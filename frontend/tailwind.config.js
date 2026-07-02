import { fileURLToPath, URL } from "node:url";
import daisyui from "daisyui";

/** @type {import('tailwindcss').Config} */
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

export default {
  content: [
    `${frontendRoot}index.html`,
    `${frontendRoot}src/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      // Make Inter the default font everywhere. Tailwind's preflight applies
      // `fontFamily.sans` to the whole page, so overriding it here means every
      // element uses Inter without touching a single component. The fallbacks
      // keep text readable if Inter hasn't finished loading yet.
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      "light",
      "dark",
      "cupcake",
      "bumblebee",
      "emerald",
      "corporate",
      "synthwave",
      "retro",
      "cyberpunk",
      "valentine",
      "halloween",
      "garden",
      "forest",
      "aqua",
      "lofi",
      "pastel",
      "fantasy",
      "wireframe",
      "black",
      "luxury",
      "dracula",
      "cmyk",
      "autumn",
      "business",
      "acid",
      "lemonade",
      "night",
      "coffee",
      "winter",
      "dim",
      "nord",
      "sunset",
    ],
  },
};
