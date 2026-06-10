/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#FFD8EC",
          100: "#FFAEDD",
          200: "#DC80B9",
          300: "#AE5A91",
          400: "#924177",
          500: "#60164B",
          600: "#430033",
          700: "#3B002D",
          800: "#2D0022",
          900: "#210019",
        },
        secondary: "#A53842",
        cranberry: "#FD7B82",
        background: {
          DEFAULT: "#FFF8F2",
          card: "#FFFFFF",
          surface: "#F4EDE5",
          elevated: "#FAF2EA",
          muted: "#E9E1D9",
        },
        text: {
          primary: "#1E1B17",
          secondary: "#51434A",
          muted: "#84727B",
          inverse: "#FFFFFF",
        },
        danger: "#BA1A1A",
        warning: "#A53842",
        success: "#6B8E6B",
        border: "#D6C1CA",
        "border-soft": "#E8D8E0",
      },
      boxShadow: {
        soft: "0 4px 20px rgba(96, 22, 75, 0.06)",
        lift: "0 12px 32px rgba(96, 22, 75, 0.1)",
      },
      fontFamily: {
        sans: ["var(--font-montserrat)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
