/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./styles/**/*.{css}",
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        lightning: ["var(--font-lightning)", "cursive"],
      },
      colors: {
        night: {
          900: "#05060a",
          800: "#080b14",
        },
        gold: {
          300: "#fce7b2",
          400: "#f5d37a",
          500: "#e9bd48",
          600: "#d19e2f",
        },
        violet: {
          300: "#b48bf9",
          400: "#9c62f3",
          500: "#7e3fd9",
        },
      },
      boxShadow: {
        glow: "0 0 25px rgba(124, 58, 237, 0.45)",
        card: "0 20px 40px -24px rgba(15, 23, 42, 0.8)",
      },
      backgroundImage: {
        "radial-night": "radial-gradient(circle at top, rgba(148, 163, 184, 0.1), transparent 55%)",
        "hero-gradient": "linear-gradient(135deg, rgba(2, 6, 23, 0.85), rgba(76, 29, 149, 0.35))",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-100%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        marquee: "marquee 10s linear infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};
