# Third-party components

This project vendors the update mechanism from
`github.com/zandaulion/pwa-kit` at commit
`e2ad9dced4f471afb3d307b00af214dacd0d2e6e`. The public pwa-kit v0.1.0
documentation grants its original update code GPL-3.0-or-later.

`models/selfie_multiclass.tflite` is Google's MediaPipe SelfieMulticlass
256×256 float32 model. It matches the
[official model](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite)
byte-for-byte (SHA-256
`c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`).
Google's [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)
lists Apache License 2.0. The model retains those terms.

Kerfspan's own source is GPL-3.0-or-later. The v0.1.0 distribution includes
the full Apache 2.0 text for the model. Dependencies installed from package
registries retain their separate licenses.
