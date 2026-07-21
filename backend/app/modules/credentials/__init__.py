# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Professional-credentials registry module.

A project-scoped register of the professional credentials a construction
delivery depends on (licences, certifications, statutory memberships,
professional indemnity, registrations, training) with validity windows,
renewal reminders and an optional statutory-notification obligation. It is
deliberately jurisdiction-neutral - it stores what a credential is and when it
is valid, never a country's rule; per-country vocabularies come from the
regional packs.

This register is distinct from the narrower certification tables elsewhere
(per-resource, per-safety-worker, per-subcontractor): it answers the
cross-cutting "which people and firms on this project hold which credentials,
are any about to lapse, and do we owe an authority a notification" question,
and emits ``credentials.expiry.alert`` on a lapse transition so a notification
subscriber can warn the team.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions."""
    from app.modules.credentials.permissions import register_credentials_permissions

    register_credentials_permissions()
