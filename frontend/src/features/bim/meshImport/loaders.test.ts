// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * End-to-end cover for the in-browser mesh import: a real file goes in, a
 * scene comes out, and the quantities are the ones the shape actually has.
 *
 * ``geometry.test.ts`` proves the measuring maths and ``formats.test.ts``
 * proves the unit checks, but both start from a hand-built THREE scene. That
 * left the step the community question is actually about - can this product
 * read my .dae - resting on nothing but the fact that the code compiles.
 *
 * The fixtures are written out here rather than committed as binaries so the
 * expected area and volume are visible next to the geometry that produces
 * them. Formats whose containers cannot reasonably be hand-authored (3DS,
 * FBX, LWO) are not covered; those still rest on their loader.
 */
import { describe, expect, it } from 'vitest';
import { loadMeshFile } from './loaders';
import { extractSceneMetrics } from './geometry';

const file = (name: string, body: string | ArrayBuffer): File =>
  new File([body], name);

/** A 2 x 2 x 2 box at the origin: surface area 24, volume 8. */
const OBJ_BOX = `# unit test box
v 0 0 0
v 2 0 0
v 2 2 0
v 0 2 0
v 0 0 2
v 2 0 2
v 2 2 2
v 0 2 2
g box
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

/** One right triangle with legs of 1: area 0.5, and no volume worth having. */
const DAE_TRIANGLE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="1" name="meter"/><up_axis>Y_UP</up_axis></asset>
  <library_geometries>
    <geometry id="tri" name="tri">
      <mesh>
        <source id="tri-pos">
          <float_array id="tri-pos-array" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common>
            <accessor source="#tri-pos-array" count="3" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="tri-vtx"><input semantic="POSITION" source="#tri-pos"/></vertices>
        <triangles count="1">
          <input semantic="VERTEX" source="#tri-vtx" offset="0"/>
          <p>0 1 2</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene"><node id="n" name="n"><instance_geometry url="#tri"/></node></visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;

const STL_TRIANGLE = `solid tri
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid tri
`;

/**
 * A glTF whose buffer is embedded as a data URI. This is the case the user
 * guide promises works, as opposed to a .gltf pointing at a sibling .bin,
 * which cannot work because the loader is handed an empty resource path.
 */
function gltfWithEmbeddedBuffer(): string {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bytes = new Uint8Array(positions.buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.byteLength }],
    buffers: [
      {
        byteLength: bytes.byteLength,
        uri: `data:application/octet-stream;base64,${base64}`,
      },
    ],
  });
}

describe('loadMeshFile', () => {
  it('reads an OBJ and measures the box it describes', async () => {
    const res = await loadMeshFile(file('box.obj', OBJ_BOX));
    expect(res.format).toBe('obj');
    expect(res.experimental).toBe(false);

    const { totals } = extractSceneMetrics(res.object, { upAxis: 'z' });
    expect(totals.objectCount).toBe(1);
    expect(totals.triangleCount).toBe(12); // six quads, triangulated
    expect(totals.area_m2).toBeCloseTo(24, 6);
    expect(totals.volume_m3).toBeCloseTo(8, 6);
  });

  it('reads a COLLADA .dae, the format the question was about', async () => {
    const res = await loadMeshFile(file('tri.dae', DAE_TRIANGLE));
    expect(res.format).toBe('dae');

    const { totals } = extractSceneMetrics(res.object, { upAxis: 'y' });
    expect(totals.objectCount).toBe(1);
    expect(totals.triangleCount).toBe(1);
    // Area survives whatever up-axis rotation the loader applied on the way in.
    expect(totals.area_m2).toBeCloseTo(0.5, 6);
  });

  it('reads an ASCII STL', async () => {
    const res = await loadMeshFile(file('tri.stl', STL_TRIANGLE));
    expect(res.format).toBe('stl');

    const { totals } = extractSceneMetrics(res.object, { upAxis: 'z' });
    expect(totals.triangleCount).toBe(1);
    expect(totals.area_m2).toBeCloseTo(0.5, 6);
  });

  it('reads a .gltf whose buffers are embedded in the file', async () => {
    const res = await loadMeshFile(file('tri.gltf', gltfWithEmbeddedBuffer()));
    expect(res.format).toBe('gltf');

    const { totals } = extractSceneMetrics(res.object, { upAxis: 'y' });
    expect(totals.triangleCount).toBe(1);
    expect(totals.area_m2).toBeCloseTo(0.5, 6);
  });

  it('refuses a format that belongs to the server-side converter', async () => {
    await expect(loadMeshFile(file('model.ifc', 'not a mesh'))).rejects.toThrow(
      /Unsupported mesh format/,
    );
  });

  it('reports a parse failure as an Error rather than escaping raw', async () => {
    await expect(loadMeshFile(file('broken.dae', 'this is not XML at all'))).rejects.toBeInstanceOf(
      Error,
    );
  });
});
