/**
 * Brand mark — downward white triangle with a chartreuse edge.
 *
 * Brand-agnostic file name + exports: future renames swap text only, never imports.
 *
 *  - <BrandMark/>      icon-only, scales by `size`
 *  - <BrandWordmark/>  mark + wordmark on a single baseline
 */

type MarkProps = {
  size?: number;
  className?: string;
  /** Override stroke color. Default is the chartreuse edge from the brand. */
  edge?: string;
  /** Override fill. Default white. */
  fill?: string;
  /** Subtle drop-shadow halo on dark surfaces. */
  glow?: boolean;
};

export function BrandMark({
  size = 32,
  className = "",
  edge = "#d9f871",
  fill = "#ffffff",
  glow = true,
}: MarkProps) {
  const filterId = `brand-glow-${size}`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="CTO Brain"
    >
      {glow && (
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <polygon
        points="8,22 92,22 50,92"
        fill={fill}
        stroke={edge}
        strokeWidth="2.4"
        strokeLinejoin="round"
        filter={glow ? `url(#${filterId})` : undefined}
      />
    </svg>
  );
}

export function BrandWordmark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={size} />
      <span className="leading-none flex items-baseline gap-1">
        <span className="text-[15px] font-semibold tracking-tight2 text-ink">
          CTO
        </span>
        <span className="text-[15px] font-semibold tracking-tight2 text-ink">
          Brain
        </span>
      </span>
    </span>
  );
}
