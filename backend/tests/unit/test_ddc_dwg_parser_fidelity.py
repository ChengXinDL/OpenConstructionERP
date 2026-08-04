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
    """An INSERT keeps its insertion point; what the block draws travels apart.

    The join is left to the renderer on purpose. Expanding a block into the
    entity array here would multiply its geometry by its placement count - a
    block placed 500 times becomes 500 copies of itself - while sending the
    definition once costs one copy however often it is placed.
    """

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
        # A placement says where, how big and how turned - never what is drawn.
        assert "points" not in geometry
        assert "entities" not in geometry
        # The three numbers the renderer needs to place the definition are all
        # here, so the join needs nothing this parser does not already emit.
        assert geometry["x_scale"] == 1.0
        assert geometry["y_scale"] == 1.0
        assert geometry["rotation"] == 0.0

    def test_block_geometry_is_filed_under_the_block_not_offered_as_a_sheet(self, export) -> None:
        """A block definition is not a sheet, and its coordinates are not the drawing's.

        This replaces a test that pinned the opposite. ``BlockId`` carries the
        owning block-table record, which in the DWG object model is
        ``*Model_Space``, ``*Paper_Space*`` **and one entry per block
        definition**; filing all three as layouts put every door and window in
        the sheet picker as a drawable sheet, and unioned block-local
        coordinates into the drawing's extents. The DXF path never did either,
        so the same UI behaved differently depending on which format was
        uploaded - which is what showed the DWG path was wrong rather than
        merely different.
        """
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbLine>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    StartPoint="0,0,0",
                    EndPoint="50,50,0",
                ),
                _row(
                    Description="<AcDbBlockReference>",
                    ID="2",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    Position="100,200,0",
                    BlockTableRecord="DOOR-900",
                ),
                # The block's own geometry, authored around the block's origin
                # and running out to x=900 there.
                _row(
                    Description="<AcDbLine>",
                    ID="3",
                    Layer="A-WALL",
                    BlockId="DOOR-900",
                    StartPoint="0,0,0",
                    EndPoint="900,0,0",
                ),
            ]
        )

        by_block = {e.get("block"): e["entity_type"] for e in result["entities"] if e.get("block")}
        assert by_block == {"DOOR-900": "LINE"}

        # The picker offers model space and nothing else.
        assert result["layouts"] == ["*Model_Space"]

        # Every entity carries EITHER the sheet it is drawn on or the block it
        # belongs to. Never both, never neither - that invariant is what lets
        # the viewer's sheet filter drop definition members without knowing
        # what a block is.
        for entity in result["entities"]:
            assert ("layout" in entity) is not bool(entity.get("block"))

        # And the block-local 900 is gone from the drawing's extents. The
        # drawing runs to the INSERT at (100, 200), not to a coordinate that
        # only means anything inside the door.
        assert result["extents"] == {"min_x": 0.0, "min_y": 0.0, "max_x": 100.0, "max_y": 200.0}

    def test_definition_members_count_as_entities_but_not_against_a_layer(self, export) -> None:
        """Two counters, deliberately different, because they answer different questions.

        ``entity_count`` counts records on the wire, and a definition member is
        one. A layer's count describes what toggling that layer off would
        remove, and toggling removes no definition member - the INSERT that
        places it governs that.
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
        assert result["entity_count"] == 2
        assert result["layers"][0]["entity_count"] == 1


class TestModelAndPaperSpaceAreSeparated:
    """Paper space is a sheet, and its millimetres are not the model's units."""

    def test_a_sheet_border_does_not_set_the_drawing_extents(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbLine>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="*Model_Space",
                    StartPoint="0,0,0",
                    EndPoint="10,10,0",
                ),
                # An A3 sheet border. Real drawings nearly always carry one.
                _row(
                    Description="<AcDbLine>",
                    ID="2",
                    Layer="A-WALL",
                    BlockId="*Paper_Space",
                    StartPoint="0,0,0",
                    EndPoint="420,297,0",
                ),
            ]
        )
        # 42x narrower than the union that used to be stored. That number is
        # also what the unit inference reads, and its threshold is 1000 raw
        # units, so a large enough title block used to relabel a unitless
        # drawing as millimetres and shift every measurement by 1000.
        assert result["extents"] == {"min_x": 0.0, "min_y": 0.0, "max_x": 10.0, "max_y": 10.0}
        # Paper space is still a sheet, unlike a block definition. Model space
        # sorts first so the viewer's auto-select lands on the drawing.
        assert result["layouts"] == ["*Model_Space", "*Paper_Space"]


class TestOwnerClassificationDoesNotDependOnNaming:
    """The block/sheet split holds whatever ``BlockId`` turns out to contain.

    We have never confirmed against a real DwgExporter build whether that
    column holds block-table record names or numeric object ids. A classifier
    that assumed names and met ids would file every entity as a block
    definition and leave the viewer with no sheet to draw - strictly worse
    than the phantom sheets being removed here. So the test that decides is
    positive evidence: a name some reference actually places is a block.
    """

    def test_an_unrecognised_owner_is_treated_as_a_sheet(self, export) -> None:
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbLine>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="8796093022440",
                    StartPoint="0,0,0",
                    EndPoint="10,10,0",
                ),
            ]
        )
        assert result["layouts"] == ["8796093022440"]
        assert [e.get("block") for e in result["entities"]] == [None]
        # No model space contributed, so the extents fall back to everything
        # that is not block-local rather than to the 0..1000 placeholder.
        assert result["extents"] == {"min_x": 0.0, "min_y": 0.0, "max_x": 10.0, "max_y": 10.0}

    def test_everything_classified_as_a_block_falls_back_to_model_space(self, export) -> None:
        """The last-resort guard: a drawing must never arrive with no sheet.

        Contrived - it takes two references placing each other's owner - but
        it is the shape that would leave ``layouts`` empty, and an empty
        picker renders as a blank canvas.
        """
        result = export(
            [
                LAYER,
                _row(
                    Description="<AcDbBlockReference>",
                    ID="1",
                    Layer="A-WALL",
                    BlockId="B",
                    Position="0,0,0",
                    BlockTableRecord="A",
                ),
                _row(
                    Description="<AcDbBlockReference>",
                    ID="2",
                    Layer="A-WALL",
                    BlockId="A",
                    Position="10,10,0",
                    BlockTableRecord="B",
                ),
            ]
        )
        assert result["layouts"] == ["*Model_Space"]
        assert all(e["layout"] == "*Model_Space" for e in result["entities"])
        assert all("block" not in e for e in result["entities"])
        assert result["extents"] == {"min_x": 0.0, "min_y": 0.0, "max_x": 10.0, "max_y": 10.0}


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
