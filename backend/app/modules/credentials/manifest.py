# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Professional-credentials registry module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_credentials",
    version="0.1.0",
    display_name="Credentials Registry",
    description=(
        "Project register of the professional credentials a delivery relies "
        "on - licences, certifications, statutory memberships, professional "
        "indemnity, registrations and training - with validity windows, "
        "renewal reminders and optional statutory-notification obligations. "
        "Jurisdiction-neutral: the register tracks what a credential is and "
        "when it is valid; regional packs supply the country-specific "
        "vocabularies."
    ),
    author="OpenConstructionERP Core Team",
    category="core",
    depends=["oe_users", "oe_projects"],
    auto_install=True,
    enabled=True,
)
