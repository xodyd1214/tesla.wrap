import { THREE as T, GLTFLoader, MeshoptDecoder, OrbitControls, RoomEnvironment } from '../assets/vendor/three-preview.js';
import { surface } from './templates.js';
import { createPreviewTexture } from './preview-texture.js?v=2';
import { createFrontProfile, createSurfaceWrap, frontDistance } from './surface-wrap.js?v=2';

const paintShells = new Set(['Geohoodsub00021Mtl', 'Georimblurlfsub01Mtl']);
const highlandRearPanels = new Set(['trunk', 'trim-rear', 'bumper-rear']);
// Named body islands in the credited 2021 Model Y mesh.
const modelYPanels = {
  'MY-291': 'mirror-r', 'MY-292': 'mirror-l',
  'MY-353': 'door-front-r', 'MY-354': 'door-front-l',
  'MY-355': 'door-rear-r', 'MY-356': 'door-rear-l',
  'MY-357': 'bumper-front', 'MY-358': 'hood',
  'MY-359': 'fender-front-r', 'MY-360': 'fender-front-l',
  'MY-361': 'pillar-r', 'MY-362': 'pillar-l',
  'MY-363': 'fender-rear-r', 'MY-364': 'fender-rear-l',
  'MY-365': 'trunk', 'MY-366': 'bumper-rear', 'MY-367': 'bumper-rear',
};
const modelYHeadlightNodes = new Set(['MY-228', 'MY-229', 'MY-267', 'MY-268']);
const modelYTaillightNodes = new Set(['MY-318', 'MY-319', 'MY-320', 'MY-321', 'MY-322', 'MY-323']);
const legacyModel3Panels = {
  Object_246: 'trunk', Object_336: 'door-rear-l', Object_394: 'door-rear-r',
  Object_428: 'bumper-front', Object_435: 'bumper-rear', Object_445: 'hood',
};
// Centerlines are sampled from each mesh, from the windshield down to the bumper lip.
const previewModels = {
  highland: {
    file: 'model.glb', length: 4.72, rotation: Math.PI / 2, highland: true, hoodSlope: .26,
    frontProfile: createFrontProfile([[-1.1, .9], [-1.75, .805], [-2.2, .666], [-2.285, .613], [-2.35, .55], [-2.35, .2]]),
  },
  'model-y': { file: 'model-y.glb', length: 4.75, rotation: -Math.PI / 2, panels: modelYPanels },
  'model-3': {
    file: 'model-3.glb', length: 4.69, panels: legacyModel3Panels, skin: legacyModel3Skin,
    hiddenMesh: 'Charge_Cap_GLOBAL001',
    frontProfile: createFrontProfile([[-1.38, .88], [-1.85, .81], [-2.1, .72], [-2.25, .64], [-2.34, .55], [-2.34, .16]]),
  },
  juniper: {
    file: 'juniper.glb', length: 4.794, skin: juniperSkin, rearCorners: true,
    frontProfile: createFrontProfile([[-1.24, 1.14], [-1.8, .98], [-2.15, .855], [-2.3, .778], [-2.36, .67], [-2.395, .3], [-2.33, .25]]),
  },
};
const views = {
  angle: [-5.2, 3.05, -5.9],
  front: [0, 3.9, -7.3],
  side: [-8, 1.65, 0.001],
  top: [0, 9, -0.005],
};

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

function materialFor(name, original) {
  const dark = (color, roughness = .6) => new T.MeshStandardMaterial({ color, roughness, side: T.DoubleSide });
  if (name === 'Tire1Mtl') return dark('#19191b', .95);
  if (name === 'Georimblurlfsub021Mtl') return new T.MeshStandardMaterial({ color: '#45444a', metalness: .74, roughness: .32 });
  if (name === 'Ln12Mtl') return new T.MeshStandardMaterial({ color: '#b11c30', emissive: '#66020d', emissiveIntensity: .8, roughness: .26 });
  if (name === 'Ln7Mtl') return dark('#dddce7', .28);
  if (/extwindow|sub31Mtl/.test(name)) {
    return new T.MeshPhysicalMaterial({
      color: '#20222b', metalness: .18, roughness: .28, clearcoat: .55,
      clearcoatRoughness: .22, envMapIntensity: .65, side: T.DoubleSide,
    });
  }
  if (name === 'Geohoodsub00031Mtl') return dark('#34343a', .26);
  if (original.map && !name.startsWith('Geocockpit')) {
    return new T.MeshStandardMaterial({ color: '#38373b', map: original.map, roughness: .58, side: T.DoubleSide });
  }
  return dark('#34343b');
}

function projection(part, x, y, z, hoodSlope) {
  // Trunk lids turn downward at the lip. Depth alone folds the vertical
  // panel back onto the deck above it.
  if (part === 'trunk') return [x, z - y];
  if (part === 'hood') return [x, (z + hoodSlope * y) / Math.hypot(1, hoodSlope)];
  if (part.startsWith('mirror')) return [x, z];
  if (part.startsWith('corner-')) return [-x, -y];
  if (part.startsWith('bumper') || part === 'trim-rear') {
    return [part === 'bumper-rear' ? -x : x, -y];
  }
  return [part.endsWith('-l') ? y : -y, z];
}

function highlandRearColumns(atlas, part, entries, left, top, uSpan, vSpan) {
  const center = (part.width - 1) / 2;
  const rows = part.rows.map(([min, max], row) => {
    const maskOffset = (part.y + row) * atlas.width;
    const target = [[Infinity, -Infinity], [Infinity, -Infinity]];
    for (let x = min; x <= max; x++) {
      if (atlas.lookup[maskOffset + x] !== part.index) continue;
      const column = x - part.x;
      const range = target[column > center ? 1 : 0];
      range[0] = Math.min(range[0], column);
      range[1] = Math.max(range[1], column);
    }
    if (!target.every(([start, end]) => start <= end)) return null;

    // Find the corresponding cross section of the mesh by intersecting its
    // projected triangle edges with this row.
    const height = T.MathUtils.clamp((row / (part.height - 1) - .015) / .97, .0001, .9999);
    const v = top + vSpan * height;
    const source = [[Infinity, -Infinity], [Infinity, -Infinity]];
    for (let i = 0; i < entries.length; i += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const a = entries[i + edge];
        const b = entries[i + (edge + 1) % 3];
        if ((a.v < v) === (b.v < v)) continue;
        const u = (T.MathUtils.lerp(a.u, b.u, (v - a.v) / (b.v - a.v)) - left) / uSpan;
        const range = source[u > .5 ? 1 : 0];
        range[0] = Math.min(range[0], u);
        range[1] = Math.max(range[1], u);
      }
    }
    if (!source.every(([start, end]) => start <= end)) return null;

    // Match the two sides separately when both the mesh and the official
    // template have a cutout. Mapping across it repeats edge pixels by the lamps.
    const split = target[1][0] - target[0][1] >= 5 && source[1][0] - source[0][1] >= .035;
    return { source, target, split };
  });

  function columnAt(row, u) {
    const fit = rows[row];
    if (!fit) {
      const [min, max] = part.rows[row];
      return max > min ? min - part.x + (max - min) * (.03 + .94 * u) : part.width / 2;
    }
    const { source, target, split } = fit;
    const first = split && u > .5 ? 1 : 0;
    const last = split ? first : 1;
    const start = source[first][0];
    const end = source[last][1];
    const position = T.MathUtils.clamp((u - start) / Math.max(.001, end - start), 0, 1);
    return T.MathUtils.lerp(target[first][0], target[last][1], .02 + .96 * position);
  }

  return (row, u) => {
    const a = Math.floor(row);
    const b = Math.ceil(row);
    return T.MathUtils.lerp(columnAt(a, u), columnAt(b, u), row - a);
  };
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

  // Use the indexed surfaces along the seams of the plate recess, trunk, and bumper.
  const halfWidth = Math.min(-x0, x1);
  if (halfWidth > .58 && y0 > .60 && y1 < .83 && z0 > 2.16 && z1 < 2.30) return 'trim-rear';
  if (halfWidth > .69 && y0 > .82 && z1 > 2.30 &&
    (z0 > 1.54 && z0 < 1.56 || z0 > 2.05 && z0 < 2.06)) return 'trunk';
  if (z0 > 2.06 && z1 > 2.35 && y1 < .80 &&
    (halfWidth > .75 || halfWidth > .37 && y0 > .54 && y1 < .58)) return 'bumper-rear';
  if (innerX > .65 && y0 < .18 && y1 > .77 && z0 > 1.67 && z0 < 1.69 && z1 > 2.15) return 'bumper-rear';
  if (innerX > .68 && y0 > .14 && y1 < .25 && z0 > 1.77 && z1 > 2.06 && z1 < 2.08) return 'bumper-rear';
  // The upper quarter panels run alongside the rear glass and trunk deck.
  if (innerX > .57 && y0 > .92 && y1 > 1.12 && z0 > 1.25 && z0 < 1.55 && z1 > 1.87 && z1 < 2.06) {
    return 'fender-rear-' + side;
  }
  return null;
}

function legacyModel3Skin(name) {
  if (name === 'Object_51') return ([x0, y0, z0]) => {
    const side = x0 < 0 ? 'l' : 'r';
    if (z0 < -1.8) return 'fender-front-' + side;
    return (y0 > .8 ? 'pillar-' : 'fender-rear-') + side;
  };
  if (name === 'Object_307' || name === 'Object_367') return ([x0, y0]) =>
    (y0 > .85 ? 'mirror-' : 'door-front-') + (x0 < 0 ? 'l' : 'r');
  return null;
}

function juniperSkin(name) {
  if (name === 'Plane_Mesh002') return ([x0, y0, z0, x1, , z1]) => {
    const side = x0 < 0 ? 'l' : 'r';
    const spansCenter = x0 < 0 && x1 > 0;
    if (spansCenter) {
      if (z1 < -1.5) return 'bumper-front';
      if (z0 < -2) return 'hood';
      return 'trunk';
    }
    if (z0 < -1.8) return 'fender-front-' + side;
    if (z0 > 1.6 && y0 < .65) return 'end-' + side;
    if (z0 > 1.2) return 'fender-rear-' + side;
    if (y0 > 1) return 'pillar-' + side;
    return (z0 < 0 ? 'door-front-' : 'door-rear-') + side;
  };
  if (name === 'Plane021_Mesh012') return ([x0, y0, z0, x1, , z1]) => {
    if (z0 > .8) return 'bumper-rear';
    if (x0 < 0 && x1 > 0) return 'bumper-front';
    return (z1 < -.9 ? 'fender-front-' : 'sill-') + (x0 < 0 ? 'l' : 'r');
  };
  if (name === 'Plane046_Mesh032') return ([x0]) => 'mirror-' + (x0 < 0 ? 'l' : 'r');
  return null;
}

// Assign each connected paint skin as a unit, welding split vertices when needed.
function separateSkins(position, index, classify, weld = true) {
  const parents = new Uint32Array(position.count);
  const point = i => [position.getX(i), position.getY(i), position.getZ(i)];
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  if (weld) {
    const vertices = new Map();
    for (let i = 0; i < parents.length; i++) {
      const key = point(i).map(value => Math.round(value * 3000)).join(',');
      if (!vertices.has(key)) vertices.set(key, i);
      parents[i] = vertices.get(key);
    }
  } else {
    for (let i = 0; i < parents.length; i++) parents[i] = i;
  }
  const vertex = i => index ? index.getX(i) : i;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const first = root(vertex(i));
    parents[root(vertex(i + 1))] = first;
    parents[root(vertex(i + 2))] = first;
  }

  const bounds = new Map();
  for (let i = 0; i < parents.length; i++) {
    const id = root(i);
    if (!bounds.has(id)) bounds.set(id, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    const range = bounds.get(id);
    const coords = point(i);
    for (let j = 0; j < coords.length; j++) {
      range[j] = Math.min(range[j], coords[j]);
      range[j + 3] = Math.max(range[j + 3], coords[j]);
    }
  }
  const skins = new Map();
  for (const [id, range] of bounds) {
    const part = classify(range);
    if (part) skins.set(id, part);
  }
  return i => skins.get(root(i));
}

function prepareCar(source, model) {
  source.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(source);
  const center = bounds.getCenter(new T.Vector3());
  const axis = model.rotation ? 'x' : 'z';
  const scale = model.length / (bounds.max[axis] - bounds.min[axis]);
  const transform = new T.Matrix4().makeRotationY(model.rotation || 0)
    .multiply(new T.Matrix4().makeScale(scale, scale, scale))
    .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const car = new T.Group();
  const projected = new Map();
  let atlasParts;
  const paintMaterial = new T.MeshPhysicalMaterial({
    color: '#ffffff', roughness: .3, metalness: .12,
    clearcoat: .48, clearcoatRoughness: .19, side: T.DoubleSide,
  });
  const paintGeometry = new T.BufferGeometry();
  const paintParts = [];
  const paintPositions = [];
  const paintNormals = [];
  const trimMaterial = new T.MeshStandardMaterial({ color: '#25252a', roughness: .48, side: T.DoubleSide });
  const trimPositions = [];
  const trimNormals = [];
  let modelYGlass;
  let modelYHeadlights;
  let modelYTaillights;

  source.traverse(object => {
    // The legacy asset's separate charge flap protrudes from the closed body.
    if (!object.isMesh || object.name === model.hiddenMesh) return;
    const geometry = object.geometry.clone();
    // Bake scene transforms into floats so quantized GLB attributes keep their range.
    for (const name of ['position', 'normal']) {
      const attribute = geometry.getAttribute(name);
      if (!attribute || attribute.array instanceof Float32Array) continue;
      const values = new Float32Array(attribute.count * 3);
      for (let i = 0; i < attribute.count; i++) {
        values[i * 3] = attribute.getX(i);
        values[i * 3 + 1] = attribute.getY(i);
        values[i * 3 + 2] = attribute.getZ(i);
      }
      geometry.setAttribute(name, new T.Float32BufferAttribute(values, 3));
    }
    geometry.applyMatrix4(transform.clone().multiply(object.matrixWorld));
    const mappedPart = model.panels?.[object.name];
    const highlandPaint = model.highland && paintShells.has(object.material.name);
    const outerShell = object.material.name === 'Geohoodsub00021Mtl';
    const classify = highlandPaint ? highlandSkin : model.skin?.(object.name);
    if (!mappedPart && !classify) {
      let material = model.highland ? materialFor(object.material.name, object.material) : object.material;
      if (material.name === 'glass_body') {
        modelYGlass ??= Object.assign(material.clone(), {
          color: new T.Color('#151b23'), roughness: .26, metalness: .05, envMapIntensity: .6,
          transparent: true, opacity: .74, depthWrite: false,
        });
        material = modelYGlass;
      } else if (modelYHeadlightNodes.has(object.name)) {
        // Keep the lenses distinct from the white paint in the front view.
        if (!modelYHeadlights) {
          modelYHeadlights = Object.assign(material.clone(), { roughness: .28, metalness: .22 });
          modelYHeadlights.color.set('#8997a8');
        }
        material = modelYHeadlights;
      } else if (modelYTaillightNodes.has(object.name)) {
        // Give the colored outer lens priority over the overlapping inner lens surfaces.
        modelYTaillights ??= Object.assign(material.clone(), {
          color: new T.Color('#771b26'), roughness: .32, metalness: .1,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        material = modelYTaillights;
      }
      car.add(new T.Mesh(geometry, material));
      return;
    }
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const skinAt = classify ? separateSkins(position, index, classify) : null;
    // Keep the original body seams that welding would join.
    const shellSkinAt = model.highland && outerShell ? separateSkins(position, index, highlandShellSkin, false) : null;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const indices = [i, i + 1, i + 2].map(id => index ? index.getX(id) : id);
      const values = indices.map(id => [position.getX(id), position.getY(id), position.getZ(id)]);
      const [x, y, z] = [0, 1, 2].map(axis => (values[0][axis] + values[1][axis] + values[2][axis]) / 3);
      const ny = (normal.getY(indices[0]) + normal.getY(indices[1]) + normal.getY(indices[2])) / 3;
      const axleDistance = Math.min(Math.abs(z + 1.48), Math.abs(z - 1.39));
      const wheel = object.material.name === 'Georimblurlfsub01Mtl' &&
        Math.abs(x) > .855 && Math.hypot(y - .345, axleDistance) < .275;
      let part = mappedPart || (wheel ? null : shellSkinAt?.(indices[0]) || skinAt?.(indices[0]) ||
        (highlandPaint ? exteriorPart(x, y, z, ny, outerShell) : null));
      if (model.rearCorners && part === 'bumper-rear' && Math.abs(x) > .83 && y < .6 && z > 1.65 && z < 2.12) {
        part = x < 0 ? 'corner-l' : 'corner-r';
      }
      if (part) {
        paintParts.push(part);
        if (!projected.has(part)) projected.set(part, []);
        const entries = projected.get(part);
        for (const [j, id] of indices.entries()) {
          const uv = projection(part, ...values[j], model.hoodSlope || 0);
          entries.push({ index: paintPositions.length / 3, u: uv[0], v: uv[1] });
          paintPositions.push(...values[j]);
          paintNormals.push(normal.getX(id), normal.getY(id), normal.getZ(id));
        }
      } else {
        for (const [j, id] of indices.entries()) {
          trimPositions.push(...values[j]);
          trimNormals.push(normal.getX(id), normal.getY(id), normal.getZ(id));
        }
      }
    }
    geometry.dispose();
  });
  paintGeometry.setAttribute('position', new T.Float32BufferAttribute(paintPositions, 3));
  paintGeometry.setAttribute('normal', new T.Float32BufferAttribute(paintNormals, 3));
  const uvLength = paintPositions.length / 3 * 2;
  const atlasPixels = new T.BufferAttribute(new Float32Array(uvLength), 2);
  const previewUv = new T.BufferAttribute(new Float32Array(uvLength), 2);
  paintGeometry.setAttribute('uv', previewUv);
  const paint = new T.Mesh(paintGeometry, paintMaterial);
  car.add(paint);
  const trimGeometry = new T.BufferGeometry();
  trimGeometry.setAttribute('position', new T.Float32BufferAttribute(trimPositions, 3));
  trimGeometry.setAttribute('normal', new T.Float32BufferAttribute(trimNormals, 3));
  car.add(new T.Mesh(trimGeometry, trimMaterial));

  return {
    car,
    partAt(hit) {
      if (hit?.object !== paint) return null;
      const part = paintParts[hit.faceIndex];
      if (atlasParts?.has(part)) return part;
      return part.startsWith('corner-') ? 'bumper-rear' : null;
    },
    mapAtlas(atlas) {
      const parts = new Map(atlas.parts.map(part => [part.id, part]));
      atlasParts = parts;
      const preview = createPreviewTexture(atlas);
      const { width, height } = preview.canvas;
      const mapped = new Map(projected);
      // Juniper Performance splits the rear bumper tips into separate islands.
      for (const id of ['corner-l', 'corner-r']) {
        if (parts.has(id) || !mapped.has(id)) continue;
        mapped.set('bumper-rear', [...mapped.get('bumper-rear'), ...mapped.get(id)]);
        mapped.delete(id);
      }
      for (const [id, entries] of mapped) {
        const part = parts.get(id);
        if (!part) {
          for (const { index } of entries) previewUv.setXY(index, .5 / width, 1 - .5 / height);
          continue;
        }
        const tile = preview.tiles.get(id);
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (const { u, v } of entries) {
          left = Math.min(left, u);
          right = Math.max(right, u);
          top = Math.min(top, v);
          bottom = Math.max(bottom, v);
        }
        const uSpan = Math.max(.001, right - left);
        const vSpan = Math.max(.001, bottom - top);
        // The Highland hood is nearly planar. Use one scale across both axes
        // instead of stretching the artwork to a different width on every row.
        const hoodScale = id === 'hood' && model.hoodSlope ? Math.min(
          .94 * (part.width - 1) / uSpan, .97 * (part.height - 1) / vSpan,
        ) : 0;
        const rearColumn = model.highland && highlandRearPanels.has(id)
          ? highlandRearColumns(atlas, part, entries, left, top, uSpan, vSpan) : null;
        for (const entry of entries) {
          let column, row;
          if (hoodScale) {
            column = (part.width - 1) / 2 + (entry.u - (left + right) / 2) * hoodScale;
            row = (part.height - 1) / 2 + (entry.v - (top + bottom) / 2) * hoodScale;
          } else if (rearColumn) {
            row = (.015 + .97 * (entry.v - top) / vSpan) * (part.height - 1);
            column = rearColumn(row, (entry.u - left) / uSpan);
          } else {
            const v = (entry.v - top) / vSpan;
            const u = (entry.u - left) / uSpan;
            row = Math.round((.015 + .97 * v) * (part.height - 1));
            const [min, max] = part.rows[row];
            column = max > min ? min - part.x + (max - min) * (.03 + .94 * u) : part.width / 2;
          }
          atlasPixels.setXY(entry.index, column, row);
          previewUv.setXY(entry.index, (tile.x + column + .5) / width, 1 - (tile.y + row + .5) / height);
        }
      }
      previewUv.needsUpdate = true;
      const map = new T.CanvasTexture(preview.canvas);
      map.colorSpace = T.SRGBColorSpace;
      // Linear filtering stays inside a tile. Mipmaps would blend neighboring panels.
      map.minFilter = T.LinearFilter;
      map.generateMipmaps = false;
      paintMaterial.map?.dispose();
      paintMaterial.map = map;
      paintMaterial.needsUpdate = true;
      return {
        ...createSurfaceWrap(atlas, mapped, paintPositions, atlasPixels, model.frontProfile),
        updateTexture(canvas) {
          // Preview the same template pixels that the editor exports to PNG.
          preview.update(canvas);
          map.needsUpdate = true;
        },
      };
    },
  };
}

export async function createViewer(container, modelId) {
  const model = previewModels[modelId];
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-3, 3, 3, -3, .1, 35);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minZoom = .78;
  controls.maxZoom = 1.85;
  controls.maxPolarAngle = Math.PI * .515;
  controls.autoRotateSpeed = 1.25;
  controls.target.set(0, .64, 0);

  try {
    const { scene: source } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(new URL('../assets/models/' + model.file, import.meta.url).href);
    const pmrem = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, .035).texture;
    scene.environmentIntensity = .86;
    room.dispose();
    pmrem.dispose();

    const sun = new T.DirectionalLight('#fff7eb', 2.0);
    sun.position.set(-3, 6, -4);
    scene.add(sun, new T.HemisphereLight('#ffffff', '#a091b4', .84));

    const pattern = surface(128, 128);
    const shadow = pattern.ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    shadow.addColorStop(0, 'rgba(28,28,28,.48)');
    shadow.addColorStop(.65, 'rgba(28,28,28,.22)');
    shadow.addColorStop(1, 'rgba(28,28,28,0)');
    pattern.ctx.fillStyle = shadow;
    pattern.ctx.fillRect(0, 0, 128, 128);
    const floor = new T.Mesh(
      new T.PlaneGeometry(3.55, 6.35),
      new T.MeshBasicMaterial({ map: new T.CanvasTexture(pattern.canvas), transparent: true, depthWrite: false, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const { car, mapAtlas, partAt } = prepareCar(source, model);
    const ray = new T.Raycaster();
    scene.add(car);

    let frame = 0;
    let currentAtlas;
    let currentView;
    let surfaceWrap;
    let lastTime;
    const request = () => { if (!frame) frame = requestAnimationFrame(draw); };
    function draw(time) {
      frame = 0;
      if (!renderer.domElement.isConnected || !container.clientWidth) return;
      if (controls.autoRotate) controls.update(lastTime ? Math.min(.05, (time - lastTime) / 1000) : 0);
      lastTime = time;
      renderer.render(scene, camera);
      if (controls.autoRotate) request();
    }
    function resize() {
      if (!renderer.domElement.isConnected) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const verticalHalf = currentView === 'top' ? model.length / 2 + .22 : 2.27;
      const half = Math.max(2.52, verticalHalf * aspect);
      camera.left = -half;
      camera.right = half;
      camera.top = half / aspect;
      camera.bottom = -half / aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      request();
    }
    function setView(view) {
      currentView = view;
      camera.position.set(...views[view]);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      resize();
    }
    controls.addEventListener('change', request);
    new ResizeObserver(resize).observe(container);

    function getProjection() {
      camera.updateMatrixWorld();
      const { elements } = camera.matrixWorld;
      return {
        right: elements.slice(0, 3),
        down: elements.slice(4, 7).map(value => -value),
        normal: elements.slice(8, 11),
      };
    }

    function dragScale() {
      return (camera.right - camera.left) / (camera.zoom * container.clientWidth);
    }

    return {
      mount() {
        const switched = renderer.domElement.parentElement !== container;
        if (switched) {
          container.replaceChildren(renderer.domElement);
          setView('angle');
        } else resize();
        return switched;
      },
      setView,
      setOrbit(enabled) {
        controls.autoRotate = enabled;
        lastTime = undefined;
        request();
      },
      setAtlas(atlas) {
        if (currentAtlas === atlas) return;
        currentAtlas = atlas;
        surfaceWrap = mapAtlas(atlas);
      },
      getProjection,
      hitSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        camera.updateMatrixWorld();
        ray.setFromCamera(new T.Vector2(
          2 * (clientX - rect.left) / rect.width - 1,
          1 - 2 * (clientY - rect.top) / rect.height,
        ), camera);
        const hit = ray.intersectObject(car)[0];
        const part = partAt(hit);
        return part ? { part, point: hit.point } : null;
      },
      fitProjection(asset, parts, projection) {
        return surfaceWrap?.fit(asset, parts, projection);
      },
      drawSurfaceLayer(ctx, layer, part) {
        surfaceWrap.draw(ctx, layer, part);
      },
      setImageEditing(editing) {
        controls.enabled = !editing;
        if (editing) controls.autoRotate = false;
      },
      dragAxes(projection, point) {
        const view = getProjection();
        const scale = dragScale();
        const right = new T.Vector3().fromArray(view.right).multiplyScalar(scale);
        const down = new T.Vector3().fromArray(view.down).multiplyScalar(scale);
        if (projection.front) {
          const { x, y, z } = point ?? { x: 0, y: .68, z: -2.15 };
          const v = frontDistance(projection.front, x, y, z);
          return {
            xx: -right.x, xy: -down.x,
            yx: frontDistance(projection.front, x + right.x, y + right.y, z + right.z) - v,
            yy: frontDistance(projection.front, x + down.x, y + down.y, z + down.z) - v,
          };
        }
        const u = new T.Vector3().fromArray(projection.right);
        const v = new T.Vector3().fromArray(projection.down);
        return { xx: right.dot(u), xy: down.dot(u), yx: right.dot(v), yy: down.dot(v) };
      },
      updateTexture(canvas) {
        surfaceWrap?.updateTexture(canvas);
        request();
      },
    };
  } catch (error) {
    controls.dispose();
    renderer.dispose();
    throw error;
  }
}
