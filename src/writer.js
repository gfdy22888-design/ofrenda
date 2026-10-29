/* ------------------------------------------------------------------
   writer.js — the remembrance text.

   Stage two of the pipeline: a 0.5B open-weight model, quantised to
   4 bits, writes the card copy on-device. If the weights can't be
   fetched (or the device can't run them), a deterministic composer
   takes over so the app never dead-ends. Both paths are honest about
   which one produced the words on the card.
   ------------------------------------------------------------------ */

const LIB_CDNS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  'https://unpkg.com/@huggingface/transformers@3.8.1',
  'https://esm.sh/@huggingface/transformers@3.8.1',
];

const WRITER_MODELS = [
  'onnx-community/Qwen2.5-0.5B-Instruct',
  'onnx-community/SmolLM2-360M-Instruct',
];

const SYSTEM = {
  en: 'You write short, plain, unsentimental remembrance text for a Day of the Dead altar card. You never use emojis, never use the word "journey", never say "rest in peace". You write like a careful grandchild, not like a greeting card.',
  es: 'Escribes textos breves y sencillos para una tarjeta de ofrenda de Día de Muertos. Sin emojis, sin clichés, sin "descanse en paz". Escribes como un nieto cuidadoso, no como una tarjeta comercial.',
  zh: '你为亡灵节祭坛卡片写简短的纪念文字。不用表情符号，不用"永远怀念""安息"这类套话，语气克制、具体、像一个细心的晚辈在说话。',
};

const TASK = {
  en: (d) => `Write the card body in English. 90 to 130 words, three short paragraphs, no headings, no bullet points.
The person: ${d.name}${d.dates ? ` (${d.dates})` : ''}, ${d.relation}.
Something we want to keep: ${d.keep || 'not specified'}.
What they actually said, transcribed on my own machine: "${d.transcript}"
Rules: quote at most six consecutive words from the transcript. Do not invent facts that are not in the transcript. Do not mention death directly more than once. End on the thing we keep, not on grief.`,
  es: (d) => `Escribe el cuerpo de la tarjeta en español. De 90 a 130 palabras, tres párrafos cortos, sin títulos ni viñetas.
La persona: ${d.name}${d.dates ? ` (${d.dates})` : ''}, ${d.relation}.
Lo que queremos guardar: ${d.keep || 'no especificado'}.
Lo que dijo, transcrito en mi propia máquina: "${d.transcript}"
Reglas: cita como máximo seis palabras seguidas del texto. No inventes hechos que no estén ahí. No menciones la muerte más de una vez. Termina en lo que guardamos, no en el duelo.`,
  zh: (d) => `用中文写这张卡片的正文。90 到 130 字，三个短段落，不要标题，不要项目符号。
这个人：${d.name}${d.dates ? `（${d.dates}）` : ''}，${d.relation}。
我们想留住的东西：${d.keep || '未指定'}。
他/她原话，由我在自己的机器上转写：「${d.transcript}」
要求：最多连续引用原话六个字。不要编造原话里没有的事实。不要用"永远怀念""安息""天堂"这类词。结尾落在"留住的东西"上，不要落在悲伤上。`,
};

let _lib = null;
async function loadLib() {
  if (_lib) return _lib;
  for (const url of LIB_CDNS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod?.pipeline) { _lib = mod; return mod; }
    } catch (err) { console.warn('[ofrenda] writer CDN failed:', url, err); }
  }
  throw new Error('inference runtime unreachable');
}

function tidy(text) {
  let t = (text || '').trim();
  // cut a dangling unfinished tail after the last full stop
  const m = t.match(/^[\s\S]*[.!?。！？]/);
  if (m && m[0].length > t.length * 0.55) t = m[0];
  return t
    .replace(/^["'“”「」\s]+|["'“”「」\s]+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Deterministic fallback — no model, still specific to this memory. */
export function composeTemplate(d) {
  const quote = pickLine(d.transcript);
  const keep = (d.keep || '').trim();
  const name = d.name || 'Someone';

  if (d.lang === 'zh') {
    const p1 = `${name}今晚在这座祭坛上。${d.dates ? `（${d.dates}）` : ''}${d.relation ? `——${d.relation}。` : ''}`;
    const p2 = quote ? `留下的原话里有这么一句：「${quote}」这句话是我们在自己的机器上，一个字一个字听出来的。` : '';
    const p3 = keep ? `我们要记住的是${keep}。不是抽象的怀念，是具体的那样东西。` : '我们要记住的是声音本身——它还在。';
    return [p1, p2, p3].filter(Boolean).join('\n\n');
  }

  if (d.lang === 'es') {
    const p1 = `${name} está en esta ofrenda esta noche.${d.dates ? ` (${d.dates})` : ''}${d.relation ? ` ${cap(d.relation)}.` : ''}`;
    const p2 = quote ? `Entre lo que dijo quedó esta frase: «${quote}» La escuchamos palabra por palabra en nuestra propia máquina.` : '';
    const p3 = keep ? `Lo que guardamos es ${keep}. No una pena abstracta: esa cosa concreta.` : 'Lo que guardamos es la voz. Todavía está.';
    return [p1, p2, p3].filter(Boolean).join('\n\n');
  }

  const p1 = `${name} is on this altar tonight${d.dates ? ` (${d.dates})` : ''}.${d.relation ? ` ${cap(d.relation)} — the one who kept the recording.` : ''}`;
  const p2 = quote ? `Somewhere in what they said is this: “${quote}” We listened it out word by word, on our own machine.` : '';
  const p3 = keep ? `What we keep is ${keep}. Not an abstract grief — that specific thing.` : 'What we keep is the voice. It is still here.';
  return [p1, p2, p3].filter(Boolean).join('\n\n');
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function pickLine(transcript) {
  const raw = (transcript || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const parts = raw.split(/(?<=[.!?。！？])\s*/).filter((s) => s.trim().length > 8);
  if (!parts.length) return raw.slice(0, 110);
  // the longest sentence usually carries the most detail, but cap it
  const best = parts.sort((a, b) => b.length - a.length)[0].trim();
  return best.length > 110 ? best.slice(0, 108).trim() + '…' : best;
}

/**
 * Compose the card body with the local model, falling back to template.
 * @returns {{text:string, engine:'model'|'template', modelId?:string}}
 */
export async function compose(d, { onProgress, onNote } = {}) {
  if (!d.useWriter) {
    return { text: composeTemplate(d), engine: 'template' };
  }

  let lastErr;
  for (const modelId of WRITER_MODELS) {
    try {
      const { pipeline, env } = await loadLib();
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      onNote?.(`Waking ${modelId.split('/').pop()}…`);
      const gen = await pipeline('text-generation', modelId, {
        dtype: 'q4',
        device: 'wasm',
        progress_callback: (p) => {
          if (p?.status === 'progress' && p.total) {
            onProgress?.(0.15 + 0.8 * (p.loaded / p.total), `${p.file || 'weights'} · ${Math.round((p.loaded / p.total) * 100)}%`);
          }
        },
      });

      const task = (TASK[d.lang] || TASK.en)(d);
      const prompt =
        `<|im_start|>system\n${SYSTEM[d.lang] || SYSTEM.en}<|im_end|>\n` +
        `<|im_start|>user\n${task}<|im_end|>\n` +
        `<|im_start|>assistant\n`;

      onNote?.('Writing…');
      const out = await gen(prompt, {
        max_new_tokens: 300,
        do_sample: true,
        temperature: 0.85,
        top_p: 0.92,
        repetition_penalty: 1.08,
        return_full_text: false,
      });

      const text = tidy(out?.[0]?.generated_text || '');
      if (text.length < 60) throw new Error('model produced too little text');
      return { text, engine: 'model', modelId };
    } catch (err) {
      lastErr = err;
      console.warn('[ofrenda] writer model failed:', modelId, err);
    }
  }

  console.warn('[ofrenda] falling back to template writer', lastErr);
  return { text: composeTemplate(d), engine: 'template', error: lastErr?.message };
}
