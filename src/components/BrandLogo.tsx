import Image from "next/image";

const LOGO_SRC = "/cto-brain-logo.png";

type MarkProps = {
  size?: number;
  className?: string;
  glow?: boolean;
};

export function BrandMark({ size = 32, className = "", glow = false }: MarkProps) {
  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={LOGO_SRC}
        alt="CTO Brain"
        width={size}
        height={size}
        priority={size >= 64}
        className="select-none"
        style={{
          clipPath: "circle(50%)",
          filter: glow
            ? "drop-shadow(0 0 12px rgba(251,146,60,0.55))"
            : undefined,
        }}
      />
    </span>
  );
}

export function MascotHero({
  size = 200,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const halo = Math.round(size * 1.35);
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <Image
          src={LOGO_SRC}
          alt=""
          width={halo}
          height={halo}
          aria-hidden
          className="select-none opacity-55"
          style={{
            clipPath: "circle(50%)",
            filter: "blur(38px) saturate(1.4)",
            transform: `scale(1)`,
          }}
        />
      </span>
      <Image
        src={LOGO_SRC}
        alt="CTO Brain"
        width={size}
        height={size}
        priority
        className="relative select-none"
        style={{
          clipPath: "circle(50%)",
          filter: "drop-shadow(0 14px 30px rgba(251,146,60,0.35))",
        }}
      />
    </span>
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
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight2 text-ink leading-none">
        CTO Brain
      </span>
    </span>
  );
}
