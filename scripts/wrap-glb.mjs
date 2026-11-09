export async function loadWrapEncoder() {
  const { MeshoptEncoder } = await import('https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_encoder.module.js');
  await MeshoptEncoder.ready;
  return MeshoptEncoder;
}

export function writeWrapGlb({ groups, atlases, encoder, source, sourceMeshes, author, license, templates, chart }) {
  const json = {
    asset: { version: '2.0', generator: sourceMeshes ? 'Wrap Studio UV' : 'Wrap Studio Highland UV', extras: {
      source, author, license, templates, ...(sourceMeshes ? { sourceMeshes } : {}),
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
    const charts = part === 'trim' ? [] : atlases.map((atlas, i) => chart(part, vertices, atlas, templates[i]));
    const uvSets = charts.map(() => []);
    const positions = [], normals = [], indices = [];
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
        for (const [i, { project }] of charts.entries()) {
          const size = [atlases[i].width, atlases[i].height];
          uvSets[i].push(...project(vertex).map((value, axis) =>
            Math.round(Math.max(0, Math.min(1, (value + .5) / size[axis])) * 65535)));
        }
      }
      indices.push(unique.get(key));
    }

    const attributes = {
      POSITION: accessor(new Float32Array(positions), 'VEC3', 3, false, { min, max }),
      NORMAL: accessor(new Float32Array(normals), 'VEC3', 3),
    };
    for (const [i, uv] of uvSets.entries()) {
      attributes['TEXCOORD_' + i] = accessor(new Uint16Array(uv), 'VEC2', 2, true);
    }
    const indexArray = unique.size <= 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
    const mesh = json.meshes.push({ primitives: [{ attributes, indices: accessor(indexArray, 'SCALAR', 1) }] }) - 1;
    const extras = { wrapPart: part };
    if (charts.some(chart => chart.part !== part)) extras.wrapParts = charts.map(chart => chart.part);
    json.scenes[0].nodes.push(json.nodes.push({ mesh, extras }) - 1);
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
