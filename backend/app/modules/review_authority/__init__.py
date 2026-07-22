# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""External-review-authority (expertise cycle) module.

Manages the review cycle a project runs with an external approving authority -
state expertise, building control, an authority having jurisdiction, or a
technical review board. It tracks the submission, the document version pinned at
submission, the remarks the authority issues, the responses back, and the final
decision, on an SLA clock.

Three things this module owns that a plain register cannot:

* a version-pin + stale-version detector, so a remark raised against the
  submitted drawing set is flagged the moment the live document moves on rather
  than silently re-mapped;
* a contestability classifier that flags a remark with no cited norm reference
  as ``no_norm_ref_contestable`` for human confirmation - it never auto-decides
  contestability;
* a repeat-remark radar that links a new remark to a prior *accepted* one it
  closely repeats, so a reviewer sees the authority re-raising a settled point.

Jurisdiction-neutral: it models the cycle and its evidence, never a country's
rulebook; per-country authority vocabularies come from the regional packs.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions and validation rules."""
    from app.modules.review_authority.permissions import register_review_authority_permissions
    from app.modules.review_authority.validators import (
        register_review_authority_validation_rules,
    )

    register_review_authority_permissions()
    register_review_authority_validation_rules()
