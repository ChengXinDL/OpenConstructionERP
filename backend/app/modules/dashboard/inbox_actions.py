# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Acting on an inbox row: acknowledge, dismiss, restore.

The inbox aggregates rows that live in other modules, so "clearing" one cannot
mean deleting it. What it means here is precise, and the precision is the point:

* **acknowledge** - the row stays on the list, flagged, so it can recede
  without vanishing. Nothing in any other module changes.
* **dismiss** - the row leaves the list. For an alert that is the whole truth,
  because the same action marks the underlying notification read and the
  notifications screen agrees. For an approval it is triage only: the step
  stays ``pending`` and stays visible where it lives. Hiding an obligation is
  not discharging one, and the ``inbox_action.dismissal_decides_nothing`` rule
  records that on the row so an audit can tell the two apart.
* **restore** - forget the state and put the row back. A dismissed alert is
  marked unread again, otherwise "restore" would clear the flag and leave the
  row invisible anyway.

Ownership is checked before anything is written. The read path silently drops
rows the caller cannot see; a write must not, so an id that is not in the
caller's own inbox answers 404 rather than quietly recording a state. The check
runs against the inbox built *without* states applied, so acting twice on the
same row still resolves.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.validation.engine import Severity, validation_engine
from app.modules.dashboard.inbox_logic import (
    SOURCE_NOTIFICATION,
    STATE_DISMISSED,
    parse_item_id,
)
from app.modules.dashboard.repository import InboxItemStateRepository
from app.modules.dashboard.validators import INBOX_ACTION_RULE_SET
from app.modules.projects.models import Project

logger = logging.getLogger(__name__)

#: Generous cap for the ownership check. The caller's inbox is built unfiltered
#: purely to answer "is this id yours?", so the list must not be truncated
#: before the id in question appears.
_OWNERSHIP_SCAN_LIMIT = 2000


class InboxItemNotFound(Exception):
    """The item id is not in the caller's inbox (or is not theirs at all)."""


class InboxActionInvalid(Exception):
    """The action failed a rule the module treats as blocking.

    Carries the findings so the router can name every reason rather than
    returning a bare 422.
    """

    def __init__(self, findings: list[dict[str, Any]]) -> None:
        super().__init__("The inbox action did not pass validation")
        self.findings = findings


def _finding(result: Any) -> dict[str, Any]:
    """One failing rule result, in the shape persisted on the state row."""
    return {
        "rule_id": result.rule_id,
        "severity": str(result.severity),
        "message": result.message,
        "suggestion": result.suggestion,
    }


class InboxActionService:
    """Record what a user did with one row of their unified inbox."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = InboxItemStateRepository(session)

    async def _validate(self, item_id: str, state: str) -> list[dict[str, Any]]:
        """Run the inbox-action rule set, blocking on ERROR findings.

        Returns the non-blocking findings to persist. A rule set that resolved
        to nothing is reported as such rather than treated as a pass: an
        unregistered rule set and a clean action look identical from here, and
        only the log can tell them apart.
        """
        try:
            report = await validation_engine.validate(
                data={"item_id": item_id, "state": state},
                rule_sets=[INBOX_ACTION_RULE_SET],
                target_type="inbox_item",
                target_id=item_id,
            )
        except Exception:  # noqa: BLE001 - a broken engine must not wedge the inbox
            logger.warning("Inbox action validation failed to run", exc_info=True)
            return []

        if report.unsupported_rule_sets and not report.supported_rule_sets:
            logger.warning(
                "Rule set %s resolved to no rules; the inbox action was not validated",
                INBOX_ACTION_RULE_SET,
            )
            return []

        failing = [r for r in report.results if not r.passed and not r.is_engine_error]
        blocking = [r for r in failing if r.severity == Severity.ERROR]
        if blocking:
            raise InboxActionInvalid([_finding(r) for r in blocking])
        return [_finding(r) for r in failing]

    async def _own_item(
        self,
        projects: list[Project],
        user_id: str,
        item_id: str,
        *,
        is_admin: bool,
    ) -> dict[str, Any]:
        """The caller's own inbox row with this id, or raise.

        Built with ``apply_states=False`` so a row the caller already
        acknowledged or dismissed can still be acted on again.
        """
        from app.modules.dashboard.inbox import compute_inbox  # noqa: PLC0415

        payload = await compute_inbox(
            self.session,
            projects,
            user_id,
            is_admin=is_admin,
            limit=_OWNERSHIP_SCAN_LIMIT,
            apply_states=False,
        )
        for item in payload.get("items", []):
            if str(item.get("id") or "") == item_id:
                return item
        raise InboxItemNotFound(item_id)

    async def act(
        self,
        projects: list[Project],
        user_id: str,
        *,
        item_id: str,
        state: str,
        is_admin: bool = False,
    ) -> tuple[str, list[dict[str, Any]]]:
        """Acknowledge or dismiss one row of the caller's inbox.

        Returns the recorded state and any non-blocking findings.

        Raises:
            InboxItemNotFound: the id is not in the caller's inbox.
            InboxActionInvalid: a blocking rule failed.
        """
        parsed = parse_item_id(item_id)
        if parsed is None:
            # Malformed ids never reach the ownership scan: an id that cannot
            # be parsed cannot match a row, and 422 with the reason is more
            # use to the caller than a 404 that says only "not found".
            findings = await self._validate(item_id, state)
            raise InboxActionInvalid(findings or [{"rule_id": "inbox_action.item_id_recognised"}])
        source, source_id = parsed

        await self._own_item(projects, user_id, item_id, is_admin=is_admin)
        findings = await self._validate(item_id, state)

        uid = uuid.UUID(str(user_id))
        await self.repo.upsert(
            uid,
            item_id,
            source=source,
            source_id=source_id,
            state=state,
            findings=findings,
        )

        if source == SOURCE_NOTIFICATION and state == STATE_DISMISSED:
            # Keep the notifications screen and the inbox telling the same
            # story: an alert cleared here is an alert read there.
            await self._set_notification_read(source_id, uid, read=True)

        return state, findings

    async def restore(
        self,
        user_id: str,
        item_id: str,
    ) -> bool:
        """Put a row back on the caller's list. Returns False when nothing was set.

        Ownership comes from the state row itself: a state row is per-person
        and could only have been written after the ownership check above, so a
        caller holding one for this id is by construction the owner. That also
        sidesteps a real chicken-and-egg problem - a dismissed alert has been
        marked read, so it is no longer in the inbox to be matched against.
        """
        uid = uuid.UUID(str(user_id))
        existing = await self.repo.get(uid, item_id)
        if existing is None:
            return False
        was_dismissed_alert = existing.source == SOURCE_NOTIFICATION and existing.state == STATE_DISMISSED
        source_id = existing.source_id
        cleared = await self.repo.clear(uid, item_id)
        if cleared and was_dismissed_alert:
            # Dismissing marked it read; restoring has to undo that or the row
            # would stay invisible with its state gone, which is the worst of
            # both answers.
            await self._set_notification_read(source_id, uid, read=False)
        return cleared

    async def _set_notification_read(
        self,
        notification_id: str,
        user_id: uuid.UUID,
        *,
        read: bool,
    ) -> None:
        """Flip one of the caller's own notifications between read and unread.

        Scoped to ``user_id`` so the statement cannot touch anybody else's row
        even if an id from another account were somehow supplied. Wrapped
        because a slim install may have the notifications module disabled, in
        which case the inbox state alone is the right outcome rather than a
        failed action.
        """
        try:
            from datetime import UTC, datetime  # noqa: PLC0415

            from sqlalchemy import update  # noqa: PLC0415

            from app.modules.notifications.models import Notification  # noqa: PLC0415

            await self.session.execute(
                update(Notification)
                .where(Notification.id == uuid.UUID(notification_id))
                .where(Notification.user_id == user_id)
                .values(is_read=read, read_at=datetime.now(UTC) if read else None)
            )
        except Exception:  # noqa: BLE001 - a disabled module must not fail the action
            logger.warning(
                "Could not update notification %s read state to %s",
                notification_id,
                read,
                exc_info=True,
            )


__all__ = [
    "InboxActionInvalid",
    "InboxActionService",
    "InboxItemNotFound",
]
