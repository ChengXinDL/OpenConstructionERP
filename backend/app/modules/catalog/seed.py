# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Demo seed data for the catalog module.

Loads a curated set of global catalog resources (labor, material, equipment,
and operator entries) with realistic base rates, price ranges, and units.

The CatalogResource table has no project_id column: resources are GLOBAL and
shared across all projects. The project_ids argument is therefore accepted for
signature compatibility with the demo seeder framework but is not used to scope
rows. Idempotency is keyed on a marker resource_code: if that row already
exists the function returns immediately.

Installs seeded before the codes were renamed carry the old ``DEMO-`` prefix.
Those rows are recoded in place rather than deleted and reinserted, see
``_recode_legacy_rows`` for why.

Safe to call repeatedly.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import CatalogResource

logger = logging.getLogger(__name__)

# Marker code used for the idempotency guard. If this row exists the whole
# seed is assumed to have run already.
_MARKER_CODE = "EU-LAB-001"

# The prefix these resources shipped under before the rename, and the marker
# that identifies an install still carrying it. An install seeded by an older
# build has 33 rows under the old prefix; without this the new marker would not
# match, the seed would run again, and the estate would end up with 66 rows and
# two of every resource. ``resource_code`` is indexed but NOT unique
# (see models.py), so nothing at the database level would stop that.
_LEGACY_PREFIX = "DEMO-"
_CODE_PREFIX = "EU-"
_LEGACY_MARKER_CODE = _LEGACY_PREFIX + _MARKER_CODE.removeprefix(_CODE_PREFIX)

# (code, name, resource_type, category, unit, base_price, min_price, max_price)
# base_price stays inside the min/max band. Prices in EUR.
_RESOURCES: tuple[tuple[str, str, str, str, str, str, str, str], ...] = (
    # --- Labor ---
    ("EU-LAB-001", "General construction laborer", "labor", "Labor - General", "h", "38.00", "32.00", "46.00"),
    ("EU-LAB-002", "Skilled carpenter", "labor", "Labor - Carpentry", "h", "52.00", "44.00", "62.00"),
    ("EU-LAB-003", "Steel fixer", "labor", "Labor - Reinforcement", "h", "49.00", "42.00", "58.00"),
    ("EU-LAB-004", "Bricklayer", "labor", "Labor - Masonry", "h", "47.00", "40.00", "55.00"),
    ("EU-LAB-005", "Electrician", "labor", "Labor - Electrical", "h", "58.00", "50.00", "70.00"),
    ("EU-LAB-006", "Plumber", "labor", "Labor - Plumbing", "h", "56.00", "48.00", "68.00"),
    ("EU-LAB-007", "Site foreman", "labor", "Labor - Supervision", "h", "72.00", "62.00", "85.00"),
    ("EU-LAB-008", "Painter and decorator", "labor", "Labor - Finishing", "h", "44.00", "37.00", "53.00"),
    # --- Material ---
    ("EU-MAT-001", "Ready-mix concrete C25/30", "material", "Concrete & Cement", "m3", "118.00", "98.00", "140.00"),
    ("EU-MAT-002", "Ready-mix concrete C30/37", "material", "Concrete & Cement", "m3", "132.00", "112.00", "158.00"),
    (
        "EU-MAT-003",
        "Reinforcement steel bar B500B",
        "material",
        "Reinforcement",
        "ton",
        "920.00",
        "820.00",
        "1080.00",
    ),
    (
        "EU-MAT-004",
        "Structural steel section S355",
        "material",
        "Structural Steel",
        "ton",
        "1450.00",
        "1280.00",
        "1690.00",
    ),
    ("EU-MAT-005", "Common clay brick", "material", "Masonry", "pcs", "0.65", "0.48", "0.92"),
    ("EU-MAT-006", "Aerated concrete block", "material", "Masonry", "pcs", "2.40", "1.90", "3.10"),
    (
        "EU-MAT-007",
        "Portland cement CEM I 42.5",
        "material",
        "Concrete & Cement",
        "ton",
        "165.00",
        "140.00",
        "195.00",
    ),
    ("EU-MAT-008", "Gypsum plasterboard 12.5 mm", "material", "Drywall & Boards", "m2", "6.80", "5.40", "8.60"),
    ("EU-MAT-009", "Mineral wool insulation 100 mm", "material", "Insulation", "m2", "11.20", "9.00", "14.50"),
    ("EU-MAT-010", "Interior emulsion paint", "material", "Paints & Coatings", "l", "8.90", "6.50", "12.00"),
    ("EU-MAT-011", "Sawn softwood timber", "material", "Timber", "m3", "420.00", "360.00", "510.00"),
    ("EU-MAT-012", "PVC drainage pipe DN110", "material", "Pipes & Drainage", "m", "9.40", "7.20", "12.80"),
    ("EU-MAT-013", "Copper electrical cable NYM 3x2.5", "material", "Electrical", "m", "3.20", "2.40", "4.60"),
    ("EU-MAT-014", "Ceramic floor tile", "material", "Tiling", "m2", "28.00", "18.00", "44.00"),
    # --- Equipment ---
    ("EU-EQP-001", "Tower crane (hire)", "equipment", "Cranes", "week", "3200.00", "2700.00", "3900.00"),
    ("EU-EQP-002", "Mobile crane 50 t (hire)", "equipment", "Cranes", "day", "980.00", "820.00", "1180.00"),
    ("EU-EQP-003", "Crawler excavator 20 t (hire)", "equipment", "Earthmoving", "day", "540.00", "450.00", "650.00"),
    ("EU-EQP-004", "Wheel loader (hire)", "equipment", "Earthmoving", "day", "410.00", "340.00", "500.00"),
    ("EU-EQP-005", "Concrete pump (hire)", "equipment", "Concrete Plant", "day", "720.00", "600.00", "880.00"),
    ("EU-EQP-006", "Scaffolding system (hire)", "equipment", "Access & Scaffolding", "m2", "14.50", "11.00", "19.00"),
    (
        "EU-EQP-007",
        "Diesel generator 60 kVA (hire)",
        "equipment",
        "Power & Generators",
        "day",
        "165.00",
        "130.00",
        "210.00",
    ),
    (
        "EU-EQP-008",
        "Telescopic handler (hire)",
        "equipment",
        "Material Handling",
        "day",
        "290.00",
        "240.00",
        "360.00",
    ),
    # --- Operator ---
    ("EU-OPR-001", "Tower crane operator", "operator", "Operators - Crane", "h", "64.00", "55.00", "76.00"),
    ("EU-OPR-002", "Excavator operator", "operator", "Operators - Earthmoving", "h", "57.00", "49.00", "68.00"),
    ("EU-OPR-003", "Concrete pump operator", "operator", "Operators - Concrete", "h", "59.00", "50.00", "71.00"),
)

# Old code -> new code, one entry per resource above. Derived from _RESOURCES so
# it cannot drift out of step with the table: adding a resource extends this map
# automatically. Deliberately an exact-match map and not a "starts with DEMO-"
# sweep, which would also rewrite any row a customer happened to code that way.
_LEGACY_CODES: dict[str, str] = {_LEGACY_PREFIX + code.removeprefix(_CODE_PREFIX): code for code, *_rest in _RESOURCES}


async def _recode_legacy_rows(session: AsyncSession) -> int:
    """Rewrite the resource_code of rows seeded under the old prefix.

    An UPDATE, not a delete and reinsert. Component.catalog_resource_id in the
    assemblies module is a real foreign key declared ondelete="SET NULL", so
    deleting these rows would silently null out every link an assembly component
    holds to a catalog resource, with no error raised anywhere, and would also
    discard usage_count. An UPDATE keeps the row id, so every existing link and
    every accumulated counter survives the rename.

    Args:
        session: Active async SQLAlchemy session.

    Returns:
        Number of rows recoded.
    """
    recoded = 0
    for legacy_code, current_code in _LEGACY_CODES.items():
        result = await session.execute(
            update(CatalogResource)
            .where(CatalogResource.resource_code == legacy_code)
            .values(resource_code=current_code)
        )
        recoded += result.rowcount or 0

    await session.flush()
    return recoded


async def seed_catalog(
    session: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[str, int]:
    """Seed the global catalog of construction resources.

    CatalogResource rows are global (no project scoping), so project_ids is
    accepted for framework signature compatibility but only used to confirm at
    least one project context exists. Returns a dict of row counts inserted.
    Re-running is a no-op once the marker resource exists.

    The guard has three outcomes. Current codes present: nothing to do. Legacy
    codes present: recode in place and stop, without inserting. Neither: insert
    the full table. The middle branch must not fall through to the insert, that
    is what would double the catalog.

    Args:
        session: Active async SQLAlchemy session.
        project_ids: Demo project ids (unused for scoping; flagship-aware
            callers pass it for uniformity across module seeders).

    Returns:
        Mapping of entity name to the number of rows inserted.
    """
    counts: dict[str, int] = {}

    # Idempotency guard: bail out if the marker resource already exists.
    existing = await session.execute(
        select(CatalogResource.id).where(CatalogResource.resource_code == _MARKER_CODE).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("Catalog seed skipped: marker resource %s already present", _MARKER_CODE)
        return {}

    # Same estate, older codes: rename it forward instead of seeding a second copy.
    legacy = await session.execute(
        select(CatalogResource.id).where(CatalogResource.resource_code == _LEGACY_MARKER_CODE).limit(1)
    )
    if legacy.scalar_one_or_none() is not None:
        recoded = await _recode_legacy_rows(session)
        logger.info("Catalog seed recoded %d resources from the previous code scheme", recoded)
        return {"catalog_resources_recoded": recoded}

    by_type: dict[str, int] = {}
    for code, name, resource_type, category, unit, base, low, high in _RESOURCES:
        resource = CatalogResource(
            resource_code=code,
            name=name,
            resource_type=resource_type,
            category=category,
            unit=unit,
            base_price=str(Decimal(base)),
            min_price=str(Decimal(low)),
            max_price=str(Decimal(high)),
            currency="EUR",
            usage_count=0,
            source="manual",
            region="EU",
            specifications={"demo": True, "band": [low, high]},
            is_active=True,
            metadata_={"seed": True, "demo": True},
        )
        session.add(resource)
        by_type[resource_type] = by_type.get(resource_type, 0) + 1

    await session.flush()

    counts["catalog_resources"] = len(_RESOURCES)
    counts.update({f"resources_{rtype}": n for rtype, n in by_type.items()})

    logger.info("Catalog seed inserted: %s", counts)
    return counts
