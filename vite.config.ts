import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Lists files in public/ (copied as-is, so not part of the bundle). */
function publicFiles(dir = "public"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicFiles(join(dir, e.name)) : [relative("public", join(dir, e.name)).replaceAll("\\", "/")],
  );
}

/**
 * Emits sw.js with the full list of built files, so the installed app works
 * offline from the first visit (including the lazily loaded zip / EXIF readers).
 */
function serviceWorker(): Plugin {
  return {
    name: "snapback-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter((f) => !f.endsWith(".map")), ...publicFiles()].sort();
      // Hash contents, not names: public/ files keep their name when edited.
      const hash = createHash("sha256");
      for (const f of files) {
        const out = bundle[f];
        hash.update(f);
        if (!out) hash.update(readFileSync(join("public", f)));
        else hash.update(out.type === "chunk" ? out.code : out.source);
      }
      const version = hash.digest("hex").slice(0, 12);
      const precache = ["./", ...files.filter((f) => f !== "index.html")];
      const source = readFileSync("pwa/sw.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// `base: "./"` keeps the build portable: it works from GitHub Pages sub-paths,
// any static host, or straight from the dist/ folder.
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
});
