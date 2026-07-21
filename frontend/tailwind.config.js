/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    // Section 11 (Design System & Design Tokens) extends this once that
    // document is approved — colors/typography/radius/elevation tokens
    // referencing CSS custom properties in src/styles/tokens.css, per
    // docs/FRONTEND_ARCHITECTURE.md Section 11 note. Spacing/breakpoints
    // deliberately stay Tailwind's defaults (Section 11: "not reinventing
    // a spacing scale Tailwind already provides well").
    extend: {},
  },
  plugins: [],
};
