# Third-party components and source

This release is based on the public Kerfspan source at commit
`df872fd377b544041bceebab130dc8033966fcbe`. The release tree removes
portrait-derived screenshots and replaces the landing preview with synthetic
vector geometry. The Kerfspan application code and documentation are licensed
GPL-3.0-or-later; see `LICENSE`.

`models/selfie_multiclass.tflite` is Google's MediaPipe SelfieMulticlass
256×256 float32 model, downloaded from the
[official model URL](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite).
The bundled 16,371,837-byte file exactly matches that download as checked on
2026-10-21. SHA-256:
`c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`.
Google's [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)
lists Apache License 2.0; its complete text is in
`THIRD_PARTY_LICENSES/Apache-2.0.txt`. The model retains that license.

`web/pwa-update.js` and `web/sw-update.js` adapt the update mechanism from
[pwa-kit](https://github.com/zandaulion/pwa-kit) at commit
`e2ad9dced4f471afb3d307b00af214dacd0d2e6e`. The public
[pwa-kit v0.1.0](https://github.com/zandaulion/pwa-kit/releases/tag/v0.1.0)
documents GPL-3.0-or-later for the original update code.

Docker builds fetch Node and Python dependencies from the package registries;
those packages retain their own licenses and are not inside this source ZIP.
