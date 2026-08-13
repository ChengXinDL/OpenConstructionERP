# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""The takeoff demo seed must draw what it claims and link only what exists.

The old seed had three ways to lie that no gate caught: a measurement's value
contradicted its own polygon (248.50 m2 stored on a 13.44 m2 rectangle), 48
rows on twelve projects carried no document, no points and no scale, and zero
of 56 measurements were linked to a BOQ position, so the traceability chain
the takeoff workspace demonstrates had no seeded example anywhere. Each is
pinned here against a real database:

* every seeded measurement is recomputed from its OWN ``points`` and
  ``scale_pixels_per_unit`` through the same service function the API uses,
  and must agree with the stored value within 1%;
* every ``linked_boq_position_id`` must resolve to a really-seeded position of
  the SAME project (a link to a row that does not exist renders as silently
  empty, which is worse than no link);
* the seed is idempotent per project, and it prunes the legacy document-less
  "boq_derived" rows earlier demo installs left behind.
"""

from __future__ import annotations

import math
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.modules.boq.models import BOQ, Position
from app.modules.projects.models import Project
from app.modules.takeoff.models import TakeoffDocument, TakeoffMeasurement
from app.modules.takeoff.seed import seed_takeoff_demo
from app.modules.takeoff.service import recompute_measurement_value
from app.modules.users.models import User

pytestmark = pytest.mark.anyio

_FLAGSHIP_ID = uuid.UUID("f1a95000-0001-4a00-8b00-000000000001")
_FRANKFURT = "Bürogebäude Frankfurt Europaviertel"
_HEILBRONN = "Lebensmittelmarkt Heilbronn"
_HEIDELBERG = "Lebensmittelmarkt Heidelberg"

# Descriptions quoted verbatim from the demo packs (office-frankfurt /
# retail_market_heilbronn), so the link patterns are exercised against the
# exact strings the real install seeds.
_FRANKFURT_POSITIONS = [
    ("02.010", "Bodenplatte WU-Beton C30/37 XC4, d=80cm", "m3"),
    ("09.120", "Trennwand Trockenbau doppelt beplankt CW100", "m2"),
    ("09.480", "Sockelleisten Aluminium", "m"),
    ("08.210", "Dämmung Rohrleitungen EnEV/GEG", "m"),
]
_HEILBRONN_POSITIONS = [
    ("04.02.0030", "Bodenplatte C25/30 (RC-Beton), d = 20 cm, inkl. Einbau und Abziehen", "m3"),
    ("04.01.0090", "XPS-Dämmung 120 mm unter Bodenplatte, Heizzone, druckfest", "m2"),
    ("09.02.0040", "Eckschutzschienen und Rammschutz-Sockelleisten Flure", "m"),
    ("09.03.0010", "T30-RS-Türen Technik- und LV-Raum", "St"),
    ("09.01.0010", "Trockenbauwände Sozialtrakt und Büros, doppelt beplankt, MW-Dämmung", "m2"),
    ("09.04.0020", "Innentüren Holz mit Stahl-Umfassungszarge, teils Feuchtraum", "St"),
]


@pytest.fixture(autouse=True)
def _isolated_data_dir(monkeypatch, tmp_path):
    """Route the takeoff documents directory into the test's tmp dir.

    ``_takeoff_documents_dir`` resolves the data root per call from the
    environment, so the seed's PDF copies land here instead of the developer's
    real data directory.
    """
    monkeypatch.setenv("OE_DATA_DIR", str(tmp_path))
    return tmp_path


async def _make_user(session) -> uuid.UUID:
    user_id = uuid.uuid4()
    session.add(
        User(
            id=user_id,
            email=f"takeoff-{user_id.hex[:8]}@example.test",
            hashed_password="x",
            full_name="Takeoff Seed Owner",
            role="manager",
            locale="en",
            is_active=True,
            metadata_={},
        )
    )
    await session.flush()
    return user_id


async def _make_project(session, name: str, owner_id: uuid.UUID, project_id: uuid.UUID | None = None) -> uuid.UUID:
    project_id = project_id or uuid.uuid4()
    session.add(
        Project(
            id=project_id,
            name=name,
            description="Takeoff seed fixture",
            currency="EUR",
            status="active",
            owner_id=owner_id,
            metadata_={},
        )
    )
    await session.flush()
    return project_id


async def _add_positions(session, project_id: uuid.UUID, rows: list[tuple[str, str, str]]) -> None:
    boq_id = uuid.uuid4()
    session.add(BOQ(id=boq_id, project_id=project_id, name="Fixture LV", description="", status="draft", metadata_={}))
    await session.flush()
    for ordinal, description, unit in rows:
        session.add(
            Position(
                id=uuid.uuid4(),
                boq_id=boq_id,
                ordinal=ordinal,
                reference_code=ordinal,
                description=description,
                unit=unit,
                quantity="100",
                unit_rate="10",
                total="1000",
                metadata_={},
            )
        )
    await session.flush()


async def _build_stand(session) -> dict[str, uuid.UUID]:
    """Flagship + two German projects with their packs' own BOQ positions."""
    owner_id = await _make_user(session)
    flagship = await _make_project(session, "Residential House - Reference Build", owner_id, _FLAGSHIP_ID)
    frankfurt = await _make_project(session, _FRANKFURT, owner_id)
    heilbronn = await _make_project(session, _HEILBRONN, owner_id)
    await _add_positions(session, frankfurt, _FRANKFURT_POSITIONS)
    await _add_positions(session, heilbronn, _HEILBRONN_POSITIONS)
    # One legacy "boq_derived" row without a document: the shape older demo
    # installs minted 4x per project. The seed must prune it.
    session.add(
        TakeoffMeasurement(
            project_id=frankfurt,
            document_id=None,
            page=1,
            type="area",
            group_name="Baugrube / Erdbau",
            annotation="Kampfmittelsondierung (legacy)",
            points=[],
            measurement_unit="m2",
            created_by=str(owner_id),
            metadata_={"project_id": str(frankfurt), "demo_id": "office-frankfurt", "source": "boq_derived"},
        )
    )
    await session.flush()
    return {"flagship": flagship, "frankfurt": frankfurt, "heilbronn": heilbronn, "owner": owner_id}


async def _measurements(session, project_id: uuid.UUID) -> list[TakeoffMeasurement]:
    return list(
        (await session.execute(select(TakeoffMeasurement).where(TakeoffMeasurement.project_id == project_id)))
        .scalars()
        .all()
    )


def _assert_close(actual: float, expected: float, label: str) -> None:
    assert expected > 0, f"{label}: expected value must be positive, got {expected}"
    rel = abs(actual - expected) / expected
    assert rel <= 0.01, f"{label}: stored {actual} vs recomputed {expected} differ by {rel:.2%}"


async def test_every_seeded_measurement_recomputes_from_its_own_geometry(pg_session) -> None:
    """Stored values, volumes and perimeters agree with points x scale (1%)."""
    ids = await _build_stand(pg_session)

    counts = await seed_takeoff_demo(pg_session, [ids["flagship"], ids["frankfurt"], ids["heilbronn"]])
    await pg_session.flush()

    assert counts["documents"] == 3, f"expected one document per project, got {counts}"
    assert counts["pruned"] == 1, "the legacy document-less row must be pruned"

    # No document-less rows survive anywhere.
    orphans = (
        await pg_session.execute(
            select(func.count()).select_from(TakeoffMeasurement).where(TakeoffMeasurement.document_id.is_(None))
        )
    ).scalar_one()
    assert orphans == 0

    for key in ("flagship", "frankfurt", "heilbronn"):
        project_id = ids[key]
        documents = list(
            (await pg_session.execute(select(TakeoffDocument).where(TakeoffDocument.project_id == project_id)))
            .scalars()
            .all()
        )
        assert len(documents) == 1, f"{key}: expected exactly one takeoff document"
        document = documents[0]
        assert document.project_id == project_id
        assert document.file_path, f"{key}: document must be backed by a PDF on disk"
        assert Path(document.file_path).exists(), f"{key}: backing PDF missing at {document.file_path}"
        scales = document.page_scales or {}
        assert scales.get("defaultScale", {}).get("unitLabel") == "m", f"{key}: metric page scale expected"
        assert float(scales["defaultScale"]["pixelsPerUnit"]) > 0

        rows = await _measurements(pg_session, project_id)
        assert rows, f"{key}: measurements expected"
        for m in rows:
            label = f"{key}:{m.annotation}"
            assert m.document_id == str(document.id), f"{label}: measurement must sit on the project's document"
            assert m.points, f"{label}: points must not be empty"
            assert m.scale_pixels_per_unit and m.scale_pixels_per_unit > 0, f"{label}: scale required"
            recomputed = recompute_measurement_value(
                measurement_type=m.type,
                points=m.points,
                scale_pixels_per_unit=m.scale_pixels_per_unit,
                count_value=m.count_value,
                client_value=None,
            )
            assert recomputed is not None, f"{label}: value must be recomputable from geometry"
            assert m.measurement_value is not None, f"{label}: stored value missing"
            _assert_close(float(m.measurement_value), float(recomputed), label)
            if m.type == "count":
                assert m.count_value == len(m.points), f"{label}: one marker per counted piece expected"
                assert float(m.measurement_value) == float(m.count_value)
            if m.depth is not None:
                assert m.volume is not None, f"{label}: depth without volume"
                _assert_close(float(m.volume), float(m.measurement_value) * float(m.depth), f"{label}:volume")
            if m.type == "area" and m.perimeter is not None:
                ring = 0.0
                for i in range(len(m.points)):
                    a, b = m.points[i], m.points[(i + 1) % len(m.points)]
                    ring += math.hypot(b["x"] - a["x"], b["y"] - a["y"])
                _assert_close(float(m.perimeter), ring / m.scale_pixels_per_unit, f"{label}:perimeter")

    # The German showpiece rows are German and sit on the Grundriss.
    frankfurt_rows = await _measurements(pg_session, ids["frankfurt"])
    annotations = {m.annotation for m in frankfurt_rows}
    assert "Bodenplatte EG gesamt (Achse 1-2 / A-D)" in annotations
    groups = {m.group_name for m in frankfurt_rows}
    assert {"Bodenplatten", "Estriche", "Sockelleisten", "Wände", "Türen"} <= groups


async def test_links_point_only_at_really_seeded_positions(pg_session) -> None:
    """Every linked_boq_position_id resolves inside the same project."""
    ids = await _build_stand(pg_session)
    await seed_takeoff_demo(pg_session, [ids["flagship"], ids["frankfurt"], ids["heilbronn"]])
    await pg_session.flush()

    linked_by_project: dict[uuid.UUID, int] = {}
    all_rows = list((await pg_session.execute(select(TakeoffMeasurement))).scalars().all())
    for m in all_rows:
        if m.linked_boq_position_id is None:
            continue
        linked_by_project[m.project_id] = linked_by_project.get(m.project_id, 0) + 1
        position = (
            await pg_session.execute(
                select(Position, BOQ.project_id)
                .join(BOQ, Position.boq_id == BOQ.id)
                .where(Position.id == uuid.UUID(m.linked_boq_position_id))
            )
        ).first()
        assert position is not None, f"{m.annotation}: linked position does not exist"
        assert position[1] == m.project_id, f"{m.annotation}: linked position belongs to another project"

    # Fixture positions cover: Frankfurt slab, 2x skirting, drywall, pipe run;
    # Heilbronn slab, XPS, skirting, drywall, T30 doors, interior doors.
    assert linked_by_project.get(ids["frankfurt"], 0) == 5, f"frankfurt links: {linked_by_project}"
    assert linked_by_project.get(ids["heilbronn"], 0) == 6, f"heilbronn links: {linked_by_project}"
    assert linked_by_project.get(ids["flagship"], 0) == 0

    # The slab measurement links to the slab position, not to a lookalike.
    slab = next(m for m in all_rows if m.project_id == ids["frankfurt"] and m.group_name == "Bodenplatten")
    slab_position = (
        await pg_session.execute(select(Position).where(Position.id == uuid.UUID(slab.linked_boq_position_id)))
    ).scalar_one()
    assert slab_position.description.startswith("Bodenplatte WU-Beton")


async def test_seed_is_idempotent_per_project(pg_session) -> None:
    """A re-run changes nothing; a later new project still gets seeded."""
    ids = await _build_stand(pg_session)
    first = await seed_takeoff_demo(pg_session, [ids["flagship"], ids["frankfurt"], ids["heilbronn"]])
    await pg_session.flush()
    assert first["documents"] == 3

    async def _totals() -> tuple[int, int]:
        docs = (await pg_session.execute(select(func.count()).select_from(TakeoffDocument))).scalar_one()
        rows = (await pg_session.execute(select(func.count()).select_from(TakeoffMeasurement))).scalar_one()
        return docs, rows

    before = await _totals()
    second = await seed_takeoff_demo(pg_session, [ids["flagship"], ids["frankfurt"], ids["heilbronn"]])
    await pg_session.flush()
    assert second == {}, f"re-run must be a no-op, got {second}"
    assert await _totals() == before

    # A project that appears later is seeded without re-touching the others.
    heidelberg = await _make_project(pg_session, _HEIDELBERG, ids["owner"])
    third = await seed_takeoff_demo(pg_session, [ids["flagship"], ids["frankfurt"], ids["heilbronn"], heidelberg])
    await pg_session.flush()
    assert third["documents"] == 1, f"only the new project gets a document, got {third}"
    docs_after, rows_after = await _totals()
    assert docs_after == before[0] + 1
    assert rows_after > before[1]
    heidelberg_rows = await _measurements(pg_session, heidelberg)
    assert heidelberg_rows and all(m.document_id for m in heidelberg_rows)
