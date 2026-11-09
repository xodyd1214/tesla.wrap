const source = 'https://raw.githubusercontent.com/teslamotors/custom-wraps/86c7d31454caf0f20af6f6af105f577643f13bce';

const side = (prefix, names) => names.split(' ').map(name => name + '-' + prefix);
const [lf, lr, lff, lrf, lm, ls, lp, le] = side('l', 'door-front door-rear fender-front fender-rear mirror sill pillar end');
const [rf, rr, rff, rrf, rm, rs, rp, re] = side('r', 'door-front door-rear fender-front fender-rear mirror sill pillar end');

// Islands are ordered by their pixel area in each pinned Tesla template.
const highland = ['bumper-front', 'hood', rrf, lrf, 'bumper-rear', lf, rf, 'trunk', lr, rr, rff, lff, 'trim-rear', lp, rp, rm, lm];
const plaid = ['hood', 'bumper-front', 'bumper-rear', lf, rf, 'trunk', rrf, lrf, lr, rr, lff, rff, 'trim-rear', rs, ls, rp, lp, lm, rm];
const juniper = ['hood', 'bumper-front', lf, rf, lr, rr, 'bumper-rear', lff, rff, lrf, rrf, 'trunk', le, re, rp, lp, ls, rs, lm, rm];

export const models = [
  { id: 'model3-2024-base', name: 'Model 3 Highland', variant: '2024+ · Standard / Premium', islands: highland, preview: 'highland' },
  { id: 'model3-2024-performance', name: 'Model 3 Highland', variant: '2024+ · Performance', islands: ['hood', 'bumper-rear', 'bumper-front', rrf, lrf, lf, rf, 'trunk', rr, lr, lff, rff, 'trim-rear', lp, rp, rm, lm], preview: 'highland' },
  { id: 'model3', name: 'Model 3', variant: '기존 모델', islands: ['bumper-front', 'hood', 'bumper-rear', 'trunk', lrf, rrf, lf, rf, lr, rr, lff, rff, lp, rp, rm, lm], preview: 'model-3' },
  { id: 'modely-2025-premium', name: 'Model Y Juniper', variant: '2025+ · Premium', islands: juniper, preview: 'juniper' },
  { id: 'modely-2025-base', name: 'Model Y Juniper', variant: '2025+ · Standard', islands: ['hood', rf, lf, 'bumper-front', rr, lr, 'trunk', 'bumper-rear', lff, rff, rrf, lrf, re, le, lp, rp, rm, lm], preview: 'juniper' },
  { id: 'modely-2025-performance', name: 'Model Y Juniper', variant: '2025+ · Performance', islands: ['hood', 'bumper-front', lf, rf, lr, rr, 'bumper-rear', lff, rff, rrf, lrf, 'trunk', lp, rp, re, le, rs, ls, 'corner-r', 'corner-l', lm, rm], preview: 'juniper' },
  { id: 'modely', name: 'Model Y', variant: '기존 모델', islands: ['hood', 'bumper-front', 'trunk', rf, lf, lr, rr, 'bumper-rear', rff, lff, rrf, lrf, lp, rp, rm, lm], preview: 'model-y' },
  { id: 'modely-l', name: 'Model Y L', variant: '', islands: ['hood', 'bumper-front', lf, rf, rr, lr, rrf, lrf, 'bumper-rear', lff, rff, rp, lp, le, re, 'trunk', rs, ls, rm, lm] },
  { id: 'models-2021', name: 'Model S', variant: '2021+', islands: plaid },
  { id: 'models-2025-plaid', name: 'Model S Plaid', variant: '2025+', islands: [plaid[0], plaid[2], plaid[1], ...plaid.slice(3, 14), ls, lp, rp, lm, rm] },
  { id: 'modelx-2021', name: 'Model X', variant: '2021+', islands: ['hood', 'bumper-front', rf, lf, lr, rr, 'bumper-rear', rrf, lrf, 'trunk', 'trim-rear', rff, lff, 'trim-tailgate', rp, lp, 'pillar-rear-l', lm, rm] },
  { id: 'cybertruck', name: 'Cybertruck', variant: '', islands: [rf, lf, 'hood', 'trunk', 'bumper-front'] },
];

const labels = {
  hood: '후드', trunk: '트렁크', 'bumper-front': '앞 범퍼', 'bumper-rear': '뒤 범퍼',
  'door-front': '앞 도어', 'door-rear': '뒤 도어', 'fender-front': '앞 펜더', 'fender-rear': '뒤 펜더',
  mirror: '사이드미러', sill: '사이드 스커트', pillar: '필러', end: '뒤 코너', corner: '범퍼 끝',
  'trim-rear': '뒤 패널', 'trim-tailgate': '테일게이트 패널', 'pillar-rear': '뒤 필러',
};
const order = ['hood', 'bumper-front', 'trunk', 'bumper-rear', lf, lr, rf, rr, lff, lrf, rff, rrf];
export function labelFor(id) {
  if (!id.endsWith('-l') && !id.endsWith('-r')) return labels[id] || id;
  return (id.endsWith('-l') ? '왼쪽 ' : '오른쪽 ') + (labels[id.slice(0, -2)] || '패널');
}

export function surface(width, height, options) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', options) };
}

async function fetchTemplate(model) {
  const response = await fetch(source + '/' + model.id + '/template.png');
  if (!response.ok) throw new Error('Tesla template download failed');
  return response.blob();
}

export async function loadTemplate(model) {
  const blank = await fetchTemplate(model);
  const image = await createImageBitmap(blank);
  const { width, height } = image;
  const { ctx } = surface(width, height);
  try {
    ctx.drawImage(image, 0, 0);
  } finally {
    image.close();
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  const hits = new Uint8Array(width * height);
  for (let i = 0; i < hits.length; i++) {
    hits[i] = +(data[i * 4] > 180 && data[i * 4 + 3] > 128);
  }

  const queue = new Uint32Array(hits.length);
  const components = [];
  for (let pixel = 0; pixel < hits.length; pixel++) {
    if (!hits[pixel]) continue;
    let head = 0;
    let tail = 1;
    hits[pixel] = 0;
    queue[0] = pixel;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        index - width,
        index + width,
      ];
      for (const neighbor of neighbors) {
        if (!hits[neighbor]) continue;
        hits[neighbor] = 0;
        queue[tail++] = neighbor;
      }
    }
    if (tail > 100) components.push(queue.slice(0, tail));
  }
  components.sort((a, b) => b.length - a.length);
  if (components.length !== model.islands.length) throw new Error('Unexpected Tesla template layout');

  const byPart = new Map();
  for (const [index, pixels] of components.entries()) {
    const id = model.islands[index];
    if (model.preview === 'highland' && (id === lrf || id === rrf)) {
      const whichSide = id.slice(-1);
      const cutoff = Math.round(height * .782) * width;
      byPart.set(id, pixels.filter(i => i >= cutoff));
      byPart.set('sill-' + whichSide, pixels.filter(i => i < cutoff));
    } else if (model.id === 'cybertruck' && (id === lf || id === rf)) {
      const whichSide = id.slice(-1);
      const ranges = [
        ['fender-front', 0, .224], ['door-front', .224, .43], ['door-rear', .43, .62], ['fender-rear', .62, 1],
      ];
      for (const [name, left, right] of ranges) {
        byPart.set(name + '-' + whichSide, pixels.filter(i => i % width >= width * left && i % width < width * right));
      }
    } else {
      byPart.set(id, pixels);
    }
  }

  // Assign the antialiased perimeter to the nearest solid panel.
  const lookup = new Uint8Array(width * height);
  const ids = [...byPart.keys()];
  ids.forEach((id, index) => {
    for (const pixel of byPart.get(id)) lookup[pixel] = index + 1;
  });
  const expanded = lookup.slice();
  for (let i = 0; i < lookup.length; i++) {
    if (lookup[i] || data[i * 4] < 30 || data[i * 4 + 3] < 6) continue;
    expanded[i] = lookup[i - width] || lookup[i + width] ||
      (i % width > 0 && lookup[i - 1]) || (i % width < width - 1 && lookup[i + 1]) || 0;
  }

  const parts = ids.map((id, index) => {
    const labelId = model.preview === 'juniper' && id.startsWith('sill-') ? 'pillar-rear-' + id.slice(-1) : id;
    return { id, index: index + 1, label: labelFor(labelId), x: width, y: height, right: 0, bottom: 0 };
  });
  for (let i = 0; i < expanded.length; i++) {
    const part = parts[expanded[i] - 1];
    if (!part) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    part.x = Math.min(part.x, x);
    part.y = Math.min(part.y, y);
    part.right = Math.max(part.right, x + 1);
    part.bottom = Math.max(part.bottom, y + 1);
  }
  for (const part of parts) {
    part.width = part.right - part.x;
    part.height = part.bottom - part.y;
    const mask = surface(part.width, part.height);
    const pixels = mask.ctx.createImageData(part.width, part.height);
    const rows = Array.from({ length: part.height }, () => [part.right, part.x]);
    for (let y = part.y; y < part.bottom; y++) {
      for (let x = part.x; x < part.right; x++) {
        const i = y * width + x;
        if (expanded[i] !== part.index) continue;
        const alpha = lookup[i] ? 255 : Math.round(data[i * 4] * data[i * 4 + 3] / 255);
        pixels.data[((y - part.y) * part.width + x - part.x) * 4 + 3] = alpha;
        if (alpha >= 128) {
          const row = rows[y - part.y];
          row[0] = Math.min(row[0], x);
          row[1] = Math.max(row[1], x);
        }
      }
    }
    mask.ctx.putImageData(pixels, 0, 0);
    part.mask = mask.canvas;
    part.rows = rows;
  }

  const partOrder = part => order.includes(part.id) ? order.indexOf(part.id) : order.length;
  const sorted = parts.sort((a, b) => partOrder(a) - partOrder(b));
  return { width, height, parts: sorted, lookup: expanded, ids, blank };
}

const footprintSize = 96;

function footprint(image, isBlank = false) {
  const { ctx } = surface(footprintSize, footprintSize);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, footprintSize, footprintSize);
  const { data } = ctx.getImageData(0, 0, footprintSize, footprintSize);
  const mask = new Uint8Array(footprintSize ** 2);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = +(data[i * 4 + 3] > 128 && (!isBlank || data[i * 4] > 180));
  }
  return mask;
}

function footprintOverlap(art, template) {
  let overlap = 0;
  let union = 0;
  for (let i = 0; i < art.length; i++) {
    overlap += art[i] & template[i];
    union += art[i] | template[i];
  }
  return overlap / union;
}

// Model 3 and Highland templates have the same PNG dimensions. Use their
// transparent footprints to flag a different layout when the match is clear.
export async function matchingModel3Templates(image, current, atlas) {
  if (!current.id.startsWith('model3')) return [];
  const art = footprint(image);
  const coverage = art.reduce((sum, pixel) => sum + pixel, 0) / art.length;
  if (coverage < .2 || coverage > .8) return [];

  const mask = art.map((_, i) => {
    const x = Math.floor((i % footprintSize + .5) * atlas.width / footprintSize);
    const y = Math.floor((Math.floor(i / footprintSize) + .5) * atlas.height / footprintSize);
    return +Boolean(atlas.lookup[y * atlas.width + x]);
  });
  const currentScore = footprintOverlap(art, mask);
  if (currentScore >= .8) return [];

  const candidates = models.filter(model => model !== current && model.id.startsWith('model3'));
  const results = await Promise.allSettled(candidates.map(async model => {
    const blank = await createImageBitmap(await fetchTemplate(model));
    try {
      return { model, score: footprintOverlap(art, footprint(blank, true)) };
    } finally {
      blank.close();
    }
  }));
  const matches = results.filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .filter(match => match.score >= .87 && match.score - currentScore >= .13)
    .sort((a, b) => b.score - a.score);
  const best = matches[0]?.score;
  return matches.filter(match => best - match.score <= .05).map(match => match.model);
}

export function selectionBounds(parts) {
  const x = Math.min(...parts.map(part => part.x));
  const y = Math.min(...parts.map(part => part.y));
  return {
    x, y,
    width: Math.max(...parts.map(part => part.right)) - x,
    height: Math.max(...parts.map(part => part.bottom)) - y,
  };
}
