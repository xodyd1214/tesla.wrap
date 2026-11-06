import { THREE as T, GLTFLoader, MeshoptDecoder, OrbitControls, RoomEnvironment } from '../assets/vendor/three-preview.js';
import { surface } from './templates.js';
import { createSurfaceWrap, frontDistance } from './surface-wrap.js';

const paintShells = new Set(['Geohoodsub00021Mtl', 'Georimblurlfsub01Mtl']);
const views = {
  angle: [-5.2, 3.05, -5.9],
  front: [0, 3.9, -7.3],
  side: [-8, 1.65, 0.001],
  top: [0, 9, 0.005],
};

function exteriorPart(x, y, z, ny) {
  const side = x < 0 ? 'l' : 'r';
  const a = Math.abs(x);
  if (a > .84 && y > .87 && z > -.79 && z < -.54) return 'mirror-' + side;
  if (z > 1.55 && y > .77 && a < .775 && ny > .26) return 'trunk';
  if (z > 2.17 && y > .65 && y < .79 && a < .64) return 'trim-rear';
  // The fender tips above the headlights extend inward toward the hood seam.
  if (a > .48 && y > .68 && z > -2.13 && z < -1.72 && ny > .5) return 'fender-front-' + side;
  if (y > .2 && (z < -2.05 || z < -1.85 && y < .53)) return 'bumper-front';
  if (y > .21 && (z > 2.09 || z > 1.78 && y < .6 && a > .68)) return 'bumper-rear';
  if (a > .65 && y > .27 && z < -.95 && z > -2.13) return 'fender-front-' + side;
  if (a > .61 && a < .81 && y > 1.03 && z > -1.16 && z < 1.66) return 'pillar-' + side;
  if (a > .73 && y > .44 && z >= 1.18 && z <= 2.09) return 'fender-rear-' + side;
  if (a > .59 && y > .145 && y < .29 && z > -1.08 && z < 1.02) return 'sill-' + side;
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
      color: '#20222b', metalness: .38, roughness: .18, clearcoat: .9,
      side: T.DoubleSide,
    });
  }
  if (name === 'Geohoodsub00031Mtl') return dark('#34343a', .26);
  if (original.map && !name.startsWith('Geocockpit')) {
    return new T.MeshStandardMaterial({ color: '#38373b', map: original.map, roughness: .58, side: T.DoubleSide });
  }
  return dark('#34343b');
}

function projection(part, x, y, z) {
  if (part === 'hood' || part === 'trunk' || part.startsWith('mirror')) return [x, z];
  if (part.startsWith('bumper') || part === 'trim-rear') {
    return [part === 'bumper-rear' ? -x : x, -y];
  }
  return [part.endsWith('-l') ? y : -y, z];
}

// The imported car has two paint meshes. Rejoin coincident vertices to find
// whole hood and door skins before using position ranges on the fused shell.
function separateSkins(position, index) {
  const parents = new Uint32Array(position.count);
  const vertices = new Map();
  const point = i => [position.getX(i), position.getY(i), position.getZ(i)];
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  for (let i = 0; i < parents.length; i++) {
    const key = point(i).map(value => Math.round(value * 3000)).join(',');
    if (!vertices.has(key)) vertices.set(key, i);
    parents[i] = vertices.get(key);
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
  for (const [id, [x0, y0, z0, x1, y1, z1]] of bounds) {
    const side = x0 < 0 ? 'l' : 'r';
    const lateral = x0 > .65 || x1 < -.65;
    if (x0 > -.75 && x0 < -.7 && x1 > .7 && x1 < .75 &&
      y0 > .41 && y1 < .925 && z0 < -2.26 && z0 > -2.3 && z1 < -1.075 && z1 > -1.13) {
      skins.set(id, 'hood');
    } else if (lateral && y0 > .22 && y0 < .32 && y1 > .84 && y1 < 1.055) {
      if (z0 > -.99 && z0 < -.87 && z1 > .15 && z1 < .27) skins.set(id, 'door-front-' + side);
      else if (z0 > .17 && z0 < .29 && z1 > 1.15 && z1 < 1.34) skins.set(id, 'door-rear-' + side);
    }
  }
  return i => skins.get(root(i));
}

function prepareCar(source, texture) {
  source.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(source);
  const center = bounds.getCenter(new T.Vector3());
  const scale = 4.72 / (bounds.max.x - bounds.min.x);
  const transform = new T.Matrix4().makeRotationY(Math.PI / 2)
    .multiply(new T.Matrix4().makeScale(scale, scale, scale))
    .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const car = new T.Group();
  const projected = new Map();
  const paintMaterial = new T.MeshPhysicalMaterial({
    color: '#ffffff', map: texture, roughness: .3, metalness: .12,
    clearcoat: .48, clearcoatRoughness: .19, side: T.DoubleSide,
  });
  const paintGeometry = new T.BufferGeometry();
  const paintParts = [];
  const paintPositions = [];
  const paintNormals = [];
  const trimMaterial = new T.MeshStandardMaterial({ color: '#25252a', roughness: .48, side: T.DoubleSide });
  const trimPositions = [];
  const trimNormals = [];

  source.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(transform.clone().multiply(object.matrixWorld));
    if (!paintShells.has(object.material.name)) {
      car.add(new T.Mesh(geometry, materialFor(object.material.name, object.material)));
      return;
    }
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const skinAt = separateSkins(position, index);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const indices = [i, i + 1, i + 2].map(id => index ? index.getX(id) : id);
      const values = indices.map(id => [position.getX(id), position.getY(id), position.getZ(id)]);
      const [x, y, z] = [0, 1, 2].map(axis => (values[0][axis] + values[1][axis] + values[2][axis]) / 3);
      const ny = (normal.getY(indices[0]) + normal.getY(indices[1]) + normal.getY(indices[2])) / 3;
      const axleDistance = Math.min(Math.abs(z + 1.48), Math.abs(z - 1.39));
      const wheel = object.material.name === 'Georimblurlfsub01Mtl' &&
        Math.abs(x) > .855 && Math.hypot(y - .345, axleDistance) < .275;
      const part = wheel ? null : skinAt(indices[0]) || exteriorPart(x, y, z, ny);
      if (part) {
        paintParts.push(part);
        if (!projected.has(part)) projected.set(part, []);
        const entries = projected.get(part);
        for (const [j, id] of indices.entries()) {
          const uv = projection(part, ...values[j]);
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
  const uv = new T.Float32BufferAttribute(new Float32Array(paintPositions.length / 3 * 2), 2);
  paintGeometry.setAttribute('uv', uv);
  const paint = new T.Mesh(paintGeometry, paintMaterial);
  car.add(paint);
  const trimGeometry = new T.BufferGeometry();
  trimGeometry.setAttribute('position', new T.Float32BufferAttribute(trimPositions, 3));
  trimGeometry.setAttribute('normal', new T.Float32BufferAttribute(trimNormals, 3));
  car.add(new T.Mesh(trimGeometry, trimMaterial));

  return {
    car,
    partAt(hit) {
      return hit?.object === paint ? paintParts[hit.faceIndex] : null;
    },
    mapAtlas(atlas) {
      const parts = new Map(atlas.parts.map(part => [part.id, part]));
      for (const [id, entries] of projected) {
        const part = parts.get(id);
        if (!part) continue;
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
        for (const entry of entries) {
          const v = (entry.v - top) / Math.max(.001, bottom - top);
          const u = (entry.u - left) / Math.max(.001, right - left);
          const row = Math.round((.015 + .97 * v) * (part.height - 1));
          const [min, max] = part.rows[row];
          const x = max > min ? min + (max - min) * (.03 + .94 * u) : part.x + part.width / 2;
          uv.setXY(entry.index, (x + .5) / atlas.width, 1 - (part.y + row + .5) / atlas.height);
        }
      }
      uv.needsUpdate = true;
      return createSurfaceWrap(atlas, projected, paintPositions, uv);
    },
  };
}

export async function createViewer(container) {
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
      .loadAsync(new URL('../assets/models/model.glb', import.meta.url).href);
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
    shadow.addColorStop(0, 'rgba(24,28,36,.54)');
    shadow.addColorStop(.65, 'rgba(24,28,36,.29)');
    shadow.addColorStop(1, 'rgba(24,28,36,0)');
    pattern.ctx.fillStyle = shadow;
    pattern.ctx.fillRect(0, 0, 128, 128);
    const floor = new T.Mesh(
      new T.PlaneGeometry(3.55, 6.35),
      new T.MeshBasicMaterial({ map: new T.CanvasTexture(pattern.canvas), transparent: true, depthWrite: false, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const art = surface(1024, 1024, true);
    art.ctx.fillStyle = '#ffffff';
    art.ctx.fillRect(0, 0, 1024, 1024);
    const texture = new T.CanvasTexture(art.canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const { car, mapAtlas, partAt } = prepareCar(source, texture);
    const ray = new T.Raycaster();
    scene.add(car);

    let frame = 0;
    let currentAtlas;
    let surfaceWrap;
    let placement;
    let lastTime;
    const request = () => { if (!frame) frame = requestAnimationFrame(draw); };
    function draw(time) {
      frame = 0;
      if (!container.clientWidth) return;
      if (controls.autoRotate) controls.update(lastTime ? Math.min(.05, (time - lastTime) / 1000) : 0);
      lastTime = time;
      renderer.render(scene, camera);
      if (controls.autoRotate) request();
    }
    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const half = Math.max(2.68, 2.39 * aspect);
      camera.left = -half;
      camera.right = half;
      camera.top = half / aspect;
      camera.bottom = -half / aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      request();
    }
    function setView(view) {
      camera.position.set(...views[view]);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      request();
    }
    controls.addEventListener('change', request);
    container.replaceChildren(renderer.domElement);
    new ResizeObserver(resize).observe(container);
    setView('angle');
    resize();

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
      setPlacement(projection) {
        if (placement === projection) return;
        placement = projection;
        controls.enabled = !placement;
        if (!placement) return;
        controls.autoRotate = false;
        if (!placement.front) {
          const distance = camera.position.distanceTo(controls.target);
          camera.position.fromArray(placement.normal).multiplyScalar(distance).add(controls.target);
        }
        controls.update();
        request();
      },
      dragScale,
      dragAxes(projection, point) {
        const view = getProjection();
        const scale = dragScale();
        const right = new T.Vector3().fromArray(view.right).multiplyScalar(scale);
        const down = new T.Vector3().fromArray(view.down).multiplyScalar(scale);
        if (projection.front) {
          const { x, y, z } = point ?? { x: 0, y: .68, z: -2.15 };
          const v = frontDistance(x, y, z);
          return {
            xx: -right.x, xy: -down.x,
            yx: frontDistance(x + right.x, y + right.y, z + right.z) - v,
            yy: frontDistance(x + down.x, y + down.y, z + down.z) - v,
          };
        }
        const u = new T.Vector3().fromArray(projection.right);
        const v = new T.Vector3().fromArray(projection.down);
        return { xx: right.dot(u), xy: down.dot(u), yx: right.dot(v), yy: down.dot(v) };
      },
      updateTexture(canvas) {
        art.ctx.fillStyle = '#ffffff';
        art.ctx.fillRect(0, 0, art.canvas.width, art.canvas.height);
        art.ctx.drawImage(canvas, 0, 0, art.canvas.width, art.canvas.height);
        texture.needsUpdate = true;
        request();
      },
    };
  } catch (error) {
    controls.dispose();
    renderer.dispose();
    throw error;
  }
}
