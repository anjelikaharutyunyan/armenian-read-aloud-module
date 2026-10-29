const MODEL_URL = "models/hy_AM-gor-medium.onnx";
const FALLBACK_MODEL_URL =
  "https://huggingface.co/davit312/piper-TTS-Armenian/resolve/main/v3/hy_AM-gor-medium.onnx";
const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const PHONEMIZER_BASE = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/";

const BOS_ID = 1;
const EOS_ID = 2;
const PAD_ID = 0;
const SPACE_ID = 3;

const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
const sentenceBoundary = /[.!?։:…]+(?=\s)|\n+/g;

const cancelled = new Set();
let enginePromise = null;

async function fetchModel(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Voice model returned ${response.status}.`);

  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());

  const model = new Uint8Array(total);
  const reader = response.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    model.set(value, loaded);
    loaded += value.length;
    onProgress(loaded / total);
  }
  return model;
}

async function fetchConfig() {
  try {
    const response = await fetch(`${MODEL_URL}.json`);
    if (response.ok) return await response.json();
  } catch {}
  const response = await fetch(`${FALLBACK_MODEL_URL}.json`);
  if (!response.ok) throw new Error(`Voice config returned ${response.status}.`);
  return response.json();
}

async function createEngine(onProgress) {
  importScripts(`${ORT_BASE}ort.min.js`, `${PHONEMIZER_BASE}piper_phonemize.js`);

  const config = await fetchConfig();

  const lines = [];
  const phonemizer = await createPiperPhonemize({
    print: line => lines.push(line),
    printErr: message => console.warn("Phonemizer:", message),
    locateFile: file => `${PHONEMIZER_BASE}${file}`
  });

  function phonemize(texts) {
    lines.length = 0;
    phonemizer.callMain([
      "-l", config.espeak.voice,
      "--input", JSON.stringify(texts.map(text => ({ text }))),
      "--espeak_data", "/espeak-ng-data"
    ]);
    if (lines.length !== texts.length) throw new Error("Armenian phonemizer returned unexpected output.");
    return lines.map(line => JSON.parse(line));
  }

  let model;
  try {
    model = await fetchModel(MODEL_URL, onProgress);
  } catch {
    model = await fetchModel(FALLBACK_MODEL_URL, onProgress);
  }

  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });

  return { config, phonemize, session };
}

function getEngine(onProgress) {
  enginePromise ??= createEngine(onProgress).catch(error => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

function splitSentences(text) {
  const chunks = [];
  let start = 0;
  const push = end => {
    const slice = text.slice(start, end);
    if (/[\p{L}\p{N}]/u.test(slice)) chunks.push({ text: slice.trim(), start, end, words: [] });
    start = end;
  };
  for (const match of text.matchAll(sentenceBoundary)) push(match.index + match[0].length);
  push(text.length);
  return chunks;
}

function spokenGroups(phonemeIds, idSamples) {
  const groups = [];
  let cursor = 0;
  let groupStart = null;
  phonemeIds.forEach((id, index) => {
    const samples = idSamples[index];
    if (id === BOS_ID || id === PAD_ID) {
      cursor += samples;
      return;
    }
    if (id === SPACE_ID || id === EOS_ID) {
      if (groupStart !== null) groups.push([groupStart, cursor]);
      groupStart = null;
      cursor += samples;
      return;
    }
    groupStart ??= cursor;
    cursor += samples;
  });
  if (groupStart !== null) groups.push([groupStart, cursor]);
  return groups;
}

function countGroups(phonemes) {
  return phonemes.join("").split(" ").filter(Boolean).length;
}

// Without phoneme durations from the model, spread the words over the
// sentence by length so highlighting still roughly follows the voice.
function wordSampleRanges(words, phonemeIds, idSamples, wordGroupCounts, sampleCount) {
  if (idSamples) {
    const groups = spokenGroups(phonemeIds, idSamples);
    const expected = wordGroupCounts.reduce((sum, count) => sum + count, 0);
    if (expected === groups.length && wordGroupCounts.every(count => count > 0)) {
      let groupIndex = 0;
      return wordGroupCounts.map(count => {
        const range = [groups[groupIndex][0], groups[groupIndex + count - 1][1]];
        groupIndex += count;
        return range;
      });
    }
  }

  const totalLength = words.reduce((sum, word) => sum + word.length, 0) || 1;
  let cursor = 0;
  return words.map(word => {
    const start = cursor;
    cursor += sampleCount * word.length / totalLength;
    return [start, cursor];
  });
}

function encodeWav(audio, sampleRate) {
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  const scale = peak < 1e-8 ? 0 : 32767 / peak;

  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + audio.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, audio.length * 2, true);
  audio.forEach((sample, index) => {
    view.setInt16(44 + index * 2, Math.max(-32767, Math.min(32767, Math.round(sample * scale))), true);
  });
  return buffer;
}

async function synthesize(id, text, rate) {
  const post = message => postMessage({ id, ...message });
  const isCancelled = () => cancelled.has(id);

  post({ type: "status", stage: "loading", progress: 0 });
  const { config, phonemize, session } = await getEngine(progress => {
    if (!isCancelled()) post({ type: "status", stage: "loading", progress });
  });
  if (isCancelled()) return;
  post({ type: "status", stage: "synthesizing", progress: 0 });

  const sampleRate = config.audio.sample_rate;
  const hopLength = config.hop_length ?? 256;

  const chunks = splitSentences(text);
  for (const word of text.matchAll(wordPattern)) {
    const chunk = chunks.find(candidate => word.index >= candidate.start && word.index < candidate.end);
    chunk?.words.push(word[0]);
  }

  const allWords = chunks.flatMap(chunk => chunk.words);
  const results = phonemize([...chunks.map(chunk => chunk.text), ...allWords]);
  const wordGroupCounts = results.slice(chunks.length).map(result => countGroups(result.phonemes));

  let firstWord = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (isCancelled()) return;

    const phonemeIds = results[index].phoneme_ids;
    const output = await session.run({
      input: new ort.Tensor("int64", BigInt64Array.from(phonemeIds, BigInt), [1, phonemeIds.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(phonemeIds.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([
        config.inference.noise_scale,
        1 / rate,
        config.inference.noise_w
      ]), [3])
    });

    const audio = output[session.outputNames[0]].data;
    const durations = session.outputNames[1] && output[session.outputNames[1]]?.data;
    const idSamples = durations?.length === phonemeIds.length
      ? Array.from(durations, frames => Math.round(frames * hopLength))
      : null;

    const counts = wordGroupCounts.slice(firstWord, firstWord + chunk.words.length);
    const timings = wordSampleRanges(chunk.words, phonemeIds, idSamples, counts, audio.length)
      .map(([start, end]) => ({ start: start / sampleRate, end: end / sampleRate }));

    const wav = encodeWav(audio, sampleRate);
    if (isCancelled()) return;
    postMessage({ id, type: "segment", wav, timings, firstWord }, [wav]);
    firstWord += chunk.words.length;
  }

  post({ type: "done" });
}

self.onmessage = ({ data }) => {
  if (data.type === "cancel") {
    cancelled.add(data.id);
    return;
  }
  if (data.type === "synthesize") {
    synthesize(data.id, data.text, data.rate)
      .catch(error => postMessage({ id: data.id, type: "error", message: error.message || String(error) }))
      .finally(() => cancelled.delete(data.id));
  }
};
