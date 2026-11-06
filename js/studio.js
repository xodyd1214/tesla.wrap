import { loadTemplate, models, selectionBounds, surface } from './templates.js';

const $ = id => document.getElementById(id);
const atlasCanvas = $('atlas');
const atlasContext = atlasCanvas.getContext('2d');
const flat = $('flat-preview');
const partsGrid = $('parts');
const modelInput = $('model');
const transformTools = $('transform-tools');
const mobileLayout = matchMedia('(max-width: 640px)');
const swatchColors = [
  ['흰색', '#ffffff'], ['검정', '#000000'], ['네이비', '#1f1d3d'],
  ['라일락', '#c5b0f4'], ['라임', '#dceeb1'], ['크림', '#f4ecd6'],
  ['민트', '#c8e6cd'], ['핑크', '#efd4d4'], ['코랄', '#f3c9b6'], ['마젠타', '#ff3d8b'],
];
const sessions = new Map();
let session;
let atlas;
let texture;
let scratch;
let overlay;
let viewer;
let viewerRequest;
let viewerFailed = false;
let loadVersion = 0;
let uploadVersion = 0;
let mode = 'image';
let guide = false;
let zoom = 1;
let frame = 0;
let textureDirty = false;
let pointer;
let sliderEdit;
let exporting = false;
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

function demoImage() {
  const { canvas, ctx } = surface(960, 780);
  ctx.fillStyle = '#212733';
  ctx.fillRect(0, 0, 960, 780);
  const lines = [
    [-72, 90, '#353e50'], [-16, 8, '#818c9e'], [5, 3, '#c5c3d7'],
    [28, 23, '#a5a1bc'], [54, 4, '#d2d3df'], [76, 9, '#6d778d'],
  ];
  for (const [offset, width, color] of lines) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(-100 + offset, 840);
    ctx.bezierCurveTo(100 + offset, 455, 570 + offset, 650, 720 + offset, -85);
    ctx.stroke();
  }
  return { image: canvas, name: 'Silverline · 샘플' };
}

function fitLayer(asset, parts) {
  const bounds = selectionBounds(parts);
  const fit = Math.max(bounds.width / asset.image.width, bounds.height / asset.image.height);
  return {
    asset, parts: parts.map(part => part.id),
    x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
    fit, scale: 100, rotation: 0,
  };
}

function snapshot() {
  return {
    colors: { ...session.colors },
    layers: session.layers.map(layer => ({ ...layer, parts: [...layer.parts] })),
    active: session.active,
  };
}

function saveUndo(before) {
  session.undo.push(before);
  if (session.undo.length > 24) session.undo.shift();
  session.redo.length = 0;
}

function transact(change) {
  saveUndo(snapshot());
  change();
  sync();
}

function restore(from, to) {
  if (!atlas || !session[from].length) return;
  session[to].push(snapshot());
  Object.assign(session, session[from].pop());
  sync();
}

function selectedParts() {
  return atlas.parts.filter(part => session.selected.has(part.id));
}

function activeImage() {
  return session?.layers[session.active];
}

function activeForSelection() {
  const layer = activeImage();
  return layer && layer.parts.some(id => session.selected.has(id)) ? layer : null;
}

function getImageAt(id) {
  return session.layers.find(layer => layer.parts.includes(id));
}

function replaceSelectedWith(layer) {
  const targets = session.selected;
  session.layers = session.layers.map(existing => ({
    ...existing, parts: existing.parts.filter(id => !targets.has(id)),
  })).filter(existing => existing.parts.length);
  session.active = session.layers.push(layer) - 1;
}

function paint(color) {
  if (!atlas || !session.selected.size) return;
  transact(() => {
    const asset = activeImage()?.asset;
    for (const id of session.selected) session.colors[id] = color;
    session.layers = session.layers.map(layer => ({
      ...layer, parts: layer.parts.filter(id => !session.selected.has(id)),
    })).filter(layer => layer.parts.length);
    session.active = session.layers.findIndex(layer => layer.asset === asset);
    $('picker').value = color;
  });
}

function setSelection(next) {
  session.selected = new Set(next);
  const first = next[0];
  const active = activeImage();
  if (!active || !active.parts.some(id => session.selected.has(id))) {
    const target = next.find(id => getImageAt(id));
    const index = session.layers.indexOf(getImageAt(target));
    if (index >= 0) session.active = index;
  }
  if (first && session.colors[first]) $('picker').value = session.colors[first];
  sync(false);
}

function togglePart(id) {
  const next = new Set(session.selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection([...next]);
}

function drawLayer(ctx, layer, dx = 0, dy = 0) {
  const { image } = layer.asset;
  const factor = layer.fit * layer.scale / 100;
  const width = image.width * factor;
  const height = image.height * factor;
  ctx.save();
  ctx.translate(layer.x - dx, layer.y - dy);
  ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function renderTexture() {
  const { width, height, parts } = atlas;
  texture.ctx.clearRect(0, 0, width, height);
  const ctx = scratch.ctx;
  for (const part of parts) {
    ctx.clearRect(0, 0, part.width, part.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, part.width, part.height);
    ctx.clip();
    ctx.fillStyle = session.colors[part.id] || '#ffffff';
    ctx.fillRect(0, 0, part.width, part.height);
    const layer = getImageAt(part.id);
    if (layer) drawLayer(ctx, layer, part.x, part.y);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(part.mask, 0, 0);
    ctx.restore();
    texture.ctx.drawImage(scratch.canvas, 0, 0, part.width, part.height, part.x, part.y, part.width, part.height);
  }
  const flatContext = flat.getContext('2d');
  flatContext.clearRect(0, 0, width, height);
  flatContext.drawImage(texture.canvas, 0, 0);
  if (viewer && session.model.preview) viewer.updateTexture(texture.canvas);
}

function selectionOverlay(part) {
  if (part.selection) return part.selection;
  const { canvas, ctx } = surface(part.width + 6, part.height + 6);
  for (const [x, y] of [[0, 3], [6, 3], [3, 0], [3, 6]]) ctx.drawImage(part.mask, x, y);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#1f1d3d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(part.mask, 3, 3);
  const tint = surface(part.width, part.height);
  tint.ctx.drawImage(part.mask, 0, 0);
  tint.ctx.globalCompositeOperation = 'source-in';
  tint.ctx.fillStyle = 'rgba(197, 176, 244, .27)';
  tint.ctx.fillRect(0, 0, part.width, part.height);
  part.selection = { outline: canvas, tint: tint.canvas };
  return part.selection;
}

function renderAtlas() {
  const { width, height } = atlas;
  const ctx = atlasContext;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = 'rgba(38, 42, 50, .27)';
  ctx.shadowBlur = 3;
  ctx.drawImage(texture.canvas, 0, 0);
  ctx.restore();
  const parts = selectedParts();
  const layer = mode === 'image' && guide ? activeForSelection() : null;
  const o = overlay.ctx;
  if (layer) {
    o.clearRect(0, 0, width, height);
    drawLayer(o, layer);
    o.globalCompositeOperation = 'destination-out';
    for (const part of atlas.parts) {
      if (layer.parts.includes(part.id)) o.drawImage(part.mask, part.x, part.y);
    }
    o.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.21;
    ctx.drawImage(overlay.canvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  for (const part of parts) {
    const selection = selectionOverlay(part);
    if (!getImageAt(part.id)) ctx.drawImage(selection.tint, part.x, part.y);
    ctx.drawImage(selection.outline, part.x - 3, part.y - 3);
  }
}

function scheduleRender(dirty = true) {
  textureDirty ||= dirty;
  if (!atlas || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!atlas) return;
    if (textureDirty) renderTexture();
    textureDirty = false;
    renderAtlas();
  });
}

function groupMembers(group) {
  return atlas.parts.filter(part => group === 'all' || part.id.startsWith('door-') && part.id.endsWith('-' + group)).map(part => part.id);
}

function updateRange(id, value) {
  const input = $(id);
  const progress = (value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
  const formatted = value + (id === 'scale' ? '%' : '°');
  input.value = value;
  input.style.setProperty('--progress', progress + '%');
  input.setAttribute('aria-valuetext', formatted);
  $(id + '-value').textContent = formatted;
}

function sync(dirty = true) {
  if (!atlas) return;
  $('count').textContent = session.selected.size + '개 선택';
  $('upload').disabled = !session.selected.size;
  $('undo').disabled = !session.undo.length;
  $('redo').disabled = !session.redo.length;
  $('reset').disabled = !Object.keys(session.colors).length && !session.layers.length;
  $('export').disabled = exporting;
  for (const button of partsGrid.children) {
    const id = button.dataset.part;
    button.setAttribute('aria-pressed', session.selected.has(id));
    button.style.setProperty('--dot', getImageAt(id) ? '#c5b0f4' : session.colors[id] || '#fff');
  }
  for (const button of document.querySelectorAll('[data-group]')) {
    const ids = groupMembers(button.dataset.group);
    button.disabled = !ids.length;
    button.setAttribute('aria-pressed', ids.length > 0 && ids.length === session.selected.size && ids.every(id => session.selected.has(id)));
  }
  for (const button of $('swatches').children) {
    button.disabled = !session.selected.size;
    button.setAttribute('aria-pressed', session.selected.size > 0 &&
      [...session.selected].every(id => !getImageAt(id) && (session.colors[id] || '#ffffff') === button.dataset.color));
  }
  $('apply-color').disabled = !session.selected.size;
  const layer = activeImage();
  const editable = activeForSelection();
  const canMove = !!editable && mode === 'image';
  atlasCanvas.classList.toggle('movable', canMove);
  $('atlas-hint').textContent = canMove ? '끌어서 이미지 이동' : '전개도에서 파츠 선택';
  $('active-image').hidden = !layer;
  transformTools.hidden = !layer || mode !== 'image';
  if (layer) {
    const image = layer.asset.image;
    const thumb = $('thumbnail').getContext('2d');
    const factor = 44 / Math.min(image.width, image.height);
    thumb.clearRect(0, 0, 44, 44);
    thumb.drawImage(image, (44 - image.width * factor) / 2, (44 - image.height * factor) / 2, image.width * factor, image.height * factor);
    $('filename').textContent = layer.asset.name;
    $('image-targets').textContent = layer.parts.length + '개 파츠에 적용됨';
    updateRange('scale', layer.scale);
    updateRange('rotation', layer.rotation);
    const sameSelection = session.selected.size === layer.parts.length && layer.parts.every(id => session.selected.has(id));
    $('apply-image').hidden = !session.selected.size || sameSelection;
    $('fit-image').hidden = !sameSelection;
    $('scale').disabled = !editable;
    $('rotation').disabled = !editable;
    $('delete-image').disabled = !editable;
  }
  scheduleRender(dirty);
}

function setMobile(view) {
  $('workspace').dataset.mobileView = view;
  for (const button of document.querySelectorAll('[data-mobile]')) {
    button.setAttribute('aria-pressed', button.dataset.mobile === view);
  }
  if (view === 'preview') void showPreview();
  else if (mobileLayout.matches) {
    viewer?.setOrbit(false);
    $('orbit').setAttribute('aria-pressed', 'false');
  }
}

function setFlat(message) {
  $('vehicle').hidden = true;
  flat.hidden = false;
  $('views').hidden = true;
  $('orbit').hidden = true;
  $('flat-note').textContent = message;
  $('flat-note').hidden = false;
  $('preview-badge').textContent = '2D';
  $('preview-message').hidden = true;
}

async function showPreview() {
  if (!atlas) return;
  const current = session;
  if (!current.model.preview || viewerFailed) {
    setFlat(viewerFailed && current.model.preview ? '3D 연결이 어려워 전개도로 미리 보여 드려요.' : '이 차종은 전개도 프리뷰를 지원해요.');
    return;
  }
  if (!viewer && $('preview-stage').clientWidth === 0) return;
  $('vehicle').hidden = false;
  flat.hidden = true;
  $('views').hidden = true;
  $('orbit').hidden = true;
  $('flat-note').hidden = true;
  $('preview-badge').textContent = '3D';
  $('preview-message').hidden = !!viewer;
  try {
    viewerRequest ??= import('./vehicle.js').then(module => module.createViewer($('vehicle')));
    viewer = await viewerRequest;
    if (session !== current || !atlas) return;
    viewer.setAtlas(atlas);
    viewer.updateTexture(texture.canvas);
    $('preview-message').hidden = true;
    $('views').hidden = false;
    $('orbit').hidden = false;
  } catch (error) {
    console.warn('Vehicle preview unavailable', error);
    viewerFailed = true;
    if (session === current) setFlat('3D를 불러올 수 없어 전개도로 미리 보여 드려요.');
  }
}

async function selectModel(model) {
  const version = ++loadVersion;
  uploadVersion++;
  atlas = null;
  pointer = null;
  sliderEdit = null;
  atlasCanvas.classList.remove('dragging', 'movable');
  $('model-name').textContent = model.name;
  $('model-variant').textContent = model.variant;
  $('atlas-message').hidden = false;
  $('atlas-message').textContent = '공식 전개도를 불러오는 중…';
  $('preview-message').textContent = '차량을 불러오는 중…';
  $('preview-message').hidden = false;
  $('vehicle').hidden = true;
  flat.hidden = true;
  $('views').hidden = true;
  $('orbit').hidden = true;
  $('flat-note').hidden = true;
  partsGrid.replaceChildren();
  $('count').textContent = '0개 선택';
  $('preview-badge').textContent = model.preview ? '3D' : '2D';
  document.querySelector('[data-mobile=preview]').textContent = model.preview ? '3D 프리뷰' : '디자인 프리뷰';
  $('active-image').hidden = true;
  transformTools.hidden = true;
  $('expand-parts').disabled = true;
  for (const id of ['undo', 'redo', 'reset', 'export', 'upload', 'apply-color']) $(id).disabled = true;
  for (const button of document.querySelectorAll('[data-group], .swatch')) button.disabled = true;
  atlasContext.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  setZoom(1);
  viewer?.setOrbit(false);
  $('orbit').setAttribute('aria-pressed', 'false');

  try {
    const existing = sessions.get(model.id);
    const layout = existing?.atlas || await loadTemplate(model);
    if (version !== loadVersion) return;
    atlas = layout;
    if (!existing) {
      const initial = layout.parts.find(part => part.id === 'hood') || layout.parts[0];
      const firstVisit = sessions.size === 0 && model === models[0];
      const colors = firstVisit ? Object.fromEntries(layout.parts.map(part => [
        part.id,
        part.id.startsWith('mirror-') ? '#868995' : '#cdd0d7',
      ])) : {};
      const layers = firstVisit ? [fitLayer(demoImage(), [initial])] : [];
      sessions.set(model.id, {
        model, atlas: layout, selected: new Set([initial.id]), colors, layers,
        active: layers.length - 1, undo: [], redo: [],
      });
    }
    session = sessions.get(model.id);
    const { width, height } = atlas;
    atlasCanvas.width = flat.width = width;
    atlasCanvas.height = flat.height = height;
    atlasCanvas.style.aspectRatio = width + ' / ' + height;
    atlasCanvas.style.setProperty('--atlas-ratio', width / height);
    texture = surface(width, height);
    scratch = surface(width, height);
    overlay = surface(width, height);
    $('dimensions').textContent = width + ' × ' + height;
    for (const part of atlas.parts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'part-button';
      button.dataset.part = part.id;
      const dot = document.createElement('span');
      dot.className = 'part-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.append(dot, part.label);
      partsGrid.append(button);
    }
    $('atlas-message').hidden = true;
    $('expand-parts').disabled = false;
    sync();
    void showPreview();
  } catch (error) {
    if (version !== loadVersion) return;
    console.warn('Tesla template unavailable', error);
    atlas = null;
    $('atlas-message').textContent = '공식 전개도를 불러오지 못했어요.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'pill secondary';
    retry.textContent = '다시 시도';
    retry.addEventListener('click', () => void selectModel(model));
    $('atlas-message').append(retry);
    $('preview-message').textContent = '전개도를 불러오면 프리뷰가 표시됩니다.';
  }
}

async function loadImage(file) {
  if (!file || !atlas || !session.selected.size) return;
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    toast('PNG, JPG, WebP 이미지를 선택해 주세요.');
    return;
  }
  const version = ++uploadVersion;
  const target = session;
  const parts = selectedParts();
  const url = URL.createObjectURL(file);
  try {
    const decoded = new Image();
    decoded.src = url;
    await decoded.decode();
    if (session !== target || version !== uploadVersion || !atlas) return;
    const ratio = Math.min(1, 2048 / Math.max(decoded.naturalWidth, decoded.naturalHeight));
    const { canvas, ctx } = surface(Math.max(1, Math.round(decoded.naturalWidth * ratio)), Math.max(1, Math.round(decoded.naturalHeight * ratio)));
    ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const asset = { image: canvas, name: file.name };
    setSelection(parts.map(part => part.id));
    transact(() => replaceSelectedWith(fitLayer(asset, parts)));
    if (mobileLayout.matches) {
      setMobile('atlas');
      $('workspace').scrollIntoView({ block: 'start' });
    }
    toast(parts.length + '개 파츠에 이미지를 적용했어요.');
  } catch {
    if (version === uploadVersion) toast('이미지를 열 수 없어요. 다른 파일을 선택해 주세요.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function point(event) {
  const rect = atlasCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * atlas.width / rect.width,
    y: (event.clientY - rect.top) * atlas.height / rect.height,
  };
}

function setZoom(value) {
  zoom = clamp(value, 1, 2);
  atlasCanvas.style.setProperty('--zoom', zoom);
  $('zoom-reset').textContent = Math.round(zoom * 100) + '%';
  $('zoom-out').disabled = zoom <= 1;
  $('zoom-in').disabled = zoom >= 2;
}

function blobFor(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
}

async function exportPNG() {
  if (!atlas || exporting) return;
  const exportModel = session.model;
  const { width, height } = atlas;
  const source = surface(width, height);
  renderTexture();
  source.ctx.drawImage(texture.canvas, 0, 0);
  exporting = true;
  $('export').disabled = true;
  try {
    let blob = await blobFor(source.canvas);
    for (const factor of [0.875, 0.75, 0.625, 0.5]) {
      if (blob.size <= 1_000_000) break;
      const w = Math.round(width * factor);
      const h = Math.round(height * factor);
      if (w < 512 || h < 512) continue;
      const reduced = surface(w, h);
      reduced.ctx.imageSmoothingQuality = 'high';
      reduced.ctx.drawImage(source.canvas, 0, 0, w, h);
      blob = await blobFor(reduced.canvas);
    }
    if (blob.size > 1_000_000) throw new Error('PNG exceeds 1 MB');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Wrap-' + exportModel.id + '.png';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    toast('PNG를 저장했어요 · ' + Math.ceil(blob.size / 1000) + ' KB');
  } catch (error) {
    console.warn(error);
    toast('1 MB 이내로 PNG를 저장하지 못했어요. 더 단순한 이미지로 시도해 주세요.');
  } finally {
    exporting = false;
    if (atlas) $('export').disabled = false;
  }
}

modelInput.replaceChildren(...models.map(model => new Option(
  model.name + (model.variant ? ' · ' + model.variant : ''),
  model.id,
)));
modelInput.addEventListener('change', () => void selectModel(models.find(model => model.id === modelInput.value)));
partsGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-part]');
  if (atlas && button) togglePart(button.dataset.part);
});
$('expand-parts').addEventListener('click', () => {
  const expanded = partsGrid.classList.toggle('expanded');
  $('expand-parts').setAttribute('aria-expanded', expanded);
  $('expand-parts').firstElementChild.textContent = expanded ? '파츠 목록 접기' : '파츠 목록 펼치기';
});
for (const button of document.querySelectorAll('[data-group]')) {
  button.addEventListener('click', () => {
    if (!atlas) return;
    setSelection(button.getAttribute('aria-pressed') === 'true' ? [] : groupMembers(button.dataset.group));
  });
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const tab of document.querySelectorAll('[data-mode]')) tab.setAttribute('aria-pressed', tab === button);
    $('image-tools').hidden = mode !== 'image';
    $('color-tools').hidden = mode !== 'color';
    sync(false);
  });
}
for (const [label, color] of swatchColors) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.dataset.color = color;
  button.title = label + ' ' + color.toUpperCase();
  button.setAttribute('aria-label', label);
  button.style.setProperty('--color', color);
  button.addEventListener('click', () => paint(color));
  $('swatches').append(button);
}
$('apply-color').addEventListener('click', () => paint($('picker').value));
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => {
  void loadImage(event.target.files[0]);
  event.target.value = '';
});
for (const target of [$('upload'), $('atlas-stage')]) {
  target.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (atlas && session.selected.size) $('upload').classList.add('dragging');
  });
  target.addEventListener('dragleave', () => $('upload').classList.remove('dragging'));
  target.addEventListener('drop', event => {
    event.preventDefault();
    $('upload').classList.remove('dragging');
    if (atlas && !session.selected.size) toast('이미지를 넣을 파츠를 먼저 선택해 주세요.');
    else void loadImage(event.dataTransfer.files[0]);
  });
}

$('delete-image').addEventListener('click', () => {
  const layer = activeForSelection();
  if (!layer) return;
  transact(() => {
    layer.parts = layer.parts.filter(id => !session.selected.has(id));
    if (layer.parts.length) return;
    session.layers.splice(session.active, 1);
    session.active = -1;
  });
});
$('fit-image').addEventListener('click', () => {
  const layer = activeForSelection();
  if (!layer) return;
  transact(() => Object.assign(layer, fitLayer(layer.asset, selectedParts())));
});
$('apply-image').addEventListener('click', () => {
  const layer = activeImage();
  if (!layer || !session.selected.size) return;
  transact(() => replaceSelectedWith(fitLayer(layer.asset, selectedParts())));
});

for (const id of ['scale', 'rotation']) {
  $(id).addEventListener('input', event => {
    const layer = activeForSelection();
    if (!layer) return;
    sliderEdit ??= snapshot();
    layer[id] = Number(event.target.value);
    updateRange(id, layer[id]);
    scheduleRender();
  });
  $(id).addEventListener('change', () => {
    if (!sliderEdit) return;
    saveUndo(sliderEdit);
    sliderEdit = null;
    sync(false);
  });
}

atlasCanvas.addEventListener('pointerdown', event => {
  if (!atlas || event.button !== 0 || pointer) return;
  const layer = mode === 'image' ? activeForSelection() : null;
  pointer = { id: event.pointerId, start: point(event), layer, x: layer?.x, y: layer?.y, before: null };
  atlasCanvas.setPointerCapture(event.pointerId);
});
atlasCanvas.addEventListener('pointermove', event => {
  if (!atlas || pointer?.id !== event.pointerId || !pointer.layer) return;
  const here = point(event);
  const dx = here.x - pointer.start.x;
  const dy = here.y - pointer.start.y;
  if (!pointer.before && Math.hypot(dx, dy) < 6) return;
  pointer.before ??= snapshot();
  pointer.layer.x = pointer.x + dx;
  pointer.layer.y = pointer.y + dy;
  atlasCanvas.classList.add('dragging');
  scheduleRender();
});
function endPointer(event) {
  if (!atlas || pointer?.id !== event.pointerId) return;
  if (pointer.before) {
    saveUndo(pointer.before);
    sync(false);
  } else if (event.type === 'pointerup') {
    const x = Math.floor(pointer.start.x);
    const y = Math.floor(pointer.start.y);
    const id = x >= 0 && x < atlas.width && y >= 0 && y < atlas.height ?
      atlas.ids[atlas.lookup[y * atlas.width + x] - 1] : null;
    if (id) togglePart(id);
  }
  pointer = null;
  atlasCanvas.classList.remove('dragging');
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) atlasCanvas.addEventListener(event, endPointer);
atlasCanvas.addEventListener('keydown', event => {
  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  const layer = activeForSelection();
  if (!atlas || !direction || !layer || mode !== 'image') return;
  event.preventDefault();
  const step = event.shiftKey ? 20 : 4;
  transact(() => {
    layer.x += direction[0] * step;
    layer.y += direction[1] * step;
  });
});

$('undo').addEventListener('click', () => restore('undo', 'redo'));
$('redo').addEventListener('click', () => restore('redo', 'undo'));
$('reset').addEventListener('click', () => {
  if (!atlas) return;
  transact(() => {
    session.colors = {};
    session.layers = [];
    session.active = -1;
  });
  toast('디자인을 초기화했어요.');
});
document.addEventListener('keydown', event => {
  if (!atlas || $('guide').open || event.target.closest?.('input, select, textarea') ||
    !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) restore('redo', 'undo');
  else restore('undo', 'redo');
});
$('export').addEventListener('click', () => void exportPNG());

$('guide-toggle').addEventListener('click', () => {
  guide = !guide;
  $('guide-toggle').setAttribute('aria-pressed', guide);
  scheduleRender(false);
});
$('zoom-out').addEventListener('click', () => setZoom(zoom - 0.25));
$('zoom-in').addEventListener('click', () => setZoom(zoom + 0.25));
$('zoom-reset').addEventListener('click', () => setZoom(1));
for (const button of document.querySelectorAll('[data-mobile]')) button.addEventListener('click', () => setMobile(button.dataset.mobile));
function placeTransformTools() {
  const target = mobileLayout.matches ? $('mobile-transform-slot') : $('active-image');
  target.append(transformTools);
}
mobileLayout.addEventListener('change', () => {
  placeTransformTools();
  void showPreview();
});
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    if (!viewer) return;
    viewer.setOrbit(false);
    $('orbit').setAttribute('aria-pressed', 'false');
    viewer.setView(button.dataset.view);
    for (const view of $('views').children) view.setAttribute('aria-pressed', view === button);
  });
}
$('orbit').addEventListener('click', () => {
  if (!viewer) return;
  const enabled = $('orbit').getAttribute('aria-pressed') !== 'true';
  viewer.setOrbit(enabled);
  $('orbit').setAttribute('aria-pressed', enabled);
  if (enabled) for (const view of $('views').children) view.setAttribute('aria-pressed', 'false');
});
for (const button of document.querySelectorAll('[data-guide]')) button.addEventListener('click', () => $('guide').showModal());
document.querySelector('[data-close]').addEventListener('click', () => $('guide').close());
$('guide').addEventListener('click', event => { if (event.target === $('guide')) $('guide').close(); });

placeTransformTools();
void selectModel(models[0]);
