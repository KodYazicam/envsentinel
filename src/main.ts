import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function invokedDirectly(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(entry);
  } catch {
    try {
      return new URL(metaUrl).href === pathToFileURL(entry).href;
    } catch {
      return false;
    }
  }
}
