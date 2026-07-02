// PostCSS pipeline for the frontend build:
//  - tailwindcss   turns the @tailwind directives + utility classes into CSS
//  - autoprefixer  adds vendor prefixes so styles work across browsers
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
