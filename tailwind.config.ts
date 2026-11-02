import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14110F",
        ink2: "#1A1613",
        panel: "#1E1A17",
        panel2: "#26211D",
        edge: "#332D27",
        edge2: "#4A423A",
        text2: "#D4CCBF",
        mute: "#A39B8E",
        portal: "#E8B04A",
        mint: "#6FCF97",
        boom: "#F0707A",
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
