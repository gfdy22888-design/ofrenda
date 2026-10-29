/* ------------------------------------------------------------------
   asr.js — speech to text entirely inside the tab.

   Whisper (ONNX) runs on WebAssembly via transformers.js. Audio is
   decoded by the Web Audio API, resampled to 16 kHz mono here, and
   never touches a network socket. The only bytes that leave the page
   are the model weights, fetched once from a CDN and then cached.

   We try several CDNs because a single blocked CDN shouldn't decide
   whether a family's recording is readable or not.
   ------------------------------------------------------------------ */

const TRANSFORMERS_CDNS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  'https://unpkg.com/@huggingface/transformers@3.8.1',
  'https://esm.sh/@huggingface/transformers@3.8.1',
];

const ASR_MODELS = {
  tiny: ['onnx-community/whisper-tiny', 'Xenova/whisper-tiny'],
  base: ['onnx-community/whisper-base', 'Xenova/whisper-base'],
};

let _lib = null;

/** Import transformers.js from whichever CDN answers first. */
async function loadLib(onNote) {
  if (_lib) return _lib;
  let lastErr;
  for (const url of TRANSFORMERS_CDNS) {
    try {
      onNote?.('Loading runtime from ' + new URL(url).host + '…');
      const mod = await import(/* @vite-ignore */ url);
      if (!mod?.pipeline) throw new Error('pipeline export missing');
      _lib = mod;
      return _lib;
    } catch (err) {
      lastErr = err;
      console.warn('[ofrenda] CDN failed, trying next:', url, err);
    }
  }
  throw new Error(
    'Could not load the inference runtime from any CDN. ' +
    (lastErr?.message || '') +
    ' — you can still type the memory by hand.'
  );
}

/** Decode any audio file the browser understands into 16 kHz mono Float32. */
export async function decodeAudio(arrayBuffer) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  // An OfflineAudioContext created at 16 kHz makes decodeAudioData resample for us.
  const ctx = new OfflineCtx(1, 1, 16000);
  const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);

  const len = audio.length;
  const mixed = new Float32Array(len);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < len; i++) mixed[i] += data[i];
  }
  for (let i = 0; i < len; i++) mixed[i] /= audio.numberOfChannels;
  return mixed;
}

/**
 * Transcribe.
 * @param {Float32Array} samples 16 kHz mono
 * @param {{model?:string, language?:string, onProgress?:Function, onNote?:Function}} opts
 */
export async function transcribe(samples, opts = {}) {
  const { model = 'tiny', language = 'auto', onProgress, onNote } = opts;

  const lib = await loadLib(onNote);
  const { pipeline, env } = lib;
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const candidates = ASR_MODELS[model] || ASR_MODELS.tiny;
  let lastErr;

  for (const modelId of candidates) {
    try {
      onNote?.(`Waking ${modelId}…`);
      const asr = await pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p?.status === 'progress' && p.total) {
            onProgress?.(p.loaded / p.total, `${p.file || 'weights'} · ${Math.round((p.loaded / p.total) * 100)}%`);
          } else if (p?.status === 'done') {
            onProgress?.(1, 'weights ready');
          }
        },
      });

      onNote?.('Listening…');
      const result = await asr(samples, {
        task: 'transcribe',
        ...(language !== 'auto' ? { language } : {}),
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      const text = (Array.isArray(result) ? result[0]?.text : result?.text || '').trim();
      if (!text) throw new Error('The model heard nothing it could transcribe.');
      return { text, modelId };
    } catch (err) {
      lastErr = err;
      console.warn('[ofrenda] ASR model failed:', modelId, err);
    }
  }

  throw new Error(
    'Could not run the speech model. ' +
    (lastErr?.message || '') +
    ' — the weights may be unreachable from your network; typing the memory still works.'
  );
}
