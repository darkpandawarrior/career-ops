// electron-builder's extraResources copier has special-cased node_modules
// handling (app-builder-lib/util/appFileCopier.js) that prunes/dedupes it
// as if it were the app's own dependency tree, rather than copying it
// verbatim -- it drops our pre-built Next.js standalone node_modules
// entirely. This hook copies it in directly after packaging, bypassing
// that logic.
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  const src = path.resolve(__dirname, "..", "..", "web", ".next", "standalone", "node_modules");
  const dest = path.join(resourcesDir, "web", "node_modules");

  fs.cpSync(src, dest, { recursive: true, dereference: true });
};
