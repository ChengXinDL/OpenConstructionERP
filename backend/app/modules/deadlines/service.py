# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cross-module deadline aggregator - query + normalise layer.

Modeled directly on :mod:`app.modules.dashboard.inbox`. Each collector imports
its sibling model **inside** the function, and the caller wraps every collector
in ``try/except`` + ``session.rollback()`` so one disabled or broken source only
blanks its own rows - never the whole register or the sweep. This introduces no
new store: it reads the existing per-module tables and normalises them into the
transport ``DeadlineItem`` shape (see :mod:`schemas`). The pure filter/sort/count
logic lives in :mod:`logic` (DB-free, unit-tested).

Deadline sources (first slice), with their pinned terminal (closed) status
vocabularies - read from each source's service layer:

* correspondence response deadlines - ``oe_correspondence_correspondence``.
* NCR corrective actions - ``oe_qms_ncr_action`` (project via parent ``QMSNCR``).
* punch items - ``oe_punchlist_item``.

Expansion adapters (tasks, QMS audit findings, DLP defects, credentials expiry)
are a deliberate follow-up; file approvals already own their overdue sweep via
``approval_routes/sla_monitor.py`` so they are intentionally NOT collected here.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.deadlines.logic import ON_TIME, OVERDUE, build_register, classify, parse_due
from app.modules.deadlines.schemas import DeadlineItem, DeadlineRegisterResponse
from app.modules.projects.models import Project

logger = logging.getLogger(__name__)

# Cap rows pulled per source so a tenant with tens of thousands of open items
# can't drag the sweep/register down. Ordered by due date ascending so the
# most-overdue rows fall inside the cap (mirror ``inbox.py`` per-source cap).
_PER_SOURCE_CAP = 500

# Per-source terminal (closed) status vocabularies, pinned against each source's
# service layer. Anything NOT in the terminal set is treated as still-open - a
# terminal-EXCLUSION model, so an unknown intermediate status still surfaces an
# overdue item rather than silently dropping it (see logic.classify).
_CORRESPONDENCE_TERMINAL = {"responded", "closed"}
_NCR_ACTION_TERMINAL = {"done", "cancelled"}
_PUNCH_TERMINAL = {"closed", "verified"}

# A signature for a source collector.
_Collector = Callable[
    [AsyncSession, "list[uuid.UUID] | None", date, int],
    Awaitable[list[DeadlineItem]],
]


def _iso_date(d: date | None) -> str | None:
    return d.isoformat() if d is not None else None


# ── Source collectors ──────────────────────────────────────────────────────


async def _collect_correspondence(
    session: AsyncSession,
    project_ids: list[uuid.UUID] | None,
    now_date: date,
    approaching_days: int,
) -> list[DeadlineItem]:
    """Open correspondence notices past / approaching their response deadline."""
    from app.modules.correspondence.models import Correspondence  # noqa: PLC0415

    stmt = select(Correspondence).where(
        Correspondence.status.not_in(_CORRESPONDENCE_TERMINAL),
        Correspondence.response_required_by.is_not(None),
    )
    if project_ids is not None:
        stmt = stmt.where(Correspondence.project_id.in_(project_ids))
    stmt = stmt.order_by(Correspondence.response_required_by.asc()).limit(_PER_SOURCE_CAP)
    rows = (await session.execute(stmt)).scalars().all()

    items: list[DeadlineItem] = []
    for r in rows:
        due = parse_due(r.response_required_by)
        cls, days, sev = classify(due, r.status, now_date, _CORRESPONDENCE_TERMINAL, approaching_days)
        if cls == ON_TIME:
            continue
        items.append(
            DeadlineItem(
                id=f"correspondence:{r.id}",
                module="correspondence",
                entity_type="correspondence",
                entity_id=str(r.id),
                project_id=str(r.project_id),
                title=r.subject,
                due_date=_iso_date(due),
                # Correspondence has no true assignee - the creator is the
                # best-effort owner. The sweep falls back to project managers
                # for an actionable recipient (see sweeper).
                owner_user_id=r.created_by,
                status=r.status,
                classification=cls,
                days_overdue=days,
                severity=sev,
                action_url="/correspondence",
            ),
        )
    return items


async def _collect_ncr_actions(
    session: AsyncSession,
    project_ids: list[uuid.UUID] | None,
    now_date: date,
    approaching_days: int,
) -> list[DeadlineItem]:
    """NCR corrective actions past / approaching their due date.

    Project scope comes from the parent ``QMSNCR``; an action whose parent NCR
    is missing is dropped (no project scope -> safe default).
    """
    from app.modules.qms.models import QMSNCR, QMSNCRAction  # noqa: PLC0415

    stmt = (
        select(QMSNCRAction, QMSNCR.project_id, QMSNCR.id)
        .join(QMSNCR, QMSNCR.id == QMSNCRAction.ncr_id)
        .where(
            QMSNCRAction.status.not_in(_NCR_ACTION_TERMINAL),
            QMSNCRAction.due_date.is_not(None),
        )
    )
    if project_ids is not None:
        stmt = stmt.where(QMSNCR.project_id.in_(project_ids))
    stmt = stmt.order_by(QMSNCRAction.due_date.asc()).limit(_PER_SOURCE_CAP)
    rows = (await session.execute(stmt)).all()

    items: list[DeadlineItem] = []
    for action, project_id, ncr_id in rows:
        due = parse_due(action.due_date)
        cls, days, sev = classify(due, action.status, now_date, _NCR_ACTION_TERMINAL, approaching_days)
        if cls == ON_TIME:
            continue
        owner = str(action.responsible_user_id) if action.responsible_user_id else None
        title = (action.description or "").strip()[:200] or "NCR corrective action"
        items.append(
            DeadlineItem(
                id=f"qms_ncr_action:{action.id}",
                module="qms_ncr_action",
                entity_type="qms_ncr_action",
                entity_id=str(action.id),
                project_id=str(project_id),
                title=title,
                due_date=_iso_date(due),
                owner_user_id=owner,
                status=action.status,
                classification=cls,
                days_overdue=days,
                severity=sev,
                # Deep-link to the parent NCR (NCRPage reads ?highlight=<id>).
                action_url=f"/ncr?highlight={ncr_id}",
            ),
        )
    return items


async def _collect_punch_items(
    session: AsyncSession,
    project_ids: list[uuid.UUID] | None,
    now_date: date,
    approaching_days: int,
) -> list[DeadlineItem]:
    """Punch items past / approaching their due date."""
    from app.modules.punchlist.models import PunchItem  # noqa: PLC0415

    stmt = select(PunchItem).where(
        PunchItem.status.not_in(_PUNCH_TERMINAL),
        PunchItem.due_date.is_not(None),
    )
    if project_ids is not None:
        stmt = stmt.where(PunchItem.project_id.in_(project_ids))
    stmt = stmt.order_by(PunchItem.due_date.asc()).limit(_PER_SOURCE_CAP)
    rows = (await session.execute(stmt)).scalars().all()

    items: list[DeadlineItem] = []
    for r in rows:
        # due_date is a real DateTime(tz) column here; parse_due handles it.
        due = parse_due(r.due_date)
        cls, days, sev = classify(due, r.status, now_date, _PUNCH_TERMINAL, approaching_days)
        if cls == ON_TIME:
            continue
        items.append(
            DeadlineItem(
                id=f"punchlist:{r.id}",
                module="punchlist",
                entity_type="punch_item",
                entity_id=str(r.id),
                project_id=str(r.project_id),
                title=r.title,
                due_date=_iso_date(due),
                owner_user_id=r.assigned_to,
                status=r.status,
                classification=cls,
                days_overdue=days,
                severity=sev,
                action_url=f"/punchlist?highlight={r.id}",
            ),
        )
    return items


# Collector registry: (module_key, collector, owns_overdue_sweep).
#
# ``owns_overdue_sweep`` guards against double-notification (spec risk): a
# source that later grows its OWN overdue sweep is dropped from the deadline
# sweeper's notify path (still shown in the read-only register). None of the
# three first-slice sources self-sweep today, so all are False.
_COLLECTORS: list[tuple[str, _Collector, bool]] = [
    ("correspondence", _collect_correspondence, False),
    ("qms_ncr_action", _collect_ncr_actions, False),
    ("punchlist", _collect_punch_items, False),
]


async def _collect_all(
    session: AsyncSession,
    project_ids: list[uuid.UUID] | None,
    now_date: date,
    approaching_days: int,
    *,
    module: str | None = None,
    for_sweep: bool = False,
) -> list[DeadlineItem]:
    """Run every matching collector, fail-soft per source.

    ``module`` filters to a single source. ``for_sweep`` drops any source that
    owns its own overdue sweep (they still appear in the register but must not
    be double-notified by this sweeper).
    """
    collected: list[DeadlineItem] = []
    for module_key, collector, owns_sweep in _COLLECTORS:
        if module is not None and module != module_key:
            continue
        if for_sweep and owns_sweep:
            continue
        try:
            collected.extend(await collector(session, project_ids, now_date, approaching_days))
        except Exception as exc:  # noqa: BLE001 - one broken/disabled source != broken register
            logger.warning("Deadline source %s failed: %s", module_key, exc, exc_info=True)
            # A failed statement aborts the PG transaction; roll back so the
            # next collector runs on a clean session.
            try:
                await session.rollback()
            except Exception:  # noqa: BLE001
                pass
    return collected


async def _resolve_project_names(session: AsyncSession, items: list[DeadlineItem]) -> None:
    """Fill ``project_name`` on each item from a single Project id->name map."""
    if not items:
        return
    ids: set[uuid.UUID] = set()
    for it in items:
        try:
            ids.add(uuid.UUID(it.project_id))
        except (ValueError, TypeError):
            pass
    if not ids:
        return
    try:
        rows = (await session.execute(select(Project.id, Project.name).where(Project.id.in_(ids)))).all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Deadline project-name resolve failed: %s", exc, exc_info=True)
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return
    name_by_id = {pid: name for pid, name in rows}
    for it in items:
        try:
            it.project_name = name_by_id.get(uuid.UUID(it.project_id))
        except (ValueError, TypeError):
            pass


async def _resolve_owner_names(session: AsyncSession, items: list[DeadlineItem]) -> None:
    """Fill ``owner_name`` on each item from a single User id->name map.

    Owners are stored as ids (String36 / GUID); a non-UUID owner (correspondence
    ``created_by`` may be free text) simply stays unresolved. Fail-soft.
    """
    if not items:
        return
    ids: set[uuid.UUID] = set()
    for it in items:
        if not it.owner_user_id:
            continue
        try:
            ids.add(uuid.UUID(it.owner_user_id))
        except (ValueError, TypeError):
            pass
    if not ids:
        return
    try:
        from app.modules.users.models import User  # noqa: PLC0415

        rows = (await session.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Deadline owner-name resolve failed: %s", exc, exc_info=True)
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return
    name_by_id = {uid: (full_name or email or None) for uid, full_name, email in rows}
    for it in items:
        if not it.owner_user_id:
            continue
        try:
            it.owner_name = name_by_id.get(uuid.UUID(it.owner_user_id))
        except (ValueError, TypeError):
            pass


async def compute_deadlines(
    session: AsyncSession,
    project_ids: list[uuid.UUID] | None,
    *,
    now: datetime | None = None,
    status: str = "all",
    module: str | None = None,
    approaching_days: int = 3,
    limit: int = 200,
) -> DeadlineRegisterResponse:
    """Aggregate overdue + approaching items across sources into one register.

    ``project_ids`` scopes the query (the router passes the caller's verified
    project). Each source is fail-soft, so a disabled module only blanks its
    own rows. Counts are pre-cap (see :func:`logic.build_register`).
    """
    now_dt = now or datetime.now(UTC)
    collected = await _collect_all(
        session,
        project_ids,
        now_dt.date(),
        approaching_days,
        module=module,
    )
    await _resolve_project_names(session, collected)
    await _resolve_owner_names(session, collected)
    return build_register(collected, status=status, limit=limit, now=now_dt)


async def collect_overdue_for_sweep(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    project_ids: list[uuid.UUID] | None = None,
) -> list[DeadlineItem]:
    """All currently-overdue items for the sweeper.

    ``project_ids=None`` scans every project (the timer's global sweep); a list
    scopes it (the manual ``POST /sweep`` on one project). Drops sources that own
    their own overdue sweep, keeps only ``overdue`` rows, and resolves project
    names for the notification context.
    """
    now_dt = now or datetime.now(UTC)
    collected = await _collect_all(
        session,
        project_ids,
        now_dt.date(),
        0,
        for_sweep=True,
    )
    overdue = [it for it in collected if it.classification == OVERDUE]
    await _resolve_project_names(session, overdue)
    return overdue
