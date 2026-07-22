# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Source-data (prerequisite documents) register module.

A project-scoped register of the prerequisite source documents a construction
delivery depends on before work can start (permits, surveys, geotechnical
reports, technical conditions, title deeds, approvals, technical specifications;
RU: ИРД) with validity windows, renewal reminders, an optional shelf-life and a
schedule-blocking flag. Alongside the documents it keeps a completeness
checklist of the prerequisites a project still needs.

It is deliberately jurisdiction-neutral - it stores what a document is and when
it is valid, never a country's rule; per-country vocabularies come from the
regional packs. It emits ``source_data.expiry.alert`` on a lapse transition so a
notification subscriber can warn the team, ships a ``source_data_completeness``
validation rule, and can assemble a structured "defective or missing source
data" notice for the correspondence module to turn into a letter.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions and validation rules."""
    from app.modules.source_data.permissions import register_source_data_permissions
    from app.modules.source_data.validators import register_source_data_rules

    register_source_data_permissions()
    register_source_data_rules()
