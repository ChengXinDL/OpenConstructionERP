# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Project Member API schemas.

The Team Strip on ProjectDetailPage works at the project level rather than the
fine-grained ``Team`` level. Internally each project gets a "Default Team"
on creation (see ``ProjectService.create_project``); these schemas describe the
project-member contract exposed at ``/api/v1/projects/{project_id}/members/``.

Each ``ProjectMemberResponse`` is a denormalised view of a row in
``oe_teams_membership`` joined to ``oe_users_user`` so the frontend can render
avatar circles (initials + tooltip) without a second roundtrip.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectMemberResponse(BaseModel):
    """A single project member.

    ``user_id`` is the canonical join key; ``email`` and ``full_name`` are
    pre-joined for the avatar tooltip + initials. ``role`` mirrors the team
    membership role and accepts the broadened whitelist (``member`` / ``lead``
    / ``owner`` / ``estimator`` / ``viewer`` / ``project_manager``).
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str
    full_name: str = ""
    role: str = "member"
    is_owner: bool = False
    created_at: datetime | None = None


class AddProjectMemberRequest(BaseModel):
    """Add a user to the project's default team."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    user_id: UUID
    role: str = Field(
        default="member",
        pattern=r"^(member|lead|owner|estimator|viewer|project_manager)$",
    )


class BulkAddProjectMembersRequest(BaseModel):
    """Invite several users to the project at once (mass invite).

    This is the "open the CDE to the whole team" path, so it is subject to the
    CDE go-live gate: when the gate is enabled the project's common data
    environment must have reached the required readiness level before the bulk
    invite is allowed.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    members: list[AddProjectMemberRequest] = Field(min_length=1, max_length=200)


class BulkAddProjectMembersResponse(BaseModel):
    """Result of a mass invite: the members added this call."""

    added: list[ProjectMemberResponse] = Field(default_factory=list)
