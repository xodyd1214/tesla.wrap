import { THREE as T, GLTFLoader, MeshoptDecoder } from '../assets/vendor/three-preview.js';
import { loadTemplate, models } from '../js/templates.js';
import { highlandBody, highlandPaintShells, separateSkins, vehicleGeometry, vehicleTransform } from '../js/vehicle.js';

const sideSeam = (801 - 539) / 203;
const isSideIsland = part => part.startsWith('sill-') || part.startsWith('fender-rear-');

function exteriorPart(x, y, z, ny, outerShell) {
  const side = x < 0 ? 'l' : 'r';
  const a = Math.abs(x);
  if (a > .84 && y > .87 && z > -.79 && z < -.54) return 'mirror-' + side;
  // Only the exterior shell carries the painted rail above the side windows.
  // The other meshes contain the dark B-pillars and quarter-window surrounds.
  if (outerShell && a > .49 && a < .82 && y > (z < -.8 ? .918 : .94) && z > -1.02 && z < 1.78 &&
    (z < 1.08 || y > 1.07)) return 'pillar-' + side;
  // The fender tips above the headlights extend inward toward the hood seam.
  if (a > .48 && y > .68 && z > -2.13 && z < -1.72 && ny > .5) return 'fender-front-' + side;
  if (y > (outerShell ? .16 : .2) && (z < -2.05 || z < -1.85 && y < .53)) return 'bumper-front';
  if (a > .65 && y > .27 && z < -.95 && z > -2.13) return 'fender-front-' + side;
  if ((a > .73 || outerShell && a > .66 && y < 1.07) && y > .44 && z >= 1.18 && z <= 2.09) return 'fender-rear-' + side;
  if ((a > .59 && y > .145 || outerShell && a > .74) && y < .29 && z > -1.08 && z < 1.02) return 'sill-' + side;
  if (a > .77 && y >= .25 && y < .96 && z > -.955 && z < 1.24) {
    return (z < .212 ? 'door-front-' : 'door-rear-') + side;
  }
  return null;
}

function highlandSkin([x0, y0, z0, x1, y1, z1]) {
  const side = x0 < 0 ? 'l' : 'r';
  const lateral = x0 > .65 || x1 < -.65;
  if (x0 > -.75 && x0 < -.7 && x1 > .7 && x1 < .75 &&
    y0 > .41 && y1 < .925 && z0 < -2.26 && z0 > -2.3 && z1 < -1.075 && z1 > -1.13) {
    return 'hood';
  }
  if (lateral && y0 > .22 && y0 < .32 && y1 > .84 && y1 < 1.055) {
    if (z0 > -.99 && z0 < -.87 && z1 > .15 && z1 < .27) return 'door-front-' + side;
    if (z0 > .17 && z0 < .29 && z1 > 1.15 && z1 < 1.34) return 'door-rear-' + side;
  }
  return null;
}

function highlandShellSkin([x0, y0, z0, x1, y1, z1]) {
  const side = x0 < 0 ? 'l' : 'r';
  const innerX = Math.max(x0, -x1);
  // Keep the upper fender and its bevel together along the hood seam.
  if (innerX > .42 && innerX < .44 && y0 > .61 && y1 > .90 &&
    z0 > -2.18 && z0 < -2.17 && z1 > -1.03 && z1 < -.94) return 'fender-front-' + side;
  // The two rear doors have matching outer skins even though the welded
  // groups include different internal supports on the two sides.
  if (innerX > .71 && y0 > .25 && y0 < .26 && y1 > .99 && y1 < 1.01 &&
    z0 > .18 && z0 < .20 && z1 > 1.28 && z1 < 1.30) return 'door-rear-' + side;
  // The wheel arch and the bumper corner meet at a diagonal seam. Keep each
  // connected shell together rather than deciding from triangle centers.
  if (innerX > .81 && y0 > .22 && y0 < .24 && y1 > .83 && y1 < .86 &&
    z0 > -1.66 && z0 < -1.64 && z1 > -.94 && z1 < -.92) return 'fender-front-' + side;
  if (innerX > .75 && y0 > .13 && y0 < .16 && y1 > .70 && y1 < .73 &&
    z0 > -2.09 && z0 < -2.06 && z1 > -1.62 && z1 < -1.60) return 'bumper-front';

  // Use the indexed surfaces along the seams of the plate recess, trunk, and bumper.
  const halfWidth = Math.min(-x0, x1);
  if (halfWidth > .58 && y0 > .60 && y1 < .83 && z0 > 2.16 && z1 < 2.30) return 'trim-rear';
  if (halfWidth > .69 && y0 > .82 && z1 > 2.30 &&
    (z0 > 1.54 && z0 < 1.56 || z0 > 2.05 && z0 < 2.06)) return 'trunk';
  if (z0 > 2.06 && z1 > 2.35 && y1 < .80 &&
    (halfWidth > .75 || halfWidth > .37 && y0 > .54 && y1 < .58)) return 'bumper-rear';
  if (innerX > .65 && y0 < .18 && y1 > .77 && z0 > 1.67 && z0 < 1.69 && z1 > 2.15) return 'bumper-rear';
  if (innerX > .68 && y0 > .14 && y1 < .25 && z0 > 1.77 && z1 > 2.06 && z1 < 2.08) return 'bumper-rear';
  // The rocker, its lower bevel, and the wheel-arch lip are separate meshes
  // from the doors. Keep them in the same continuous side island.
  if (innerX > .70 && z0 > -1.10 && z0 < -1.07 && y0 < .16 &&
    (z1 > 2.04 && z1 < 2.06 || z1 > .98 && z1 < 1.01 && y1 < .17)) return 'sill-' + side;
  if (innerX > .84 && z0 > .98 && z0 < 1.14 && z1 > 1.12 && z1 < 1.66 &&
    y0 < .60 && y1 < .70) return 'fender-rear-' + side;
  // The upper quarter panels run alongside the rear glass and trunk deck.
  if (innerX > .57 && y0 > .92 && y1 > 1.12 && z0 > 1.25 && z0 < 1.55 && z1 > 1.87 && z1 < 2.06) {
    return 'fender-rear-' + side;
  }
  return null;
}

function addHighlandSide(triangle, side, addTriangle) {
  if (triangle.every(vertex => vertex[2] <= sideSeam)) {
    addTriangle('sill-' + side, triangle);
    return;
  }
  if (triangle.every(vertex => vertex[2] >= sideSeam)) {
    addTriangle('fender-rear-' + side, triangle);
    return;
  }
  // A 3D triangle can cross the logical cut in the editor. Split it at the
  // same point so picking and vehicle-fit projection use the correct part.
  for (const [part, sign] of [['sill-', -1], ['fender-rear-', 1]]) {
    const distance = triangle.map(vertex => (vertex[2] - sideSeam) * sign);
    const polygon = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (distance[i] >= 0) polygon.push(triangle[i]);
      if (distance[i] * distance[j] < 0) {
        const t = distance[i] / (distance[i] - distance[j]);
        polygon.push(triangle[i].map((value, axis) => T.MathUtils.lerp(value, triangle[j][axis], t)));
      }
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      addTriangle(part + side, [polygon[0], polygon[i], polygon[i + 1]]);
    }
  }
}

// Reuse one continuous chart for the sill and the quarter, including the
// logical cut that lets the editor color those areas separately.
function sidePixels(part, x, y, z) {
  const offset = Math.abs(x) - .85;
  let u, v;
  if (isSideIsland(part)) {
    const sill = 17 + 182 * y + 105 * offset - 9 * z;
    const quarter = 21 + 187 * y - 113 * offset - 2.5 * z;
    u = T.MathUtils.lerp(sill, quarter, T.MathUtils.smoothstep(z, .9, 1.34));
    v = 539 + 203 * z;
  } else if (part.startsWith('fender-front-')) {
    // The panel transitions from horizontal beside the hood to vertical
    // beside the door. The across-panel direction turns along that curve.
    const along = z + 1.5;
    u = 164 - 25 * along + (184 + 35 * along) * (y - .78) - (132 - 145 * along) * (Math.abs(x) - .78);
    v = 483 + 202 * z;
  } else if (part.startsWith('door-front-')) {
    u = 42 + 202 * y - 5 * z;
    v = 511 + 201 * z;
  } else {
    u = 49 + 200 * y - 71 * offset - 11 * z;
    v = 514 + 204 * z;
  }
  return [part.endsWith('-l') ? u : 1023 - u, v];
}

function project(part, [x, y, z], mask, shape) {
  const { x: left, y: top, width, height } = mask;
  const middle = left + (width - 1) / 2;
  const scale = (value, min, max) => T.MathUtils.clamp((value - min) / (max - min), 0, 1);
  const rowAt = value => top + value * (height - 1);
  if (isSideIsland(part) || part.startsWith('door-') || part.startsWith('fender-front-')) {
    return sidePixels(part, x, y, z);
  }
  if (part === 'hood') {
    const along = (z + .26 * y) / Math.hypot(1, .26);
    return [middle + x * (width - 1) / 1.52, rowAt(.02 + .96 * scale(along, -2.05, -.84))];
  }
  if (part === 'bumper-front' || part === 'bumper-rear') {
    // Fixed scale across the flat part plus an allowance for the length that
    // wraps back around the wheel arches. Match the top and lip separately.
    const front = part === 'bumper-front';
    const sweep = front ? z + 2.36 : 2.36 - z;
    const across = 202 * x + Math.sign(x) * 113 * Math.max(0, sweep);
    const u = middle + across * (width - 1) / (front ? 548 : 517);
    const v = front ? scale(y, .15, .72) : scale(y, .79, .15);
    return [u, rowAt(.01 + .98 * v)];
  }
  if (part === 'trunk') {
    // Landmarks from the deck beside the glass, the lip, and the badge panel.
    const along = z - 1.995;
    const stretch = T.MathUtils.lerp(147, 211, T.MathUtils.smoothstep(z, 1.95, 2.03));
    const v = 669 + stretch * along + 192 * Math.max(0, 1.035 - y);
    return [middle + 203 * x, rowAt(scale(v, 603, 778))];
  }
  if (part === 'trim-rear') {
    return [middle + 201 * x, rowAt(.02 + .96 * scale(y, .825, .611))];
  }
  // The remaining narrow glass rails and mirror caps use the cutout widths
  // in the official PNG. Their borders change shape along the strip.
  const across = part.startsWith('mirror-') ? x : part.endsWith('-l') ? y : -y;
  const u = scale(across, shape.left, shape.right);
  const v = Math.round((.015 + .97 * scale(z, shape.front, shape.rear)) * (height - 1));
  const [min, max] = mask.rows[v];
  return [max > min ? min + (max - min) * (.03 + .94 * u) : middle, top + v];
}

function collectShells(source) {
  const groups = new Map();
  const transform = vehicleTransform(source, highlandBody);
  function add(part, triangle) {
    if (!groups.has(part)) groups.set(part, []);
    groups.get(part).push(...triangle);
  }
  source.traverse(object => {
    if (!object.isMesh || !highlandPaintShells.has(object.material.name)) return;
    const geometry = vehicleGeometry(object, transform);
    const { position, normal } = geometry.attributes;
    const index = geometry.index;
    const outerShell = object.material.name === 'Geohoodsub00021Mtl';
    const skinAt = separateSkins(position, index, highlandSkin);
    const shellAt = outerShell ? separateSkins(position, index, highlandShellSkin, false) : null;
    for (let i = 0; i < index.count; i += 3) {
      const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const triangle = indices.map(j => [position.getX(j), position.getY(j), position.getZ(j),
        normal.getX(j), normal.getY(j), normal.getZ(j)]);
      const [x, y, z, , ny] = triangle[0].map((_, axis) =>
        (triangle[0][axis] + triangle[1][axis] + triangle[2][axis]) / 3);
      const axle = Math.min(Math.abs(z + 1.48), Math.abs(z - 1.39));
      const wheel = Math.abs(x) > .855 && Math.hypot(y - .345, axle) < .275;
      const grille = Math.abs(x) < .65 && y > .20 && y < .31 && z > -2.35 && z < -2.09;
      const part = !outerShell && (wheel || grille) ? null :
        shellAt?.(indices[0]) || skinAt(indices[0]) || exteriorPart(x, y, z, ny, outerShell);
      if (part && isSideIsland(part)) addHighlandSide(triangle, part.slice(-1), add);
      else add(part || 'trim', triangle);
    }
    geometry.dispose();
  });
  return groups;
}

function shapeOf(part, vertices) {
  const shape = { left: Infinity, right: -Infinity, front: Infinity, rear: -Infinity };
  for (const [x, y, z] of vertices) {
    const u = part.startsWith('mirror-') ? x : part.endsWith('-l') ? y : -y;
    shape.left = Math.min(shape.left, u);
    shape.right = Math.max(shape.right, u);
    shape.front = Math.min(shape.front, z);
    shape.rear = Math.max(shape.rear, z);
  }
  return shape;
}

function writeWrapGlb(groups, atlases, encoder) {
  const json = {
    asset: { version: '2.0', generator: 'Wrap Studio Highland UV', extras: {
      source: highlandBody.file, author: 'RBLXSupercars', license: 'CC-BY-4.0',
      templates: ['model3-2024-base', 'model3-2024-performance'],
    } },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
    extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'],
  };
  const buffers = [];
  let offset = 0;
  let decodedOffset = 0;
  function accessor(values, type, components, normalized = false, range) {
    const count = values.length / components;
    const byteStride = values.BYTES_PER_ELEMENT * components;
    const mode = type === 'SCALAR' ? 'TRIANGLES' : 'ATTRIBUTES';
    const bytes = encoder.encodeGltfBuffer(new Uint8Array(values.buffer), count, byteStride, mode);
    const bufferView = json.bufferViews.push({
      buffer: 1, byteOffset: decodedOffset, byteLength: values.byteLength,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: bytes.length, byteStride, count, mode } },
    }) - 1;
    decodedOffset += Math.ceil(values.byteLength / 4) * 4;
    buffers.push(bytes);
    offset += bytes.length;
    const padding = (4 - offset % 4) % 4;
    if (padding) buffers.push(new Uint8Array(padding));
    offset += padding;
    return json.accessors.push({
      bufferView, componentType: values instanceof Float32Array ? 5126 : values instanceof Uint16Array ? 5123 : 5125,
      count, type, ...(normalized ? { normalized } : {}), ...range,
    }) - 1;
  }

  for (const [part, vertices] of groups) {
    const shape = shapeOf(part, vertices);
    const masks = atlases.map(atlas => atlas.parts.find(mask => mask.id === part));
    if (part !== 'trim' && !masks.every(Boolean)) throw new Error('Missing Highland template part: ' + part);
    const positions = [], normals = [], indices = [], baseUV = [], performanceUV = [];
    const unique = new Map();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices) {
      const key = vertex.join(',');
      if (!unique.has(key)) {
        unique.set(key, positions.length / 3);
        const p = vertex.slice(0, 3).map(Math.fround);
        positions.push(...p);
        const normal = vertex.slice(3);
        const length = Math.hypot(...normal);
        normals.push(...(length ? normal.map(value => value / length) : [0, 1, 0]));
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], p[axis]);
          max[axis] = Math.max(max[axis], p[axis]);
        }
        if (part !== 'trim') {
          for (const [i, uv] of [baseUV, performanceUV].entries()) {
            const pixel = project(part, vertex, masks[i], shape);
            const size = [atlases[i].width, atlases[i].height];
            uv.push(...pixel.map((value, axis) =>
              Math.round(T.MathUtils.clamp((value + .5) / size[axis], 0, 1) * 65535)));
          }
        }
      }
      indices.push(unique.get(key));
    }

    const attributes = {
      POSITION: accessor(new Float32Array(positions), 'VEC3', 3, false, { min, max }),
      NORMAL: accessor(new Float32Array(normals), 'VEC3', 3),
    };
    if (part !== 'trim') {
      attributes.TEXCOORD_0 = accessor(new Uint16Array(baseUV), 'VEC2', 2, true);
      attributes.TEXCOORD_1 = accessor(new Uint16Array(performanceUV), 'VEC2', 2, true);
    }
    const indexArray = unique.size <= 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
    const mesh = json.meshes.push({ primitives: [{ attributes, indices: accessor(indexArray, 'SCALAR', 1) }] }) - 1;
    json.scenes[0].nodes.push(json.nodes.push({ mesh, extras: { wrapPart: part } }) - 1);
  }
  json.buffers.push({ byteLength: offset },
    { byteLength: decodedOffset, extensions: { EXT_meshopt_compression: { fallback: true } } });
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(bytes.length / 4) * 4;
  const glb = new Uint8Array(28 + jsonLength + offset);
  const header = new DataView(glb.buffer);
  [0x46546c67, 2, glb.length, jsonLength, 0x4e4f534a].forEach((value, i) => header.setUint32(i * 4, value, true));
  glb.fill(32, 20, 20 + jsonLength);
  glb.set(bytes, 20);
  header.setUint32(20 + jsonLength, offset, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true);
  let start = 28 + jsonLength;
  for (const buffer of buffers) {
    glb.set(buffer, start);
    start += buffer.length;
  }
  return glb;
}

// Run from the project origin in a browser. The only inputs are the
// attributed Highland mesh and the pinned Tesla template PNGs.
export async function bakeHighlandWrap() {
  const highland = models.filter(model => model.preview === 'highland');
  const [{ MeshoptEncoder }, { scene }, ...atlases] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_encoder.module.js'),
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../assets/models/' + highlandBody.file, import.meta.url).href),
    ...highland.map(loadTemplate),
  ]);
  await MeshoptEncoder.ready;
  return writeWrapGlb(collectShells(scene), atlases, MeshoptEncoder);
}
