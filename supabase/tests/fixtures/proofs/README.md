# Synthetic proof fixtures

These files contain generated solid colors, not participant information. The small `valid` fixtures cover MIME decoding. Large fixtures exercise decoded memory independently of compressed file size.

- `20mp-*` and `20mp.webp`: 5000 × 4000 pixels; RGB PNG, 16-bit RGBA PNG, progressive JPEG, lossy/lossless WebP.
- `over20mp.png`: 5001 × 4000 pixels. This is accepted after the owner removed the custom 20 MP limit.
- `48mp.png` and `48mp.jpeg`: 8000 × 6000 pixels, both below 10,000,000 bytes.

Tests pad a valid PNG to exactly 10,000,000 bytes to check the byte boundary. Truncation and oversized fixtures are produced in tests. Native codec safety protections remain enabled.
