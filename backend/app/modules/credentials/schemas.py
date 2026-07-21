# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pydantic schemas for the professional-credentials registry."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ── Canonical vocabularies (open-ended; packs may extend via the DB) ───
#
# These are the built-in, jurisdiction-neutral credential families. The DB
# column is a plain String so a regional pack can persist a value outside this
# list without a migration; the API validates against the union so the built-in
# UI pickers stay honest.

CREDENTIAL_TYPES: tuple[str, ...] = (
    "professional_license",  # e.g. chartered / registered engineer or architect
    "certification",  # a competency certificate
    "statutory_membership",  # membership of a body required to practise
    "professional_indemnity",  # PI / liability cover tied to a person or firm
    "registration",  # a register entry (trade card, roster)
    "training",  # a completed training / course record
    "accreditation",  # firm-level accreditation
    "other",
)

HOLDER_KINDS: tuple[str, ...] = ("person", "company")

STATUSES: tuple[str, ...] = (
    "active",
    "expiring_soon",
    "expired",
    "suspended",
    "revoked",
)

# Statuses a caller may set explicitly; the date-derived ones are computed.
_MANUAL_STATUSES: tuple[str, ...] = ("active", "suspended", "revoked")

_CREDENTIAL_TYPE_PATTERN = "^(" + "|".join(CREDENTIAL_TYPES) + ")$"
_HOLDER_KIND_PATTERN = "^(" + "|".join(HOLDER_KINDS) + ")$"
_MANUAL_STATUS_PATTERN = "^(" + "|".join(_MANUAL_STATUSES) + ")$"


# ── Create ─────────────────────────────────────────────────────────────


class CredentialCreate(BaseModel):
    """Body for ``POST /v1/credentials/``."""

    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    holder_name: str = Field(..., min_length=1, max_length=255)
    holder_kind: str = Field(default="person", pattern=_HOLDER_KIND_PATTERN)
    holder_user_id: UUID | None = None
    credential_type: str = Field(..., pattern=_CREDENTIAL_TYPE_PATTERN)
    discipline: str | None = Field(default=None, max_length=64)
    authority: str | None = Field(default=None, max_length=255)
    identifier: str | None = Field(default=None, max_length=120)
    jurisdiction: str | None = Field(default=None, max_length=64)
    issued_at: date | None = None
    valid_until: date | None = None
    notify_days_before: int = Field(default=30, ge=0, le=365)
    notification_obligation_days: int | None = Field(default=None, ge=0, le=365)
    notification_trigger: str | None = Field(default=None, max_length=64)
    status: str | None = Field(
        default=None,
        pattern=_MANUAL_STATUS_PATTERN,
        description=(
            "Optional manual status. Only active / suspended / revoked may be "
            "set; expiring_soon / expired are derived from the validity window."
        ),
    )
    notes: str = Field(default="", max_length=10000)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _dates_consistent(self) -> CredentialCreate:
        if self.issued_at is not None and self.valid_until is not None and self.valid_until < self.issued_at:
            raise ValueError("valid_until must be on or after issued_at.")
        return self


# ── Update ─────────────────────────────────────────────────────────────


class CredentialUpdate(BaseModel):
    """Body for ``PATCH /v1/credentials/{id}``."""

    model_config = ConfigDict(str_strip_whitespace=True)

    holder_name: str | None = Field(default=None, min_length=1, max_length=255)
    holder_kind: str | None = Field(default=None, pattern=_HOLDER_KIND_PATTERN)
    holder_user_id: UUID | None = None
    credential_type: str | None = Field(default=None, pattern=_CREDENTIAL_TYPE_PATTERN)
    discipline: str | None = Field(default=None, max_length=64)
    authority: str | None = Field(default=None, max_length=255)
    identifier: str | None = Field(default=None, max_length=120)
    jurisdiction: str | None = Field(default=None, max_length=64)
    issued_at: date | None = None
    valid_until: date | None = None
    notify_days_before: int | None = Field(default=None, ge=0, le=365)
    notification_obligation_days: int | None = Field(default=None, ge=0, le=365)
    notification_trigger: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, pattern=_MANUAL_STATUS_PATTERN)
    notes: str | None = Field(default=None, max_length=10000)
    metadata: dict[str, Any] | None = None


# ── Response ───────────────────────────────────────────────────────────


class CredentialResponse(BaseModel):
    """Credential returned from the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    holder_name: str
    holder_kind: str = "person"
    holder_user_id: UUID | None = None
    credential_type: str
    discipline: str | None = None
    authority: str | None = None
    identifier: str | None = None
    jurisdiction: str | None = None
    issued_at: date | None = None
    valid_until: date | None = None
    notify_days_before: int = 30
    notification_obligation_days: int | None = None
    notification_trigger: str | None = None
    status: str = "active"
    notes: str = ""
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="metadata_",
    )
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime

    # Computed convenience field. None when the credential is perpetual
    # (no valid_until); otherwise signed - negative once expired.
    days_until_expiry: int | None = Field(
        default=None,
        description="Days to expiry: negative when expired, 0 on expiry day, None when perpetual.",
    )


__all__ = [
    "CREDENTIAL_TYPES",
    "HOLDER_KINDS",
    "STATUSES",
    "CredentialCreate",
    "CredentialResponse",
    "CredentialUpdate",
]
