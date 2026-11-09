import { surface } from './templates.js';

function partOutline(width, height, mask) {
  const { canvas, ctx } = surface(width, height);
  const edge = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = mask[i + 3];
      if (!alpha) continue;
      const inner = Math.min(x ? mask[i - 1] : 0, x + 1 < width ? mask[i + 7] : 0,
        y ? mask[i - width * 4 + 3] : 0, y + 1 < height ? mask[i + width * 4 + 3] : 0);
      edge.data[i] = edge.data[i + 1] = edge.data[i + 2] = 55;
      edge.data[i + 3] = Math.max(0, alpha - inner);
    }
  }
  ctx.putImageData(edge, 0, 0);
  return canvas;
}

export function createDrawingBoard(root, { commit, preview }) {
  const get = id => root.querySelector('#' + id);
  const canvas = get('drawing-canvas');
  const ctx = canvas.getContext('2d');
  const stage = get('drawing-stage');
  const widthInput = get('drawing-width');
  const toolButtons = root.querySelectorAll('[data-drawing-tool]');
  let part, ink, background, outline, maskPixels, inverse, stroke;
  let tool = 'pen';
  let turns = 0;
  let frame = 0;

  function render() {
    frame = 0;
    if (!part || !stage.clientWidth || !stage.clientHeight) return;
    const density = Math.min(devicePixelRatio, 2);
    const w = Math.round(stage.clientWidth * density);
    const h = Math.round(stage.clientHeight * density);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const padding = Math.min(w, h) * .075;
    const scale = Math.min((w - 2 * padding) / (turns % 2 ? part.height : part.width),
      (h - 2 * padding) / (turns % 2 ? part.width : part.height));

    ctx.resetTransform();
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((turns + 2) * Math.PI / 2);
    ctx.scale(scale, scale);
    ctx.translate(-part.width / 2, -part.height / 2);
    inverse = ctx.getTransform().inverse();
    ctx.drawImage(part.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(background.canvas, 0, 0);
    const drawn = stroke?.canvas || ink;
    if (drawn) ctx.drawImage(drawn, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(outline, 0, 0);
    ctx.restore();
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function setTurns(value) {
    turns = (value + 4) % 4;
    inverse = null;
    get('drawing-angle').textContent = turns * 90 + '°';
    requestDraw();
  }

  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return new DOMPoint((event.clientX - rect.left) * canvas.width / rect.width,
      (event.clientY - rect.top) * canvas.height / rect.height).matrixTransform(inverse);
  }

  function mark(point) {
    const { ctx: pen, last, width } = stroke;
    if (last?.x === point.x && last.y === point.y) return;
    pen.beginPath();
    if (last) {
      pen.moveTo(last.x, last.y);
      pen.lineTo(point.x, point.y);
      pen.stroke();
    } else {
      pen.arc(point.x, point.y, width / 2, 0, 2 * Math.PI);
      pen.fill();
    }
    stroke.last = point;
    requestDraw();
    preview();
  }

  canvas.addEventListener('pointerdown', event => {
    if (!part || !inverse || stroke || event.button !== 0 || (tool === 'eraser' && !ink)) return;
    const point = position(event);
    const x = Math.floor(point.x), y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= part.width || y >= part.height ||
      maskPixels[(y * part.width + x) * 4 + 3] < 128) return;
    const work = surface(part.width, part.height);
    if (ink) work.ctx.drawImage(ink, 0, 0);
    const width = Number(widthInput.value);
    Object.assign(work.ctx, {
      globalCompositeOperation: tool === 'eraser' ? 'destination-out' : 'source-over',
      strokeStyle: get('drawing-color').value, fillStyle: get('drawing-color').value,
      lineWidth: width, lineCap: 'round', lineJoin: 'round',
    });
    stroke = { ...work, width, id: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    mark(point);
  });
  canvas.addEventListener('pointermove', event => {
    if (stroke?.id !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) mark(position(sample));
  });
  canvas.addEventListener('pointerup', event => {
    if (stroke?.id !== event.pointerId) return;
    mark(position(event));
    const finished = stroke.canvas;
    stroke = null;
    commit(part, finished);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (stroke?.id !== event.pointerId) return;
      stroke = null;
      requestDraw();
      preview();
    });
  }

  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      tool = button.dataset.drawingTool;
      for (const option of toolButtons) option.setAttribute('aria-pressed', option === button);
    });
  }
  for (const button of root.querySelectorAll('[data-drawing-turn]')) {
    button.addEventListener('click', () => { if (!stroke) setTurns(turns + Number(button.dataset.drawingTurn)); });
  }
  get('drawing-angle').addEventListener('click', () => { if (!stroke) setTurns(0); });
  get('drawing-clear').addEventListener('click', () => { if (part && !stroke) commit(part, null); });
  widthInput.addEventListener('input', () => { get('drawing-width-value').textContent = widthInput.value + ' px'; });
  new ResizeObserver(requestDraw).observe(stage);

  return {
    show(next, nextInk) {
      const partChanged = part !== next;
      if (!partChanged && ink === nextInk) return false;
      if (stroke) {
        stroke = null;
        preview();
      }
      if (partChanged) {
        background = next ? surface(next.width, next.height) : null;
        maskPixels = next?.mask.getContext('2d').getImageData(0, 0, next.width, next.height).data;
        outline = next ? partOutline(next.width, next.height, maskPixels) : null;
        setTurns(0);
      }
      part = next;
      ink = nextInk;
      canvas.hidden = !part;
      get('drawing-message').hidden = !!part;
      get('drawing-tools').disabled = !part;
      get('drawing-clear').disabled = !ink;
      get('drawing-part').textContent = part?.label || '';
      requestDraw();
      return partChanged && !!part;
    },
    setBackground(target, source) {
      if (part !== target) return;
      const { width, height } = target;
      background.ctx.clearRect(0, 0, width, height);
      background.ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
      requestDraw();
    },
    draft(target) {
      return part === target ? stroke?.canvas : undefined;
    },
  };
}
