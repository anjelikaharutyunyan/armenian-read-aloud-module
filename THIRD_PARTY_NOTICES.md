# Third-party components

The package includes the `hy_AM-gor-medium` voice model and its JSON
configuration from the community Armenian Piper voice project:
<https://huggingface.co/davit312/piper-TTS-Armenian/tree/main/v3>.
The project's current speech-folder documentation identifies the model as
GPL-2.0. Confirm the license in the upstream repository at the time you
redistribute it and include any required license text/notices. This MIT
package license does not relicense the voice model.

At runtime, the speech worker loads these dependencies from jsDelivr:

- ONNX Runtime Web 1.20.1: <https://github.com/microsoft/onnxruntime>
- `@diffusionstudio/piper-wasm` 1.0.0: <https://github.com/diffusionstudio/piper-wasm>

These dependencies are not bundled in this folder. Their licenses apply to
their respective code. Self-host and review all dependency licenses if your
distribution policy requires that.

The Piper project is available at <https://github.com/OHF-Voice/piper1-gpl>.
