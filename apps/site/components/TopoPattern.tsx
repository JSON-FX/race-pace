/**
 * Signature fallback for event photography. None of the seeded events carry
 * a hero_image_url yet, so this is the path that actually renders — it
 * stands in for a hero photo, not a placeholder for one. Drawn as
 * topographic elevation contours (the shape a trail's climb takes on a
 * map), with a single trail-green line threading through the layers as
 * the route line, tying the motif directly to the elevation_gain_m /
 * cutoff_hours stats shown elsewhere on the same page.
 */
export function TopoPattern({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="400" height="300" fill="rgb(var(--forest))" />
      <g fill="none" stroke="white" strokeOpacity="0.09" strokeWidth="1.25">
        <path d="M-20,240 C60,200 100,260 180,220 C260,180 300,230 420,190" />
        <path d="M-20,200 C70,165 110,215 190,180 C270,145 310,190 420,155" />
        <path d="M-20,160 C80,130 120,170 200,140 C280,110 320,150 420,120" />
        <path d="M-20,120 C90,95 130,125 210,100 C290,75 330,110 420,85" />
        <path d="M-20,80 C100,60 140,85 220,62 C300,40 340,70 420,50" />
      </g>
      <path
        d="M-20,255 C50,215 90,270 170,225 C250,180 290,150 340,95 C365,68 390,55 420,40"
        fill="none"
        stroke="rgb(var(--primary))"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
