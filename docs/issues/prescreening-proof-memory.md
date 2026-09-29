# Pre-screening proof verification exceeds Edge memory

Status: root cause confirmed in hosted staging on 30 September 2026. Production is unchanged. The owner subsequently removed the custom 20-megapixel restriction; the product upload limit is now 10 MB only. Native codec safety protections remain enabled.

## Evidence and impact

A valid RGB PNG with dimensions 5,000 × 4,000 and size 70,322 bytes passes the accepted 10 MB / 20-megapixel limits. `prescreening-proof` version 1 terminated at 276,237,468 bytes with `Memory` / HTTP 546 at `2026-09-29T20:52:20Z`. The 20,004,000-pixel rejection works. Genuine 20-megapixel progressive JPEG and WebP files passed. Uploads alone held no capacity.

`verify-image.ts` checks dimensions, then fully decodes with jSquash WebAssembly. Its PNG implementation retains a full image allocation and copies RGBA pixels into JavaScript. At 20 megapixels, that copy alone is 80 MB. Removing that copy in an isolated experiment still retained a 181,731,328-byte WASM heap. A malformed decode followed by a valid decode grew that heap above 300 MB. Fresh instances also depended on garbage collection to release prior allocations. The defect entered with feature commit `c7d103e`.

Existing tests exercised tiny images and a tiny PNG padded to 10 MB. They tested compressed size, not large decoded images. The local Edge worker also enforces 256 MB, so genuine boundary fixtures can reproduce the defect.

## Selected fix

Keep Supabase Edge as the authorization and database boundary. Move only image decoding to a private Node route in the existing runner Vercel application, using the already locked Sharp version as a direct pinned dependency. The helper receives a short-lived signed proof URL, not a 10 MB request body. It has no database credentials or mutation authority.

1. Edge checks the authenticated verified booker and immutable upload ownership as before.
2. Edge signs the private object for 120 seconds and calls the helper with an environment-specific server secret.
3. The helper authenticates before fetching. Require the exact configured Supabase origin and exact proof-bucket object path. Disallow redirects and arbitrary query parameters. Bound both request JSON and streamed image bytes; cancel oversized or timed-out reads.
4. Reject other file signatures before invoking Sharp. Require JPEG, PNG or WebP; enforce 10,000,000 bytes. Remove the custom pixel-count limit. Fully decode with `failOn: warning` and native safety limits. Preserve the existing first-frame image semantics, rather than silently adding animation support.
5. Edge validates the helper response before setting `verified_at`. Helper failures leave the upload unverified and acquire no slots. No fallback to the known unsafe decoder.

The helper uses a separate secret in each environment. Never expose it through `NEXT_PUBLIC_*`. It never logs URLs, proof bytes or credentials. One active decode per instance is allowed; additional work fails retryably instead of growing memory without bound.

## Rejected approaches

- Lowering the user-approved byte limit or accepting metadata without complete decoding.
- Removing only the compressed input copy, which is 70 KB in the failing case.
- Retaining jSquash with a custom WASM import or relying on garbage collection between codecs.
- Stock pngjs, which retains scanlines and additional full-frame buffers.
- A new custom PNG codec/build toolchain. Row decoding also needs separate handling for extreme dimensions, checksum errors and animation.

## Files and validation

- Add a server-only helper and Next route, focused route/security tests, and genuine 20-megapixel fixtures.
- Update `prescreening-proof` to call the helper and remove unused decoder binaries/imports.
- Start the local helper during backend CI so real Edge API tests exercise the full boundary.
- Test each format, RGB/RGBA/16-bit PNG, malformed data, exact byte limits, 48-megapixel images, oversized files, missing/wrong secret, foreign origins/paths, redirects, streamed overruns, timeouts, warm mixed-format requests and concurrent requests.
- Run full repository checks. Deploy the compatible helper and Edge/configuration change to staging, then repeat Browser uploads at the exact deployed revision. Verify private access and held-slot behavior remain unchanged.
- Release records must include the helper deployment and secret fingerprints. Any unavailable helper blocks proof verification safely. Production promotion remains blocked until all required staging checks pass.

References: [Supabase limits](https://supabase.com/docs/guides/functions/limits), [Sharp input safety](https://sharp.pixelplumbing.com/api-constructor/), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Deployment configuration

Set `PROOF_VERIFIER_SECRET` in the matching runner Vercel environment and Supabase secrets. Set `PROOF_VERIFIER_URL` to that environment's `/api/internal/prescreening-proof` route. Protected staging also needs the runner project's existing automation token as `PROOF_VERIFIER_BYPASS_SECRET` in Edge secrets. This is sent only as a server header; helper authentication remains independently required. Never put either secret in public variables or logs. Deploy the helper before switching Edge verification.
