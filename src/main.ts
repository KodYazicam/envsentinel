import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function invokedDirectly(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // npm installs the bin as a symlink. Resolve both sides so `envsentinel`
    // (the link) is recognised as the same file as dist/cli.js (the target).
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(entry));
  } catch {
    try {
      return new URL(metaUrl).href === pathToFileURL(entry).href;
    } catch {
      return false;
    }
  }
}
