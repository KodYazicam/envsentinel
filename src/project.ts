import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv, type EnvMap } from "./parse.js";
import { parseSchema, type EnvSchema } from "./schema.js";
import { shouldSkipDir } from "./scan.js";

export interface LoadedSchema {
  schema: EnvSchema;
  path: string;
}

export function loadSchema(cwd: string, explicit?: string): LoadedSchema {
  const candidates = explicit ? [explicit] : ["env.schema.json", "envsentinel.schema.json"];
  for (const name of candidates) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${name}: invalid JSON (${(error as Error).message})`);
    }
    return { schema: parseSchema(raw, name), path };
  }
  throw new Error(
    `schema not found (looked for ${candidates.join(", ")}). Create env.schema.json, then: envsentinel example`,
  );
}

export function loadEnvFile(cwd: string, name: string): EnvMap {
  const path = resolve(cwd, name);
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8"));
}

export function walkScanFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (shouldSkipDir(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkScanFiles(abs, acc);
    else if (/\.(env|ts|js|mjs|cjs|json|yml|yaml|md|py)$/i.test(entry.name) || entry.name.startsWith(".env")) {
      acc.push(abs);
    }
  }
  return acc;
}
