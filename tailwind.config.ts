import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0814",
        ink2: "#110c20",
        panel: "#17112b",
        panel2: "#1f1838",
        edge: "#2c2350",
        edge2: "#3d3170",
        text2: "#cfc9ea",
        mute: "#a69fc6",
        pot: "#836ef9",
        mint: "#8bf5c0",
        boom: "#ff5d73",
        gold: "#ffd166",
      },
      fontFamily: {
        display: ["var(--font-display)", "var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
