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
          DEFAULT: "#0a0a0c",
          elevated: "#0f0f12",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.03)",
          hover: "rgba(255,255,255,0.06)",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.14)",
        },
        ink: {
          DEFAULT: "#fafafa",
          dim: "rgba(255,255,255,0.62)",
          faint: "rgba(255,255,255,0.42)",
          ghost: "rgba(255,255,255,0.22)",
        },
        accent: {
          DEFAULT: "#a78bfa",
          glow: "rgba(167,139,250,0.16)",
          edge: "rgba(167,139,250,0.40)",
        },
        ok: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
      },
      backgroundImage: {
        "grid-fade": "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(167,139,250,0.10), transparent 70%)",
        "shimmer": "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.4s ease-out",
        "shimmer": "shimmer 2s infinite",
        "pulse-soft": "pulse-soft 2.5s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
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
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(167,139,250,0.30), 0 8px 24px -8px rgba(167,139,250,0.20)",
      },
    },
  },
  plugins: [],
};

export default config;
