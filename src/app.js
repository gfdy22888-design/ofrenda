/* ------------------------------------------------------------------
   app.js — wiring.
   ------------------------------------------------------------------ */
import { decodeAudio, transcribe } from './asr.js';
import { compose, composeTemplate } from './writer.js';
import { buildCardSVG, svgToPngBlob } from './card.js';
import { SAMPLE } from './sample.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  mode: 'record',
  audio: null,          // Float32Array @16k, never uploaded
  blob: null,           // original recording, kept in memory only
  transcript: '',
  card: null,
  cardSVG: '',
};

/* ---------------- tabs ---------------- */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
    const name = tab.dataset.tab;
    state.mode = name;
    $$('.panel').forEach((p) => p.classList.toggle('is-hidden', p.dataset.panel !== name));
    $('#btn-transcribe').style.display = name === 'record' || name === 'upload' ? '' : 'none';
    syncButtons();
  });
});

/* ---------------- recording ---------------- */
let rec = null;
let chunks = [];
let timerId = null;
let t0 = 0;

$('#btn-record').addEventListener('click', async () => {
  if (rec && rec.state === 'recording') {
    rec.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      clearInterval(timerId);
      $('#btn-record').classList.remove('is-recording');
      $('#btn-record').innerHTML = '<span class="rec-dot"></span> Record again';
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      state.blob = blob;
      setStatus('#asr-status', `Recorded ${(blob.size / 1024).toFixed(0)} KB — stays in this tab.`);
      try {
        state.audio = await decodeAudio(await blob.arrayBuffer());
        syncButtons();
      } catch (err) {
        setStatus('#asr-status', 'Could not decode that recording: ' + err.message, true);
      }
    };

    rec.start();
    $('#btn-record').classList.add('is-recording');
    $('#btn-record').innerHTML = '<span class="rec-dot"></span> Stop recording';
    t0 = Date.now();
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('#rec-timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 250);
    setStatus('#asr-status', 'Recording locally — nothing is being sent anywhere.');
  } catch (err) {
    setStatus('#asr-status', 'Microphone unavailable: ' + err.message, true);
  }
});

/* ---------------- upload ---------------- */
async function handleFile(file) {
  if (!file) return;
  $('#file-name').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB — decoded on this device`;
  state.blob = file;
  try {
    state.audio = await decodeAudio(await file.arrayBuffer());
    setStatus('#asr-status', 'Audio decoded. Ready to transcribe.');
    syncButtons();
  } catch (err) {
    setStatus('#asr-status', 'Could not decode that file: ' + err.message, true);
  }
}

$('#file-audio').addEventListener('change', (e) => handleFile(e.target.files?.[0]));
const dz = $('#dropzone');
['dragover', 'dragenter'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); })
);
dz.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));

/* ---------------- typed + sample ---------------- */
$('#typed-memory').addEventListener('input', (e) => {
  state.transcript = e.target.value.trim();
  $('#transcript').value = e.target.value;
  if (state.transcript.length > 40) unlockFrom(2);
  syncButtons();
});

$('#btn-sample').addEventListener('click', () => {
  fillFields(SAMPLE);
  state.transcript = SAMPLE.transcript;
  $('#transcript').value = SAMPLE.transcript;
  setStatus('#asr-status', 'Sample memo loaded from a bundled text file.');
  unlockFrom(2);
});

/* ---------------- transcribe ---------------- */
$('#btn-transcribe').addEventListener('click', async () => {
  if (!state.audio) return;
  const btn = $('#btn-transcribe');
  btn.disabled = true;
  $('#asr-progress').classList.remove('is-hidden');
  $('#asr-progress .bar').style.width = '4%';

  try {
    const { text, modelId } = await transcribe(state.audio, {
      model: $('#sel-asr').value,
      language: $('#sel-lang').value,
      onProgress: (ratio, note) => {
        $('#asr-progress .bar').style.width = `${Math.max(4, ratio * 100).toFixed(0)}%`;
        setStatus('#asr-status', note ? `Downloading weights · ${note}` : 'Downloading weights…');
      },
      onNote: (note) => setStatus('#asr-status', note),
    });

    state.transcript = text;
    $('#transcript').value = text;
    const secs = (state.audio.length / 16000).toFixed(0);
    setStatus('#asr-status', `Transcribed ${secs}s of audio with ${modelId} — on this device.`);
    $('#asr-progress .bar').style.width = '100%';
    setTimeout(() => $('#asr-progress').classList.add('is-hidden'), 700);
    unlockFrom(2);
  } catch (err) {
    setStatus('#asr-status', err.message, true);
    $('#asr-progress').classList.add('is-hidden');
  } finally {
    btn.disabled = false;
    syncButtons();
  }
});

$('#transcript').addEventListener('input', (e) => {
  state.transcript = e.target.value;
  syncButtons();
});

/* ---------------- compose ---------------- */
$('#btn-compose').addEventListener('click', async () => {
  const btn = $('#btn-compose');
  btn.disabled = true;
  $('#gen-progress').classList.remove('is-hidden');
  $('#gen-progress .bar').style.width = '10%';

  const d = readFields();
  try {
    const { text, engine, modelId } = await compose(d, {
      onProgress: (ratio, note) => {
        $('#gen-progress .bar').style.width = `${Math.max(10, ratio * 100).toFixed(0)}%`;
        setStatus('#gen-status', note ? `Loading writer · ${note}` : 'Loading writer…');
      },
      onNote: (note) => setStatus('#gen-status', note),
    });

    renderCard({ ...d, body: text });

    setStatus(
      '#gen-status',
      engine === 'model'
        ? `Written by ${modelId} on this device.`
        : (d.useWriter
            ? 'Weights unreachable — card composed by the offline fallback.'
            : 'Writer model off — card composed by the offline fallback.')
    );
    $('#gen-progress .bar').style.width = '100%';
    setTimeout(() => $('#gen-progress').classList.add('is-hidden'), 600);
  } catch (err) {
    renderCard({ ...d, body: composeTemplate(d) });
    setStatus('#gen-status', 'Writer failed (' + err.message + ') — used the offline fallback.', true);
  } finally {
    btn.disabled = false;
    syncButtons();
  }
});

/* ---------------- card rendering ---------------- */
function renderCard(d) {
  const footer = `recorded ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  state.card = { ...d, footer };
  state.cardSVG = buildCardSVG(state.card);
  $('#card-host').innerHTML = state.cardSVG;
  unlockFrom(4);
  updateShareHash();
  $('#step-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#btn-png').addEventListener('click', async () => {
  if (!state.cardSVG) return;
  const btn = $('#btn-png');
  btn.disabled = true;
  try {
    const blob = await svgToPngBlob(state.cardSVG, 2);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ofrenda-${(state.card?.name || 'card').replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    setStatus('#share-note', 'PNG export failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#btn-print').addEventListener('click', () => window.print());

$('#btn-copy-link').addEventListener('click', async () => {
  updateShareHash();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('#share-note', 'Link copied. It carries the card text — no server involved.');
  } catch {
    setStatus('#share-note', 'Copy blocked by the browser. The link is in your address bar.');
  }
});

$('#btn-again').addEventListener('click', () => {
  state.audio = null; state.blob = null; state.transcript = ''; state.card = null; state.cardSVG = '';
  $('#transcript').value = '';
  $('#card-host').innerHTML = '';
  history.replaceState(null, '', location.pathname);
  unlockFrom(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------------- share link ---------------- */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function updateShareHash() {
  if (!state.card) return;
  const { n, r, k, l, t, dt, body, footer } = state.card;
  const payload = { n, r, k, l, t, dt, body, footer };
  history.replaceState(null, '', '#' + b64encode(JSON.stringify(payload)));
}

function readHash() {
  if (!location.hash || location.hash.length < 12) return null;
  try { return JSON.parse(b64decode(location.hash.slice(1))); } catch { return null; }
}

/* ---------------- helpers ---------------- */
function readFields() {
  return {
    name: $('#f-name').value.trim(),
    relation: $('#f-relation').value.trim(),
    keep: $('#f-keep').value.trim(),
    lang: $('#f-lang').value,
    title: $('#f-title').value.trim() || 'In memory',
    dates: $('#f-dates').value.trim(),
    transcript: state.transcript,
    useWriter: $('#chk-writer').checked,
  };
}

function fillFields(src) {
  $('#f-name').value = src.name || '';
  $('#f-relation').value = src.relation || '';
  $('#f-keep').value = src.keep || '';
  $('#f-lang').value = src.lang || 'en';
  $('#f-title').value = src.title || 'In memory';
  $('#f-dates').value = src.dates || '';
}

function unlockFrom(step) {
  $$('.step').forEach((el) => {
    const n = Number(el.dataset.step);
    if (n < step) { el.classList.remove('is-locked'); el.classList.add('is-done'); }
    if (n === step) el.classList.remove('is-locked');
  });
  syncButtons();
}

function syncButtons() {
  const hasAudio = !!state.audio;
  const trBtn = $('#btn-transcribe');
  if (trBtn) trBtn.disabled = !hasAudio;
  $('#btn-compose').disabled = state.transcript.trim().length < 20;
}

function setStatus(sel, msg, isErr = false) {
  const el = $(sel);
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
}

/* ---------------- boot ---------------- */
(function boot() {
  const shared = readHash();
  if (shared) {
    // someone opened a shared card: render it, skip the workshop
    $$('.step').forEach((el) => {
      if (el.dataset.step !== '4') el.style.display = 'none';
    });
    const d = {
      name: shared.n || '', relation: shared.r || '', keep: shared.k || '',
      lang: shared.l || 'en', title: shared.t || 'In memory', dates: shared.dt || '',
      body: shared.body || '', footer: shared.footer || '',
    };
    state.card = d;
    state.cardSVG = buildCardSVG(d);
    $('#card-host').innerHTML = state.cardSVG;
    $('#step-card').classList.remove('is-locked');
    const hint = document.querySelector('#step-card .hint');
    if (hint) hint.textContent = 'A card someone made on their own machine and chose to share. Nothing here was fetched from a server.';
    $('#btn-again').textContent = 'Make your own';
    return;
  }
  syncButtons();

  // ?demo=1 — straight to a finished card, no weights to download.
  if (new URLSearchParams(location.search).get('demo') === '1') startDemo();
})();

function startDemo() {
  fillFields(SAMPLE);
  state.transcript = SAMPLE.transcript;
  $('#transcript').value = SAMPLE.transcript;
  $('#chk-writer').checked = false;
  unlockFrom(2);
  setStatus('#asr-status', "Instant demo — Rosa's memo ships with the page. No download, no network.");
  $('#btn-compose').click();
}
