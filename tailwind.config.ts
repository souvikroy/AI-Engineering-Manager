import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d12",
        surface: "#12151c",
        border: "#1f2430",
        muted: "#7a8497",
        accent: "#7c5cff",
        ok: "#3ddc97",
        warn: "#ffb454",
        bad: "#ff6b6b",
      },
    },
  },
  plugins: [],
};

export default config;
