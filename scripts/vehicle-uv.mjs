import { THREE as T, GLTFLoader, MeshoptDecoder } from '../assets/vendor/three-preview.js';
import { loadTemplate, models } from '../js/templates.js';
import { previewModels, separateSkins, vehicleGeometry, vehicleTransform } from '../js/vehicle.js';
import { loadWrapEncoder, writeWrapGlb } from './wrap-glb.mjs';

// Named body islands in the credited 2021 Model Y mesh.
const modelYPanels = {
  'MY-291': 'mirror-r', 'MY-292': 'mirror-l',
  'MY-353': 'door-front-r', 'MY-354': 'door-front-l',
  'MY-355': 'door-rear-r', 'MY-356': 'door-rear-l',
  'MY-357': 'bumper-front', 'MY-358': 'hood',
  'MY-359': 'fender-front-r', 'MY-360': 'fender-front-l',
  'MY-361': 'pillar-r', 'MY-362': 'pillar-l',
  'MY-363': 'fender-rear-r', 'MY-364': 'fender-rear-l',
  'MY-365': 'trunk', 'MY-366': 'bumper-rear', 'MY-367': 'trunk',
};
const legacyModel3Panels = {
  Object_246: 'trunk', Object_336: 'door-rear-l', Object_394: 'door-rear-r',
  Object_428: 'bumper-front', Object_435: 'bumper-rear', Object_445: 'hood',
};
const credits = {
  'model-3': ['aarajesh', 'CC-BY-4.0'],
  'model-y': ['763468712', 'CC-BY-4.0'],
  juniper: ['BloxBloger', 'CC-BY-NC-4.0'],
};

function legacySkin(name) {
  if (name === 'Object_51') return ([x, y, z]) =>
    (z < -1.8 ? 'fender-front-' : y > .8 && z < -.8 ? 'pillar-' : 'fender-rear-') + (x < 0 ? 'l' : 'r');
  if (name === 'Object_307' || name === 'Object_367') return ([x, y]) =>
    (y > .85 ? 'mirror-' : 'door-front-') + (x < 0 ? 'l' : 'r');
  return null;
}

function juniperSkin(name) {
  if (name === 'Plane_Mesh002') return ([x0, y0, z0, x1, , z1]) => {
    if (x0 < 0 && x1 > 0) {
      if (z1 < -1.5) return 'bumper-front';
      if (z0 < -2) return 'hood';
      return y0 > 1.1 ? 'trunk' : 'bumper-rear';
    }
    const side = x0 < 0 ? 'l' : 'r';
    if (z0 < -1.8) return 'fender-front-' + side;
    if (z0 < -.8) return (y0 > 1 ? 'pillar-' : 'door-front-') + side;
    if (z0 < .3) return 'door-rear-' + side;
    if (y0 > 1.22) return 'rear-rail-' + side;
    return (z0 > 1.6 ? 'end-' : 'fender-rear-') + side;
  };
  if (name === 'Plane021_Mesh012') return ([x0, , z0, x1, , z1]) => {
    if (x0 < 0 && x1 > 0) return z0 > .8 ? 'lower-rear' : 'bumper-front';
    return z1 < -.99 ? 'fender-front-' + (x0 < 0 ? 'l' : 'r') : 'trim';
  };
  if (name === 'Plane046_Mesh032') return ([x0]) => 'mirror-' + (x0 < 0 ? 'l' : 'r');
  return null;
}

function collectShells(source, model, family) {
  const groups = new Map();
  const sourceMeshes = [];
  const transform = vehicleTransform(source, model);
  const named = family === 'model-y' ? modelYPanels : family === 'model-3' ? legacyModel3Panels : {};
  source.traverse(object => {
    if (!object.isMesh) return;
    const fixedPart = named[object.name];
    const classify = family === 'juniper' ? juniperSkin(object.name) :
      family === 'model-3' ? legacySkin(object.name) : null;
    if (!fixedPart && !classify) return;
    const geometry = vehicleGeometry(object, transform);
    const { position, normal } = geometry.attributes;
    const index = geometry.index;
    const vertexAt = i => index ? index.getX(i) : i;
    const skinAt = classify ? separateSkins(position, index, classify, false) : null;
    sourceMeshes.push(object.name);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const first = vertexAt(i);
      let part = fixedPart || skinAt(first);
      if (part === 'lower-rear') {
        const indices = [first, vertexAt(i + 1), vertexAt(i + 2)];
        const x = indices.reduce((total, j) => total + position.getX(j), 0) / 3;
        const z = indices.reduce((total, j) => total + position.getZ(j), 0) / 3;
        part = Math.abs(x) > .82 && z < 2.17 ? 'rear-tip-' + (x < 0 ? 'l' : 'r') : 'trim';
      }
      if (!groups.has(part)) groups.set(part, []);
      const vertices = groups.get(part);
      for (let k = 0; k < 3; k++) {
        const j = vertexAt(i + k);
        vertices.push([position.getX(j), position.getY(j), position.getZ(j),
          normal.getX(j), normal.getY(j), normal.getZ(j)]);
      }
    }
    geometry.dispose();
  });
  return { groups, sourceMeshes };
}

const clamp = T.MathUtils.clamp;

function surfacePoint(family, part, [x, y, z]) {
  const side = part.endsWith('-l') ? 1 : -1;
  if (part === 'hood') {
    const slope = family === 'model-y' ? .24 : .28;
    return [x, (z + slope * y) / Math.hypot(1, slope)];
  }
  if (part === 'bumper-front') return [x + Math.sign(x) * .49 * Math.max(0, z + 2.35), y];
  if (part === 'bumper-rear') {
    const across = family === 'juniper' ? x : x + Math.sign(x) * .46 * Math.max(0, 2.34 - z);
    return [across, -y];
  }
  if (part === 'trunk') {
    const lip = family === 'model-y' ? 1.17 : family === 'model-3' ? 1.04 : 1.19;
    return [x, z + Math.max(0, lip - y) * 1.05];
  }
  if (part.startsWith('mirror-')) return [x, z];
  if (part.startsWith('pillar-') || part.startsWith('rear-rail-')) return [side * (y + Math.abs(x)), z];
  if (part.startsWith('fender-front-')) {
    const along = clamp((z + 2.18) / 1.22, 0, 1);
    // Turn the cross section from the hood plane to the vertical wheel arch.
    return [side * ((.63 + .37 * along) * (y - .80) - (1 - .70 * along) * (Math.abs(x) - .80)), z];
  }
  if (part.startsWith('rear-tip-')) return [side * (y - .4 * Math.abs(x)), z - .5 * y];
  if (part.startsWith('end-')) return [side * (y - .45 * Math.abs(x)), z - .3 * y];
  if (part.startsWith('fender-rear-')) return [side * (y - .45 * Math.abs(x)), z];
  return [side * (y - .23 * Math.abs(x)), z];
}

// Record projected silhouette widths. Scan each triangle edge only across
// the rows it crosses so dense subdivided shells can be authored offline.
function scanRows(points, height, rowAt) {
  const rows = Array.from({ length: height }, () => [Infinity, -Infinity]);
  for (let i = 0; i < points.length; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const [u0, v0] = points[i + edge];
      const [u1, v1] = points[i + (edge + 1) % 3];
      const a = rowAt(v0), b = rowAt(v1);
      if (a === b) continue;
      for (let row = Math.max(0, Math.ceil(Math.min(a, b))); row <= Math.min(height - 1, Math.floor(Math.max(a, b))); row++) {
        const u = T.MathUtils.lerp(u0, u1, (row - a) / (b - a));
        rows[row][0] = Math.min(rows[row][0], u);
        rows[row][1] = Math.max(rows[row][1], u);
      }
    }
  }
  return rows;
}

function fitChart(vertices, mask, project, { planar = false, matchWidth = false, offset = true } = {}) {
  const points = vertices.map(project);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of points) {
    u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const xCenter = mask.x + (mask.width - 1) / 2;
  const yCenter = (mask.height - 1) / 2;
  const spanV = Math.max(.001, v1 - v0);
  const spanU = Math.max(.001, u1 - u0);
  const yScale = .97 * (mask.height - 1) / spanV;
  if (planar) {
    const scale = Math.min(yScale, .98 * (mask.width - 1) / spanU);
    return vertex => {
      const [u, v] = project(vertex);
      return [xCenter + (u - uc) * scale, mask.y + yCenter + (v - vc) * scale];
    };
  }

  const rowAt = v => yCenter + (v - vc) * yScale;
  const source = scanRows(points, mask.height, rowAt);
  const ratios = [];
  for (const [i, [a, b]] of source.entries()) {
    const [left, right] = mask.rows[i];
    if (b - a >= spanU * .22 && right - left >= mask.width * .22) ratios.push((right - left) / (b - a));
  }
  ratios.sort((a, b) => a - b);
  const xScale = ratios.length ? ratios[Math.floor(ratios.length / 2)] : (mask.width - 1) / spanU;
  const centers = source.map(([a, b], i) => {
    const [left, right] = mask.rows[i];
    if (a >= b || left >= right) return null;
    return (left + right) / 2 - xCenter - ((a + b) / 2 - uc) * xScale;
  });
  const shifts = centers.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 9); j <= Math.min(i + 9, centers.length - 1); j++) {
      if (centers[j] === null) continue;
      sum += centers[j]; n++;
    }
    return n ? clamp(sum / n, -mask.width * .4, mask.width * .4) : 0;
  });

  return vertex => {
    const [u, v] = project(vertex);
    const row = clamp(rowAt(v), 0, mask.height - 1);
    const i = Math.round(row);
    const [a, b] = source[i];
    const [left, right] = mask.rows[i];
    const shift = T.MathUtils.lerp(shifts[Math.floor(row)], shifts[Math.ceil(row)], row % 1);
    const column = matchWidth && b - a > .001 && right > left ?
      T.MathUtils.lerp(left, right, .02 + .96 * clamp((u - a) / (b - a), 0, 1)) :
      xCenter + (u - uc) * xScale + (offset ? shift : 0);
    return [column, mask.y + row];
  };
}

// Door seams run across the atlas columns. Align the leading and trailing
// edges at each height, so artwork crossing two doors meets at the shut line.
function doorChart(vertices, mask, project, front) {
  const points = vertices.map(project);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of points) {
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const columnAt = u => (u - u0) * (mask.width - 1) / (u1 - u0);
  const edges = scanRows(points.map(([u, v]) => [v, u]), mask.width, columnAt);
  const nearSeam = Math.ceil(mask.height * .22);
  const seamRows = front ? mask.rows.slice(-nearSeam) : mask.rows.slice(0, nearSeam);
  const seamLeft = Math.min(...seamRows.map(([left]) => left));
  const seamRight = Math.max(...seamRows.map(([, right]) => right));
  let seamStart = Infinity, seamEnd = -Infinity;
  for (const [u, v] of points) {
    if ((front ? v1 - v : v - v0) > (v1 - v0) * .18) continue;
    seamStart = Math.min(seamStart, u);
    seamEnd = Math.max(seamEnd, u);
  }
  const rows = Array.from({ length: mask.width }, () => [Infinity, -Infinity]);
  for (const [row, [left, right]] of mask.rows.entries()) {
    for (let column = left - mask.x; column <= right - mask.x; column++) {
      rows[column][0] = Math.min(rows[column][0], row);
      rows[column][1] = Math.max(rows[column][1], row);
    }
  }
  const fallback = fitChart(vertices, mask, project);
  return vertex => {
    const [u, v] = project(vertex);
    const column = columnAt(u);
    const [a, b] = edges[Math.round(clamp(column, 1, mask.width - 2))];
    if (!(b - a >= .05)) return fallback(vertex);
    const t = clamp((v - a) / (b - a), 0, 1);
    const seamColumn = T.MathUtils.lerp(seamLeft, seamRight, clamp((u - seamStart) / (seamEnd - seamStart), 0, 1));
    const mappedColumn = T.MathUtils.lerp(mask.x + column, seamColumn, (front ? t : 1 - t) ** 2);
    const [top, bottom] = rows[Math.round(clamp(mappedColumn - mask.x, 1, mask.width - 2))];
    if (!(bottom - top >= 6)) return fallback(vertex);
    return [mappedColumn, mask.y + T.MathUtils.lerp(top + 1, bottom - 1, t)];
  };
}

function maskBand(mask, atlas, first, last, side) {
  const rows = mask.rows.slice(first, last);
  if (!side) return { ...mask, y: mask.y + first, height: rows.length, rows };
  const edge = Math.floor(mask.x + mask.width / 2);
  const ranges = rows.map(([a, b], i) => {
    let min = mask.right, max = mask.x;
    for (let x = a; x <= b; x++) {
      if ((side === 'l') !== (x < edge)) continue;
      if (atlas.lookup[(mask.y + first + i) * atlas.width + x] !== mask.index) continue;
      min = Math.min(min, x); max = Math.max(max, x);
    }
    return [min, max];
  });
  const x = side === 'l' ? mask.x : edge;
  const right = side === 'l' ? edge : mask.right;
  return { ...mask, x, right, width: right - x, y: mask.y + first, height: ranges.length, rows: ranges };
}

function chartFor(family, role, vertices, atlas, template) {
  const base = template === 'modely-2025-base';
  const performance = template === 'modely-2025-performance';
  const side = role.slice(-1);
  let part = role;
  if (role.startsWith('rear-rail-')) part = base ? 'trunk' : 'sill-' + side;
  if (role.startsWith('rear-tip-')) part = performance ? 'corner-' + side : 'end-' + side;
  let mask = atlas.parts.find(candidate => candidate.id === part);
  if (!mask) throw new Error('Missing ' + template + ' panel ' + part);
  if (base && role.startsWith('rear-rail-')) mask = maskBand(mask, atlas, 0, 130, side);
  if (base && role === 'trunk') mask = maskBand(mask, atlas, 107, mask.height);
  if (role.startsWith('rear-tip-') && !performance) {
    mask = maskBand(mask, atlas, Math.round(mask.height * .55), mask.height);
  }
  const matchWidth = role.startsWith('pillar-') || role.startsWith('rear-rail-') || role.startsWith('fender-front-');
  const project = vertex => surfacePoint(family, role, vertex);
  const uv = role.startsWith('door-') ? doorChart(vertices, mask, project, role.startsWith('door-front-')) :
    fitChart(vertices, mask, project, {
      planar: role === 'hood', matchWidth, offset: role.endsWith('-l') || role.endsWith('-r'),
    });
  return { part, project: uv };
}

// Run at the editor origin so Three and the pinned Tesla templates share
// the same loader as the deployed preview.
export async function bakeVehicleWrap(family) {
  const model = previewModels[family];
  if (!Object.hasOwn(credits, family)) throw new Error('Unknown wrap mesh: ' + family);
  const trims = models.filter(template => template.preview === family);
  const [encoder, { scene }, ...atlases] = await Promise.all([
    loadWrapEncoder(),
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../assets/models/' + model.file, import.meta.url).href),
    ...trims.map(loadTemplate),
  ]);
  const [author, license] = credits[family];
  return writeWrapGlb({
    ...collectShells(scene, model, family),
    atlases, encoder, author, license, source: model.file, templates: trims.map(template => template.id),
    chart: (...args) => chartFor(family, ...args),
  });
}
