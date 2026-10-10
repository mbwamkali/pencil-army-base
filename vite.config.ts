import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig } from "vitest/config";

/** Lists every built file in a service worker so the whole game works offline after the first visit. */
function offlineSupport() {
  return {
    name: "offline-support",
    apply: "build" as const,
    writeBundle(options: { dir?: string }) {
      const dir = options.dir ?? "dist";
      const files: string[] = [];
      const walk = (d: string) => {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (name !== "sw.js") files.push(relative(dir, full).split("\\").join("/"));
        }
      };
      walk(dir);
      files.sort();
      const version = createHash("sha1")
        .update(files.map((f) => f + createHash("sha1").update(readFileSync(join(dir, f))).digest("hex")).join("|"))
        .digest("hex")
        .slice(0, 10);
      const urls = ["./", ...files.map((f) => `./${f}`)];
      writeFileSync(
        join(dir, "sw.js"),
        `const CACHE = "pencil-army-base-${version}";
const FILES = ${JSON.stringify(urls)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(e.request)));
});
`,
      );
    },
  };
}

const appVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

export default defineConfig({
  // The version in package.json, shown on the main menu and the About screen.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // Relative paths so the build works from any folder, such as a GitHub Pages project site.
  base: "./",
  plugins: [offlineSupport()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
