// Copies third-party browser files from node_modules into static/vendor/.
//
// The app has no build step: static/ is served as-is and vendor files are
// committed. Versions are pinned in package.json / package-lock.json; to
// update a library, bump it there, run `npm install && npm run vendor`
// and commit the result.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "static", "vendor");

// [source in node_modules, destination in static/vendor]
const FILES = [
    ["markdown-it/dist/browser/markdown-it.umd.min.js", "markdown-it/markdown-it.min.js"],
    ["markdown-it/LICENSE", "markdown-it/LICENSE"],
    ["dompurify/dist/purify.min.js", "dompurify/purify.min.js"],
    ["dompurify/LICENSE", "dompurify/LICENSE"],
];

for (const [src, dst] of FILES) {
    const to = path.join(OUT, dst);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(NM, src), to);
}

const versions = {};
for (const pkg of new Set(FILES.map(([src]) => src.split("/")[0].startsWith("@")
    ? src.split("/").slice(0, 2).join("/") : src.split("/")[0]))) {
    versions[pkg] = JSON.parse(fs.readFileSync(path.join(NM, pkg, "package.json"), "utf8")).version;
}
fs.writeFileSync(path.join(OUT, "VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("vendored:", versions);
