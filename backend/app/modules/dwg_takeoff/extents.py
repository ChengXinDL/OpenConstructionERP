# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""One bounding-box rule for stored DWG/DXF entities.

There used to be two. ``dxf_processor.parse_dxf`` computed the extents it
stores on the version row, and ``service._extents_from_raw_entities``
recomputed them for the lazy units backfill, and the two disagreed about the
same drawing: the parser looked for ``insertion_point`` while every writer in
the codebase emits ``insert``, so a block placed at (30, 0) was invisible to
one of them and visible to the other. A rule written once per caller is only
ever tested at the caller that happened to be right, so both callers now go
through here.

Two filters are applied, and they are the reason this module exists rather
than a bare loop:

* An entity that belongs to a **block definition** carries ``block`` and no
  ``layout``. Its coordinates are block-local - authored around the block's
  own origin - and unioning them with model space produces a box far larger
  than the drawing. Skipped.
* An entity that belongs to a **layout** carries ``layout``. Paper space is a
  sheet in millimetres wrapped around a model in whatever the model is
  authored in, so a title block on an A0 sheet reports a 1189-unit drawing
  whatever the building measures. Filtered by :func:`model_space_extents`.

Entities from older blobs carry no ``layout`` key at all. They are always
included: an absent tag means "we do not know", never "paper space".
"""

from collections.abc import Collection
from typing import Any

# Names a modelspace layout goes by. The DXF path takes the authoritative
# name from ``doc.modelspace()`` and passes it in explicitly; this set is the
# fallback for entities read back from storage, where the document is long
# gone and only the tag written at parse time survives. "Model" is ezdxf's
# name for it, "*Model_Space" is the DWG block-table record name the DDC
# export carries.
MODEL_SPACE_NAMES = frozenset({"Model", "*Model_Space"})


def _iter_coordinates(geometry: dict[str, Any]) -> list[tuple[Any, Any]]:
    """Yield every (x, y) pair a stored ``geometry_data`` dict describes.

    Every key any writer in this module emits is read here. The list was
    built by walking the writers field by field rather than by eye:
    ``dxf_processor._serialize_entity`` and the entity branches of
    ``ddc_dwg_parser.parse_ddc_dwg_excel``.

    Args:
        geometry: A stored ``geometry_data`` mapping.

    Returns:
        Coordinate pairs, unvalidated - the caller drops what will not float.
    """
    points: list[tuple[Any, Any]] = []

    for key in ("start", "end", "insert", "insertion_point"):
        point = geometry.get(key)
        if isinstance(point, dict):
            points.append((point.get("x"), point.get("y")))

    # LWPOLYLINE/POLYLINE/HATCH carry ``points``; SPLINE carries
    # ``control_points``. The second was read by neither of the two original
    # loops, so a drawing made only of splines reported no extents at all.
    for key in ("points", "control_points"):
        for vertex in geometry.get(key) or []:
            if isinstance(vertex, dict):
                points.append((vertex.get("x"), vertex.get("y")))

    center = geometry.get("center")
    if isinstance(center, dict):
        radius = geometry.get("radius") or geometry.get("major_radius") or 0
        try:
            r = float(radius)
        except (TypeError, ValueError):
            r = 0.0
        try:
            cx, cy = float(center.get("x", 0)), float(center.get("y", 0))
        except (TypeError, ValueError):
            return points
        points.append((cx - r, cy - r))
        points.append((cx + r, cy + r))

    return points


def extents_from_stored_entities(
    entities: list[dict[str, Any]],
    *,
    layouts: Collection[str] | None = None,
) -> dict[str, float] | None:
    """Compute a bounding box from stored ``{entity_type, geometry_data}`` records.

    Args:
        entities: Stored entity records, as written by either parser.
        layouts: When given, only entities tagged with one of these layout
            names contribute. An entity carrying no ``layout`` key is always
            included - an absent tag is unknown provenance, not paper space.

    Returns:
        A ``{min_x, min_y, max_x, max_y}`` mapping, or ``None`` when no entity
        carried a usable coordinate.
    """
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    found = False

    for entity in entities:
        # Block-local coordinates never describe where the drawing is.
        if entity.get("block"):
            continue
        if layouts is not None:
            layout = entity.get("layout")
            if layout is not None and layout not in layouts:
                continue
        geometry = entity.get("geometry_data") or {}
        if not isinstance(geometry, dict):
            continue
        for raw_x, raw_y in _iter_coordinates(geometry):
            try:
                x, y = float(raw_x), float(raw_y)
            except (TypeError, ValueError):
                continue
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)
            found = True

    if not found:
        return None
    return {"min_x": float(min_x), "min_y": float(min_y), "max_x": float(max_x), "max_y": float(max_y)}


def model_space_names_present(entities: list[dict[str, Any]]) -> set[str]:
    """Return the modelspace layout names these entities actually use.

    Empty when the entities carry no layout tags, or none of the tags names a
    modelspace - in which case there is nothing to filter towards and the
    caller should fall back to every layout.
    """
    return {
        layout for entity in entities if isinstance(layout := entity.get("layout"), str) and layout in MODEL_SPACE_NAMES
    }


def model_space_extents(
    entities: list[dict[str, Any]],
    *,
    model_space_names: Collection[str] | None = None,
) -> dict[str, float] | None:
    """Bounding box of model space, falling back to every layout when it is empty.

    A drawing that genuinely has no model-space content - a sheet set where
    everything was drawn in paper space - would otherwise report no extents at
    all and land on the parser's 0..1000 placeholder. It gets its real
    paper-space box instead, which is wrong about coordinate system but right
    about magnitude, and magnitude is what the unit inference reads.

    Args:
        entities: Stored entity records.
        model_space_names: Authoritative modelspace layout name(s) when the
            caller still holds the document. Derived from the entity tags when
            omitted.

    Returns:
        A ``{min_x, min_y, max_x, max_y}`` mapping, or ``None`` when no entity
        anywhere carried a usable coordinate.
    """
    names = model_space_names if model_space_names is not None else model_space_names_present(entities)
    if names:
        box = extents_from_stored_entities(entities, layouts=names)
        if box is not None:
            return box
    return extents_from_stored_entities(entities)
