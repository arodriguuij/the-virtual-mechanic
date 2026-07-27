/** Official Strava icomark — a single fill path (Simple Icons' `siStrava`
 * glyph). Takes an explicit `color` (default Strava's corporate orange)
 * rather than `currentColor`, since every usage so far needs a fixed color
 * regardless of surrounding text color (white on the login button's orange
 * background, orange on the auth-callback screen's white background). */
export function StravaMark({
  className,
  color = "#FC4C02",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}
