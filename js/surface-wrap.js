import { surface } from './templates.js';

function dot(axis, x, y, z) {
  return axis[0] * x + axis[1] * y + axis[2] * z;
}

function sample(source, width, height, x, y, output, offset) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    output[offset + 3] = 0;
    return;
  }
  // Interpolate at texel centers and weight colors by opacity to keep clear edges clean.
  x = Math.max(0, x - .5);
  y = Math.max(0, y - .5);
  const col = Math.floor(x);
  const row = Math.floor(y);
  const dx = x - col;
  const dy = y - row;
  const topLeft = (row * width + col) * 4;
  const topRight = topLeft + (col < width - 1 ? 4 : 0);
  const bottomLeft = topLeft + (row < height - 1 ? width * 4 : 0);
  const bottomRight = bottomLeft + topRight - topLeft;
  const a = source[topLeft + 3] * (1 - dx) * (1 - dy);
  const b = source[topRight + 3] * dx * (1 - dy);
  const c = source[bottomLeft + 3] * (1 - dx) * dy;
  const d = source[bottomRight + 3] * dx * dy;
  const alpha = a + b + c + d;
  output[offset + 3] = alpha;
  if (!alpha) return;
  for (let channel = 0; channel < 3; channel++) {
    output[offset + channel] = (source[topLeft + channel] * a + source[topRight + channel] * b +
      source[bottomLeft + channel] * c + source[bottomRight + channel] * d) / alpha;
  }
}

const frontParts = new Set(['hood', 'bumper-front', 'fender-front-l', 'fender-front-r']);
export function createFrontProfile(points) {
  let distance = 0;
  return points.slice(1).map(([endZ, endY], i) => {
    const [z, y] = points[i];
    const dz = endZ - z;
    const dy = endY - y;
    const length = Math.hypot(dz, dy);
    const start = distance;
    distance += length;
    return { z, y, dz: dz / length, dy: dy / length, start, length };
  });
}

export function frontDistance(profile, x, y, z) {
  // The nose curves back around the sides. Compare it with the centerline
  // after accounting for that sweep near the bumper.
  const sweep = Math.max(0, Math.min(1, (-z - 1.5) / .5));
  const centerZ = z - .36 * x * x * sweep;
  let distance = 0;
  let closest = Infinity;
  for (const segment of profile) {
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

export function imagePlane(projection, x, y, z) {
  const { front, right, down } = projection;
  return front ? [-x, frontDistance(front, x, y, z)] : [dot(right, x, y, z), dot(down, x, y, z)];
}

// Choose the outside skin where several mesh faces share the same template UV.
function outsideDepth(id, x, y, z) {
  if (id === 'bumper-front') return -z;
  if (id === 'bumper-rear' || id === 'trim-rear' || id.startsWith('corner-')) return z;
  if (id === 'hood' || id === 'trunk' || id.startsWith('mirror')) return y;
  return id.endsWith('-l') ? -x : x;
}

function surfacePositions(atlas, part, entries, positions, uv) {
  const width = Math.max(64, part.width);
  const height = Math.max(32, part.height);
  const grid = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height).fill(-Infinity);
  for (let i = 0; i < entries.length; i += 3) {
    const [a, b, c] = [entries[i], entries[i + 1], entries[i + 2]].map(entry => entry.index);
    const x0 = uv.getX(a) * width - .5;
    const y0 = uv.getY(a) * height - .5;
    const x1 = uv.getX(b) * width - .5;
    const y1 = uv.getY(b) * height - .5;
    const x2 = uv.getX(c) * width - .5;
    const y2 = uv.getY(c) * height - .5;
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
        const x = w0 * positions[a * 3] + w1 * positions[b * 3] + w2 * positions[c * 3];
        const y = w0 * positions[a * 3 + 1] + w1 * positions[b * 3 + 1] + w2 * positions[c * 3 + 1];
        const z = w0 * positions[a * 3 + 2] + w1 * positions[b * 3 + 2] + w2 * positions[c * 3 + 2];
        const pixel = row * width + col;
        const outside = outsideDepth(part.id, x, y, z);
        if (outside <= depth[pixel]) continue;
        depth[pixel] = outside;
        grid[pixel * 3] = x;
        grid[pixel * 3 + 1] = y;
        grid[pixel * 3 + 2] = z;
      }
    }
  }

  // Match each template row to a cross-section of the surface. Interpolate
  // between measured points across mesh gaps instead of repeating edge pixels.
  const rows = new Map();
  for (let y = 0; y < height; y++) {
    let first = -1;
    let previous = -1;
    const start = y * width;
    for (let x = 0; x < width; x++) {
      if (depth[start + x] === -Infinity) continue;
      if (first === -1) first = x;
      else {
        for (let missing = previous + 1; missing < x; missing++) {
          const t = (missing - previous) / (x - previous);
          for (let axis = 0; axis < 3; axis++) {
            grid[(start + missing) * 3 + axis] = mix(grid[(start + previous) * 3 + axis], grid[(start + x) * 3 + axis], t);
          }
        }
      }
      previous = x;
    }
    if (first >= 0) rows.set(y, { start, first, last: previous });
  }
  const points = new Float32Array(part.width * part.height * 3);
  const pixels = [];
  if (!rows.size) return { points, pixels };

  const available = [...rows.keys()];
  let next = 0;
  for (let y = 0; y < part.height; y++) {
    const sourceY = (y + .5) * height / part.height - .5;
    while (next < available.length - 1 && available[next] < sourceY) next++;
    const y0 = available[Math.max(0, next - 1)];
    const y1 = available[next];
    const t = y0 === y1 ? 0 : Math.min(1, (sourceY - y0) / (y1 - y0));
    const top = rows.get(y0);
    const bottom = rows.get(y1);
    const [left, right] = part.rows[y];
    const start = (part.y + y) * atlas.width + part.x;
    for (let x = 0; x < part.width; x++) {
      if (atlas.lookup[start + x] !== part.index) continue;
      const u = right > left ? Math.max(0, Math.min(1, (part.x + x - left) / (right - left))) : .5;
      const pixel = y * part.width + x;
      for (let axis = 0; axis < 3; axis++) {
        points[pixel * 3 + axis] = mix(rowPoint(grid, top, u, axis), rowPoint(grid, bottom, u, axis), t);
      }
      pixels.push(pixel);
    }
  }
  return { points, pixels };
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function rowPoint(grid, { start, first, last }, u, axis) {
  const x = mix(first, last, u);
  const left = Math.floor(x);
  return mix(grid[(start + left) * 3 + axis], grid[(start + Math.min(left + 1, last)) * 3 + axis], x - left);
}

export function createSurfaceWrap(atlas, parts, positions, uv, frontProfile) {
  const maps = new Map();
  const images = new WeakMap();
  const stamp = surface(atlas.width, atlas.height);

  return {
    fit(asset, selection, projection) {
      if (!selection.length || !selection.every(part => parts.has(part.id))) return null;
      const followsFront = frontProfile && selection.every(part => frontParts.has(part.id)) &&
        selection.some(part => part.id === 'hood') && selection.some(part => part.id === 'bumper-front');
      const front = followsFront ? frontProfile : null;
      const placement = { ...projection, front };
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const part of selection) {
        for (const { index } of parts.get(part.id)) {
          const x = positions[index * 3], y = positions[index * 3 + 1], z = positions[index * 3 + 2];
          const [u, v] = imagePlane(placement, x, y, z);
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
        projection: front === (projection.front ?? null) ? projection : { ...projection, front },
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
          map.frontRows[pixel] = frontDistance(front, points[offset], points[offset + 1], points[offset + 2]);
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
        const sx = u * cos + v * sin + width / 2;
        const sy = v * cos - u * sin + height / 2;
        sample(source, width, height, sx, sy, output.data, pixel * 4);
      }
      stamp.ctx.putImageData(output, 0, 0);
      ctx.drawImage(stamp.canvas, 0, 0, part.width, part.height, 0, 0, part.width, part.height);
    },
  };
}
