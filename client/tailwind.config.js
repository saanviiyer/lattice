/** @type {import('tailwindcss').Config} */

// Every themed colour resolves through a CSS variable holding raw RGB channels, so
// `bg-slate-900/90` and `border-veil/[.07]` keep working while the theme swaps the
// values underneath. The alternative -- a `dark:` variant on each of the ~520 colour
// classes in the components -- would have been a far larger and much more fragile
// change, and would have left the two themes free to drift apart.
const themed = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const scale = (name, shades) =>
  Object.fromEntries(shades.map((shade) => [shade, themed(`${name}-${shade}`)]));

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: scale("slate", [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        cyan: scale("cyan", [200, 300, 400, 500]),
        indigo: scale("indigo", [300, 400, 500, 600]),
        rose: scale("rose", [300, 400, 500]),
        amber: scale("amber", [300, 400, 500]),
        emerald: scale("emerald", [300, 400, 500]),
        sky: scale("sky", [300, 400, 500]),
        fuchsia: scale("fuchsia", [300]),
        // The app's surfaces, named by what they are rather than by a hex value that
        // only made sense against a dark ground.
        surface: {
          rail: themed("surface-rail"),      // sidebar and title bar
          header: themed("surface-header"),  // sticky list headers
          card: themed("surface-card"),      // list rows and cards
          raised: themed("surface-raised"),  // popovers and menus
          notice: themed("surface-notice"),  // toasts
        },
        // Recessed surfaces -- segmented controls, inset panels. Black at 20-25% over
        // a dark ground; on light that is a charcoal slab that swallows the text on it.
        well: themed("well"),
        // Hairline borders and raised surfaces. White at 4-8% over a dark ground;
        // the same idea in light needs ink, not white, or it simply disappears.
        veil: themed("veil"),
      },
      // slate-700 and -800 do double duty: a border/fill in most places, faint text
      // in a few. On a dark ground one value served both, because a faint border and
      // faint text are both "slightly lighter than the page". On white they diverge --
      // a border light enough to be a hairline is 1.4:1 as text, i.e. invisible -- so
      // text gets its own value at those two steps.
      textColor: ({ theme }) => ({
        ...theme("colors"),
        slate: {
          ...theme("colors.slate"),
          600: themed("text-600"),
          700: themed("text-700"),
          800: themed("text-800"),
        },
      }),
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
