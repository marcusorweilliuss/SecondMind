import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#111113",
          850: "#161618",
          800: "#1c1c1f",
          700: "#26262a",
          600: "#34343a",
          500: "#52525b",
          400: "#71717a",
          300: "#a1a1aa",
          200: "#d4d4d8",
          100: "#e8e8ea",
        },
        accent: {
          DEFAULT: "#ffd43b",
          soft: "#f5c518",
          deep: "#caa400",
        },
        grass: "#7bd88f",
        coral: "#ff6b6b",
        sky: "#5bc8ff",
      },
      keyframes: {
        popIn: {
          "0%": { opacity: "0", transform: "scale(0.82) translateY(12px)" },
          "60%": { opacity: "1", transform: "scale(1.04) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        backdropIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        sweep: {
          from: { width: "0%" },
          to: { width: "100%" },
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(255,212,59,0.5)" },
          "70%": { boxShadow: "0 0 0 12px rgba(255,212,59,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,212,59,0)" },
        },
      },
      animation: {
        "pop-in": "popIn 0.32s cubic-bezier(0.18,0.89,0.32,1.28) both",
        "backdrop-in": "backdropIn 0.2s ease both",
        wiggle: "wiggle 0.5s ease-in-out",
        floaty: "floaty 3s ease-in-out infinite",
        sweep: "sweep 0.5s ease-out both",
        "pulse-ring": "pulseRing 1.8s ease-out infinite",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
