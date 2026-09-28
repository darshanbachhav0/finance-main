import path from "node:path";
import { fileURLToPath } from "node:url";

// True when the calling module is the script Node was started with (`node thisFile.js`),
// false when it was imported (e.g. in-process from server.js or from a test).
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(fileURLToPath(importMetaUrl)) === normalize(process.argv[1]);
}
