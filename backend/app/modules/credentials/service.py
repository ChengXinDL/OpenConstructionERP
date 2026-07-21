# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Business logic for the professional-credentials registry.

Owns two things a data model alone cannot: deriving a credential's ``status``
from its validity window (recomputed on every write, terminal manual states
preserved) and firing a ``credentials.expiry.alert`` event the moment a
credential *transitions* into an alerting bucket, so a notification subscriber
can warn the team before a licence lapses. Both are jurisdiction-neutral - the
country-specific "notify authority within N days" content is carried as data on
the row, never as logic here.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from datetime import date as _date
from typing import Any

from fastapi import HTTPException
from fastapi import status as http_status

from app.core.events import event_bus
from app.modules.credentials.models import Credential
from app.modules.credentials.repository import CredentialRepository
from app.modules.credentials.schemas import CredentialCreate, CredentialUpdate

logger = logging.getLogger(__name__)

# Buckets whose *entry* fires the expiry alert.
_ALERT_STATUSES: frozenset[str] = frozenset({"expiring_soon", "expired"})

# Manual states the date-derive path must never overwrite. ``revoked`` is
# terminal (a revoked credential cannot be reinstated in place - issue a new
# one); ``suspended`` is reversible back to a live state.
_MANUAL_STATUSES: frozenset[str] = frozenset({"suspended", "revoked"})
_TERMINAL_STATUSES: frozenset[str] = frozenset({"revoked"})


def recompute_status(
    today: _date,
    valid_until: _date | None,
    notify_days_before: int,
    *,
    current_status: str | None = None,
) -> str:
    """Derive ``status`` from the validity window.

    Pure function so unit tests drive it without a session.

    Rules:
        - A ``suspended`` / ``revoked`` credential keeps that manual state - the
          auto-derive path never flips it back to active.
        - ``valid_until is None`` → ``active`` (a perpetual credential that
          never expires).
        - ``today > valid_until`` → ``expired``.
        - ``valid_until - today <= notify_days_before`` → ``expiring_soon``
          (inclusive on the boundary day so a reminder is never skipped).
        - Otherwise → ``active``.
    """
    if current_status in _MANUAL_STATUSES:
        return current_status  # type: ignore[return-value]
    if valid_until is None:
        return "active"
    if today > valid_until:
        return "expired"
    delta = (valid_until - today).days
    if delta <= max(0, notify_days_before):
        return "expiring_soon"
    return "active"


class CredentialService:
    """Business logic for the credentials registry."""

    def __init__(self, session: object) -> None:
        self.session = session
        self.repo = CredentialRepository(session)  # type: ignore[arg-type]

    @staticmethod
    def _today() -> _date:
        return datetime.now(UTC).date()

    @staticmethod
    def _publish_expiry_alert(
        credential: Credential,
        *,
        previous_status: str | None,
    ) -> None:
        """Fire ``credentials.expiry.alert`` on a status transition.

        Only the *transition* into ``expiring_soon`` / ``expired`` fires - a
        PATCH that leaves the credential in the same alert bucket does not
        re-spam subscribers. ``previous_status=None`` is the create path.
        """
        if credential.status not in _ALERT_STATUSES:
            return
        if previous_status == credential.status:
            return

        try:
            today = datetime.now(UTC).date()
            days = (credential.valid_until - today).days if credential.valid_until else 0
        except TypeError:  # pragma: no cover - defensive
            days = 0

        # Detached publish so a notifications subscriber opening its own session
        # can't contend with the request's write transaction.
        event_bus.publish_detached(
            "credentials.expiry.alert",
            {
                "credential_id": str(credential.id),
                "project_id": str(credential.project_id),
                "credential_type": credential.credential_type,
                "holder_name": credential.holder_name,
                "holder_user_id": (str(credential.holder_user_id) if credential.holder_user_id else None),
                "authority": credential.authority,
                "status": credential.status,
                "valid_until": (credential.valid_until.isoformat() if credential.valid_until else None),
                "days_until_expiry": days,
                "notify_days_before": credential.notify_days_before,
                "previous_status": previous_status,
            },
            source_module="credentials",
        )

    # ── CRUD ────────────────────────────────────────────────────────────

    async def create_credential(
        self,
        data: CredentialCreate,
        *,
        user_id: str | None = None,
    ) -> Credential:
        derived_status = data.status or recompute_status(
            today=self._today(),
            valid_until=data.valid_until,
            notify_days_before=data.notify_days_before,
        )

        credential = Credential(
            project_id=data.project_id,
            holder_name=data.holder_name,
            holder_kind=data.holder_kind,
            holder_user_id=data.holder_user_id,
            credential_type=data.credential_type,
            discipline=data.discipline,
            authority=data.authority,
            identifier=data.identifier,
            jurisdiction=data.jurisdiction,
            issued_at=data.issued_at,
            valid_until=data.valid_until,
            notify_days_before=data.notify_days_before,
            notification_obligation_days=data.notification_obligation_days,
            notification_trigger=data.notification_trigger,
            status=derived_status,
            notes=data.notes,
            metadata_=data.metadata,
            created_by=user_id,
        )
        credential = await self.repo.create(credential)
        logger.info(
            "Credential created: %s (%s) for project %s",
            credential.id,
            credential.credential_type,
            credential.project_id,
        )
        self._publish_expiry_alert(credential, previous_status=None)
        return credential

    async def get_credential(self, credential_id: uuid.UUID) -> Credential:
        row = await self.repo.get_by_id(credential_id)
        if row is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Credential not found.",
            )
        return row

    async def list_credentials(
        self,
        project_id: uuid.UUID,
        *,
        status: str | None = None,
        credential_type: str | None = None,
        holder_user_id: uuid.UUID | None = None,
    ) -> list[Credential]:
        return await self.repo.list_for_project(
            project_id,
            status=status,
            credential_type=credential_type,
            holder_user_id=holder_user_id,
        )

    async def list_expiring_soon(
        self,
        project_id: uuid.UUID,
        *,
        limit: int = 50,
    ) -> list[Credential]:
        return await self.repo.list_expiring_soon(project_id, limit=limit)

    async def update_credential(
        self,
        credential_id: uuid.UUID,
        data: CredentialUpdate,
        *,
        user_id: str | None = None,
    ) -> Credential:
        credential = await self.get_credential(credential_id)
        previous_status = credential.status

        fields: dict[str, Any] = data.model_dump(exclude_unset=True)

        # Date ordering guard if either side moved.
        new_issued = fields.get("issued_at", credential.issued_at)
        new_valid = fields.get("valid_until", credential.valid_until)
        if new_issued is not None and new_valid is not None and new_valid < new_issued:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="valid_until must be on or after issued_at.",
            )

        explicit_status = fields.get("status")
        # Terminal-state contract: a revoked credential cannot be transitioned
        # out of in place - the auto-derive path already preserves it; block the
        # explicit path too so it can't be reinstated by a stray PATCH.
        if (
            explicit_status is not None
            and credential.status in _TERMINAL_STATUSES
            and explicit_status != credential.status
        ):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Cannot transition out of a terminal status.",
            )
        if explicit_status is None:
            fields["status"] = recompute_status(
                today=self._today(),
                valid_until=new_valid,
                notify_days_before=fields.get("notify_days_before", credential.notify_days_before),
                current_status=credential.status,
            )

        # Apply the mutation on the loaded instance so metadata merge and the
        # metadata column alias are handled cleanly.
        if "metadata" in fields:
            incoming = fields.pop("metadata")
            merged = dict(credential.metadata_ or {})
            if isinstance(incoming, dict):
                merged.update(incoming)
            fields["metadata_"] = merged

        if user_id is not None:
            merged_meta = dict(fields.get("metadata_") or credential.metadata_ or {})
            merged_meta["updated_by"] = user_id
            merged_meta["updated_at"] = datetime.now(UTC).isoformat()
            fields["metadata_"] = merged_meta

        for key, value in fields.items():
            setattr(credential, key, value)
        await self.session.flush()  # type: ignore[attr-defined]
        await self.session.refresh(credential)  # type: ignore[attr-defined]

        self._publish_expiry_alert(credential, previous_status=previous_status)
        return credential

    async def delete_credential(self, credential_id: uuid.UUID) -> None:
        await self.get_credential(credential_id)
        await self.repo.delete(credential_id)
