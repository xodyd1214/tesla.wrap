import { loadTemplate, models, selectionBounds, surface } from './templates.js?v=2';
import { withProjectStore } from './projects.js';

const $ = id => document.getElementById(id);
const atlasCanvas = $('atlas');
const atlasContext = atlasCanvas.getContext('2d');
const vehicle = $('vehicle');
const flat = $('flat-preview');
const partsGrid = $('parts');
const modelInput = $('model');
const transformTools = $('transform-tools');
const basisButtons = document.querySelectorAll('[data-basis]');
const showProjectsButton = $('show-projects');
const projectDialog = $('projects');
const projectControls = $('project-controls');
const projectList = $('project-list');
const projectName = $('project-name');
const projectDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' });
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
const previewRequests = new Map();
let loadVersion = 0;
let uploadVersion = 0;
let mode = 'image';
let newImageBasis = 'atlas';
let guide = false;
let zoom = 1;
let frame = 0;
let textureDirty = false;
let pointer;
let placing = false;
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
  ctx.fillStyle = '#242424';
  ctx.fillRect(0, 0, 960, 780);
  const lines = [
    [-72, 90, '#424242'], [-16, 8, '#898989'], [5, 3, '#e8e8e8'],
    [28, 23, '#b9b9b9'], [54, 4, '#dedede'], [76, 9, '#707070'],
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

function fitLayer(asset, parts, projection = null) {
  if (projection) {
    const fit = viewer.fitProjection(asset, parts, projection);
    if (fit) return {
      asset, parts: parts.map(part => part.id),
      ...fit, scale: 100, rotation: 0,
    };
  }
  const bounds = selectionBounds(parts);
  const fit = Math.max(bounds.width / asset.image.width, bounds.height / asset.image.height);
  return {
    asset, parts: parts.map(part => part.id),
    x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
    fit, projection: null, scale: 100, rotation: 0, uprightInEditor: true,
  };
}

function snapshot(design = session) {
  return {
    colors: { ...design.colors },
    layers: design.layers.map(layer => ({ ...layer, parts: [...layer.parts] })),
    active: design.active,
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
  const projection = activeForSelection()?.projection;
  session[to].push(snapshot());
  Object.assign(session, session[from].pop());
  const restored = activeForSelection()?.projection;
  if (restored !== projection) placing = !!restored;
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

function placementBasis() {
  const layer = activeForSelection();
  if (layer) return layer.projection ? 'vehicle' : 'atlas';
  return session?.model.preview && flat.hidden ? newImageBasis : 'atlas';
}

function syncBasis() {
  const basis = placementBasis();
  for (const button of basisButtons) {
    button.disabled = !atlas || !session.selected.size ||
      button.dataset.basis === 'vehicle' && (!session.model.preview || !flat.hidden);
    button.setAttribute('aria-pressed', button.dataset.basis === basis);
  }
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

function setSelection(next, focusedPart) {
  const previous = activeForSelection();
  session.selected = new Set(next);
  const first = next[0];
  const focusedImage = getImageAt(focusedPart);
  if (focusedImage) {
    session.active = session.layers.indexOf(focusedImage);
  } else if (!activeForSelection()) {
    const target = next.find(id => getImageAt(id));
    const index = session.layers.indexOf(getImageAt(target));
    if (index >= 0) session.active = index;
  }
  const editable = activeForSelection();
  if (editable !== previous) placing = !!editable?.projection;
  if (first && session.colors[first]) $('picker').value = session.colors[first];
  sync(false);
}

function togglePart(id) {
  const next = new Set(session.selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection([...next], next.has(id) ? id : undefined);
}

function drawLayer(ctx, layer, dx = 0, dy = 0) {
  const { image } = layer.asset;
  const factor = layer.fit * layer.scale / 100;
  const width = image.width * factor;
  const height = image.height * factor;
  ctx.save();
  ctx.translate(layer.x - dx, layer.y - dy);
  // Artwork is upright on the rotated editor. Whole-template PNGs and older
  // projects already use the official orientation of the template pixels.
  ctx.rotate(layer.rotation * Math.PI / 180 + (layer.uprightInEditor ? Math.PI : 0));
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function renderTexture() {
  const { width, height, parts } = atlas;
  if (viewer && session.model.preview) viewer.setAtlas(atlas, session.model.id);
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
    if (layer?.projection) viewer.drawSurfaceLayer(ctx, layer, part);
    else if (layer) drawLayer(ctx, layer, part.x, part.y);
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
  const { width, height, mask } = part;
  const { canvas, ctx } = surface(width, height);
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#272727';
  ctx.fillRect(0, 0, width, height);

  // Inset both strokes so that adjacent selections keep their own edges.
  const offsets = [[0, -4], [3, -3], [4, 0], [3, 3], [0, 4], [-3, 3], [-4, 0], [-3, -3]];
  const inset = surface(width, height);
  inset.ctx.drawImage(mask, 0, 0);
  inset.ctx.globalCompositeOperation = 'source-in';
  inset.ctx.fillStyle = '#fff';
  inset.ctx.fillRect(0, 0, width, height);
  inset.ctx.globalCompositeOperation = 'destination-in';
  for (const [x, y] of offsets) inset.ctx.drawImage(mask, x, y);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(inset.canvas, 0, 0);

  for (const [x, y] of offsets) inset.ctx.drawImage(mask, x * 2, y * 2);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(inset.canvas, 0, 0);
  const tint = surface(width, height);
  tint.ctx.drawImage(mask, 0, 0);
  tint.ctx.globalCompositeOperation = 'source-in';
  tint.ctx.fillStyle = 'rgba(112, 112, 112, .18)';
  tint.ctx.fillRect(0, 0, width, height);
  part.selection = { outline: canvas, tint: tint.canvas };
  return part.selection;
}

function renderAtlas() {
  const { width, height } = atlas;
  const ctx = atlasContext;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = 'rgba(32, 32, 32, .24)';
  ctx.shadowBlur = 3;
  ctx.drawImage(texture.canvas, 0, 0);
  ctx.restore();
  const parts = selectedParts();
  const layer = mode === 'image' && guide ? activeForSelection() : null;
  const o = overlay.ctx;
  if (layer && !layer.projection) {
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
    ctx.drawImage(selection.outline, part.x, part.y);
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
  $('download-template').disabled = false;
  $('import-template').disabled = false;
  $('save-project-button').disabled = false;
  for (const button of partsGrid.children) {
    button.setAttribute('aria-pressed', session.selected.has(button.dataset.part));
  }
  $('select-all').disabled = !atlas.parts.length;
  $('select-all').setAttribute('aria-pressed', atlas.parts.length > 0 && atlas.parts.every(part => session.selected.has(part.id)));
  for (const button of $('swatches').children) {
    button.disabled = !session.selected.size;
    button.setAttribute('aria-pressed', session.selected.size > 0 &&
      [...session.selected].every(id => !getImageAt(id) && (session.colors[id] || '#ffffff') === button.dataset.color));
  }
  $('apply-color').disabled = !session.selected.size;
  const layer = activeImage();
  const editable = activeForSelection();
  const canMove = !!editable && !editable.projection && mode === 'image';
  atlasCanvas.classList.toggle('movable', canMove);
  $('atlas-hint').textContent = editable?.projection && mode === 'image' ? '차량 맞춤 · 프리뷰에서 끌어 이동' :
    canMove ? '원본 배치 · 전개도에서 끌어 이동' : '전개도에서 파츠 선택';
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
  syncBasis();
  syncPlacement();
  scheduleRender(dirty);
}

function syncPlacement() {
  const button = $('place-image');
  const layer = mode === 'image' ? activeForSelection() : null;
  button.hidden = $('views').hidden || !layer;
  const editing = !button.hidden && placing && !!layer.projection;
  button.setAttribute('aria-pressed', editing);
  button.textContent = editing ? '배치 완료' : layer?.projection ? '차량에서 이동' : '차량에 배치';
  vehicle.toggleAttribute('data-placing', editing);
  viewer?.setImageEditing(editing);
  if (editing) $('orbit').setAttribute('aria-pressed', 'false');
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
  syncBasis();
  syncPlacement();
}

function loadViewer(modelId) {
  let request = previewRequests.get(modelId);
  if (!request) {
    request = {};
    request.promise = import('./vehicle.js?v=10').then(module => module.createViewer(vehicle, modelId)).then(ready => {
      request.viewer = ready;
      return ready;
    }).catch(error => {
      previewRequests.delete(modelId);
      throw error;
    });
    previewRequests.set(modelId, request);
  }
  return request.promise;
}

async function showPreview(prepare = false) {
  if (!atlas) return;
  const current = session;
  const modelId = current.model.preview;
  if (!modelId) {
    setFlat('이 차종은 전개도 프리뷰를 지원해요.');
    return;
  }
  if (!prepare && !viewer && $('preview-stage').clientWidth === 0) return;
  $('vehicle').hidden = false;
  flat.hidden = true;
  $('views').hidden = true;
  $('orbit').hidden = true;
  $('flat-note').hidden = true;
  $('preview-badge').textContent = '3D';
  $('preview-message').hidden = !!viewer;
  try {
    const ready = await loadViewer(modelId);
    if (session !== current || !atlas) return;
    viewer = ready;
    if (viewer.mount()) {
      for (const view of $('views').children) view.setAttribute('aria-pressed', view.dataset.view === 'angle');
    }
    viewer.setAtlas(atlas, current.model.id);
    viewer.updateTexture(texture.canvas);
    $('preview-message').hidden = true;
    $('views').hidden = false;
    $('orbit').hidden = false;
    syncBasis();
    syncPlacement();
  } catch (error) {
    console.warn('Vehicle preview unavailable', error);
    if (session === current && atlas) setFlat('3D를 불러올 수 없어 전개도로 미리 보여 드려요.');
  }
}

async function currentProjection() {
  const target = session;
  if (!target.model.preview) return null;
  if ($('views').hidden) await showPreview(true);
  return atlas && session === target && !$('views').hidden ? viewer.getProjection() : null;
}

async function chooseBasis(basis) {
  if (!atlas || !session.selected.size || mode !== 'image') return;
  const version = ++uploadVersion;
  const layer = activeForSelection();
  if (!layer) {
    newImageBasis = basis;
    syncBasis();
    return;
  }
  if (basis === placementBasis()) return;
  const projection = basis === 'vehicle' ? await currentProjection() : null;
  if (version !== uploadVersion || layer !== activeForSelection() || mode !== 'image') return;
  const parts = atlas.parts.filter(part => layer.parts.includes(part.id));
  const replacement = layer.alternatePlacement || fitLayer(layer.asset, parts, projection);
  if (basis === 'vehicle' && (!projection || !replacement.projection)) {
    toast('이 파츠 조합에서는 차량 맞춤을 사용할 수 없어요.');
    return;
  }
  const { x, y, fit, scale, rotation, projection: previousProjection, uprightInEditor = false } = layer;
  const alternatePlacement = { x, y, fit, scale, rotation, projection: previousProjection, uprightInEditor };
  if (basis === 'vehicle' && !layer.alternatePlacement) {
    replacement.scale = scale;
    replacement.rotation = rotation;
  }
  placing = !!replacement.projection;
  newImageBasis = basis;
  transact(() => Object.assign(layer, { uprightInEditor: false }, replacement, { alternatePlacement }));
  if (mobileLayout.matches) {
    setMobile(placing ? 'preview' : 'atlas');
    $('workspace').scrollIntoView({ block: 'start' });
  }
}

async function selectModel(model, saved = null) {
  const version = ++loadVersion;
  uploadVersion++;
  atlas = null;
  pointer = null;
  placing = false;
  sliderEdit = null;
  atlasCanvas.classList.remove('dragging', 'movable');
  $('model-name').textContent = model.name;
  $('model-variant').textContent = model.variant;
  $('atlas-message').hidden = false;
  $('atlas-message').textContent = '공식 전개도를 불러오는 중…';
  $('preview-message').textContent = '차량을 불러오는 중…';
  $('preview-message').hidden = false;
  $('vehicle').hidden = true;
  if (model.preview !== session?.model.preview) vehicle.replaceChildren();
  flat.hidden = true;
  $('views').hidden = true;
  syncPlacement();
  $('orbit').hidden = true;
  $('flat-note').hidden = true;
  partsGrid.replaceChildren();
  $('count').textContent = '0개 선택';
  $('preview-badge').textContent = model.preview ? '3D' : '2D';
  document.querySelector('[data-mobile=preview]').textContent = model.preview ? '3D 프리뷰' : '디자인 프리뷰';
  $('active-image').hidden = true;
  transformTools.hidden = true;
  for (const id of ['undo', 'redo', 'reset', 'export', 'download-template', 'import-template', 'upload', 'apply-color', 'save-project-button']) $(id).disabled = true;
  $('select-all').disabled = true;
  syncBasis();
  for (const button of document.querySelectorAll('.swatch')) button.disabled = true;
  atlasContext.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  setZoom(1);
  viewer?.setOrbit(false);
  viewer = previewRequests.get(model.preview)?.viewer;
  $('orbit').setAttribute('aria-pressed', 'false');

  try {
    const existing = sessions.get(model.id);
    const layout = saved?.atlas || existing?.atlas || await loadTemplate(model);
    if (version !== loadVersion) return;
    atlas = layout;
    if (saved) {
      sessions.set(model.id, {
        ...saved, model, undo: existing ? [snapshot(existing)] : [], redo: [],
      });
    } else if (!existing) {
      const initial = layout.parts.find(part => part.id === 'hood') || layout.parts[0];
      const firstVisit = sessions.size === 0 && model === models[0];
      const colors = firstVisit ? Object.fromEntries(layout.parts.map(part => [
        part.id,
        part.id.startsWith('mirror-') ? '#808080' : '#d5d5d5',
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
    texture = surface(width, height, { willReadFrequently: true });
    scratch = surface(width, height);
    overlay = surface(width, height);
    $('dimensions').textContent = width + ' × ' + height;
    for (const part of atlas.parts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'part-button';
      button.dataset.part = part.id;
      const check = document.createElement('span');
      check.className = 'part-check';
      check.setAttribute('aria-hidden', 'true');
      button.append(check, part.label);
      partsGrid.append(button);
    }
    $('atlas-message').hidden = true;
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

async function loadImage(file, basis = placementBasis()) {
  const fullTemplate = basis === 'template';
  if (!file || !atlas || (!fullTemplate && !session.selected.size)) return;
  if (fullTemplate) {
    if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) {
      toast('작성한 도안을 PNG로 저장해 주세요.');
      return;
    }
  } else if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    toast('PNG, JPG, WebP 이미지를 선택해 주세요.');
    return;
  }
  const version = ++uploadVersion;
  const target = session;
  const parts = fullTemplate ? atlas.parts : selectedParts();
  const onVehicle = basis === 'vehicle';
  const url = URL.createObjectURL(file);
  try {
    const decoded = new Image();
    decoded.src = url;
    await decoded.decode();
    if (session !== target || version !== uploadVersion || !atlas) return;
    const { naturalWidth: width, naturalHeight: height } = decoded;
    if (fullTemplate && (width < 512 || height < 512 || width > atlas.width || height > atlas.height ||
      width * atlas.height !== height * atlas.width)) {
      toast('이 차종의 빈 도안과 같은 비율로 저장해 주세요. 원본 크기는 ' + atlas.width + ' × ' + atlas.height + '입니다.');
      return;
    }
    const ratio = Math.min(1, 2048 / Math.max(width, height));
    const { canvas, ctx } = surface(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const asset = { image: canvas, name: file.name };
    const projection = onVehicle ? await currentProjection() : null;
    if (session !== target || version !== uploadVersion || !atlas) return;
    const layer = fullTemplate ? {
      asset, parts: parts.map(part => part.id), x: atlas.width / 2, y: atlas.height / 2,
      fit: atlas.width / width, projection: null, scale: 100, rotation: 0,
    } : fitLayer(asset, parts, projection);
    setSelection(layer.parts);
    placing = !!layer.projection;
    transact(() => {
      if (fullTemplate) session.colors = {};
      replaceSelectedWith(layer);
    });
    if (fullTemplate && mode !== 'image') setTool('image');
    if (mobileLayout.matches) {
      setMobile(placing ? 'preview' : 'atlas');
      $('workspace').scrollIntoView({ block: 'start' });
    }
    if (fullTemplate) toast('도안을 전체 파츠에 적용했어요. 실행 취소로 이전 작업을 복원할 수 있어요.');
    else toast(onVehicle && !layer.projection ? '이 파츠 조합에는 원본 배치를 적용했어요.' : parts.length + '개 파츠에 이미지를 적용했어요.');
  } catch {
    if (version === uploadVersion) toast('이미지를 열 수 없어요. 다른 파일을 선택해 주세요.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function point(event) {
  const rect = atlasCanvas.getBoundingClientRect();
  return {
    x: (rect.right - event.clientX) * atlas.width / rect.width,
    y: (rect.bottom - event.clientY) * atlas.height / rect.height,
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

async function saveProject(name) {
  const design = snapshot();
  const modelId = session.model.id;
  const selected = [...session.selected];
  const assets = [...new Set(design.layers.map(layer => layer.asset))];
  const layers = design.layers.map(({ asset, ...layer }) => ({ ...layer, asset: assets.indexOf(asset) }));
  const images = await Promise.all(assets.map(async asset => ({ name: asset.name, blob: await blobFor(asset.image) })));
  const project = { ...design, layers, images, name, modelId, selected, savedAt: Date.now() };
  const id = await withProjectStore('readwrite', store => store.add(project));
  return { id, ...project };
}

async function openProject(id) {
  const saved = await withProjectStore('readonly', store => store.get(id));
  const model = models.find(candidate => candidate.id === saved?.modelId);
  if (!model) throw new Error('Saved model unavailable');
  if (saved.layers.some(layer => layer.projection)) {
    try {
      await loadViewer(model.preview);
    } catch {
      $('project-status').textContent = '이 작업의 이미지 배치를 열려면 3D 프리뷰를 불러와야 해요.';
      return;
    }
  }
  const layout = sessions.get(model.id)?.atlas || await loadTemplate(model);
  const assets = await Promise.all(saved.images.map(async ({ name, blob }) => {
    const bitmap = await createImageBitmap(blob);
    try {
      const { canvas, ctx } = surface(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      return { name, image: canvas };
    } finally {
      bitmap.close();
    }
  }));
  if (!projectDialog.open) return;
  modelInput.value = model.id;
  await selectModel(model, {
    atlas: layout, colors: saved.colors, selected: new Set(saved.selected), active: saved.active,
    layers: saved.layers.map(layer => ({ ...layer, asset: assets[layer.asset] })),
  });
  projectDialog.close();
  toast('‘' + saved.name + '’ 작업을 열었어요.');
}

async function runProjectAction(action, pending, failure) {
  if (projectControls.disabled) return;
  projectControls.disabled = true;
  showProjectsButton.disabled = true;
  $('project-status').textContent = pending;
  try {
    await action();
  } catch (error) {
    console.warn('Saved project operation failed', error);
    $('project-status').textContent = failure;
  } finally {
    projectControls.disabled = false;
    showProjectsButton.disabled = false;
  }
}

function projectRow({ id, name, modelId, savedAt }) {
  const row = document.createElement('li');
  const details = document.createElement('div');
  details.className = 'project-details';
  const title = document.createElement('strong');
  title.textContent = name;
  const metadata = document.createElement('small');
  const model = models.find(candidate => candidate.id === modelId);
  metadata.textContent = [model?.name || modelId, model?.variant, projectDate.format(savedAt)].filter(Boolean).join(' · ');
  details.append(title, metadata);
  const open = document.createElement('button');
  open.className = 'small-pill secondary';
  open.type = 'button';
  open.textContent = '열기';
  open.setAttribute('aria-label', name + ' 열기');
  open.addEventListener('click', () => void runProjectAction(() => openProject(id), '작업을 불러오는 중…', '작업을 열지 못했어요. 다시 시도해 주세요.'));
  const remove = document.createElement('button');
  remove.className = 'small-pill';
  remove.type = 'button';
  remove.textContent = '삭제';
  remove.setAttribute('aria-label', name + ' 삭제');
  remove.addEventListener('click', () => {
    if (!confirm('‘' + name + '’ 작업을 삭제할까요?')) return;
    void runProjectAction(async () => {
      await withProjectStore('readwrite', store => store.delete(id));
      row.remove();
      $('project-status').textContent = '저장한 작업을 삭제했어요.';
    }, '작업을 삭제하는 중…', '작업을 삭제하지 못했어요.');
  });
  row.append(details, open, remove);
  return row;
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
    downloadBlob(blob, 'Wrap-' + exportModel.id + '.png');
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
$('select-all').addEventListener('click', event => {
  if (!atlas) return;
  setSelection(event.currentTarget.getAttribute('aria-pressed') === 'true' ? [] : atlas.parts.map(part => part.id));
});

function setTool(next) {
  mode = next;
  for (const tab of document.querySelectorAll('[data-mode]')) tab.setAttribute('aria-pressed', tab.dataset.mode === mode);
  $('image-tools').hidden = mode !== 'image';
  $('color-tools').hidden = mode !== 'color';
  sync(false);
}
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => setTool(button.dataset.mode));
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
for (const button of basisButtons) button.addEventListener('click', () => {
  if (mode !== 'image') setTool('image');
  void chooseBasis(button.dataset.basis);
});
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => {
  void loadImage(event.target.files[0]);
  event.target.value = '';
});
$('download-template').addEventListener('click', () => {
  if (atlas) downloadBlob(atlas.blank, 'Template-' + session.model.id + '.png');
});
$('import-template').addEventListener('click', () => $('template-file').click());
$('template-file').addEventListener('change', event => {
  void loadImage(event.target.files[0], 'template');
  event.target.value = '';
});
for (const target of [$('upload'), $('atlas-stage'), vehicle]) {
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
    else void loadImage(event.dataTransfer.files[0], target === vehicle ? 'vehicle' :
      target === $('atlas-stage') ? 'atlas' : placementBasis());
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
  transact(() => Object.assign(layer, fitLayer(layer.asset, selectedParts(), layer.projection)));
});
$('apply-image').addEventListener('click', async () => {
  const layer = activeImage();
  if (!layer || !session.selected.size) return;
  const version = ++uploadVersion;
  const selection = session.selected;
  const parts = selectedParts();
  const onVehicle = placementBasis() === 'vehicle';
  const projection = onVehicle ? layer.projection || await currentProjection() : null;
  if (version !== uploadVersion || layer !== activeImage() || selection !== session.selected || mode !== 'image') return;
  const replacement = fitLayer(layer.asset, parts, projection);
  placing = !!replacement.projection;
  transact(() => replaceSelectedWith(replacement));
  if (placing && mobileLayout.matches) setMobile('preview');
  if (onVehicle && !replacement.projection) toast('이 파츠 조합에는 원본 배치를 적용했어요.');
});

$('place-image').addEventListener('click', () => {
  const layer = activeForSelection();
  if (!layer || !viewer) return;
  if (layer.projection) {
    placing = !placing;
    syncPlacement();
    return;
  }
  void chooseBasis('vehicle');
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
  const active = mode === 'image' ? activeForSelection() : null;
  const layer = active?.projection ? null : active;
  pointer = { source: atlasCanvas, id: event.pointerId, start: point(event), layer, x: layer?.x, y: layer?.y, before: null };
  atlasCanvas.setPointerCapture(event.pointerId);
});
atlasCanvas.addEventListener('pointermove', event => {
  if (!atlas || pointer?.source !== atlasCanvas || pointer.id !== event.pointerId || !pointer.layer) return;
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

vehicle.addEventListener('pointerdown', event => {
  if (!atlas || event.button !== 0 || pointer || mode !== 'image' || $('views').hidden) return;
  if (!vehicle.hasAttribute('data-placing')) return;
  const layer = activeForSelection();
  if (!layer?.projection) return;
  const hit = layer.projection.front ? viewer.hitSurface(event.clientX, event.clientY) : null;
  // Claim this drag before OrbitControls receives the same pointer.
  event.stopPropagation();
  viewer.setOrbit(false);
  $('orbit').setAttribute('aria-pressed', 'false');
  pointer = {
    source: vehicle, id: event.pointerId, start: { x: event.clientX, y: event.clientY },
    layer, x: layer.x, y: layer.y, axes: viewer.dragAxes(layer.projection, layer.parts.includes(hit?.part) ? hit.point : null), before: null,
  };
  vehicle.setPointerCapture(event.pointerId);
}, true);
vehicle.addEventListener('pointermove', event => {
  if (!atlas || pointer?.source !== vehicle || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.start.x;
  const dy = event.clientY - pointer.start.y;
  if (!pointer.before && Math.hypot(dx, dy) < 4) return;
  pointer.before ??= snapshot();
  const { xx, xy, yx, yy } = pointer.axes;
  pointer.layer.x = pointer.x + dx * xx + dy * xy;
  pointer.layer.y = pointer.y + dx * yx + dy * yy;
  scheduleRender();
});

function endPointer(event) {
  if (!atlas || pointer?.source !== event.currentTarget || pointer.id !== event.pointerId) return;
  if (pointer.before) {
    saveUndo(pointer.before);
    sync(false);
  } else if (event.type === 'pointerup' && pointer.source === atlasCanvas) {
    const x = Math.floor(pointer.start.x);
    const y = Math.floor(pointer.start.y);
    const id = x >= 0 && x < atlas.width && y >= 0 && y < atlas.height ?
      atlas.ids[atlas.lookup[y * atlas.width + x] - 1] : null;
    if (id) togglePart(id);
  }
  pointer = null;
  atlasCanvas.classList.remove('dragging');
}
for (const target of [atlasCanvas, vehicle]) {
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(event, endPointer);
  target.addEventListener('keydown', nudgeImage);
}
function nudgeImage(event) {
  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  const layer = activeForSelection();
  if (!atlas || !direction || !layer || mode !== 'image') return;
  if (layer.projection ? !event.currentTarget.hasAttribute('data-placing') : event.currentTarget !== atlasCanvas) return;
  event.preventDefault();
  const step = event.shiftKey ? 20 : 4;
  const [dx, dy] = direction.map(axis => axis * step);
  transact(() => {
    if (layer.projection) {
      const { xx, xy, yx, yy } = viewer.dragAxes(layer.projection);
      layer.x += dx * xx + dy * xy;
      layer.y += dx * yx + dy * yy;
    } else {
      layer.x -= dx;
      layer.y -= dy;
    }
  });
}

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
  if (!atlas || $('guide').open || projectDialog.open || event.target.closest?.('input, select, textarea') ||
    !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) restore('redo', 'undo');
  else restore('undo', 'redo');
});
$('export').addEventListener('click', () => void exportPNG());

showProjectsButton.addEventListener('click', () => {
  projectDialog.showModal();
  void runProjectAction(async () => {
    const saved = await withProjectStore('readonly', store => store.getAll());
    saved.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
    projectList.replaceChildren(...saved.map(projectRow));
    $('project-status').textContent = saved.length ? '' : '아직 저장한 작업이 없어요.';
  }, '저장한 작업을 불러오는 중…', '브라우저 저장소를 열지 못했어요.');
});
$('close-projects').addEventListener('click', () => projectDialog.close());
$('save-project').addEventListener('submit', event => {
  event.preventDefault();
  const name = projectName.value.trim();
  if (!atlas || !name) return;
  void runProjectAction(async () => {
    const saved = await saveProject(name);
    projectList.prepend(projectRow(saved));
    projectName.value = '';
    $('project-status').textContent = '이 브라우저에 작업을 저장했어요.';
  }, '작업을 저장하는 중…', '작업을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
});

$('guide-toggle').addEventListener('click', () => {
  guide = !guide;
  $('guide-toggle').setAttribute('aria-pressed', guide);
  scheduleRender(false);
});
$('zoom-out').addEventListener('click', () => setZoom(zoom - 0.25));
$('zoom-in').addEventListener('click', () => setZoom(zoom + 0.25));
$('zoom-reset').addEventListener('click', () => setZoom(1));
for (const button of document.querySelectorAll('[data-mobile]')) button.addEventListener('click', () => setMobile(button.dataset.mobile));

const previewPane = $('preview-pane');
const previewDialog = $('preview-fullscreen');
const previewSibling = previewPane.nextElementSibling;
const expandPreview = $('expand-preview');
expandPreview.addEventListener('click', () => {
  previewDialog.append(previewPane);
  previewDialog.showModal();
});
$('close-preview').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('close', () => {
  previewSibling.before(previewPane);
  expandPreview.focus({ preventScroll: true });
});

function placeTransformControls() {
  $(mobileLayout.matches ? 'mobile-transform-slot' : 'active-image').append(transformTools);
}
mobileLayout.addEventListener('change', () => {
  placeTransformControls();
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
  placing = false;
  syncPlacement();
  const enabled = $('orbit').getAttribute('aria-pressed') !== 'true';
  viewer.setOrbit(enabled);
  $('orbit').setAttribute('aria-pressed', enabled);
  if (enabled) for (const view of $('views').children) view.setAttribute('aria-pressed', 'false');
});
for (const button of document.querySelectorAll('[data-guide]')) button.addEventListener('click', () => $('guide').showModal());
document.querySelector('[data-close]').addEventListener('click', () => $('guide').close());
$('guide').addEventListener('click', event => { if (event.target === $('guide')) $('guide').close(); });

placeTransformControls();
void selectModel(models[0]);
