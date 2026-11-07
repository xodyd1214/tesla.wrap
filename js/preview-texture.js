import { surface } from './templates.js';

function nearestSolidPixels(atlas, part) {
  const { width, height } = part;
  const size = width * height;
  const mask = part.mask.getContext('2d').getImageData(0, 0, width, height).data;
  const source = new Int32Array(size).fill(-1);
  const queue = new Uint32Array(size);
  let end = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixel = row * width + col;
      if (mask[pixel * 4 + 3] !== 255) continue;
      source[pixel] = (part.y + row) * atlas.width + part.x + col;
      queue[end++] = pixel;
    }
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

// Interpolated mesh UVs can cross gaps in a panel's silhouette. Give each
// panel a separate rectangle whose gaps repeat that panel's own edge pixels.
export function createPreviewTexture(atlas) {
  const tiles = new Map();
  let x = 0;
  let y = 1; // The first row supplies white for faces without a template panel.
  let rowHeight = 0;
  for (const part of [...atlas.parts].sort((a, b) => b.height - a.height)) {
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
    drawProjection(tile, layer, plane, color) {
      const { x, y, width, height } = tile;
      const { image: artwork } = layer.asset;
      const factor = layer.fit * layer.scale / 100;
      const scaleX = (width - 1) / plane.width;
      const scaleY = (height - 1) / plane.height;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
      ctx.translate(x + .5 + (layer.x - plane.left) * scaleX, y + .5 + (layer.y - plane.top) * scaleY);
      ctx.scale(scaleX * factor, scaleY * factor);
      ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(artwork, -artwork.width / 2, -artwork.height / 2);
      ctx.restore();
    },
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
