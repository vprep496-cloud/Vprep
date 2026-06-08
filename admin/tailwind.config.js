/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ---------------------------------------------------------------
      // Phase 7 — Stitch UI design tokens.
      //
      // Mirrors mobile/tailwind.config.js so both apps share design tokens —
      // see that file for the full extraction rationale (short version: the
      // Stitch exports — including `admin_dashboard/code.html` — only ship a
      // `light` M3 rendering of a magenta/wine brand scheme, while this admin
      // app is built dark-first (`<html class="dark">` in app/layout.tsx, all
      // six phases of pages built against a dark palette). Re-deriving the
      // brand hue's *dark*-appropriate roles from the same Stitch scheme's
      // `inverse-*`/`on-*` tokens — rather than flipping the whole portal to
      // a literal light theme — keeps Phase 1-6 intact (Agent Rule #1) while
      // still making the admin portal visually consistent with Stitch's
      // brand identity.
      colors: {
        // Magenta/wine brand ramp, anchored at Stitch's `surface-tint`
        // (#924177 — M3's algorithmic key tone for the brand hue) and
        // expanded via HSL-lightness interpolation toward the literal
        // lightest/darkest primary-family tones Stitch exported
        // (`primary-fixed` #FFD8EC / `primary` #430033).
        primary: {
          50: "#FBDEED",
          100: "#E9CEE0",
          200: "#D9AACA",
          300: "#CA87B3",
          400: "#BB679F",
          500: "#924177",
          600: "#8D3F73",
          700: "#71325C",
          800: "#552645",
          900: "#3F0A31",
        },
        secondary: "#A53842", // Stitch `secondary`
        background: {
          DEFAULT: "#1E1B17", // Stitch `on-background` / `on-surface` (darkest warm neutral)
          card: "#33302B", // Stitch `inverse-surface` (this scheme's dark-counterpart surface)
          surface: "#423A3A", // interpolated next elevation step (between card and on-surface-variant)
        },
        text: {
          primary: "#F7EFE7", // Stitch `inverse-on-surface`
          secondary: "#D6C1CA", // Stitch `outline-variant`
          muted: "#84727B", // Stitch `outline`
        },
        danger: "#BA1A1A", // Stitch `error`
        warning: "#E0A458", // M3 has no warning role — warm gold chosen to harmonize with the brand family
        success: "#83A782", // derived from Stitch `on-tertiary-container`, shifted toward sage for a clear "positive" read
        border: "#3E3736", // interpolated separator tone between `card` and `surface`
      },
      // Stitch's `fontFamily` blocks name every text role "Montserrat" —
      // loaded here via `next/font/google` in app/layout.tsx and exposed as
      // a CSS variable consumed by `font-sans`.
      fontFamily: {
        sans: ["var(--font-montserrat)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
