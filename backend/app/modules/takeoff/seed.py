# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Demo seed data for the takeoff module.

Loaded on demand via ``await seed_takeoff_demo(session, project_ids)``.

Seeds one uploaded PDF :class:`TakeoffDocument` per showcase project - the
flagship reference build plus the German demo projects - together with a spread
of :class:`TakeoffMeasurement` annotations whose values are DERIVED from their
own geometry: every measurement's ``points`` + ``scale_pixels_per_unit`` are
fed through :func:`app.modules.takeoff.service.recompute_measurement_value`
(the same function the API uses), so the stored value can never contradict the
drawn shape. German projects get the vector Grundriss fixture rendered by
:mod:`app.scripts.generate_grundriss_pdf`; measurement polygons come from the
same :mod:`app.scripts.grundriss_plan` geometry, so a seeded room measurement
encloses exactly the room it names.

Where a matching BOQ position exists on the same project (matched against the
demo templates' own German descriptions, never invented), the measurement is
linked via ``linked_boq_position_id`` - the traceability chain the takeoff
workspace demonstrates. Only positions that really exist are referenced; a
missed lookup leaves the measurement unlinked rather than pointing nowhere.

The seed is idempotent PER PROJECT: a project that already has a takeoff
document is skipped, so a user upload never blocks the seed from reaching the
projects that are still empty (same contract as the daily_diary / field_time
seeders). Legacy demo rows minted without a document, points or scale (the old
"boq_derived" fill) are pruned - a measurement that cannot be shown on any
sheet is worse than an honest empty state.
"""

from __future__ import annotations

import logging
import math
import shutil
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.boq.models import BOQ, Position
from app.modules.projects.models import Project
from app.modules.takeoff.models import (
    CadExtractionSession,
    TakeoffDocument,
    TakeoffMeasurement,
)
from app.modules.takeoff.service import recompute_measurement_value
from app.modules.users.models import User
from app.scripts import grundriss_plan as plan

logger = logging.getLogger(__name__)

_FLAGSHIP_ID = uuid.UUID("f1a95000-0001-4a00-8b00-000000000001")

_ASSETS_DIR = Path(__file__).resolve().parents[2] / "scripts" / "flagship_assets"

#: Calibration for the flagship's scanned book plate (``house_plans.pdf``):
#: the printed overall dimension 34'-6" (10.5156 m) measures ~230 PDF points
#: across, i.e. the ratio a user gets by calibrating on that dimension string.
_FLAGSHIP_SCALE = 230.0 / 10.5156

#: The German Grundriss is drawn at M 1:100, so its ratio is exactly the
#: frontend's 1:100 preset value (72 / 0.0254 / 100 PDF points per metre).
_GRUNDRISS_SCALE = plan.PT_PER_M


@dataclass(frozen=True)
class _Spec:
    """One measurement to seed: geometry in viewer coordinates + intent."""

    type: str
    group_name: str
    group_color: str
    annotation: str
    points: list[dict[str, float]]
    unit: str
    depth: Decimal | None = None
    count: int | None = None
    link_patterns: tuple[str, ...] = field(default=())


def _ring_perimeter_m(points: list[dict[str, float]], scale: float) -> Decimal | None:
    """Closed-ring perimeter of a polygon in metres (None for degenerate input)."""
    if len(points) < 3 or scale <= 0:
        return None
    total = 0.0
    for i in range(len(points)):
        a = points[i]
        b = points[(i + 1) % len(points)]
        total += math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    return Decimal(str(round(total / scale, 6)))


# ── flagship: honest measurements over the scanned reference plate ──────────
# Viewer coordinates measured off the rendered page (501 x 708 pt, y down from
# the top-left). Rooms follow the plate's own printed labels; values are
# recomputed from these very points, so figure and number agree.


def _flagship_specs() -> list[_Spec]:
    return [
        _Spec(
            "area",
            "Floor areas",
            "#3B82F6",
            "Living room floor",
            [{"x": 176.0, "y": 434.0}, {"x": 305.0, "y": 434.0}, {"x": 305.0, "y": 520.0}, {"x": 176.0, "y": 520.0}],
            "m2",
        ),
        _Spec(
            "area",
            "Floor areas",
            "#3B82F6",
            "Dining room floor",
            [{"x": 309.0, "y": 434.0}, {"x": 395.0, "y": 434.0}, {"x": 395.0, "y": 520.0}, {"x": 309.0, "y": 520.0}],
            "m2",
        ),
        _Spec(
            "area",
            "Floor areas",
            "#3B82F6",
            "Kitchen floor",
            [{"x": 318.0, "y": 345.0}, {"x": 394.0, "y": 345.0}, {"x": 394.0, "y": 406.0}, {"x": 318.0, "y": 406.0}],
            "m2",
        ),
        _Spec(
            "area",
            "Floor areas",
            "#3B82F6",
            "Chamber floor (upper floor, centre)",
            [{"x": 250.0, "y": 166.0}, {"x": 314.0, "y": 166.0}, {"x": 314.0, "y": 248.5}, {"x": 250.0, "y": 248.5}],
            "m2",
        ),
        _Spec(
            "distance",
            "Skirting",
            "#F59E0B",
            "Skirting run - living room, front wall",
            [{"x": 176.0, "y": 520.0}, {"x": 305.0, "y": 520.0}],
            "m",
        ),
        _Spec(
            "distance",
            "Skirting",
            "#F59E0B",
            "Skirting run - dining room, west wall",
            [{"x": 309.0, "y": 434.0}, {"x": 309.0, "y": 520.0}],
            "m",
        ),
        _Spec(
            "count",
            "Doors",
            "#EF4444",
            "Interior doorways (ground floor)",
            [
                {"x": 235.0, "y": 430.0},
                {"x": 312.5, "y": 431.0},
                {"x": 304.0, "y": 361.0},
                {"x": 350.0, "y": 397.5},
                {"x": 344.0, "y": 430.0},
                {"x": 260.0, "y": 521.0},
            ],
            "pcs",
            count=6,
        ),
        _Spec(
            "count",
            "Windows",
            "#8B5CF6",
            "Windows (ground floor)",
            [
                {"x": 176.0, "y": 450.0},
                {"x": 176.0, "y": 495.0},
                {"x": 215.0, "y": 522.5},
                {"x": 280.0, "y": 522.5},
                {"x": 330.0, "y": 524.0},
                {"x": 350.0, "y": 524.0},
                {"x": 370.0, "y": 524.0},
                {"x": 395.0, "y": 475.0},
            ],
            "pcs",
            count=8,
        ),
    ]


# ── German projects: measurements over the vector Grundriss ─────────────────
# All geometry comes from app.scripts.grundriss_plan, the same module the PDF
# is rendered from, so the polygons sit exactly on the drawn rooms. Labels and
# groups are German; link patterns quote the demo packs' own BOQ descriptions.


def _door_markers(only_t30: bool = False) -> list[dict[str, float]]:
    doors = [d for d in plan.DOORS if d.t30] if only_t30 else plan.DOORS
    return plan.viewer_points([(d.cx, d.wall_center_y) for d in doors])


def _window_markers() -> list[dict[str, float]]:
    return plan.viewer_points([(cx, plan.window_wall_center_y(south)) for cx, south in plan.WINDOWS])


def _skirting_ring_1_06() -> list[dict[str, float]]:
    """Skirting run around Großraumbüro 1.06, open at the door leaf."""
    room = plan.ROOMS["1.06"]
    door = next(d for d in plan.DOORS if d.room_number == "1.06")
    x0, y0 = room.x, room.y
    x1, y1 = room.x + room.w, room.y + room.d
    east_jamb = door.cx + plan.DOOR_W_M / 2.0
    west_jamb = door.cx - plan.DOOR_W_M / 2.0
    return plan.viewer_points([(east_jamb, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0), (west_jamb, y0)])


def _corridor_line(y_m: float) -> list[dict[str, float]]:
    flur = plan.ROOMS["1.11"]
    return plan.viewer_points([(flur.x, y_m), (flur.x + flur.w, y_m)])


def _specs_frankfurt() -> list[_Spec]:
    flur = plan.ROOMS["1.11"]
    return [
        _Spec(
            "area",
            "Bodenplatten",
            "#3B82F6",
            "Bodenplatte EG gesamt (Achse 1-2 / A-D)",
            plan.viewer_points(plan.building_outline_m()),
            "m2",
            depth=Decimal("0.800000"),
            link_patterns=("Bodenplatte%",),
        ),
        _Spec(
            "area",
            "Estriche",
            "#10B981",
            "Estrich Flur 1.11",
            plan.viewer_points(plan.room_polygon_m("1.11")),
            "m2",
            link_patterns=("%Estrich%",),
        ),
        _Spec(
            "area",
            "Estriche",
            "#10B981",
            "Estrich Büro 1.01",
            plan.viewer_points(plan.room_polygon_m("1.01")),
            "m2",
            link_patterns=("%Estrich%",),
        ),
        _Spec(
            "polyline",
            "Sockelleisten",
            "#F59E0B",
            "Sockelleiste Großraumbüro 1.06 (umlaufend)",
            _skirting_ring_1_06(),
            "m",
            link_patterns=("%Sockelleisten%",),
        ),
        _Spec(
            "distance",
            "Sockelleisten",
            "#F59E0B",
            "Sockelleiste Flur 1.11, Achse B",
            _corridor_line(flur.y),
            "m",
            link_patterns=("%Sockelleisten%",),
        ),
        _Spec(
            "polyline",
            "Wände",
            "#06B6D4",
            "Trennwand Trockenbau Flur, Achse C (Länge)",
            _corridor_line(plan.CORRIDOR_Y1_M + plan.INT_WALL_M / 2.0),
            "m",
            link_patterns=("Trennwand Trockenbau%", "%Trockenbau%"),
        ),
        _Spec(
            "polyline",
            "Haustechnik",
            "#6366F1",
            "Rohrleitungstrasse Flur bis Technik 1.05",
            plan.viewer_points([(1.2, 6.995), (26.8, 6.995), (26.8, 3.0)]),
            "m",
            link_patterns=("Dämmung Rohrleitungen%",),
        ),
        _Spec(
            "count",
            "Türen",
            "#EF4444",
            "Innentüren EG",
            _door_markers(),
            "pcs",
            count=len(plan.DOORS),
            link_patterns=("%Innentüren%",),
        ),
        _Spec(
            "count",
            "Fenster",
            "#8B5CF6",
            "Fenster EG",
            _window_markers(),
            "pcs",
            count=len(plan.WINDOWS),
        ),
    ]


def _specs_heilbronn() -> list[_Spec]:
    flur = plan.ROOMS["1.11"]
    return [
        _Spec(
            "area",
            "Bodenplatten",
            "#3B82F6",
            "Bodenplatte EG gesamt (Achse 1-2 / A-D)",
            plan.viewer_points(plan.building_outline_m()),
            "m2",
            depth=Decimal("0.200000"),
            link_patterns=("Bodenplatte%",),
        ),
        _Spec(
            "area",
            "Dämmung",
            "#14B8A6",
            "XPS-Dämmung unter Bodenplatte",
            plan.viewer_points(plan.building_outline_m(inset=0.17)),
            "m2",
            link_patterns=("XPS-Dämmung%",),
        ),
        _Spec(
            "area",
            "Estriche",
            "#10B981",
            "Estrich Flur Sozialtrakt",
            plan.viewer_points(plan.room_polygon_m("1.11")),
            "m2",
            link_patterns=("%Estrich%",),
        ),
        _Spec(
            "distance",
            "Sockelleisten",
            "#F59E0B",
            "Rammschutz-Sockelleiste Flur, Achse B",
            _corridor_line(flur.y),
            "m",
            link_patterns=("%Sockelleisten%",),
        ),
        _Spec(
            "polyline",
            "Wände",
            "#06B6D4",
            "Trockenbauwand Sozialtrakt, Achse C (Länge)",
            _corridor_line(plan.CORRIDOR_Y1_M + plan.INT_WALL_M / 2.0),
            "m",
            link_patterns=("Trockenbauwände%", "%Trockenbau%"),
        ),
        _Spec(
            "count",
            "Türen",
            "#EF4444",
            "T30-Türen Technik 1.05 und Lager 1.10",
            _door_markers(only_t30=True),
            "pcs",
            count=sum(1 for d in plan.DOORS if d.t30),
            link_patterns=("T30%",),
        ),
        _Spec(
            "count",
            "Türen",
            "#EF4444",
            "Innentüren Sozialtrakt EG",
            _door_markers(),
            "pcs",
            count=len(plan.DOORS),
            link_patterns=("%Innentüren%",),
        ),
    ]


def _specs_heidelberg() -> list[_Spec]:
    flur = plan.ROOMS["1.11"]
    return [
        _Spec(
            "area",
            "Bodenplatten",
            "#3B82F6",
            "Bodenplatte EG gesamt (Achse 1-2 / A-D)",
            plan.viewer_points(plan.building_outline_m()),
            "m2",
            depth=Decimal("0.200000"),
            link_patterns=("Bodenplatte%",),
        ),
        _Spec(
            "area",
            "Dämmung",
            "#14B8A6",
            "XPS-Dämmung unter Bodenplatte",
            plan.viewer_points(plan.building_outline_m(inset=0.17)),
            "m2",
            link_patterns=("XPS-Dämmung%",),
        ),
        _Spec(
            "area",
            "Estriche",
            "#10B981",
            "Estrich Flur Sozialtrakt",
            plan.viewer_points(plan.room_polygon_m("1.11")),
            "m2",
            link_patterns=("%Estrich%",),
        ),
        _Spec(
            "distance",
            "Sockelleisten",
            "#F59E0B",
            "Rammschutz-Sockelleiste Flur, Achse B",
            _corridor_line(flur.y),
            "m",
            link_patterns=("%Sockelleisten%",),
        ),
        _Spec(
            "count",
            "Türen",
            "#EF4444",
            "Innentüren Sozialtrakt EG",
            _door_markers(),
            "pcs",
            count=len(plan.DOORS),
            link_patterns=("%Innentüren%",),
        ),
    ]


def _grundriss_extracted_text() -> str:
    rooms = ", ".join(f"{r.label} ({plan.format_area_de(r.area_m2)})" for r in plan.ROOMS.values())
    return f"Grundriss Erdgeschoss. Maßstab M 1:100. Büro- und Sozialbereich: {rooms}. Alle Maße in m."


@dataclass(frozen=True)
class _DocumentPlan:
    """Everything needed to seed one project's takeoff document + rows."""

    source_pdf: str
    filename: str
    scale: float
    scale_source: str
    extracted_text: str
    summary: str
    specs: list[_Spec]


def _flagship_document_plan() -> _DocumentPlan:
    return _DocumentPlan(
        source_pdf="house_plans.pdf",
        filename="ground-floor-plan.pdf",
        scale=round(_FLAGSHIP_SCALE, 6),
        scale_source="manual_calibration",
        extracted_text=(
            "Plan of Design No. 2 - reference build plate. Calibrated on the printed 34'-6\" overall "
            "dimension. Room takeoff over the scanned floor plans."
        ),
        summary="Scanned plate calibrated and measured: floors, skirting runs, doors and windows.",
        specs=_flagship_specs(),
    )


def _german_document_plan(specs: list[_Spec]) -> _DocumentPlan:
    return _DocumentPlan(
        source_pdf="grundriss_erdgeschoss.pdf",
        filename="A-2.01 Grundriss Erdgeschoss.pdf",
        scale=round(_GRUNDRISS_SCALE, 6),
        scale_source="preset",
        extracted_text=_grundriss_extracted_text(),
        summary="Grundriss ausgewertet: Bodenplatte, Estriche, Trennwände, Sockelleisten, Türen und Fenster.",
        specs=specs,
    )


#: German demo projects that receive the Grundriss, keyed by project name
#: (demo installs mint random project ids, so the stable key is the name).
_GERMAN_PROJECT_PLANS: dict[str, Callable[[], list[_Spec]]] = {
    "Bürogebäude Frankfurt Europaviertel": _specs_frankfurt,
    "Lebensmittelmarkt Heilbronn": _specs_heilbronn,
    "Lebensmittelmarkt Heidelberg": _specs_heidelberg,
}


async def _resolve_owner_id(session: AsyncSession, project_id: uuid.UUID) -> uuid.UUID | None:
    """Resolve a valid owner user id for the takeoff document.

    Prefers the owner of the target project (the demo user installed alongside
    it); falls back to any existing user. Returns None when the users table is
    empty, in which case the caller skips seeding.
    """
    owner_id = (await session.execute(select(Project.owner_id).where(Project.id == project_id))).scalar_one_or_none()
    if owner_id is not None:
        return owner_id
    return (await session.execute(select(User.id).limit(1))).scalar_one_or_none()


async def _resolve_position_id(session: AsyncSession, project_id: uuid.UUID, patterns: tuple[str, ...]) -> str | None:
    """Find a really-seeded BOQ position of this project matching a pattern.

    Patterns are tried in order; the first hit wins (deterministic via the
    position ordinal). Returns None when nothing matches, so a measurement is
    left unlinked rather than pointing at a position that does not exist.
    """
    for pattern in patterns:
        stmt = (
            select(Position.id)
            .join(BOQ, Position.boq_id == BOQ.id)
            .where(BOQ.project_id == project_id, Position.description.ilike(pattern))
            .order_by(Position.ordinal)
            .limit(1)
        )
        position_id = (await session.execute(stmt)).scalars().first()
        if position_id is not None:
            return str(position_id)
    return None


async def _prune_documentless_demo_rows(session: AsyncSession) -> int:
    """Delete legacy demo measurements that have no document behind them.

    Older demo installs minted 4 rows per project straight from BOQ items
    (``metadata.source == "boq_derived"``) with no document, no points and no
    scale - list entries that break the moment they are opened on a sheet.
    Only rows carrying that exact demo marker are touched; user rows never
    match it.
    """
    rows = (
        await session.execute(
            select(TakeoffMeasurement.id, TakeoffMeasurement.metadata_).where(TakeoffMeasurement.document_id.is_(None))
        )
    ).all()
    stale = [row_id for row_id, meta in rows if isinstance(meta, dict) and meta.get("source") == "boq_derived"]
    if stale:
        await session.execute(delete(TakeoffMeasurement).where(TakeoffMeasurement.id.in_(stale)))
    return len(stale)


async def _seed_project_document(
    session: AsyncSession,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    doc_plan: _DocumentPlan,
) -> dict[str, int]:
    """Seed one project's document + measurements. Returns per-entity counts."""
    from app.modules.takeoff.service import _takeoff_documents_dir

    counts = {"documents": 0, "measurements": 0, "linked": 0}

    # --- the takeoff document, backed by a REAL PDF on disk ---
    # The viewer streams the file from GET /takeoff/documents/{id}/download/,
    # which 404s unless an actual PDF exists under the takeoff documents
    # directory. The id is generated up front so the on-disk file name matches
    # the row, exactly like a real upload.
    doc_uuid = uuid.uuid4()
    source_pdf = _ASSETS_DIR / doc_plan.source_pdf
    pages = 1
    size_bytes = 0
    file_path = ""
    if source_pdf.exists():
        documents_dir = _takeoff_documents_dir()
        documents_dir.mkdir(parents=True, exist_ok=True)
        dest_pdf = documents_dir / f"{doc_uuid}.pdf"
        shutil.copyfile(source_pdf, dest_pdf)
        size_bytes = dest_pdf.stat().st_size
        file_path = str(dest_pdf)
        try:
            import fitz  # PyMuPDF - already a takeoff dependency

            with fitz.open(dest_pdf) as opened:
                pages = max(1, opened.page_count)
        except Exception:  # noqa: BLE001 - page count is cosmetic, never fatal
            pages = 1
    else:
        logger.warning("takeoff seed: reference PDF missing at %s", source_pdf)

    document = TakeoffDocument(
        id=doc_uuid,
        filename=doc_plan.filename,
        pages=pages,
        size_bytes=size_bytes,
        content_type="application/pdf",
        status="analyzed",
        project_id=project_id,
        owner_id=owner_id,
        file_path=file_path,
        extracted_text=doc_plan.extracted_text,
        page_data=[{"page": n, "text": doc_plan.filename, "tables": []} for n in range(1, pages + 1)],
        analysis={"summary": doc_plan.summary, "trades": ["concrete", "drywall", "flooring", "doors", "windows"]},
        page_scales={"defaultScale": {"pixelsPerUnit": doc_plan.scale, "unitLabel": "m"}, "byPage": {}},
        metadata_={"seed": True, "demo": True, "scale": "1:100"},
    )
    session.add(document)
    await session.flush()
    # Capture the generated id locally (never read document.measurements - a
    # lazy relationship would raise MissingGreenlet under async).
    document_id = str(document.id)
    counts["documents"] = 1

    owner_ref = str(owner_id)
    for spec in doc_plan.specs:
        # The value is DERIVED from the seeded geometry through the same
        # function the API uses - figure and number cannot disagree.
        raw_value = recompute_measurement_value(
            measurement_type=spec.type,
            points=spec.points,
            scale_pixels_per_unit=doc_plan.scale,
            count_value=spec.count,
            client_value=None,
        )
        value = Decimal(str(round(raw_value, 6))) if raw_value is not None else None
        volume = None
        if spec.depth is not None and value is not None:
            volume = (value * spec.depth).quantize(Decimal("0.000001"))
        perimeter = _ring_perimeter_m(spec.points, doc_plan.scale) if spec.type == "area" else None

        linked_position_id = None
        if spec.link_patterns:
            linked_position_id = await _resolve_position_id(session, project_id, spec.link_patterns)
            if linked_position_id is not None:
                counts["linked"] += 1

        measurement = TakeoffMeasurement(
            project_id=project_id,
            document_id=document_id,
            page=1,
            type=spec.type,
            group_name=spec.group_name,
            group_color=spec.group_color,
            annotation=spec.annotation,
            points=spec.points,
            measurement_value=value,
            measurement_unit=spec.unit,
            depth=spec.depth,
            volume=volume,
            perimeter=perimeter,
            count_value=spec.count,
            scale_pixels_per_unit=doc_plan.scale,
            scale_source=doc_plan.scale_source,
            linked_boq_position_id=linked_position_id,
            metadata_={"seed": True, "demo": True},
            created_by=owner_ref,
        )
        session.add(measurement)
        counts["measurements"] += 1

    return counts


async def seed_takeoff_demo(
    session: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[str, int]:
    """Seed demo takeoff documents, measurements and a CAD session.

    Args:
        session: Open async DB session.
        project_ids: Candidate projects. The flagship project and the German
            showcase projects (matched by name) each receive their own
            document; a project that already has one is skipped.

    Returns:
        A dict of row counts per entity inserted (plus ``linked`` and
        ``pruned``), or an empty dict when nothing was done.
    """
    if not project_ids:
        return {}

    counts: dict[str, int] = {"documents": 0, "measurements": 0, "linked": 0, "cad_sessions": 0, "pruned": 0}

    # Heal older installs: demo rows without a document cannot be shown on any
    # sheet, so they go before new documents arrive.
    counts["pruned"] = await _prune_documentless_demo_rows(session)

    # Resolve seed targets: the flagship by id, German projects by name.
    targets: list[tuple[uuid.UUID, _DocumentPlan]] = []
    if _FLAGSHIP_ID in project_ids:
        targets.append((_FLAGSHIP_ID, _flagship_document_plan()))
    name_rows = (
        await session.execute(
            select(Project.id, Project.name).where(
                Project.id.in_(project_ids), Project.name.in_(list(_GERMAN_PROJECT_PLANS))
            )
        )
    ).all()
    for pid, name in name_rows:
        targets.append((pid, _german_document_plan(_GERMAN_PROJECT_PLANS[name]())))

    for project_id, doc_plan in targets:
        # Per-project idempotency: a document already present (seeded or user
        # uploaded) means this project is done - never double-seed it.
        existing = (
            await session.execute(select(TakeoffDocument.id).where(TakeoffDocument.project_id == project_id).limit(1))
        ).scalar_one_or_none()
        if existing is not None:
            continue

        owner_id = await _resolve_owner_id(session, project_id)
        if owner_id is None:
            logger.info("takeoff seed skipped for %s: no owner user available", project_id)
            continue

        project_counts = await _seed_project_document(session, project_id, owner_id, doc_plan)
        for key, num in project_counts.items():
            counts[key] += num

        # --- 1 optional CAD extraction session (flagship only) ---
        if project_id == _FLAGSHIP_ID:
            now = datetime.now(UTC)
            owner_ref = str(owner_id)
            cad_session = CadExtractionSession(
                session_id=f"seed-cad-{project_id}",
                user_id=owner_ref,
                filename="structure.ifc",
                file_format="ifc",
                element_count=6,
                extraction_time=2.4,
                elements_data=[
                    {"id": "elem_001", "category": "wall", "area_m2": 84.3},
                    {"id": "elem_002", "category": "slab", "area_m2": 92.6},
                ],
                columns_metadata={"category": "string", "area_m2": "number"},
                project_id=str(project_id),
                display_name="Structure (IFC) extraction",
                is_permanent=True,
                expires_at=now + timedelta(days=7),
                created_by=owner_ref,
                session_ttl_days=7,
                is_persistent=True,
                bim_model_id=None,
            )
            session.add(cad_session)
            counts["cad_sessions"] += 1

    await session.flush()
    if any(counts.values()):
        logger.info("takeoff demo seed inserted: %s", counts)
        return counts
    return {}
