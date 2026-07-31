# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Teams ORM models.

Tables:
    oe_teams_team       - project teams for entity visibility
    oe_teams_membership - user-to-team membership
    oe_teams_visibility - entity-to-team visibility restrictions

Visibility semantics
~~~~~~~~~~~~~~~~~~~~
``EntityVisibility`` rows RESTRICT, they never grant. A record with no row is
open to everyone who can already reach its project; a record with one or more
rows is reachable only by the project owner, a system admin, and the members of
the named teams. There is deliberately no direction in which a row widens what a
user can see, so no team assignment can hand out access the user did not already
hold on the parent project. See :mod:`app.modules.teams.access` for the
subtractive resolver every consumer is expected to use.
"""

import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base


class Team(Base):
    """A team within a project for visibility control."""

    __tablename__ = "oe_teams_team"

    project_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    name_translations: Mapped[dict | None] = mapped_column(  # type: ignore[assignment]
        JSON, nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    metadata_: Mapped[dict] = mapped_column(  # type: ignore[assignment]
        "metadata",
        JSON,
        nullable=False,
        default=dict,
        server_default="{}",
    )

    # Relationships
    memberships: Mapped[list["TeamMembership"]] = relationship(
        back_populates="team",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    # A team's restrictions can run to thousands of rows on a large project and
    # are never needed to render the team itself, so they are ordered
    # explicitly rather than loaded with every parent read.
    visibility_grants: Mapped[list["EntityVisibility"]] = relationship(
        back_populates="team",
        cascade="all, delete-orphan",
        lazy="raise_on_sql",
    )

    def __repr__(self) -> str:
        return f"<Team {self.name} (project={self.project_id})>"


class TeamMembership(Base):
    """Association between a user and a team."""

    __tablename__ = "oe_teams_membership"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_teams_membership_team_user"),)

    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("oe_teams_team.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("oe_users_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="member", server_default="member")

    # Relationships
    # ``raise_on_sql``: the FK column already carries the parent id, so an
    # implicit walk upwards is the async lazy-load crash, not a convenience.
    # Reading it is still free when ``Team.memberships`` populated it.
    team: Mapped[Team] = relationship(back_populates="memberships", lazy="raise_on_sql")

    def __repr__(self) -> str:
        return f"<TeamMembership team={self.team_id} user={self.user_id} ({self.role})>"


class EntityVisibility(Base):
    """Restricts one record to one team.

    The row is subtractive. Its presence turns the named record from "open to
    every member of the project" into "reachable only by the project owner, a
    system admin, and the members of the teams named by the rows on this
    record". It cannot make a record reachable to someone who could not already
    reach the project it belongs to.
    """

    __tablename__ = "oe_teams_visibility"
    __table_args__ = (
        UniqueConstraint(
            "entity_type",
            "entity_id",
            "team_id",
            name="uq_teams_visibility_entity_team",
        ),
        Index("ix_teams_visibility_entity", "entity_type", "entity_id"),
    )

    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("oe_teams_team.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Relationships
    team: Mapped[Team] = relationship(back_populates="visibility_grants", lazy="raise_on_sql")

    def __repr__(self) -> str:
        return f"<EntityVisibility {self.entity_type}/{self.entity_id} -> team={self.team_id}>"
