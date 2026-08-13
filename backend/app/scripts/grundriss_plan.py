# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Single source of truth for the demo German floor plan (Grundriss Erdgeschoss).

This module owns the GEOMETRY of the vector reference plan that ships as
``flagship_assets/grundriss_erdgeschoss.pdf``:

* :mod:`app.scripts.generate_grundriss_pdf` renders the PDF from these numbers
  (run it to regenerate the fixture deterministically), and
* :mod:`app.modules.takeoff.seed` derives measurement polygons / polylines /
  count markers from the same numbers, so a seeded measurement always encloses
  exactly the room it names and its value recomputes from its own points.

Keeping both consumers on one dataclass table is deliberate: a copied
coordinate that drifts stays green in every gate, a shared one cannot drift.

Coordinate systems
------------------
* Plan space: metres, origin at the building's OUTER south-west corner,
  x to the east, y to the north.
* PDF space (reportlab): points (1/72 inch), origin bottom-left of the page.
* Viewer space (what ``TakeoffMeasurement.points`` stores): PDF user units at
  zoom 1 with the origin at the TOP-left of the page and y growing downwards -
  the space PDF.js viewports and the takeoff overlay canvas share (see
  ``frontend/src/features/takeoff/lib/takeoff-viewport.ts``).

The plan is drawn at M 1:100 on DIN A3 landscape, so one metre of building is
``72 / (0.0254 * 100)`` PDF points on paper - the same "pixels per unit" ratio
the frontend's 1:100 scale preset produces, which makes the seeded
``scale_pixels_per_unit`` literally the preset value.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- page & scale ----------------------------------------------------------

#: DIN A3 landscape in PDF points (420 x 297 mm).
PAGE_W_PT: float = 1190.5511811023622
PAGE_H_PT: float = 841.8897637795275

#: Drawing scale denominator (M 1:100).
SCALE_RATIO: int = 100

#: PDF points per real-world metre at M 1:100 (equals the frontend preset:
#: ``72 / (0.0254 * ratio)``).
PT_PER_M: float = 72.0 / (0.0254 * SCALE_RATIO)

#: Building outer south-west corner on the page, in PDF points (bottom-left
#: origin). Leaves room for dimension chains below/left and the title block.
ORIGIN_X_PT: float = 150.0
ORIGIN_Y_PT: float = 200.0

# --- building envelope (metres) -------------------------------------------

BUILDING_W_M: float = 28.24  #: outer width (west-east)
BUILDING_D_M: float = 14.36  #: outer depth (south-north)
EXT_WALL_M: float = 0.365  #: exterior wall thickness
INT_WALL_M: float = 0.115  #: partition thickness

#: Corridor (Flur) clear band along y, full inner width along x.
CORRIDOR_Y0_M: float = 5.995
CORRIDOR_Y1_M: float = 7.995

#: Inner envelope (clear face of the exterior wall).
INNER_X0_M: float = EXT_WALL_M
INNER_X1_M: float = BUILDING_W_M - EXT_WALL_M
INNER_Y0_M: float = EXT_WALL_M
INNER_Y1_M: float = BUILDING_D_M - EXT_WALL_M

DOOR_W_M: float = 0.885  #: single interior door opening
WINDOW_W_M: float = 1.51  #: window opening in exterior walls


@dataclass(frozen=True)
class Room:
    """One labelled room: clear (inner-face) rectangle in plan metres."""

    number: str
    name: str
    x: float
    y: float
    w: float
    d: float

    @property
    def area_m2(self) -> float:
        return self.w * self.d

    @property
    def label(self) -> str:
        return f"{self.name} {self.number}"


#: Rooms keyed by room number. South row / corridor / north row layout;
#: widths + partitions sum exactly to the inner envelope on both rows.
ROOMS: dict[str, Room] = {
    r.number: r
    for r in (
        # south row (between exterior wall and corridor south wall)
        Room("1.01", "Büro", 0.365, 0.365, 5.39, 5.515),
        Room("1.02", "Büro", 5.870, 0.365, 5.38, 5.515),
        Room("1.03", "Besprechung", 11.365, 0.365, 6.59, 5.515),
        Room("1.04", "Teeküche", 18.070, 0.365, 3.98, 5.515),
        Room("1.05", "Technik", 22.165, 0.365, 5.71, 5.515),
        # north row (between corridor north wall and exterior wall)
        Room("1.06", "Großraumbüro", 0.365, 8.110, 10.89, 5.885),
        Room("1.07", "WC Herren", 11.370, 8.110, 3.19, 5.885),
        Room("1.08", "WC Damen", 14.675, 8.110, 3.21, 5.885),
        Room("1.09", "Kopierraum", 18.000, 8.110, 4.05, 5.885),
        Room("1.10", "Lager", 22.165, 8.110, 5.71, 5.885),
        # corridor
        Room("1.11", "Flur", 0.365, CORRIDOR_Y0_M, 27.51, CORRIDOR_Y1_M - CORRIDOR_Y0_M),
    )
}


@dataclass(frozen=True)
class Door:
    """Interior door in a corridor wall: opening centre + which wall."""

    room_number: str
    cx: float  #: opening centre x, metres
    south_wall: bool  #: True = corridor SOUTH wall, False = corridor NORTH wall
    t30: bool = False  #: fire-rated door (T30), labelled on the plan

    @property
    def wall_center_y(self) -> float:
        if self.south_wall:
            return CORRIDOR_Y0_M - INT_WALL_M / 2.0
        return CORRIDOR_Y1_M + INT_WALL_M / 2.0


#: One door per room, opening off the corridor. Technik and Lager get T30
#: fire doors (referenced by the retail demo's T30 BOQ position).
DOORS: list[Door] = [
    Door("1.01", 5.00, south_wall=True),
    Door("1.02", 6.70, south_wall=True),
    Door("1.03", 12.20, south_wall=True),
    Door("1.04", 18.90, south_wall=True),
    Door("1.05", 23.00, south_wall=True, t30=True),
    Door("1.06", 1.20, south_wall=False),
    Door("1.07", 12.20, south_wall=False),
    Door("1.08", 15.50, south_wall=False),
    Door("1.09", 18.80, south_wall=False),
    Door("1.10", 23.00, south_wall=False, t30=True),
]

#: Entrance (double door) opening in the WEST exterior wall, y-range in metres.
ENTRANCE_Y0_M: float = 6.115
ENTRANCE_Y1_M: float = 7.875

#: Window opening centres in the exterior walls: (centre x, on_south_wall).
WINDOWS: list[tuple[float, bool]] = [
    # south facade
    (1.85, True),
    (4.25, True),
    (7.35, True),
    (9.75, True),
    (12.55, True),
    (14.65, True),
    (16.75, True),
    (19.90, True),
    (24.50, True),
    # north facade
    (1.80, False),
    (4.30, False),
    (6.80, False),
    (9.30, False),
    (12.90, False),
    (16.20, False),
    (19.90, False),
    (24.50, False),
]


def window_wall_center_y(south: bool) -> float:
    """Centre-line y of the exterior wall a window sits in, metres."""
    return EXT_WALL_M / 2.0 if south else BUILDING_D_M - EXT_WALL_M / 2.0


# --- coordinate transforms -------------------------------------------------


def to_pdf_xy(x_m: float, y_m: float) -> tuple[float, float]:
    """Plan metres -> PDF points (bottom-left origin, y up). For reportlab."""
    return (ORIGIN_X_PT + x_m * PT_PER_M, ORIGIN_Y_PT + y_m * PT_PER_M)


def to_viewer_xy(x_m: float, y_m: float) -> tuple[float, float]:
    """Plan metres -> takeoff viewer coordinates (top-left origin, y down)."""
    x_pt, y_pt = to_pdf_xy(x_m, y_m)
    return (x_pt, PAGE_H_PT - y_pt)


def viewer_points(points_m: list[tuple[float, float]]) -> list[dict[str, float]]:
    """Convert plan-space vertices to the ``points`` JSON the viewer stores."""
    out: list[dict[str, float]] = []
    for x_m, y_m in points_m:
        x, y = to_viewer_xy(x_m, y_m)
        out.append({"x": round(x, 3), "y": round(y, 3)})
    return out


def room_polygon_m(number: str) -> list[tuple[float, float]]:
    """Clear-face rectangle of a room as a closed-ring vertex list (metres)."""
    r = ROOMS[number]
    return [(r.x, r.y), (r.x + r.w, r.y), (r.x + r.w, r.y + r.d), (r.x, r.y + r.d)]


def building_outline_m(inset: float = 0.0) -> list[tuple[float, float]]:
    """Outer building rectangle, optionally inset (metres)."""
    return [
        (inset, inset),
        (BUILDING_W_M - inset, inset),
        (BUILDING_W_M - inset, BUILDING_D_M - inset),
        (inset, BUILDING_D_M - inset),
    ]


def format_area_de(value_m2: float) -> str:
    """German-style area label with a decimal comma, e.g. ``29,73 m²``."""
    return f"{value_m2:.2f}".replace(".", ",") + " m²"


def format_len_de(value_m: float) -> str:
    """German-style dimension label in metres with a decimal comma.

    Two decimals by default ("2,00", "5,39"), three when the value needs them
    ("0,115", "5,885") - matching how chains on German drawings are labelled.
    """
    if abs(value_m - round(value_m, 2)) < 5e-4:
        return f"{value_m:.2f}".replace(".", ",")
    return f"{value_m:.3f}".replace(".", ",")
