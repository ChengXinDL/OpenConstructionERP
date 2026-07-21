# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""FastAPI router for the professional-credentials registry.

Auto-mounted at ``/api/v1/credentials/``. Every endpoint is project-scoped via
:func:`app.dependencies.verify_project_access` - the same guard the compliance
docs and RFI modules use - so a caller cannot see or mutate credentials on a
project they lack access to, and a cross-project id surfaces as 404 (not 403) so
the endpoint can't be turned into an id-existence oracle.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query

from app.dependencies import (
    CurrentUserId,
    LangDep,
    RequirePermission,
    SessionDep,
    verify_project_access,
)
from app.modules.credentials import intl
from app.modules.credentials.schemas import (
    CREDENTIAL_TYPES,
    HOLDER_KINDS,
    STATUSES,
    CredentialCreate,
    CredentialResponse,
    CredentialUpdate,
)
from app.modules.credentials.service import CredentialService

router = APIRouter(tags=["credentials"])


def _get_service(session: SessionDep) -> CredentialService:
    return CredentialService(session)


def _to_response(item: object) -> CredentialResponse:
    """Build a response with the computed ``days_until_expiry``.

    ``None`` for a perpetual credential (no ``valid_until``); otherwise a signed
    day count - negative once expired.
    """
    valid_until = getattr(item, "valid_until", None)
    days_until_expiry: int | None = None
    if valid_until is not None:
        try:
            days_until_expiry = (valid_until - datetime.now(UTC).date()).days
        except TypeError:  # pragma: no cover - defensive
            days_until_expiry = None

    resp = CredentialResponse.model_validate(item)
    return resp.model_copy(update={"days_until_expiry": days_until_expiry})


@router.get(
    "/meta",
    dependencies=[Depends(RequirePermission("credentials.read"))],
)
async def get_meta(lang: LangDep) -> dict:
    """Expose the validated vocabularies with localized labels for the UI.

    The frontend builds its type / status pickers from this payload so it never
    drifts from the server-side whitelists, and the labels come pre-translated
    for the requested locale (falling back to English).
    """
    return {
        "credential_types": [{"code": c, "label": intl.describe_type(c, lang)} for c in CREDENTIAL_TYPES],
        "holder_kinds": list(HOLDER_KINDS),
        "statuses": [{"code": s, "label": intl.describe_status(s, lang)} for s in STATUSES],
    }


@router.get(
    "/",
    response_model=list[CredentialResponse],
    dependencies=[Depends(RequirePermission("credentials.read"))],
)
async def list_credentials(
    user_id: CurrentUserId,
    session: SessionDep,
    project_id: uuid.UUID = Query(...),
    status_filter: str | None = Query(default=None, alias="status"),
    credential_type: str | None = Query(default=None),
    holder_user_id: uuid.UUID | None = Query(default=None),
    service: CredentialService = Depends(_get_service),
) -> list[CredentialResponse]:
    """List credentials for a project, optionally filtered."""
    await verify_project_access(project_id, user_id, session)
    items = await service.list_credentials(
        project_id,
        status=status_filter,
        credential_type=credential_type,
        holder_user_id=holder_user_id,
    )
    return [_to_response(i) for i in items]


@router.get(
    "/expiring-soon/",
    response_model=list[CredentialResponse],
    dependencies=[Depends(RequirePermission("credentials.read"))],
)
async def list_expiring_soon(
    user_id: CurrentUserId,
    session: SessionDep,
    project_id: uuid.UUID = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
    service: CredentialService = Depends(_get_service),
) -> list[CredentialResponse]:
    """Credentials already expired or due within their reminder window.

    Ascending by expiry - designed for the dashboard "credentials to renew"
    widget.
    """
    await verify_project_access(project_id, user_id, session)
    items = await service.list_expiring_soon(project_id, limit=limit)
    return [_to_response(i) for i in items]


@router.post(
    "/",
    response_model=CredentialResponse,
    status_code=201,
)
async def create_credential(
    data: CredentialCreate,
    user_id: CurrentUserId,
    session: SessionDep,
    _perm: None = Depends(RequirePermission("credentials.create")),
    service: CredentialService = Depends(_get_service),
) -> CredentialResponse:
    """Register a new credential against a project."""
    await verify_project_access(data.project_id, user_id, session)
    credential = await service.create_credential(data, user_id=user_id)
    return _to_response(credential)


@router.get(
    "/{credential_id}/",
    response_model=CredentialResponse,
    dependencies=[Depends(RequirePermission("credentials.read"))],
)
async def get_credential(
    credential_id: uuid.UUID,
    user_id: CurrentUserId,
    session: SessionDep,
    service: CredentialService = Depends(_get_service),
) -> CredentialResponse:
    """Read a single credential."""
    credential = await service.get_credential(credential_id)
    await verify_project_access(credential.project_id, user_id, session)
    return _to_response(credential)


@router.patch(
    "/{credential_id}/",
    response_model=CredentialResponse,
)
async def update_credential(
    credential_id: uuid.UUID,
    data: CredentialUpdate,
    user_id: CurrentUserId,
    session: SessionDep,
    _perm: None = Depends(RequirePermission("credentials.update")),
    service: CredentialService = Depends(_get_service),
) -> CredentialResponse:
    """Patch a credential. Status is recomputed unless a manual status is set."""
    existing = await service.get_credential(credential_id)
    await verify_project_access(existing.project_id, user_id, session)
    credential = await service.update_credential(credential_id, data, user_id=user_id)
    return _to_response(credential)


@router.delete(
    "/{credential_id}/",
    status_code=204,
)
async def delete_credential(
    credential_id: uuid.UUID,
    user_id: CurrentUserId,
    session: SessionDep,
    _perm: None = Depends(RequirePermission("credentials.delete")),
    service: CredentialService = Depends(_get_service),
) -> None:
    """Delete a credential."""
    existing = await service.get_credential(credential_id)
    await verify_project_access(existing.project_id, user_id, session)
    await service.delete_credential(credential_id)


__all__ = ["router"]
