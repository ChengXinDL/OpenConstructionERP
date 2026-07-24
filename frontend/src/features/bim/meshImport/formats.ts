// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Pure, dependency-free mesh-format helpers.
 *
 * Split out of ``loaders.ts`` so lightweight callers (e.g. the file manager
 * upload router) can recognise a 3D mesh file by name WITHOUT importing
 * three.js and its ~nine addon loaders. ``loaders.ts`` re-exports these so
 * existing ``./loaders`` imports keep working unchanged.
 *
 * Keep this list in sync with the backend ``bim_hub/mesh_formats.py``
 * MESH_GEOMETRY_EXTENSIONS set.
 */

export type MeshFormat =
  | 'obj'
  | '3ds'
  | 'dae'
  | 'fbx'
  | 'lwo'
  | 'stl'
  | 'ply'
  | 'gltf'
  | 'glb'
  | 'usd'
  | 'usdz';

/** Every extension the mesh importer accepts, lower-case with the leading dot. */
export const MESH_IMPORT_EXTENSIONS = [
  '.obj',
  '.3ds',
  '.dae',
  '.fbx',
  '.lwo',
  '.stl',
  '.ply',
  '.gltf',
  '.glb',
  '.usd',
  '.usdz',
] as const;

/** Lower-case file extension including the dot, or '' when there is none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

/** Resolve a filename to a supported mesh format, or null. */
export function meshFormatFromName(filename: string): MeshFormat | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  const candidate = ext.slice(1) as MeshFormat;
  return (MESH_IMPORT_EXTENSIONS as readonly string[]).includes(ext) ? candidate : null;
}

/** True when the file is one the mesh importer can handle. */
export function isMeshImportFile(filename: string): boolean {
  return meshFormatFromName(filename) !== null;
}
