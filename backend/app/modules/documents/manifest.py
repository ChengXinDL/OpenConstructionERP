# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Project Files module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_documents",
    version="0.1.0",
    display_name="Project Files",
    description="Upload, categorize, and manage project files with tagging and search",
    author="OpenConstructionERP Core Team",
    category="core",
    depends=["oe_projects"],
    auto_install=True,
    enabled=True,
)
