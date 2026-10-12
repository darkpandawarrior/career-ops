import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fontsSource = readFileSync(new URL("./fonts.ts", import.meta.url), "utf8");
const assets = [
  "../assets/fonts/inter/Inter-Latin-Variable.woff2",
  "../assets/fonts/instrument-serif/InstrumentSerif-Latin-Regular.woff2",
  "../assets/fonts/instrument-serif/InstrumentSerif-Latin-Italic.woff2",
];

test("web fonts are local and never use the Google build-time loader", () => {
  assert.match(fontsSource, /next\/font\/local/);
  assert.doesNotMatch(fontsSource, /next\/font\/google/);
});

test("every configured WOFF2 asset is vendored", () => {
  for (const relativePath of assets) {
    const bytes = readFileSync(new URL(relativePath, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2", `${relativePath} is not a WOFF2 file`);
    const configuredPath = relativePath.replace("../", "../");
    const escapedPath = configuredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(fontsSource, new RegExp(`path:\\s*["']${escapedPath}["']`));
  }
});

test("both vendored font families include their OFL license", () => {
  for (const relativePath of [
    "../assets/fonts/inter/OFL.txt",
    "../assets/fonts/instrument-serif/OFL.txt",
  ]) {
    assert.match(readFileSync(new URL(relativePath, import.meta.url), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});
