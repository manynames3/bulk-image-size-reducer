# Test Fixtures

`sample.heic` is the [heic2any demo fixture](https://github.com/alexcorvi/heic2any/blob/master/demo/1.heic), used to exercise actual HEIC decoding instead of renaming a JPEG. The project's MIT license is already retained at [vendor/heic2any/LICENSE.md](../../vendor/heic2any/LICENSE.md).

Other images are generated in-browser or read from the bundled sample photos. Fault-injection tests explicitly simulate unavailable resources, decoder dimensions, allocation failures or inflated size metadata; they do not claim to reproduce a physical device running out of memory.

`sample.avif` and `sample.webp` are genuine codec fixtures derived from `assets/samples/alpine-lake-thumb.jpg`, with the photo source documented in `assets/README.md`. AVIF was encoded with macOS `sips`; WebP with Chrome's canvas encoder. These bundled fixtures do not require those encoders when running the tests. EXIF orientation fixtures and the 48 MP test image are generated inside the tests.
