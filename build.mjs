import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const output = new URL("./dist/", root);

// Publish only runtime assets, never the working tree or test dependencies.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of [
  "index.html",
  "styles.css",
  "premium.css",
  "app.js",
  "assets",
  "vendor",
]) {
  await cp(new URL(name, root), new URL(name, output), { recursive: true });
}
console.log("Static release created in dist/");
