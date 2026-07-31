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

Alongside the credentials themselves the module holds what the project
*requires* - which credential types are demanded of whom, whether a gap stops
work or is merely noted, and how long a lapse is tolerated - and joins the two
into a compliance report that names the people who may not work today. Because
nothing rewrites a stored status as the calendar moves, expiry is derived on
every read from the dates rather than trusted from the column; the column is a
cache that ``POST /refresh-statuses/`` converges on demand.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's permissions and its validation rules. Both are
    idempotent - the registries overwrite by code and by rule id - so a hot
    reload re-registers cleanly.

    The rules must be registered here and not only where they are used: a rule
    set that resolves to no rules is reported by the engine as unsupported,
    which in the payload is indistinguishable from "the rules ran and found
    nothing wrong". A credentials report that quietly checks nothing is worse
    than no report at all.
    """
    from app.modules.credentials.permissions import register_credentials_permissions
    from app.modules.credentials.validators import register_credentials_rules

    register_credentials_permissions()
    register_credentials_rules()
