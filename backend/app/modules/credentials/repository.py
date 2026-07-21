# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Professional-credentials data-access layer."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.credentials.models import Credential

# The expiry-alert buckets, shared by the "expiring soon" query and the
# dashboard widget. A perpetual credential (no valid_until) never enters these.
_ALERT_STATUSES: tuple[str, ...] = ("expiring_soon", "expired")


class CredentialRepository:
    """Data access for :class:`Credential` rows."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, credential_id: uuid.UUID) -> Credential | None:
        return await self.session.get(Credential, credential_id)

    async def list_for_project(
        self,
        project_id: uuid.UUID,
        *,
        status: str | None = None,
        credential_type: str | None = None,
        holder_user_id: uuid.UUID | None = None,
    ) -> list[Credential]:
        stmt = select(Credential).where(Credential.project_id == project_id)
        if status is not None:
            stmt = stmt.where(Credential.status == status)
        if credential_type is not None:
            stmt = stmt.where(Credential.credential_type == credential_type)
        if holder_user_id is not None:
            stmt = stmt.where(Credential.holder_user_id == holder_user_id)
        # Perpetual credentials (NULL valid_until) sort last; the rest ascend by
        # expiry so the most-urgent rows lead, matching the UI default.
        stmt = stmt.order_by(
            Credential.valid_until.is_(None),
            Credential.valid_until.asc(),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_expiring_soon(
        self,
        project_id: uuid.UUID,
        *,
        limit: int = 50,
    ) -> list[Credential]:
        stmt = (
            select(Credential)
            .where(
                Credential.project_id == project_id,
                Credential.status.in_(_ALERT_STATUSES),
            )
            .order_by(Credential.valid_until.asc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, credential: Credential) -> Credential:
        self.session.add(credential)
        await self.session.flush()
        return credential

    async def delete(self, credential_id: uuid.UUID) -> None:
        row = await self.get_by_id(credential_id)
        if row is not None:
            await self.session.delete(row)
            await self.session.flush()
