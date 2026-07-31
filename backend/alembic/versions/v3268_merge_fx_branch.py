# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Merge the fx rate-set branch back into the mainline.

``v3255_fx_rate_sets_and_policy`` names ``v3234_cost_search_trgm`` as its
parent. By the time it was written, ``v3234`` was long closed: it is one of
the four parents ``v3250_merge_open_heads`` already folded into the mainline,
and it sits many revisions below the tip. The result was two heads, so
``alembic upgrade head`` refused to run at all with "Multiple head revisions
are present". Nothing was wrong with the fx DDL itself, only with where it was
attached.

This revision merges the two heads and does nothing else. The alternative was
to repoint the fx revision's ``down_revision`` at the current tip, and that is
the wrong repair: any database already stamped at
``v3255_fx_rate_sets_and_policy`` would then count every revision between
``v3235`` and ``v3267`` as an ancestor it had supposedly applied, and those
migrations would be skipped in silence rather than run. Rewriting the parent of
a revision that may already be stamped somewhere loses schema. Merging keeps
both paths intact and is safe to apply from either side.

Note for anyone reading the version numbers: the fx revision is named for 3255
but sequences after 3267. The number in a revision id records when it was
written, not where it belongs in the chain, and renaming it now would break the
stamp on any install that has it. The chain is the authority, not the filename.

Revision ID: v3268_merge_fx_branch
Revises: v3267_saved_views_team_share, v3255_fx_rate_sets_and_policy
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

revision: str = "v3268_merge_fx_branch"
down_revision: Union[str, Sequence[str], None] = (
    "v3267_saved_views_team_share",
    "v3255_fx_rate_sets_and_policy",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Join the two heads. A merge carries no DDL of its own."""


def downgrade() -> None:
    """Split back into two heads. Also carries no DDL."""
