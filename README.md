# Armenian Read Aloud

A small, framework-free Armenian text-to-speech widget for static sites or server-rendered pages. It generates Armenian speech in the browser with Piper and highlights the word currently being spoken. No page-specific CSS classes are required: use the optional `data-reader-ignore` attribute only for content you want skipped.

## Quick start

1. Copy this folder into your site, keeping `armenian-speech.js`, `armenian-speech-worker.js`, and `models/` together.
2. Add the widget markup to the page:

   ```html
   <section data-armenian-reader>
     <button type="button" data-reader-play aria-pressed="false"
             data-label-play="Կարդալ էջը" data-label-stop="Դադարեցնել ընթերցումը">
       Կարդալ էջը
     </button>
     <p data-reader-status role="status" aria-live="polite" hidden></p>
     <main data-reader-content>
       <h1>Բարի գալուստ</h1>
       <p>Այս տեքստը կհնչի բարձրաձայն։</p>
       <p data-reader-ignore>Այս նշումով տեքստը չի կարդացվի։</p>
     </main>
   </section>
   ```

3. Load the CSS and scripts. Keep the engine script before the widget script:

   ```html
   <link rel="stylesheet" href="armenian-reader.css">
   <script src="armenian-speech.js" defer></script>
   <script src="armenian-reader-widget.js" defer></script>
   ```

4. Serve the page over HTTPS or from localhost. For a quick local preview, run `py -m http.server 8000` in this folder and open <http://localhost:8000>.
5. Press **Կարդալ էջը**. On first use, the browser loads the included voice model (about 64 MB); the browser may cache it for later visits. The browser also downloads ONNX Runtime Web and the Piper phonemizer from jsDelivr. Text is processed in the browser; the fallback voice-model download is from Hugging Face if the local model files cannot be loaded.

## Configure

- Put `data-reader-ignore` on any element whose content should not be spoken. It is also not highlighted.
- Set `data-highlight="false"` on the outer `data-armenian-reader` element to turn off word highlighting while keeping speech enabled.
- Customize button labels with `data-label-play` and `data-label-stop`; customize the live status messages with `data-status-loading`, `data-status-preparing`, and `data-status-error` on the play button.
- The widget reads only the element marked `data-reader-content`.
- The default ignored elements are `script`, `style`, `noscript`, form controls, buttons, navigation, forms, hidden elements, elements with `aria-hidden="true"`, and elements marked `data-reader-ignore`.
- The play button and status text should be outside `data-reader-content` so the widget does not read its own controls.

## Files

- `armenian-reader-widget.js` — DOM integration, text collection, playback controls, optional word highlighting.
- `armenian-reader.css` — minimal accessible control and highlight styles; customize as needed.
- `armenian-speech.js` — browser audio playback and worker communication.
- `armenian-speech-worker.js` — text chunking, Armenian phonemization, and voice inference.
- `models/` — Piper voice model and its configuration.
- `index.html` — working demo.

## Accessibility and privacy

The play button uses `aria-pressed`; progress and errors are announced in a live status region. Highlighting is visual only and does not change the spoken text. The widget excludes its own controls when collecting text. Speech generation runs in the browser. The model and runtime libraries are downloaded as described above; no page text is sent to a speech server by this browser setup.

## Model and dependency notices

The included `hy_AM-gor-medium` voice model is from the community Armenian Piper voice project: <https://huggingface.co/davit312/piper-TTS-Armenian/tree/main/v3>. The upstream project identifies the model under GPL-2.0; review its current terms and include any required notices when redistributing. This package also loads ONNX Runtime Web 1.20.1 and `@diffusionstudio/piper-wasm` 1.0.0 from jsDelivr at runtime. Review their licenses and pin or self-host these dependencies according to your deployment policy. Piper engine information: <https://github.com/OHF-Voice/piper1-gpl>.

## GitHub note

The voice model is about 64 MB. It is below GitHub's per-file hard limit but makes clones and downloads large. For a smaller source repository, remove `models/` and adjust the documented model URL to a hosted copy. Keep the model's attribution and license notice with any distributed copy.
