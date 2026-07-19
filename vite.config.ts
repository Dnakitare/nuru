import { defineConfig } from "vite";

// Nuru ships as a GitHub Pages project site at dnakitare.github.io/nuru/, so
// built asset URLs need that subpath prefix. Dev server (npm run dev) ignores
// base and serves from root.
export default defineConfig({
  base: "/nuru/",
});
