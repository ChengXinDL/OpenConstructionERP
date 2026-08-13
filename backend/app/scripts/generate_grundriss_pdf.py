# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Generate the vector German demo floor plan (Grundriss Erdgeschoss).

Renders ``flagship_assets/grundriss_erdgeschoss.pdf`` from the geometry in
:mod:`app.scripts.grundriss_plan` - a single-page, fully vector DIN A3 sheet at
M 1:100 with German room labels, dimension chains in metres, axis bubbles, a
title block with a scale bar, and a border frame. The takeoff demo seeder
derives its measurement polygons from the same geometry module, so what the
viewer draws and what the seed claims cannot drift apart.

Regenerate (deterministic output, reportlab ``invariant`` mode)::

    python -m app.scripts.generate_grundriss_pdf

reportlab is already a backend dependency (GAEB/report exports); no new
dependencies are introduced.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import black, white
from reportlab.pdfgen import canvas as rl_canvas

from app.scripts import grundriss_plan as plan

OUT_PATH = Path(__file__).resolve().parent / "flagship_assets" / "grundriss_erdgeschoss.pdf"

# Paint greys (0 = black, 1 = white).
_EXT_WALL_GREY = 0.15
_INT_WALL_GREY = 0.30
_THIN = 0.5
_MEDIUM = 0.9
_THICK = 1.4


def _pt(x_m: float, y_m: float) -> tuple[float, float]:
    return plan.to_pdf_xy(x_m, y_m)


def _rect_m(c: rl_canvas.Canvas, x_m: float, y_m: float, w_m: float, d_m: float, *, fill_grey: float | None) -> None:
    """Axis-aligned rectangle given in plan metres."""
    x, y = _pt(x_m, y_m)
    if fill_grey is None:
        c.rect(x, y, w_m * plan.PT_PER_M, d_m * plan.PT_PER_M, stroke=1, fill=0)
    else:
        c.setFillGray(fill_grey)
        c.rect(x, y, w_m * plan.PT_PER_M, d_m * plan.PT_PER_M, stroke=0, fill=1)


def _line_m(c: rl_canvas.Canvas, x1_m: float, y1_m: float, x2_m: float, y2_m: float) -> None:
    x1, y1 = _pt(x1_m, y1_m)
    x2, y2 = _pt(x2_m, y2_m)
    c.line(x1, y1, x2, y2)


def _draw_walls(c: rl_canvas.Canvas) -> None:
    """Exterior wall band, corridor walls and partitions as filled bands."""
    # Exterior band: dark outer rectangle, white inner envelope punched out.
    _rect_m(c, 0, 0, plan.BUILDING_W_M, plan.BUILDING_D_M, fill_grey=_EXT_WALL_GREY)
    _rect_m(
        c,
        plan.INNER_X0_M,
        plan.INNER_Y0_M,
        plan.INNER_X1_M - plan.INNER_X0_M,
        plan.INNER_Y1_M - plan.INNER_Y0_M,
        fill_grey=1.0,
    )
    # Corridor walls (two horizontal bands across the inner envelope).
    inner_w = plan.INNER_X1_M - plan.INNER_X0_M
    _rect_m(
        c, plan.INNER_X0_M, plan.CORRIDOR_Y0_M - plan.INT_WALL_M, inner_w, plan.INT_WALL_M, fill_grey=_INT_WALL_GREY
    )
    _rect_m(c, plan.INNER_X0_M, plan.CORRIDOR_Y1_M, inner_w, plan.INT_WALL_M, fill_grey=_INT_WALL_GREY)
    # Room partitions: vertical bands in the gaps between neighbouring rooms.
    south = [plan.ROOMS[n] for n in ("1.01", "1.02", "1.03", "1.04", "1.05")]
    north = [plan.ROOMS[n] for n in ("1.06", "1.07", "1.08", "1.09", "1.10")]
    for row in (south, north):
        for left, right in zip(row, row[1:], strict=False):
            gap_x = left.x + left.w
            _rect_m(c, gap_x, row[0].y, right.x - gap_x, row[0].d, fill_grey=_INT_WALL_GREY)


def _punch_doors(c: rl_canvas.Canvas) -> None:
    """White openings in corridor walls plus door leaves and swing arcs."""
    r = plan.DOOR_W_M
    for door in plan.DOORS:
        x0 = door.cx - r / 2.0
        if door.south_wall:
            wall_y = plan.CORRIDOR_Y0_M - plan.INT_WALL_M
            _rect_m(c, x0, wall_y - 0.01, r, plan.INT_WALL_M + 0.02, fill_grey=1.0)
            hinge_x, hinge_y = x0, wall_y  # leaf swings south, into the room
            leaf_end_y = hinge_y - r
            arc_start = 270.0
        else:
            wall_y = plan.CORRIDOR_Y1_M
            _rect_m(c, x0, wall_y - 0.01, r, plan.INT_WALL_M + 0.02, fill_grey=1.0)
            hinge_x, hinge_y = x0, wall_y + plan.INT_WALL_M
            leaf_end_y = hinge_y + r
            arc_start = 0.0
        c.setLineWidth(_THIN)
        c.setStrokeColor(black)
        _line_m(c, hinge_x, hinge_y, hinge_x, leaf_end_y)
        hx, hy = _pt(hinge_x, hinge_y)
        r_pt = r * plan.PT_PER_M
        c.arc(hx - r_pt, hy - r_pt, hx + r_pt, hy + r_pt, arc_start, 90.0)
        if door.t30:
            c.setFont("Helvetica-Bold", 6.5)
            label_y = hinge_y + 0.22 if not door.south_wall else hinge_y - 0.62
            tx, ty = _pt(door.cx + 0.62, label_y)
            c.drawString(tx, ty, "T30")
    # Entrance: double door in the west exterior wall.
    _rect_m(
        c,
        -0.01,
        plan.ENTRANCE_Y0_M,
        plan.EXT_WALL_M + 0.02,
        plan.ENTRANCE_Y1_M - plan.ENTRANCE_Y0_M,
        fill_grey=1.0,
    )
    half = (plan.ENTRANCE_Y1_M - plan.ENTRANCE_Y0_M) / 2.0
    c.setLineWidth(_THIN)
    for hinge_y, extent_start in ((plan.ENTRANCE_Y0_M, 0.0), (plan.ENTRANCE_Y1_M, 270.0)):
        _line_m(c, plan.EXT_WALL_M, hinge_y, plan.EXT_WALL_M + half, hinge_y)
        hx, hy = _pt(plan.EXT_WALL_M, hinge_y)
        r_pt = half * plan.PT_PER_M
        c.arc(hx - r_pt, hy - r_pt, hx + r_pt, hy + r_pt, extent_start, 90.0)


def _punch_windows(c: rl_canvas.Canvas) -> None:
    """White openings with double glazing lines in the exterior walls."""
    for cx, south in plan.WINDOWS:
        x0 = cx - plan.WINDOW_W_M / 2.0
        y0 = 0.0 if south else plan.BUILDING_D_M - plan.EXT_WALL_M
        _rect_m(c, x0, y0 - 0.01, plan.WINDOW_W_M, plan.EXT_WALL_M + 0.02, fill_grey=1.0)
        c.setLineWidth(_THIN)
        c.setStrokeColor(black)
        for frac in (0.34, 0.66):
            gy = y0 + plan.EXT_WALL_M * frac
            _line_m(c, x0, gy, x0 + plan.WINDOW_W_M, gy)
        for jx in (x0, x0 + plan.WINDOW_W_M):
            _line_m(c, jx, y0, jx, y0 + plan.EXT_WALL_M)


def _room_labels(c: rl_canvas.Canvas) -> None:
    c.setFillColor(black)
    for room in plan.ROOMS.values():
        cx, cy = _pt(room.x + room.w / 2.0, room.y + room.d / 2.0)
        if room.number == "1.11":  # corridor: keep the label clear of doors
            cx, _ = _pt(4.4, 0)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(cx, cy + 4.0, room.label)
        c.setFont("Helvetica", 7.5)
        c.drawCentredString(cx, cy - 6.5, plan.format_area_de(room.area_m2))


def _tick(c: rl_canvas.Canvas, x: float, y: float) -> None:
    """Diagonal dimension tick (German chain style)."""
    c.line(x - 2.6, y - 2.6, x + 2.6, y + 2.6)


def _chain_h(c: rl_canvas.Canvas, y_m: float, cuts: list[float], *, small_rotated: bool) -> None:
    """Horizontal dimension chain at plan height ``y_m`` with cuts in metres."""
    c.setLineWidth(_THIN)
    x_start, y = _pt(cuts[0], y_m)
    x_end, _ = _pt(cuts[-1], y_m)
    c.line(x_start, y, x_end, y)
    for cut in cuts:
        x, _ = _pt(cut, y_m)
        _tick(c, x, y)
    for left, right in zip(cuts, cuts[1:], strict=False):
        seg = right - left
        label = plan.format_len_de(seg)
        mx, _ = _pt((left + right) / 2.0, y_m)
        if seg >= 1.0:
            c.setFont("Helvetica", 7)
            c.drawCentredString(mx, y + 3.2, label)
        elif small_rotated:
            c.saveState()
            c.setFont("Helvetica", 4.6)
            c.translate(mx + 1.4, y + 3.0)
            c.rotate(90)
            c.drawString(0, 0, label)
            c.restoreState()


def _chain_v(c: rl_canvas.Canvas, x_m: float, cuts: list[float], *, small_rotated: bool) -> None:
    """Vertical dimension chain at plan offset ``x_m`` with cuts in metres."""
    c.setLineWidth(_THIN)
    x, y_start = _pt(x_m, cuts[0])
    _, y_end = _pt(x_m, cuts[-1])
    c.line(x, y_start, x, y_end)
    for cut in cuts:
        _, y = _pt(x_m, cut)
        _tick(c, x, y)
    for low, high in zip(cuts, cuts[1:], strict=False):
        seg = high - low
        label = plan.format_len_de(seg)
        _, my = _pt(x_m, (low + high) / 2.0)
        c.saveState()
        c.translate(x - 3.2, my)
        c.rotate(90)
        size = 7 if seg >= 1.0 else 4.6
        if seg >= 1.0 or small_rotated:
            c.setFont("Helvetica", size)
            c.drawCentredString(0, 0, label)
        c.restoreState()


def _dimension_chains(c: rl_canvas.Canvas) -> None:
    # South-row cut list: outer face, wall faces of every room, outer face.
    cuts = [0.0, plan.EXT_WALL_M]
    for room in (plan.ROOMS[n] for n in ("1.01", "1.02", "1.03", "1.04", "1.05")):
        cuts.append(round(room.x + room.w, 4))
        cuts.append(round(room.x + room.w + plan.INT_WALL_M, 4))
    cuts[-1] = plan.BUILDING_W_M  # after the last room comes the exterior wall
    _chain_h(c, -0.9, cuts, small_rotated=True)
    _chain_h(c, -1.62, [0.0, plan.BUILDING_W_M], small_rotated=False)
    v_cuts = [
        0.0,
        plan.EXT_WALL_M,
        plan.CORRIDOR_Y0_M - plan.INT_WALL_M,
        plan.CORRIDOR_Y0_M,
        plan.CORRIDOR_Y1_M,
        plan.CORRIDOR_Y1_M + plan.INT_WALL_M,
        plan.BUILDING_D_M - plan.EXT_WALL_M,
        plan.BUILDING_D_M,
    ]
    _chain_v(c, -0.9, v_cuts, small_rotated=True)
    _chain_v(c, -1.62, [0.0, plan.BUILDING_D_M], small_rotated=False)


def _axes(c: rl_canvas.Canvas) -> None:
    """Dash-dot structural axes with bubbles: A-D horizontal, 1-2 vertical."""
    c.setLineWidth(_THIN)
    c.setDash(6, 3)
    h_axes = [
        ("A", plan.EXT_WALL_M / 2.0),
        ("B", plan.CORRIDOR_Y0_M - plan.INT_WALL_M / 2.0),
        ("C", plan.CORRIDOR_Y1_M + plan.INT_WALL_M / 2.0),
        ("D", plan.BUILDING_D_M - plan.EXT_WALL_M / 2.0),
    ]
    for _lbl, y_m in h_axes:
        _line_m(c, -1.05, y_m, plan.BUILDING_W_M + 0.55, y_m)
    v_axes = [("1", plan.EXT_WALL_M / 2.0), ("2", plan.BUILDING_W_M - plan.EXT_WALL_M / 2.0)]
    for _lbl, x_m in v_axes:
        _line_m(c, x_m, -0.35, x_m, plan.BUILDING_D_M + 1.05)
    c.setDash()  # reset to solid
    c.setFont("Helvetica", 8)
    for label, y_m in h_axes:
        bx, by = _pt(-1.45, y_m)
        c.circle(bx, by, 9, stroke=1, fill=0)
        c.drawCentredString(bx, by - 2.8, label)
    for label, x_m in v_axes:
        bx, by = _pt(x_m, plan.BUILDING_D_M + 1.45)
        c.circle(bx, by, 9, stroke=1, fill=0)
        c.drawCentredString(bx, by - 2.8, label)


def _north_arrow(c: rl_canvas.Canvas) -> None:
    cx, cy = 1035.0, 700.0
    c.setLineWidth(_MEDIUM)
    c.circle(cx, cy, 16, stroke=1, fill=0)
    p = c.beginPath()
    p.moveTo(cx, cy + 12)
    p.lineTo(cx - 6, cy - 9)
    p.lineTo(cx, cy - 4)
    p.lineTo(cx + 6, cy - 9)
    p.close()
    c.setFillColor(black)
    c.drawPath(p, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(cx, cy + 21, "N")


def _scale_bar(c: rl_canvas.Canvas, x: float, y: float) -> None:
    """Graphic scale bar 0-5 m in 1 m steps (alternating fill)."""
    step = plan.PT_PER_M
    c.setLineWidth(_THIN)
    for i in range(5):
        c.setFillGray(0.0 if i % 2 == 0 else 1.0)
        c.rect(x + i * step, y, step, 4.5, stroke=1, fill=1)
    c.setFillColor(black)
    c.setFont("Helvetica", 5.5)
    for i in range(6):
        c.drawCentredString(x + i * step, y + 7.0, str(i))
    c.setFont("Helvetica", 5.5)
    c.drawString(x + 5 * step + 5.0, y + 0.5, "m")


def _title_block(c: rl_canvas.Canvas) -> None:
    x0, y0, w, h = 700.0, 34.0, 458.0, 112.0
    c.setLineWidth(_THICK)
    c.setFillColor(white)
    c.rect(x0, y0, w, h, stroke=1, fill=1)
    c.setFillColor(black)
    c.setLineWidth(_THIN)
    c.line(x0, y0 + h - 30, x0 + w, y0 + h - 30)
    c.line(x0, y0 + h - 58, x0 + w, y0 + h - 58)
    c.line(x0 + 250, y0, x0 + 250, y0 + h - 58)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x0 + 10, y0 + h - 21, "Grundriss Erdgeschoss")
    c.setFont("Helvetica", 8.5)
    c.drawString(x0 + 260, y0 + h - 20, "Maßstab M 1:100")
    c.drawString(x0 + 10, y0 + h - 46, "Neubau Bürogebäude · Büro- und Sozialbereich EG")
    c.drawString(x0 + 260, y0 + h - 46, "Format DIN A3 · Alle Maße in m")
    c.setFont("Helvetica", 8)
    c.drawString(x0 + 10, y0 + 34, "Plan-Nr. A-2.01 · Index C · Stand 07/2026")
    c.drawString(x0 + 10, y0 + 20, "Blatt 1 von 1 · Flächen nach DIN 277")
    c.drawString(x0 + 10, y0 + 6, "Bemaßung: lichte Maße / Wandstärken")
    _scale_bar(c, x0 + 260, y0 + 12)


def _sheet_header(c: rl_canvas.Canvas) -> None:
    c.setFont("Helvetica-Bold", 13)
    c.drawString(42.0, plan.PAGE_H_PT - 46.0, "GRUNDRISS ERDGESCHOSS")
    c.setFont("Helvetica", 9)
    c.drawString(42.0, plan.PAGE_H_PT - 60.0, "M 1:100 · Alle Maße in m · Flächenangaben in m²")


def build_pdf(out_path: Path = OUT_PATH) -> Path:
    """Render the plan; ``invariant`` makes the bytes reproducible."""
    c = rl_canvas.Canvas(str(out_path), pagesize=(plan.PAGE_W_PT, plan.PAGE_H_PT), invariant=1)
    c.setTitle("Grundriss Erdgeschoss M 1:100")
    c.setAuthor("OpenConstructionERP demo assets")
    c.setSubject("Vector demo floor plan for the PDF takeoff module")
    # Border frame.
    c.setLineWidth(_THICK)
    c.rect(25, 25, plan.PAGE_W_PT - 50, plan.PAGE_H_PT - 50, stroke=1, fill=0)
    _sheet_header(c)
    _axes(c)
    _draw_walls(c)
    _punch_doors(c)
    _punch_windows(c)
    c.setLineWidth(_MEDIUM)
    c.setStrokeColor(black)
    _room_labels(c)
    _dimension_chains(c)
    _north_arrow(c)
    _title_block(c)
    c.showPage()
    c.save()
    return out_path


if __name__ == "__main__":
    path = build_pdf()
    print(f"wrote {path} ({path.stat().st_size} bytes)")
