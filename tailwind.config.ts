import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        bg: {
          DEFAULT: "#0c0a08",
          elevated: "#15110d",
          deep: "#070605",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.025)",
          hover: "rgba(255,255,255,0.05)",
          strong: "rgba(255,255,255,0.06)",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.06)",
          strong: "rgba(255,255,255,0.12)",
          accent: "rgba(251,146,60,0.32)",
        },
        ink: {
          DEFAULT: "#fafafa",
          dim: "rgba(255,255,255,0.65)",
          faint: "rgba(255,255,255,0.42)",
          ghost: "rgba(255,255,255,0.22)",
        },
        accent: {
          DEFAULT: "#fb923c",
          hot: "#fdba74",
          glow: "rgba(251,146,60,0.18)",
          edge: "rgba(251,146,60,0.45)",
        },
        signal: {
          pink: "#fde68a",
          teal: "#5eead4",
          amber: "#fbbf24",
        },
        ok: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
      },
      letterSpacing: {
        display: "-0.035em",
        tight2: "-0.022em",
        kicker: "0.18em",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251,146,60,0.10), transparent 70%)",
        "shimmer":
          "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
        "accent-gradient":
          "linear-gradient(135deg, #fb923c 0%, #fdba74 55%, #fde68a 100%)",
        "ink-gradient":
          "linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.55) 100%)",
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out",
        "slide-up": "slide-up 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
        "shimmer": "shimmer 2.4s infinite",
        "pulse-soft": "pulse-soft 2.6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
        "rise": "rise 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "shimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "1" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "rise": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(251,146,60,0.32), 0 8px 28px -8px rgba(251,146,60,0.32)",
        "soft-lift":
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 32px -16px rgba(0,0,0,0.6)",
        "ring-accent":
          "0 0 0 1px rgba(251,146,60,0.35), 0 0 24px -4px rgba(251,146,60,0.30)",
      },
    },
  },
  plugins: [],
};

export default config;
