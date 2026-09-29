# Proof image decoders

Pinned decoder assets from the corresponding npm package releases:

- `jpeg.wasm`: `@jsquash/jpeg@1.6.0/codec/dec/mozjpeg_dec.wasm`
- `png.wasm`: `@jsquash/png@3.1.1/codec/pkg/squoosh_png_bg.wasm`
- `webp.wasm`: `@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm`

The JavaScript wrappers are imported at the same pinned versions. These assets ship with the Edge Function through `static_files`; verification requires no runtime CDN request. Upstream: https://github.com/jamsinclair/jSquash. The Apache 2.0 license is included here; codec source notices remain in the upstream packages.

Supabase Edge Runtime 1.74.2 cannot decode JPEG/WebP through `createImageBitmap`. Full decoding verifies uploaded image content after checking its byte size and declared dimensions. A 20-megapixel decode bound protects the worker's memory budget; the user-facing upload message must disclose this alongside the 10 MB limit.
