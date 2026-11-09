import { THREE as T, GLTFLoader, MeshoptDecoder, OrbitControls, RoomEnvironment } from '../assets/vendor/three-preview.js';
import { selectionBounds, surface } from './templates.js';
import { createPreviewTexture } from './preview-texture.js?v=3';
import { createFrontProfile, createSurfaceWrap, frontDistance } from './surface-wrap.js?v=3';

export const highlandPaintShells = new Set(['Geohoodsub00021Mtl', 'Georimblurlfsub01Mtl']);
export const highlandBody = { file: 'model.glb', length: 4.72, rotation: Math.PI / 2 };
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
    ...highlandBody, wrapFile: 'highland-wrap.glb?v=1',
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

function projection(part, x, y, z) {
  // Depth alone folds the vertical panel back onto the trunk deck.
  if (part === 'trunk') return [x, z - y];
  if (part === 'hood' || part.startsWith('mirror')) return [x, z];
  if (part.startsWith('corner-')) return [-x, -y];
  if (part.startsWith('bumper') || part === 'trim-rear') {
    return [part === 'bumper-rear' ? -x : x, -y];
  }
  return [part.endsWith('-l') ? y : -y, z];
}

function highlandSideTiles(atlas) {
  const tiles = new Map();
  for (const side of ['l', 'r']) {
    const panels = ['sill-' + side, 'fender-rear-' + side].map(id => atlas.parts.find(part => part.id === id));
    if (!panels.every(Boolean)) continue;
    const bounds = selectionBounds(panels);
    const { canvas, ctx } = surface(bounds.width, bounds.height);
    for (const part of panels) {
      ctx.drawImage(part.mask, part.x - bounds.x, part.y - bounds.y);
    }
    const tile = { ...bounds, mask: canvas, id: panels[0].id };
    for (const part of panels) tiles.set(part.id, tile);
  }
  return tiles;
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
export function separateSkins(position, index, classify, weld = true) {
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

export function vehicleTransform(source, model) {
  source.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(source);
  const center = bounds.getCenter(new T.Vector3());
  const axis = model.rotation ? 'x' : 'z';
  const scale = model.length / (bounds.max[axis] - bounds.min[axis]);
  return new T.Matrix4().makeRotationY(model.rotation || 0)
    .multiply(new T.Matrix4().makeScale(scale, scale, scale))
    .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}

export function vehicleGeometry(object, transform) {
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
  return geometry.applyMatrix4(transform.clone().multiply(object.matrixWorld));
}

function prepareCar(source, model, wrap) {
  const transform = vehicleTransform(source, model);
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
  let bakedTrim;
  let modelYGlass;
  let modelYHeadlights;
  let modelYTaillights;

  function addPaintTriangle(part, triangle) {
    paintParts.push(part);
    if (!projected.has(part)) projected.set(part, []);
    const entries = projected.get(part);
    for (const [x, y, z, nx, ny, nz, baseU, baseV, perfU, perfV] of triangle) {
      const [u, v] = wrap ? [baseU, baseV] : projection(part, x, y, z);
      entries.push({ index: paintPositions.length / 3, u, v, perfU, perfV });
      paintPositions.push(x, y, z);
      paintNormals.push(nx, ny, nz);
    }
  }

  source.traverse(object => {
    // The legacy asset's separate charge flap protrudes from the closed body.
    if (!object.isMesh || object.name === model.hiddenMesh) return;
    if (wrap && highlandPaintShells.has(object.material.name)) return;
    const geometry = vehicleGeometry(object, transform);
    const mappedPart = model.panels?.[object.name];
    const classify = model.skin?.(object.name);
    if (!mappedPart && !classify) {
      let material = wrap ? materialFor(object.material.name, object.material) : object.material;
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
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const indices = [i, i + 1, i + 2].map(id => index ? index.getX(id) : id);
      const values = indices.map(id => [position.getX(id), position.getY(id), position.getZ(id)]);
      const [x, y, z] = [0, 1, 2].map(axis => (values[0][axis] + values[1][axis] + values[2][axis]) / 3);
      let part = mappedPart || skinAt?.(indices[0]);
      if (model.rearCorners && part === 'bumper-rear' && Math.abs(x) > .83 && y < .6 && z > 1.65 && z < 2.12) {
        part = x < 0 ? 'corner-l' : 'corner-r';
      }
      if (part) {
        const triangle = indices.map((id, j) => [...values[j], normal.getX(id), normal.getY(id), normal.getZ(id)]);
        addPaintTriangle(part, triangle);
      } else {
        for (const [j, id] of indices.entries()) {
          trimPositions.push(...values[j]);
          trimNormals.push(normal.getX(id), normal.getY(id), normal.getZ(id));
        }
      }
    }
    geometry.dispose();
  });
  wrap?.traverse(object => {
    if (!object.isMesh) return;
    const part = object.userData.wrapPart;
    const { position, normal, uv, uv1 } = object.geometry.attributes;
    const index = object.geometry.index;
    if (part === 'trim') {
      bakedTrim = object.geometry;
      return;
    }
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map(j => [
        position.getX(j), position.getY(j), position.getZ(j),
        normal.getX(j), normal.getY(j), normal.getZ(j), uv.getX(j), uv.getY(j), uv1.getX(j), uv1.getY(j),
      ]);
      addPaintTriangle(part, triangle);
    }
  });
  paintGeometry.setAttribute('position', new T.Float32BufferAttribute(paintPositions, 3));
  paintGeometry.setAttribute('normal', new T.Float32BufferAttribute(paintNormals, 3));
  const uvLength = paintPositions.length / 3 * 2;
  const atlasPixels = new T.BufferAttribute(new Float32Array(uvLength), 2);
  const previewUv = new T.BufferAttribute(new Float32Array(uvLength), 2);
  paintGeometry.setAttribute('uv', previewUv);
  const paint = new T.Mesh(paintGeometry, paintMaterial);
  car.add(paint);
  if (bakedTrim) car.add(new T.Mesh(bakedTrim, trimMaterial));
  else if (trimPositions.length) {
    const trimGeometry = new T.BufferGeometry();
    trimGeometry.setAttribute('position', new T.Float32BufferAttribute(trimPositions, 3));
    trimGeometry.setAttribute('normal', new T.Float32BufferAttribute(trimNormals, 3));
    car.add(new T.Mesh(trimGeometry, trimMaterial));
  }

  return {
    car,
    partAt(hit) {
      if (hit?.object !== paint) return null;
      const part = paintParts[hit.faceIndex];
      if (atlasParts?.has(part)) return part;
      return part.startsWith('corner-') ? 'bumper-rear' : null;
    },
    mapAtlas(atlas, modelId) {
      const parts = new Map(atlas.parts.map(part => [part.id, part]));
      atlasParts = parts;
      const sideTiles = wrap ? highlandSideTiles(atlas) : new Map();
      const performance = modelId === 'model3-2024-performance';
      const previewParts = new Set(atlas.parts.map(part => sideTiles.get(part.id) || part));
      const preview = createPreviewTexture(atlas, previewParts);
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
        const tilePart = sideTiles.get(id) || part;
        const tile = preview.tiles.get(tilePart.id);
        if (wrap) {
          // glTF UVs address the official PNG. Move to the corresponding tile
          // for edge padding and retain local pixel positions for vehicle fit.
          for (const { index, u, v, perfU, perfV } of entries) {
            const x = performance ? perfU : u;
            const y = performance ? perfV : v;
            const column = T.MathUtils.clamp(x * atlas.width - .5 - tilePart.x, 0, tile.width - 1);
            const row = T.MathUtils.clamp(y * atlas.height - .5 - tilePart.y, 0, tile.height - 1);
            atlasPixels.setXY(index, column + tilePart.x - part.x, row + tilePart.y - part.y);
            previewUv.setXY(index, (tile.x + column + .5) / width, 1 - (tile.y + row + .5) / height);
          }
          continue;
        }
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
        for (const entry of entries) {
          const v = (entry.v - top) / vSpan;
          const u = (entry.u - left) / uSpan;
          const row = Math.round((.015 + .97 * v) * (part.height - 1));
          const [min, max] = part.rows[row];
          const column = max > min ? min - part.x + (max - min) * (.03 + .94 * u) : part.width / 2;
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
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const load = file => loader.loadAsync(new URL('../assets/models/' + file, import.meta.url).href);
    const [{ scene: source }, wrap] = await Promise.all([load(model.file), model.wrapFile && load(model.wrapFile)]);
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

    const { car, mapAtlas, partAt } = prepareCar(source, model, wrap?.scene);
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
      setAtlas(atlas, modelId) {
        if (currentAtlas === atlas) return;
        currentAtlas = atlas;
        surfaceWrap = mapAtlas(atlas, modelId);
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
