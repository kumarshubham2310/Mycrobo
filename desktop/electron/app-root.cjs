const { resolve } = require("node:path");

function resolveApplicationRoot({ isPackaged, appPath, sourceDirectory }) {
  if (isPackaged) return resolve(String(appPath || ""));
  if (!sourceDirectory) throw new Error("The Electron source directory is required in development mode.");
  return resolve(sourceDirectory, "..", "..");
}

module.exports = { resolveApplicationRoot };
