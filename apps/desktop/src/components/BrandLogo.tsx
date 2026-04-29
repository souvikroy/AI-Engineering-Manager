import { cn } from "@/lib/cn";

/**
 * OpenGraphXEM brand mark.
 *
 * The mark is a downward-pointing triangle in deep forest green (#3D5520).
 * Sits on either a transparent dark background or a light tile depending on `tile`.
 * Pair with `<BrandWordmark>` for full logo+name treatments.
 */

interface MarkProps {
  size?: number;
  tile?: boolean;          // wrap in a light card-like tile (matches the icon asset)
  className?: string;
}

export function BrandMark({ size = 28, tile = false, className }: MarkProps) {
  if (tile) {
    return (
      <div
        className={cn("rounded-md bg-zinc-50 grid place-items-center shadow-sm", className)}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Triangle size={Math.round(size * 0.62)} />
      </div>
    );
  }
  return (
    <div className={cn("inline-grid place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      <Triangle size={Math.round(size * 0.78)} />
    </div>
  );
}

function Triangle({ size }: { size: number }) {
  // 20% inset between the triangle's corners and the bounding box, similar to the brand asset.
  return (
    <svg width={size} height={size} viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 26L1 4H31L16 26Z" fill="#3D5520" stroke="#3D5520" strokeWidth="0.5" strokeLinejoin="round" />
    </svg>
  );
}

interface LogoProps {
  size?: number;
  showText?: boolean;
  tile?: boolean;          // light tile behind the triangle (matches the brand asset exactly)
  className?: string;
  textClassName?: string;
}

export function BrandLogo({ size = 28, showText = true, tile = true, className, textClassName }: LogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={size} tile={tile} />
      {showText && (
        <span className={cn("font-semibold tracking-tight", textClassName)}>OpenGraphXEM</span>
      )}
    </div>
  );
}

/** Wordmark only — useful in headers where the mark is shown elsewhere. */
export function BrandWordmark({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-tight", className)}>OpenGraphXEM</span>;
}

export const BRAND_NAME = "OpenGraphXEM";
