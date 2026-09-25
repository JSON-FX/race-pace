# Trail Atlas organizer hero directions

Status: Open spread selected for implementation. The other four options remain visual proposals. See the [implementation plan](../../plans/2026-09-25-organizer-open-spread-featured-image.md).

The five options use the same 1484 × 1060 generated concept image and the existing Race Pace Fieldnotes palette and type roles. The photograph is illustrative. It does not depict the staging organizer or an actual Race Pace event.

| Option | Structure | Main tradeoff |
| --- | --- | --- |
| Open spread | Unboxed image beside organizer identity | Balanced, with little room for additional profile facts in the hero |
| Gallery profile | Centered photograph followed by identity caption | Maximum photo emphasis, taller first fold |
| Forest canopy | Dark identity band followed by a framed photograph | Strongest brand color, tallest composition |
| Atlas ledger | Compact identity rail beside the photograph | Good for profile facts, more structured appearance |
| Community header | Full-width identity above photograph and event state | Connects the hero to events, busier than a pure introduction |

## Image and data recommendation

Add an optional organizer featured image separate from the existing cover photo. The cover can remain a promotional banner with embedded copy. A profile featured image should be a photograph near a 7:5 landscape ratio, with important subjects away from the edges. Admin-provided images and null fallbacks need their own implementation and review after a direction is selected. Do not use the generated concept as a public profile claim.

## Research adaptation

- [Airbnb design analysis](https://getdesign.md/airbnb/design-md): image-led discovery and generous spacing informed Open spread and Community header. Race Pace keeps its own green palette, type, and race facts.
- [Nike design analysis](https://getdesign.md/nike/design-md): athletic editorial photography informed Gallery profile and Forest canopy. No Nike branding, typeface, or monochrome system was adopted.
- [Notion design analysis](https://getdesign.md/notion/design-md): quiet surfaces and clear hierarchy informed Atlas ledger. Race Pace retains its Fieldnotes typography and spacing.
- The local Storybook Hub's `projects/race-pace/DESIGN.md` supplies Race Pace colors, New York display type, San Francisco interface type, and responsive spacing.
- UI/UX Pro Max checks informed responsive image sizing, visible focus, and phone-width overflow checks. Impeccable guided the distinct visual structures and bounded desktop and mobile review.

## Generated image

Tool: built-in image generation. File: `assets/organizer-featured-trail-runners.png`.

```text
Use case: photorealistic-natural
Asset type: recommended featured photograph for the left panel of a Race Pace organizer profile hero, approximately 7:5 landscape composition
Primary request: a small group of Filipino trail runners moving along a lush mountain ridge in the Philippines at early morning, conveying community and outdoor racing
Scene/backdrop: layered green highlands, a soft misty valley, tropical mountain vegetation, a believable narrow trail
Style/medium: natural editorial sports photography, realistic people and landscape, crisp high-resolution detail, not an advertisement
Composition/framing: 7:5 landscape; runners visible as full figures in the middle ground, the trail leading into the scene; balanced focal point across the central 70 percent so the image works in a card; no important subject touching an edge
Lighting/mood: warm sunrise, quiet energy, natural color and contrast
Color palette: forest green, muted olive, warm gold, cool mist, compatible with a deep green interface
Constraints: no typography, no logo, no banners, no watermarks, no fake UI; respectful and plausible Filipino appearance; no visible race bib numbers or brand marks
```
