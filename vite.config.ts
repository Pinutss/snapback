import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps the build portable: it works from GitHub Pages sub-paths,
// any static host, or straight from the dist/ folder.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
