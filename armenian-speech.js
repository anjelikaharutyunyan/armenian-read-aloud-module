(() => {
  const LOCAL_SERVER_URL = "http://127.0.0.1:8765/synthesize";
  const WORKER_URL = new URL("armenian-speech-worker.js", document.currentScript.src);
  const SILENT_WAV = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQIAAAAAAA==";

  const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;

  const isLocalPage = window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1"].includes(window.location.hostname);

  let worker = null;
  let nextRequestId = 1;

  function abortError() {
    return new DOMException("Speech request was cancelled.", "AbortError");
  }

  function getWorker() {
    worker ??= new Worker(WORKER_URL);
    return worker;
  }

  async function synthesizeWithLocalServer(text, { rate, signal, onSegment }) {
    const response = await fetch(LOCAL_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate }),
      signal
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Speech service returned ${response.status}.`);
    }

    const timings = (response.headers.get("X-Piper-Word-Timings") || "")
      .split(";").filter(Boolean).map(entry => {
        const [startMs, endMs] = entry.split(",").map(Number);
        return { start: startMs / 1000, end: endMs / 1000 };
      });
    onSegment({ blob: await response.blob(), timings, firstWord: 0 });
  }

  function synthesizeInBrowser(text, { rate, signal, onStatus, onSegment }) {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      const speechWorker = getWorker();

      const cleanup = () => {
        speechWorker.removeEventListener("message", onMessage);
        speechWorker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        speechWorker.postMessage({ type: "cancel", id });
        cleanup();
        reject(abortError());
      };
      const onError = event => {
        cleanup();
        worker = null;
        speechWorker.terminate();
        reject(new Error(event.message || "Armenian speech engine failed to start."));
      };
      const onMessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === "status") onStatus?.(data);
        if (data.type === "segment") {
          onSegment({
            blob: new Blob([data.wav], { type: "audio/wav" }),
            timings: data.timings,
            firstWord: data.firstWord
          });
        }
        if (data.type === "done") {
          cleanup();
          resolve();
        }
        if (data.type === "error") {
          cleanup();
          reject(new Error(data.message));
        }
      };

      speechWorker.addEventListener("message", onMessage);
      speechWorker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      speechWorker.postMessage({ type: "synthesize", id, text, rate });
    });
  }

  async function synthesize(text, options) {
    if (isLocalPage) {
      try {
        return await synthesizeWithLocalServer(text, options);
      } catch (error) {
        if (error.name === "AbortError" || !(error instanceof TypeError)) throw error;
      }
    }
    return synthesizeInBrowser(text, options);
  }

  // Call from the click handler, before any await, so mobile browsers
  // allow this element to play the audio that arrives later.
  function unlockAudio(audio) {
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
  }

  // Speaks text through `audio`, starting with the first sentence while the
  // rest is still being generated. `onWord` receives the index of the word
  // being spoken (or -1); `onTimings(false)` reports that highlighting is
  // unavailable for part of the text.
  function speak(text, { audio, rate = 1, signal, onStatus, onWord, onTimings }) {
    const wordCount = [...text.matchAll(wordPattern)].length;
    const queue = [];
    let current = null;
    let synthesisDone = false;
    let frame = 0;
    let finished = false;

    return new Promise((resolve, reject) => {
      const finish = error => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        if (current) URL.revokeObjectURL(current.url);
        queue.forEach(segment => URL.revokeObjectURL(segment.url));
        onWord?.(-1);
        error ? reject(error) : resolve();
      };

      const trackWord = () => {
        if (!current || audio.paused) {
          frame = 0;
          return;
        }
        const time = audio.currentTime;
        const index = current.timings
          ? current.timings.findIndex(timing => time >= timing.start && time < timing.end)
          : -1;
        onWord?.(index >= 0 ? current.firstWord + index : -1);
        frame = requestAnimationFrame(trackWord);
      };

      const playNext = () => {
        if (current) URL.revokeObjectURL(current.url);
        current = queue.shift() ?? null;
        if (!current) {
          onWord?.(-1);
          if (synthesisDone) finish();
          return;
        }
        audio.src = current.url;
        audio.play().then(() => {
          onStatus?.({ stage: "playing" });
          if (!frame) frame = requestAnimationFrame(trackWord);
        }, error => {
          if (!finished && error.name !== "AbortError") finish(error);
        });
      };

      audio.onended = playNext;
      audio.onerror = () => finish(new Error("The generated audio could not be played."));
      signal?.addEventListener("abort", () => finish(abortError()), { once: true });

      synthesize(text, {
        rate,
        signal,
        onStatus: status => {
          if (!current) onStatus?.(status);
        },
        onSegment: ({ blob, timings, firstWord }) => {
          if (finished) return;
          const valid = Array.isArray(timings) && timings.length > 0 &&
            firstWord + timings.length <= wordCount &&
            timings.every(timing => Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.end > timing.start);
          if (!valid) onTimings?.(false);
          queue.push({ url: URL.createObjectURL(blob), timings: valid ? timings : null, firstWord });
          if (!current) playNext();
        }
      }).then(() => {
        synthesisDone = true;
        if (!current && !queue.length) finish();
      }, error => finish(error));
    });
  }

  window.ArmenianSpeech = { speak, unlockAudio };
})();
