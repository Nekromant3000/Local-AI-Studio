/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070b14",
          900: "#0b1020",
          850: "#0e1528",
          800: "#121a30",
          750: "#17213c",
          700: "#1d2948",
          600: "#2a3a61",
          500: "#41577f",
          400: "#617aa3",
          300: "#8ea6ca",
          200: "#c1d0e6",
          100: "#e5edf9",
        },
        accent: {
          500: "#6d7cff",
          400: "#8c96ff",
          300: "#aab2ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(109,124,255,.25), 0 8px 40px rgba(44,54,140,.22)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fadeUp .18s ease-out",
      },
    },
  },
  plugins: [],
};
