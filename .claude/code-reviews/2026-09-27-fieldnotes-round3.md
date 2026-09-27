# Open-event annotation review

Scope: three existing Runner component files, followed by a styling-only participant-row correction. Prior uncommitted Fieldnotes changes remain covered by earlier reviews.

## Review

- Distance facts reuse the existing canonical Badge with its default forest-green/white treatment. Values, category identity and entry actions are preserved.
- Participant prices retain formatPeso and authoritative stored centavo amounts. No calculation or provider value changed. The larger interface typography is display only.
- Participant categories render as full-width divided links. This removes the odd-count empty grid cell and aligns names, prices and arrows. Stable category IDs, accessible link names, hrefs and focus treatment remain intact. Mobile labels may wrap while prices and arrows stay together.
- The animated parallax wrapper is positioned relatively so its fill Image has a containing block. Motion values and the reduced-motion fallback remain intact.
- Shared primitive source, backend, authentication, reservation lifecycle and money mutations are unchanged. No dependency or new component abstraction was added.

## Evidence and findings

All 483 Runner tests, types and isolated build pass for the facts/price/positioning change. The final row layout passes all 37 existing event tests, types, static detector and whitespace checks. Desktop Browser review confirms 88px rows and forest-green/white prices. Narrow-phone DOM inspection confirms no overflow at 425px; the Browser's requested 320px override gave inconsistent capture dimensions, which is documented without claiming exact-width verification.

Technical review found no outstanding issues in this follow-up. Existing registration destinations and values are preserved. No release or provider action occurred.
