import { surface } from './templates.js';

function dot(axis, x, y, z) {
  return axis[0] * x + axis[1] * y + axis[2] * z;
}

const frontParts = new Set(['hood', 'bumper-front', 'fender-front-l', 'fender-front-r']);
// Highland's centerline in model coordinates, from the windshield to the bumper lip.
const frontProfile = [
  [-1.1, .9], [-1.75, .805], [-2.2, .666], [-2.285, .613], [-2.35, .55], [-2.35, .2],
];
let frontLength = 0;
const frontSegments = frontProfile.slice(1).map(([endZ, endY], i) => {
  const [z, y] = frontProfile[i];
  const dz = endZ - z;
  const dy = endY - y;
  const length = Math.hypot(dz, dy);
  const start = frontLength;
  frontLength += length;
  return { z, y, dz: dz / length, dy: dy / length, start, length };
});

export function frontDistance(x, y, z) {
  // The nose curves back around the sides. Compare it with the centerline
  // after accounting for that sweep near the bumper.
  const sweep = Math.max(0, Math.min(1, (-z - 1.5) / .5));
  const centerZ = z - .36 * x * x * sweep;
  let distance = 0;
  let closest = Infinity;
  for (const segment of frontSegments) {
    const dz = centerZ - segment.z;
    const dy = y - segment.y;
    const along = Math.max(0, Math.min(segment.length, dz * segment.dz + dy * segment.dy));
    const error = (dz - along * segment.dz) ** 2 + (dy - along * segment.dy) ** 2;
    if (error < closest) {
      closest = error;
      distance = segment.start + along;
    }
  }
  return distance;
}

// Choose the outside skin where several mesh faces share the same template UV.
function outsideDepth(id, x, y, z) {
  if (id === 'bumper-front') return -z;
  if (id === 'bumper-rear' || id === 'trim-rear') return z;
  if (id === 'hood' || id === 'trunk' || id.startsWith('mirror')) return y;
  return id.endsWith('-l') ? -x : x;
}

function surfacePositions(atlas, part, entries, positions, uv) {
  const { width, height } = part;
  const size = width * height;
  const points = new Float32Array(size * 3);
  const depth = new Float32Array(size).fill(-Infinity);
  const queue = new Uint32Array(size);
  let end = 0;
  for (let i = 0; i < entries.length; i += 3) {
    const [a, b, c] = [entries[i], entries[i + 1], entries[i + 2]].map(entry => entry.index);
    const x0 = uv.getX(a) * atlas.width - part.x - .5;
    const y0 = (1 - uv.getY(a)) * atlas.height - part.y - .5;
    const x1 = uv.getX(b) * atlas.width - part.x - .5;
    const y1 = (1 - uv.getY(b)) * atlas.height - part.y - .5;
    const x2 = uv.getX(c) * atlas.width - part.x - .5;
    const y2 = (1 - uv.getY(c)) * atlas.height - part.y - .5;
    const det = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (Math.abs(det) < 1e-6) continue;
    const left = Math.max(0, Math.ceil(Math.min(x0, x1, x2)));
    const right = Math.min(width - 1, Math.floor(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.ceil(Math.min(y0, y1, y2)));
    const bottom = Math.min(height - 1, Math.floor(Math.max(y0, y1, y2)));
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const w1 = ((col - x0) * (y2 - y0) - (row - y0) * (x2 - x0)) / det;
        const w2 = ((x1 - x0) * (row - y0) - (y1 - y0) * (col - x0)) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
        if (atlas.lookup[(part.y + row) * atlas.width + part.x + col] !== part.index) continue;
        const x = w0 * positions[a * 3] + w1 * positions[b * 3] + w2 * positions[c * 3];
        const y = w0 * positions[a * 3 + 1] + w1 * positions[b * 3 + 1] + w2 * positions[c * 3 + 1];
        const z = w0 * positions[a * 3 + 2] + w1 * positions[b * 3 + 2] + w2 * positions[c * 3 + 2];
        const pixel = row * width + col;
        const outside = outsideDepth(part.id, x, y, z);
        if (outside <= depth[pixel]) continue;
        if (depth[pixel] === -Infinity) queue[end++] = pixel;
        depth[pixel] = outside;
        points[pixel * 3] = x;
        points[pixel * 3 + 1] = y;
        points[pixel * 3 + 2] = z;
      }
    }
  }

  // Extend the closest mapped surface to masked edges between UV samples.
  function extend(from, to) {
    if (depth[to] !== -Infinity) return;
    const col = to % width;
    const row = Math.floor(to / width);
    if (atlas.lookup[(part.y + row) * atlas.width + part.x + col] !== part.index) return;
    depth[to] = depth[from];
    points.copyWithin(to * 3, from * 3, from * 3 + 3);
    queue[end++] = to;
  }
  for (let i = 0; i < end; i++) {
    const pixel = queue[i];
    if (pixel % width > 0) extend(pixel, pixel - 1);
    if (pixel % width < width - 1) extend(pixel, pixel + 1);
    if (pixel >= width) extend(pixel, pixel - width);
    if (pixel < size - width) extend(pixel, pixel + width);
  }
  return { points, pixels: queue.subarray(0, end) };
}

export function createSurfaceWrap(atlas, parts, positions, uv, useFrontProfile) {
  const maps = new Map();
  const images = new WeakMap();
  const stamp = surface(atlas.width, atlas.height);

  return {
    fit(asset, selection, projection) {
      if (!selection.length || !selection.every(part => parts.has(part.id))) return null;
      const front = useFrontProfile && selection.every(part => frontParts.has(part.id)) &&
        selection.some(part => part.id === 'hood') && selection.some(part => part.id === 'bumper-front');
      const { right, down } = projection;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const part of selection) {
        for (const { index } of parts.get(part.id)) {
          const x = positions[index * 3], y = positions[index * 3 + 1], z = positions[index * 3 + 2];
          const u = front ? -x : dot(right, x, y, z);
          const v = front ? frontDistance(x, y, z) : dot(down, x, y, z);
          x0 = Math.min(x0, u);
          x1 = Math.max(x1, u);
          y0 = Math.min(y0, v);
          y1 = Math.max(y1, v);
        }
      }
      const { width, height } = asset.image;
      return {
        x: (x0 + x1) / 2, y: (y0 + y1) / 2,
        fit: Math.max((x1 - x0) / width, (y1 - y0) / height),
        projection: front === !!projection.front ? projection : { ...projection, front },
      };
    },
    draw(ctx, layer, part) {
      if (!maps.has(part.id)) {
        const map = surfacePositions(atlas, part, parts.get(part.id), positions, uv);
        maps.set(part.id, { ...map, output: stamp.ctx.createImageData(part.width, part.height) });
      }
      const map = maps.get(part.id);
      const { points, pixels, output } = map;
      const image = layer.asset.image;
      const { width, height } = image;
      if (!images.has(image)) images.set(image, image.getContext('2d').getImageData(0, 0, width, height).data);
      const source = images.get(image);
      const { right, down, front } = layer.projection;
      if (front && !map.frontRows) {
        map.frontRows = new Float32Array(output.width * output.height);
        for (const pixel of pixels) {
          const offset = pixel * 3;
          map.frontRows[pixel] = frontDistance(points[offset], points[offset + 1], points[offset + 2]);
        }
      }
      const factor = layer.fit * layer.scale / 100;
      const angle = layer.rotation * Math.PI / 180;
      const cos = Math.cos(angle) / factor;
      const sin = Math.sin(angle) / factor;
      for (const pixel of pixels) {
        const offset = pixel * 3;
        const x = points[offset], y = points[offset + 1], z = points[offset + 2];
        const u = (front ? -x : dot(right, x, y, z)) - layer.x;
        const v = (front ? map.frontRows[pixel] : dot(down, x, y, z)) - layer.y;
        const sx = Math.floor(u * cos + v * sin + width / 2);
        const sy = Math.floor(v * cos - u * sin + height / 2);
        const dest = pixel * 4;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
          output.data[dest + 3] = 0;
          continue;
        }
        const src = (sy * width + sx) * 4;
        output.data[dest] = source[src];
        output.data[dest + 1] = source[src + 1];
        output.data[dest + 2] = source[src + 2];
        output.data[dest + 3] = source[src + 3];
      }
      stamp.ctx.putImageData(output, 0, 0);
      ctx.drawImage(stamp.canvas, 0, 0, part.width, part.height, 0, 0, part.width, part.height);
    },
  };
}
