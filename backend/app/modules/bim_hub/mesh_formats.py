# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure helpers for classifying common 3D mesh uploads.

Formats like OBJ, STL, PLY, DAE, glTF/GLB, FBX, 3DS and LWO are *geometry
only*: they carry surfaces (and therefore measurable area / volume / length)
but no BIM properties, materials or classifications. There is no server-side
converter that turns them into the canonical BIM model - instead the BIM Hub
3D uploader reads them directly in the browser, extracts geometric quantities
and posts a normalized GLB back through the ordinary data + geometry upload.

The raw-CAD ingest endpoints (``upload-cad`` and "convert document to BIM")
therefore should never try to store these as convertible CAD. This module
gives them a single, framework-free place to recognise a mesh file and return
a friendly, actionable message that points the user at the right door.

Pure stdlib, no DB and no FastAPI imports, so it is trivially unit-testable.
"""

from __future__ import annotations

from typing import Final

# Lower-case extensions (with the leading dot) of the geometry-only mesh
# formats the in-browser BIM Hub uploader handles. Keep this in sync with the
# frontend ``meshImport/formats.ts`` MESH_IMPORT_EXTENSIONS list.
MESH_GEOMETRY_EXTENSIONS: Final[frozenset[str]] = frozenset(
    {
        ".obj",
        ".stl",
        ".ply",
        ".dae",
        ".glb",
        ".gltf",
        ".fbx",
        ".3ds",
        ".lwo",
        ".usd",
        ".usdz",
    }
)


def is_mesh_geometry_ext(ext: str) -> bool:
    """True when *ext* is a geometry-only 3D mesh format we read in-browser.

    ``ext`` may be given with or without the leading dot and in any case.
    """
    if not ext:
        return False
    normalized = ext.lower()
    if not normalized.startswith("."):
        normalized = "." + normalized
    return normalized in MESH_GEOMETRY_EXTENSIONS


def mesh_upload_hint(ext: str, filename: str | None = None) -> str:
    """Friendly rejection message for a geometry-only mesh upload.

    Explains that mesh formats are read directly by the BIM Hub 3D uploader
    (no server conversion) and that they carry geometry but no BIM data.
    """
    who = f"'{filename}' " if filename else "This file "
    ext_label = ext if ext.startswith(".") else f".{ext}"
    return (
        f"{who}is a 3D mesh file ({ext_label}). Open the BIM Hub 3D uploader "
        "and drop it there - OBJ, STL, glTF/GLB, DAE, FBX, PLY and 3DS are "
        "read directly in the browser to view, measure and extract geometry "
        "quantities. Mesh formats carry geometry only (no BIM properties or "
        "classifications), so there is nothing to convert on the server."
    )
