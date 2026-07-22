# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Authority-submission (XML document) factory module.

A generic engine for producing, validating and rendering the structured XML
documents a construction delivery has to hand to an authority - a building
authority, a client's tender portal, a national expertise body. The engine is
jurisdiction-neutral: it is driven entirely by *profiles* (schema definitions
carried as data), so a new submission format is a new profile row, never new
code.

Why "as data"
=============
Every jurisdiction has its own XML dialect for the same act (submit a tender,
lodge an expertise package, hand over an asset register). The DACH GAEB X83
tender exchange is the proven pattern this generalises: a root element, a fixed
set of expected fields, a schema version. Rather than hard-code one country, the
module ships a ``field_spec`` per profile and a single deterministic builder
that walks it. The built-in profiles are deliberately neutral (a generic XML
document, a GAEB-X83-shaped tender example, a COBie-shaped handover example);
regional packs - e.g. RU Minstroy expertise XML - plug in as additional profile
rows with their own ``field_spec`` and ``root_element``.

Pipeline per submission: ``draft -> validated -> signed_pending -> submitted ->
accepted | rejected``. A submission must validate cleanly against its profile's
``field_spec`` before it can be marked submitted (rule
``authority_submission.schema_valid``). The same structured payload is the
single source for both the machine XML (``generate_xml``) and the human-readable
review (``render``).
"""


async def on_startup() -> None:
    """Module startup hook - register permissions and the schema-valid rule."""
    from app.modules.authority_submission.permissions import (
        register_authority_submission_permissions,
    )
    from app.modules.authority_submission.validators import (
        register_authority_submission_rules,
    )

    register_authority_submission_permissions()
    register_authority_submission_rules()
