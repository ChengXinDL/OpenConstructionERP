# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""What the DDC DWG parser keeps, and what it throws away.

A v12.6.1 report said DWG files upload but the drawing does not look like the
source. Nothing covered ``parse_ddc_dwg_excel``, so every fidelity loss was
invisible to the suite. These tests pin the current behaviour: the parts that
are correct stay correct, and each known loss is asserted explicitly so that
whoever repairs it sees exactly one test turn red per repair.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from app.modules.dwg_takeoff.ddc_dwg_parser import parse_ddc_dwg_excel

COLUMNS = [
    "Description",
    "ID",
    "Name",
    "Layer",
    "BlockId",
    "Color",
    "Color Index",
    "On",
    "Frozen",
    "StartPoint",
    "EndPoint",
    "Position",
    "BlockTableRecord",
    "Rotation",
    "ScaleFactors",
    "Min Extents",
    "Max Extents",
    "Pattern Name",
    "Solid Fill",
    "Closed",
]


def _row(**cells: object) -> list[object]:
    """Build one export row, leaving every unnamed column blank."""
    unknown = set(cells) - set(COLUMNS)
    assert not unknown, f"column not in the DDC export header: {sorted(unknown)}"
    return [cells.get(name) for name in COLUMNS]


@pytest.fixture
def export(tmp_path: Path):
    """Write a DDC-shaped .xlsx and return the parsed result."""

    def _build(rows: list[list[object]]) -> dict:
        openpyxl = pytest.importorskip("openpyxl")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(COLUMNS)
        for row in rows:
            ws.append(row)
        path = tmp_path / "export.xlsx"
        wb.save(str(path))
        wb.close()
        return parse_ddc_dwg_excel(path)

    return _build


LAYER = _row(Description="<AcDbLayerTableRecord>", Name="A-WALL", Color=7, On=True, Frozen=False)


class TestBlockReferencesAreNotExpanded:
    """An INSERT keeps its insertion point and loses everything it draws."""

    def test_insert_carries_no_geometry_of_its_own(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbBlockReference>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    Position="100,200,0",
                    BlockTableRecord="DOOR-900",
                    Rotation=0,
                    ScaleFactors="[1,1,1]",
                ),
            ]
        )
        inserts = [e for e in result["entities"] if e["entity_type"] == "INSERT"]
        assert len(inserts) == 1
        geometry = inserts[0]["geometry_data"]
        assert geometry["block_name"] == "DOOR-900"
        assert geometry["insert"] == {"x": 100.0, "y": 200.0}
        # The whole of what the block draws is absent. In an architectural
        # drawing this is the doors, windows, furniture and title block, which
        # is why the render can look nothing like the source.
        assert "points" not in geometry
        assert "entities" not in geometry

    def test_block_geometry_is_parsed_but_filed_under_the_block_as_a_layout(self, export) -> None:
        """The block's own lines are read - they are just not joined to the INSERT.

        This is the reason the repair is a join rather than new parsing, and
        also why the sheet picker currently offers block definitions as sheets.
        """
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbBlockReference>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    Position="0,0,0",
                    BlockTableRecord="DOOR-900",
                ),
                _row(
                    Description="<AcDbLine>",
                    ID="2",
                    Layer="A-WALL",
                    BlockId="DOOR-900",
                    StartPoint="0,0,0",
                    EndPoint="900,0,0",
                ),
            ]
        )
        by_layout: dict[str, list[dict]] = {}
        for entity in result["entities"]:
            by_layout.setdefault(entity["layout"], []).append(entity)

        assert by_layout["*Model_Space"][0]["entity_type"] == "INSERT"
        assert [e["entity_type"] for e in by_layout["DOOR-900"]] == ["LINE"]
        # And the block definition is presented to the viewer as if it were a
        # drawable sheet alongside model space.
        assert "DOOR-900" in result["layouts"]


class TestHatchIsReducedToItsBoundingBox:
    def test_non_rectangular_fill_becomes_a_rectangle(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbHatch>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    **{"Min Extents": "0,0,0", "Max Extents": "100,50,0"},
                    **{"Pattern Name": "ANSI31", "Solid Fill": "false"},
                ),
            ]
        )
        hatches = [e for e in result["entities"] if e["entity_type"] == "HATCH"]
        assert len(hatches) == 1
        # Four axis-aligned corners, whatever the real boundary was. An L-shaped
        # room fills its whole bounding rectangle on screen.
        assert hatches[0]["geometry_data"]["points"] == [
            {"x": 0.0, "y": 0.0},
            {"x": 100.0, "y": 0.0},
            {"x": 100.0, "y": 50.0},
            {"x": 0.0, "y": 50.0},
        ]


class TestSplinesAreApproximated:
    def test_closed_spline_becomes_an_ellipse_on_its_bounding_box(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbSpline>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    Closed="true",
                    **{"Min Extents": "0,0,0", "Max Extents": "40,20,0"},
                ),
            ]
        )
        assert [e["entity_type"] for e in result["entities"]] == ["ELLIPSE"]
        geometry = result["entities"][0]["geometry_data"]
        assert geometry["center"] == {"x": 20.0, "y": 10.0}
        assert geometry["major_radius"] == pytest.approx(20.0)
        assert geometry["minor_radius"] == pytest.approx(10.0)
        assert geometry["end_angle"] == pytest.approx(math.pi * 2)

    def test_open_spline_becomes_a_straight_chord(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbSpline>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    Closed="false",
                    StartPoint="0,0,0",
                    EndPoint="100,100,0",
                ),
            ]
        )
        # Every control point between the ends is gone; a curve is drawn as the
        # straight line joining its endpoints.
        assert [e["entity_type"] for e in result["entities"]] == ["LINE"]
        geometry = result["entities"][0]["geometry_data"]
        assert geometry["start"] == {"x": 0.0, "y": 0.0}
        assert geometry["end"] == {"x": 100.0, "y": 100.0}


class TestWhatTheParserGetsRight:
    """Guard the correct behaviour so a fidelity repair cannot regress it."""

    def test_line_layer_and_extents_survive(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbLine>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    StartPoint="10,20,0",
                    EndPoint="110,220,0",
                ),
            ]
        )
        assert result["entity_count"] == 1
        entity = result["entities"][0]
        assert entity["entity_type"] == "LINE"
        assert entity["layer"] == "A-WALL"
        assert entity["geometry_data"]["start"] == {"x": 10.0, "y": 20.0}
        assert result["extents"] == {
            "min_x": 10.0,
            "min_y": 20.0,
            "max_x": 110.0,
            "max_y": 220.0,
        }
        assert [layer["name"] for layer in result["layers"]] == ["A-WALL"]
        assert result["layers"][0]["entity_count"] == 1

    def test_frozen_layer_is_reported_invisible(self, export) -> None:
        result = export(
            [
                _row(
                    Description="<AcDbLayerTableRecord>",
                    Name="A-HIDDEN",
                    Color=7,
                    On=True,
                    Frozen=True,
                ),
            ]
        )
        assert result["layers"][0]["visible"] is False
