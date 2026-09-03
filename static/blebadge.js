// Real device-captured GIF previews for animations 1-16 (indices 0, 17, 18 have
// no captured GIF and fall back to a procedural placeholder preview).
// see gifs/gifs.js

// ═══════════════════════════════════════════════════════════
// App state
// ═══════════════════════════════════════════════════════════
const led = new LedShow();
if (!navigator.bluetooth) document.getElementById('no-bt-warning').style.display = 'block';

const pixels = new Array(12).fill(null).map(() => new Uint8Array(48)); // preview buffer

// Preview canvas
const CELL = 10;
const prevCanvas = document.getElementById('preview-canvas');
const prevCtx = prevCanvas.getContext('2d');
prevCanvas.width = 48 * CELL; prevCanvas.height = 12 * CELL;
function resizePreview() {
  const maxW = Math.min(window.innerWidth - 32, 560);
  prevCanvas.style.width = maxW + 'px';
  prevCanvas.style.height = (maxW * 12/48) + 'px';
}
resizePreview();
window.addEventListener('resize', resizePreview);

function renderPreview() {
  prevCtx.fillStyle = '#000'; prevCtx.fillRect(0,0,prevCanvas.width,prevCanvas.height);
  for (let r=0;r<12;r++) for (let c=0;c<48;c++) {
    prevCtx.fillStyle = pixels[r][c] ? '#FF3333' : '#1A1A1A';
    prevCtx.fillRect(c*CELL+1, r*CELL+1, CELL-2, CELL-2);
  }
}
function setPixels(frame) { for (let r=0;r<12;r++) for (let c=0;c<48;c++) pixels[r][c] = frame[r]?.[c] ? 1 : 0; renderPreview(); }
function clearPixels() { for (let r=0;r<12;r++) pixels[r].fill(0); renderPreview(); }
renderPreview();

// Toast
let toastTimer;
function toast(msg, dur = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ═══════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════
const btnConn = document.getElementById('btn-conn');
const connDot = document.getElementById('conn-dot');
const connTxt = document.getElementById('conn-txt');

function setConnState(state, msg) {
  connDot.className = state;
  connTxt.textContent = msg;
  const isConn = state === 'on';
  document.querySelectorAll('.send-btn:not(.stop)').forEach(b => b.disabled = !isConn);
  btnConn.textContent = isConn ? 'DISCONNECT' : 'CONNECT';
}

let freeModeReady = false;
function ensureFreeMode() {
  if (!led.connected) return Promise.resolve();
  if (freeModeReady) return Promise.resolve();
  freeModeReady = true;
  return led.freeMode().catch(e => { freeModeReady = false; throw e; });
}

btnConn.addEventListener('click', async () => {
  if (led.connected) {
    await led.disconnect();
    freeModeReady = false;
    setConnState('', 'not connected'); toast('Disconnected');
    return;
  }
  try {
    setConnState('busy', 'connecting…'); btnConn.disabled = true;
    const name = await led.connect(() => { setConnState('err', 'disconnected'); toast('Connection lost'); freeModeReady = false; });
    await led.freeMode();
    freeModeReady = true;
    setConnState('on', name); toast(`Connected: ${name}`);
  } catch (e) {
    setConnState('', 'not connected'); toast(e.message?.includes('cancelled') ? 'Cancelled' : 'Connection failed: ' + e.message);
    console.error(e);
  } finally { btnConn.disabled = false; }
});

// ═══════════════════════════════════════════════════════════
// Tabs
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + tab).classList.add('active');
    document.getElementById('preview-area').classList.toggle('hidden', tab === 'anim');
    if (tab === 'anim') renderAnimPreviews();
    if (tab === 'draw') { syncDrawCanvas(); await led.uploadBitmap(drawPixels, 1); }
  });
});

// ═══════════════════════════════════════════════════════════
// Effect pills (shared)
// ═══════════════════════════════════════════════════════════
const EFFECTS = [
  { label:'Static', key:'STATIC' }, { label:'← Left', key:'LEFT' },
  { label:'→ Right', key:'RIGHT' }, { label:'↑ Up', key:'UP' },
  { label:'↓ Down', key:'DOWN' }, { label:'❄ Snow', key:'SNOW' },
  { label:'Scroll', key:'SCROLL' }, { label:'Laser', key:'LASER' },
];
function buildEffectPills(containerId, defaultKey) {
  const row = document.getElementById(containerId);
  EFFECTS.forEach(e => {
    const d = document.createElement('div');
    d.className = 'pill' + (e.key === defaultKey ? ' active' : '');
    d.textContent = e.label; d.dataset.effect = e.key;
    d.addEventListener('click', () => { row.querySelectorAll('.pill').forEach(p => p.classList.remove('active')); d.classList.add('active'); led.setEffect(getSelectedEffect(containerId)); });
    row.appendChild(d);
  });
}
buildEffectPills('text-effect-row', 'LEFT');
buildEffectPills('draw-effect-row', 'STATIC');
function getSelectedEffect(rowId) {
  const el = document.querySelector(`#${rowId} .pill.active`);
  return el ? LedShow.EFFECT[el.dataset.effect] : LedShow.EFFECT.STATIC;
}

// Sliders
function bindSlider(id, lblId, suffix = '', fn = null) {
  const sl = document.getElementById(id), lb = document.getElementById(lblId);
  sl.addEventListener('input', () => lb.textContent = sl.value + suffix);
  if (fn != null) 
    sl.addEventListener('change', async() => { try {await fn(parseInt(sl.value))} catch {}} );
}
bindSlider('sl-text-bright','lbl-text-bright', '%', (val) => led.setBrightness(val));
bindSlider('sl-text-speed','lbl-text-speed', '%', (val) => led.setSpeed(val));
bindSlider('sl-draw-bright','lbl-draw-bright', '%', (val) => led.setBrightness(val));
bindSlider('sl-draw-speed','lbl-draw-speed', '%', (val) => led.setSpeed(val));
bindSlider('sl-anim-bright','lbl-anim-bright', '%', (val) => led.setBrightness(val));
bindSlider('sl-music-gain','lbl-music-gain', 'x');

// ═══════════════════════════════════════════════════════════
// TEXT TAB — render text to a bitmap
// ═══════════════════════════════════════════════════════════
function renderTextToWideMatrix(text) {
  // Renders text to an offscreen canvas taller/wider than the badge, at 4x
  // resolution, then downsamples to a 12-row-high strip whose width scales
  // with the text length (for scrolling).
  const scale = 4;
  const h = 12 * scale;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `bold ${Math.floor(h * 1.1)}px "Trebuchet MS", sans-serif`;
  mctx.imageSmoothingEnabled = false;
  const textW = Math.max(mctx.measureText(text || ' ').width + h, 48*scale);
  const w = Math.ceil(textW);

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(h * 1.1)}px "Trebuchet MS", sans-serif`;
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = 'middle';
  ctx.fillText(text || ' ', h*0.1, h/1.8);
  const img = ctx.getImageData(0,0,w,h);
  const cols = Math.round(w/scale);
  const frame = new Array(12).fill(null).map(() => new Uint8Array(cols));
  for (let r=0;r<12;r++) {
    for (let c=0;c<cols;c++) {
      const pr = Math.min(h-1, r*scale + Math.floor(scale/2));
      const pc = Math.min(w-1, c*scale + Math.floor(scale/2));
      frame[r][c] = img.data[(pr*w+pc)*4] > 90 ? 1 : 0;
    }
  }
  return frame; // frame[row] has `cols` columns (cols >= 48)
}

function windowFrame(wideFrame, offset) {
  const cols = wideFrame[0].length;
  const frame = new Array(12).fill(null).map(() => new Uint8Array(48));
  for (let r=0;r<12;r++) {
    for (let c=0;c<48;c++) {
      const src = (offset + c) % cols;
      frame[r][c] = wideFrame[r][src];
    }
  }
  return frame;
}

document.getElementById('text-input').addEventListener('input', function(){
  if (!this.value.trim()) return clearPixels();
  const wide = renderTextToWideMatrix(this.value);
  setPixels(windowFrame(wide, 0));
});

document.getElementById('btn-send-text').addEventListener('click', async () => {
  const text = document.getElementById('text-input').value.trim();
  if (!text) return toast('Type something first');
  const bright = parseInt(document.getElementById('sl-text-bright').value);
  const speed  = parseInt(document.getElementById('sl-text-speed').value);
  const effect = getSelectedEffect('text-effect-row');

    try {
      await led.setBrightness(bright);
      const matrix12 = renderTextToWideMatrix(text);
      const result = await led.uploadBitmap(matrix12, 1, effect, speed, bright);
      if (result.bitmapAcked) {
        toast('Device confirmed the upload — check the badge. Report back either way!', 4500);
      } else {
        toast('Upload sent, but no confirmation from the device — check the badge and report what you see.', 4500);
      }
      // console.log('Upload ACK detail:', result);
    } catch (e) {
      toast('Upload failed: ' + e.message, 4000);
      console.error('Upload error (this detail is useful to report):', e);
    }
});

// ═══════════════════════════════════════════════════════════
// FREE DRAW TAB
// ═══════════════════════════════════════════════════════════
const drawCanvas = document.getElementById('draw-canvas');
const dCtx = drawCanvas.getContext('2d');
const drawPixels = new Array(12).fill(null).map(() => new Uint8Array(48));
let drawing = false;
let drawTool = 'draw';

function syncDrawCanvas() {
  dCtx.fillStyle = '#000'; dCtx.fillRect(0,0,48,12);
  for (let r=0;r<12;r++) for (let c=0;c<48;c++) {
    drawPixels[r][c] = pixels[r][c];
    dCtx.fillStyle = pixels[r][c] ? '#FF3333' : '#1A1A1A';
    dCtx.fillRect(c,r,1,1);
  }
}
syncDrawCanvas();

function paintAt(e, touch = false) {
  const wrap = document.getElementById('draw-canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const cx = touch ? e.touches[0].clientX : e.clientX;
  const cy = touch ? e.touches[0].clientY : e.clientY;
  const col = Math.floor((cx - rect.left) / rect.width * 48);
  const row = Math.floor((cy - rect.top) / rect.height * 12);
  if (row<0||row>=12||col<0||col>=48) return;
  const on = drawTool === 'draw' ? 1 : 0;
  if (drawPixels[row][col] === on) return; // no change, skip redundant BLE write
  drawPixels[row][col] = on;
  dCtx.fillStyle = on ? '#FF3333' : '#1A1A1A';
  dCtx.fillRect(col,row,1,1);
  pixels[row][col] = on;
  renderPreview();

  if (led.connected) {
    ensureFreeMode()
      .then(() => led.drawPixel(row, col, !!on))
      .catch(e => console.error('live draw write failed', e));
  }
}
const dWrap = document.getElementById('draw-canvas-wrap');
dWrap.addEventListener('mousedown', e => { drawing = true; paintAt(e); });
dWrap.addEventListener('mousemove', e => { if (drawing) paintAt(e); });
window.addEventListener('mouseup', () => drawing = false);
dWrap.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; paintAt(e,true); }, {passive:false});
dWrap.addEventListener('touchmove', e => { e.preventDefault(); if (drawing) paintAt(e,true); }, {passive:false});
dWrap.addEventListener('touchend', () => drawing = false);
dWrap.addEventListener('contextmenu', e => e.preventDefault());

function pushFullFrameIfLive() {
  if (led.connected) {
    ensureFreeMode()
      .then(() => led.drawFrame(drawPixels))
      .catch(e => console.error('live frame push failed', e));
  }
}

document.getElementById('tool-draw').addEventListener('click', () => {
  drawTool = 'draw';
  document.getElementById('tool-draw').classList.add('active');
  document.getElementById('tool-erase').classList.remove('active');
});
document.getElementById('tool-erase').addEventListener('click', () => {
  drawTool = 'erase';
  document.getElementById('tool-erase').classList.add('active');
  document.getElementById('tool-draw').classList.remove('active');
});
document.getElementById('tool-clear').addEventListener('click', () => {
  for (let r=0;r<12;r++) drawPixels[r].fill(0);
  clearPixels(); syncDrawCanvas(); led.clearFrame();
});
document.getElementById('tool-invert').addEventListener('click', () => {
  for (let r=0;r<12;r++) for (let c=0;c<48;c++) { drawPixels[r][c] ^= 1; pixels[r][c] = drawPixels[r][c]; }
  syncDrawCanvas(); renderPreview();
  pushFullFrameIfLive();
});
document.getElementById('tool-save').addEventListener('click', () => {
  const out = document.createElement('canvas');
  out.width = 48; out.height = 12;
  const octx = out.getContext('2d');
  octx.fillStyle = '#000'; octx.fillRect(0,0,48,12);
  octx.fillStyle = '#fff';
  for (let r=0;r<12;r++) for (let c=0;c<48;c++) if (drawPixels[r][c]) octx.fillRect(c,r,1,1);
  const a = document.createElement('a');
  a.download = 'ledshow-drawing.png';
  a.href = out.toDataURL('image/png');
  a.click();
});
document.getElementById('load-png').addEventListener('change', function(){
  const file = this.files[0]; if (!file) return;
  const img = new Image();
  img.onload = async () => {
    const off = document.createElement('canvas'); off.width = 48; off.height = 12;
    const octx = off.getContext('2d');
    octx.fillStyle = '#000'; octx.fillRect(0,0,48,12);
    octx.drawImage(img, 0, 0, 48, 12);
    const data = octx.getImageData(0,0,48,12).data;
    for (let r=0;r<12;r++) for (let c=0;c<48;c++) {
      const v = data[(r*48+c)*4] > 90 ? 1 : 0;
      drawPixels[r][c] = v; pixels[r][c] = v;
    }
    syncDrawCanvas(); renderPreview(); toast('Image loaded ✓');
    const bright = parseInt(document.getElementById('sl-draw-bright').value);
    const speed  = parseInt(document.getElementById('sl-draw-speed').value);
    const effect = getSelectedEffect('draw-effect-row');
    try {
      const result = await led.uploadBitmap(drawPixels, 1, effect, speed, bright);
      if (result.bitmapAcked) {
        toast('Device confirmed the upload — check the badge. Report back either way!', 4500);
      } else {
        toast('Upload sent, but no confirmation from the device — check the badge and report what you see.', 4500);
      }
      // console.log('Upload ACK detail:', result);
    } catch (e) {
      toast('Upload failed: ' + e.message, 4000);
      console.error('Upload error (this detail is useful to report):', e);
    }    
  };
  img.src = URL.createObjectURL(file);
  this.value = '';
});

document.getElementById('btn-send-draw').addEventListener('click', async () => {
  const bright = parseInt(document.getElementById('sl-draw-bright').value);
  const speed  = parseInt(document.getElementById('sl-draw-speed').value);
  const effect = getSelectedEffect('draw-effect-row');
  try {
    const result = await led.uploadBitmap(drawPixels, 1, effect, speed, bright);
    if (result.bitmapAcked) {
      toast('Device confirmed the upload — check the badge. Report back either way!', 4500);
    } else {
      toast('Upload sent, but no confirmation from the device — check the badge and report what you see.', 4500);
    }
    console.log('Upload ACK detail:', result);
  } catch (e) {
    toast('Upload failed: ' + e.message, 4000);
    console.error('Upload error (this detail is useful to report):', e);
  }
});

// ═══════════════════════════════════════════════════════════
// ANIMATIONS TAB
// ═══════════════════════════════════════════════════════════
let selectedAnim = 0;
let animPreviewed = false;

function makeAnimPreviewCanvas(i, canvasEl) {
  const ctx = canvasEl.getContext('2d');
  canvasEl.width = 48; canvasEl.height = 12;
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,48,12);
  const seed = (i+1)*7;
  for (let r=0;r<12;r++) for (let c=0;c<48;c++) {
    const v = Math.sin(c*0.4*seed)*Math.cos(r*0.7+seed) > 0.1 ? 1 : 0;
    ctx.fillStyle = v ? '#FF3333' : '#1A1A1A';
    ctx.fillRect(c,r,1,1);
  }
}

async function playAnim(i) {
  selectedAnim = i;
  if (!led.connected) { toast('Connect to the badge first'); return; }
  try {
    const bright = parseInt(document.getElementById('sl-anim-bright').value);
    await led.setBrightness(bright);
    await led.animate(i);
    toast(`Animation ${i} playing ✓`);
  } catch (e) { toast('Error: ' + e.message); console.error(e); }
}

function renderAnimPreviews() {
  if (animPreviewed) return;
  animPreviewed = true;
  const grid = document.getElementById('anim-grid');
  grid.innerHTML = '';
  for (let i=0;i<19;i++) {
    const card = document.createElement('div');
    card.className = 'anim-card' + (i === selectedAnim ? ' active' : '');
    const prev = document.createElement('div'); prev.className = 'anim-preview';
    const gifSrc = ANIM_GIFS[i];
    let cv = null;
    if (gifSrc) {
      const img = document.createElement('img');
      img.src = gifSrc; img.alt = `Animation ${i}`;
      img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover'; img.style.imageRendering = 'pixelated';
      prev.appendChild(img);
    } else {
      cv = document.createElement('canvas'); prev.appendChild(cv);
    }
    card.appendChild(prev);
    const nm = document.createElement('span'); nm.className = 'anim-name'; nm.textContent = `Anim ${i}`; card.appendChild(nm);
    card.addEventListener('click', () => {
      document.querySelectorAll('.anim-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      playAnim(i);
    });
    if (cv) makeAnimPreviewCanvas(i, cv);
    grid.appendChild(card);
  }
}

// ═══════════════════════════════════════════════════════════
// MUSIC TAB — FFT / Spectrogram
// ═══════════════════════════════════════════════════════════
let audioCtx = null, analyser = null, fftRunning = false;
let visMode = 'center';
const fftCanvas = document.getElementById('fft-bar-canvas');
const fftCtx = fftCanvas.getContext('2d');

function setVisualization(el) {
  document.querySelectorAll('[data-vis]').forEach(p => p.classList.remove('active'));
  el.classList.add('active'); visMode = el.dataset.vis;
}

// Confirmed from a real capture: the device takes exactly 12 bar-height
// bytes (0-8) plus 1 mode byte (0 = bottom-up, 1 = center-symmetric) and
// renders it natively — so "Bottom" vs "Center" here isn't just a local
// preview choice, it tells the badge itself which layout to draw.
const BAR_COUNT = 12;
const BAR_WIDTH = 2;
const BAR_PITCH = 48 / BAR_COUNT;

function barColumns(i) {
  const start = Math.round(i * BAR_PITCH + (BAR_PITCH - BAR_WIDTH) / 2);
  const cols = [];
  for (let w=0; w<BAR_WIDTH; w++) { const c = start + w; if (c>=0 && c<48) cols.push(c); }
  return cols;
}

function drawFFT() {
  if (!analyser || !fftRunning) return;
  const gain = parseFloat(document.getElementById('sl-music-gain').value);
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  fftCtx.fillStyle = '#000'; fftCtx.fillRect(0,0,48,12);
  for (let r=0;r<12;r++) pixels[r].fill(0);

  const bars12 = [];
  let deviceMode = visMode === 'bottom' ? 0 : 1; // device only knows bottom(0)/center(1)

  if (visMode === 'bottom') {
    for (let i=0;i<BAR_COUNT;i++) {
      const idx = Math.floor(i * data.length / (BAR_COUNT * 2));
      let val = Math.min(1, (data[idx]/255) * gain / 5); // 0..1
      if (val < 0.08) val = 0; // noise gate — ignore ambient mic hiss / silence
      const level8 = Math.min(8, Math.floor(val * 8));      // 0..8, matches device bar scale
      bars12.push(level8);

      // classic bottom-up bar: full 12-row range
      const rows = Math.max(1, Math.min(12, Math.floor(level8 / 8 * 12)));
      const cols = barColumns(i);
      for (const c of cols) {
        for (let r=0; r<rows; r++) {
          const rr = 11 - r;
          fftCtx.fillStyle = '#FF3333'; fftCtx.fillRect(c, rr, 1, 1); pixels[rr][c] = 1;
        }
      }
    }
  } else {
    for (let i=0;i<BAR_COUNT;i++) {
      const idx = Math.floor(i * data.length / (BAR_COUNT * 2));
      let val = Math.min(1, (data[idx]/255) * gain / 5); // 0..1
      if (val < 0.08) val = 0; // noise gate — ignore ambient mic hiss / silence
      const level8 = Math.min(8, Math.floor(val * 8));      // 0..8, matches device bar scale
      bars12.push(level8);

      // symmetric row-pairs lit outward from center (rows 5/6), max 6 pairs = 12 rows
      const pairs = Math.max(1, Math.min(6, Math.floor(level8 / 8 * 6)));
      const cols = barColumns(i);
      for (const c of cols) {
        for (let k=0; k<pairs; k++) {
          const rTop = 5 - k, rBot = 6 + k;
          if (rTop>=0) { fftCtx.fillStyle = '#FF3333'; fftCtx.fillRect(c, rTop, 1, 1); pixels[rTop][c] = 1; }
          if (rBot<=11) { fftCtx.fillStyle = '#FF3333'; fftCtx.fillRect(c, rBot, 1, 1); pixels[rBot][c] = 1; }
        }
      }
    }
  }
  renderPreview();

  if (led.connected) led.spectrogramFrame(bars12, deviceMode).catch(()=>{});
  requestAnimationFrame(drawFFT);
}

async function startAudio(streamOrElement) {
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (analyser) analyser.disconnect();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
  const src = streamOrElement instanceof MediaStream
    ? audioCtx.createMediaStreamSource(streamOrElement)
    : audioCtx.createMediaElementSource(streamOrElement);
  src.connect(analyser); analyser.connect(audioCtx.destination);
  fftRunning = true;
  document.getElementById('btn-stop-music').style.display = 'block';
  if (led.connected) await led.sessionStart().catch(()=>{});
  drawFFT();
}

document.getElementById('btn-mic').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    await startAudio(stream);
    document.getElementById('btn-mic').classList.add('active');
    document.getElementById('btn-file').classList.remove('active');
    toast('Microphone active 🎙');
  } catch (e) { toast('Microphone unavailable'); }
});
document.getElementById('btn-file').addEventListener('click', () => document.getElementById('music-file').click());
document.getElementById('music-file').addEventListener('change', async function(){
  if (!this.files[0]) return;
  const url = URL.createObjectURL(this.files[0]);
  const audio = new Audio(url); audio.crossOrigin = 'anonymous';
  document.body.appendChild(audio);
  await audio.play();
  await startAudio(audio);
  document.getElementById('btn-file').classList.add('active');
  document.getElementById('btn-mic').classList.remove('active');
  toast(`▶ ${this.files[0].name}`);
});
document.getElementById('btn-stop-music').addEventListener('click', async () => {
  fftRunning = false;
  document.getElementById('btn-stop-music').style.display = 'none';
  document.getElementById('btn-mic').classList.remove('active');
  document.getElementById('btn-file').classList.remove('active');
  clearPixels();
  fftCtx.fillStyle = '#000'; fftCtx.fillRect(0,0,48,12);
  if (audioCtx) audioCtx.suspend();
  if (led.connected) led.sessionStop().catch(()=>{});
  toast('Audio stopped');
});

window.addEventListener('beforeunload', () => { if (led.connected) led.disconnect(); });