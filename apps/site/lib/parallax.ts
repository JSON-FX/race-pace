/**
 * Pure math behind ParallaxMedia's scroll-linked drift. Kept separate from
 * the component so the clamping/timing logic is testable without a DOM.
 *
 * The image lags the page by `factor` (a fraction of scroll speed) — the
 * classic depth illusion — but only ever in one direction (down, revealing
 * the oversize buffer painted above it in the DOM) and only up to
 * `maxOffset`. That cap must match the pixels of oversize the component
 * paints around the media, or a translate past the buffer would tear a gap
 * at the section's edge.
 */

export interface ParallaxConfig {
  /** Fraction of scroll speed the media drifts by. ~0.2–0.4 reads as depth;
   *  higher reads as broken. */
  factor?: number;
  /** Max translate in px — must not exceed the oversize buffer in the DOM. */
  maxOffset?: number;
  /** When true, motion is disabled entirely and a constant is returned. */
  reducedMotion?: boolean;
}

export const DEFAULT_PARALLAX_FACTOR = 0.3;
export const DEFAULT_PARALLAX_MAX_OFFSET = 60;

/**
 * Vertical translate (px) to apply to the hero media at a given scroll
 * position.
 *
 * - Returns 0 before the section's top has scrolled past the viewport top
 *   (nothing should move before the hero is in play).
 * - Grows linearly with scroll distance past that point, scaled by `factor`.
 * - Clamped to `maxOffset` so it can never exceed the oversize buffer.
 * - Reduced motion always returns a constant 0 — the static layout must
 *   already look correct at rest, so 0 is the correct "no motion" value.
 */
export function parallaxOffset(
  scrollY: number,
  sectionTop: number,
  config: ParallaxConfig = {},
): number {
  const {
    factor = DEFAULT_PARALLAX_FACTOR,
    maxOffset = DEFAULT_PARALLAX_MAX_OFFSET,
    reducedMotion = false,
  } = config;

  if (reducedMotion) return 0;

  const relativeScroll = Math.max(0, scrollY - sectionTop);
  const raw = relativeScroll * factor;

  return Math.min(maxOffset, raw);
}
