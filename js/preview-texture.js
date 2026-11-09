import { surface } from './templates.js';

export function nearestPixels(width, height, isSeed) {
  const size = width * height;
  const source = new Int32Array(size).fill(-1);
  const queue = new Uint32Array(size);
  let end = 0;

  for (let pixel = 0; pixel < size; pixel++) {
    if (!isSeed(pixel)) continue;
    source[pixel] = pixel;
    queue[end++] = pixel;
  }

  function extend(from, to) {
    if (source[to] !== -1) return;
    source[to] = source[from];
    queue[end++] = to;
  }
  for (let i = 0; i < end; i++) {
    const pixel = queue[i];
    if (pixel % width > 0) extend(pixel, pixel - 1);
    if (pixel % width < width - 1) extend(pixel, pixel + 1);
    if (pixel >= width) extend(pixel, pixel - width);
    if (pixel < size - width) extend(pixel, pixel + width);
  }
  return source;
}

function nearestSolidPixels(atlas, part) {
  const { width, height } = part;
  const mask = part.mask.getContext('2d').getImageData(0, 0, width, height).data;
  return nearestPixels(width, height, pixel => mask[pixel * 4 + 3] === 255).map(pixel =>
    pixel < 0 ? -1 : (part.y + Math.floor(pixel / width)) * atlas.width + part.x + pixel % width,
  );
}

// Interpolated mesh UVs can cross gaps in an island's silhouette. Give each
// island a separate rectangle whose gaps repeat that island's own edge pixels.
export function createPreviewTexture(atlas, parts) {
  const tiles = new Map();
  let x = 0;
  let y = 1; // The first row supplies white for faces without a template panel.
  let rowHeight = 0;
  for (const part of [...parts].sort((a, b) => b.height - a.height)) {
    if (x + part.width > atlas.width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    tiles.set(part.id, {
      x, y, width: part.width, height: part.height,
      source: nearestSolidPixels(atlas, part),
    });
    x += part.width;
    rowHeight = Math.max(rowHeight, part.height);
  }

  const { canvas, ctx } = surface(atlas.width, y + rowHeight, { alpha: false });
  const image = ctx.createImageData(canvas.width, canvas.height);
  const output = new Uint32Array(image.data.buffer).fill(0xffffffff);

  return {
    canvas,
    tiles,
    update(sourceCanvas) {
      const { data } = sourceCanvas.getContext('2d').getImageData(0, 0, atlas.width, atlas.height);
      const pixels = new Uint32Array(data.buffer);
      for (const tile of tiles.values()) {
        for (let row = 0; row < tile.height; row++) {
          const start = (tile.y + row) * canvas.width + tile.x;
          const from = row * tile.width;
          for (let col = 0; col < tile.width; col++) {
            output[start + col] = pixels[tile.source[from + col]] || 0xffffffff;
          }
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  };
}
