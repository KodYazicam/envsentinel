#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { parseEnv } from "./parse.js";
import {
  validateEnv,
  exampleFromSchema,
  typesFromSchema,
  parseSchema,
  type EnvSchema,
} from "./schema.js";
import { scanText, diffExample, shouldSkipDir } from "./scan.js";
import { invokedDirectly } from "./main.js";
import { packageVersion } from "./version.js";

function help(): string {
  return `
envsentinel — validate env files, scan secrets, generate types

One JSON schema drives five commands: check, scan, example, types, diff.
Nothing is uploaded. There is no cloud.

Usage:
  envsentinel check [--schema file] [--env file] [--strict] [--strict-file] [--json]
  envsentinel scan [dir] [--json]
  envsentinel example [--schema file] [-o .env.example]
  envsentinel types [--schema file] [-o env.d.ts]
  envsentinel diff [--example .env.example] [--env .env]

Default schema: env.schema.json  (or envsentinel.schema.json)
Default env:    .env

check:
  Reads --env, then fills missing schema keys from process.env unless
  --strict-file is set. Unknown keys in the file are warnings unless
  --strict is set (then they fail the run). Empty values fall back to
  the field default when one is declared. --json prints a machine-
  readable report (issues and counts only, never values).

scan:
  Walks source-like files and reports AWS / GitHub / OpenAI / Anthropic /
  Stripe / Slack / Google / Telegram / npm / PEM shapes. Skips
  node_modules, .git, dist, .venv, vendor, lockfiles, and .env.example.
  --json prints one JSON object with the leak list (no secret values).

License: KYAL-1.0 — free to use, attribution required.
https://github.com/KodYazicam/envsentinel
`.trim();
}

function loadSchema(cwd: string, explicit?: string): EnvSchema {
  const candidates = explicit
    ? [explicit]
    : ["env.schema.json", "envsentinel.schema.json"];
  for (const name of candidates) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw new Error(`${name}: invalid JSON (${(error as Error).message})`);
      }
      return parseSchema(raw, name);
    }
  }
  throw new Error(
    `schema not found (looked for ${candidates.join(", ")}). Create env.schema.json, then: envsentinel example`,
  );
}

function loadEnvFile(cwd: string, name: string): Record<string, string> {
  const path = resolve(cwd, name);
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8"));
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (shouldSkipDir(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, acc);
    else if (/\.(env|ts|js|mjs|cjs|json|yml|yaml|md|py)$/i.test(entry.name) || entry.name.startsWith(".env")) {
      acc.push(abs);
    }
  }
  return acc;
}

export function run(argv: string[], cwd = process.cwd()): number {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(help());
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(packageVersion());
    return 0;
  }

  const flag = (name: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx >= 0) return argv[idx + 1];
    return fallback;
  };
  const has = (name: string): boolean => argv.includes(name);

  try {
    if (cmd === "check") {
      const schema = loadSchema(cwd, flag("--schema"));
      const envName = flag("--env", ".env") as string;
      const fileEnv = loadEnvFile(cwd, envName);
      const merged: Record<string, string | undefined> = { ...fileEnv };
      if (!has("--strict-file")) {
        for (const key of Object.keys(schema.fields)) {
          if (merged[key] === undefined && process.env[key] !== undefined) {
            merged[key] = process.env[key];
          }
        }
      }
      const result = validateEnv(merged, schema);
      const unknown = result.issues.filter((i) => i.severity === "warning");
      const strictFailed = has("--strict") && unknown.length > 0;
      if (has("--json")) {
        const report = {
          ok: result.ok && !strictFailed,
          env: envName,
          variables: Object.keys(result.values).length,
          issues: [...result.issues, ...(strictFailed ? [{ key: "--strict", message: "unknown keys are not allowed", severity: "error" }] : [])],
        };
        console.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
      }
      for (const issue of result.issues) {
        const tag = issue.severity === "error" ? "error" : "warn ";
        console.error(`${tag}  ${issue.key}: ${issue.message}`);
      }
      if (strictFailed) {
        console.error("error  --strict: unknown keys are not allowed");
        return 1;
      }
      if (result.ok) {
        console.log(`ok  ${Object.keys(result.values).length} variables`);
        return 0;
      }
      return 1;
    }

    if (cmd === "scan") {
      const target = resolve(cwd, argv[1] && !argv[1].startsWith("-") ? argv[1] : ".");
      const files = statSync(target).isDirectory() ? walkFiles(target) : [target];
      let count = 0;
      const leaks: Array<{ file: string; line: number; kind: string; key?: string }> = [];
      for (const file of files) {
        let source = "";
        try {
          source = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const found = scanText(relative(cwd, file) || file, source);
        leaks.push(...found);
        for (const leak of found) {
          count += 1;
          console.error(`secret  ${leak.file}:${leak.line}  ${leak.kind}${leak.key ? `  (${leak.key})` : ""}`);
        }
      }
      if (has("--json")) {
        console.log(
          JSON.stringify({ ok: count === 0, filesScanned: files.length, leaks }, null, 2),
        );
        return count === 0 ? 0 : 1;
      }
      if (count === 0) {
        console.log("ok  no secrets found");
        return 0;
      }
      return 1;
    }

    if (cmd === "example") {
      const schema = loadSchema(cwd, flag("--schema"));
      const out = flag("-o") ?? flag("--out") ?? ".env.example";
      writeFileSync(resolve(cwd, out), exampleFromSchema(schema));
      console.log(`wrote ${out}`);
      return 0;
    }

    if (cmd === "types") {
      const schema = loadSchema(cwd, flag("--schema"));
      const out = flag("-o") ?? flag("--out") ?? "env.d.ts";
      writeFileSync(resolve(cwd, out), typesFromSchema(schema));
      console.log(`wrote ${out}`);
      return 0;
    }

    if (cmd === "diff") {
      const exampleName = flag("--example", ".env.example") as string;
      const envName = flag("--env", ".env") as string;
      const examplePath = resolve(cwd, exampleName);
      const envPath = resolve(cwd, envName);
      if (!existsSync(examplePath)) {
        console.error(`missing ${exampleName}`);
        return 1;
      }
      const example = parseEnv(readFileSync(examplePath, "utf8"));
      const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
      const { missing, extra } = diffExample(Object.keys(example), Object.keys(env));
      for (const key of missing) console.error(`missing  ${key}`);
      for (const key of extra) console.error(`extra    ${key}`);
      if (missing.length === 0 && extra.length === 0) {
        console.log("ok  env matches example");
        return 0;
      }
      return missing.length ? 1 : 0;
    }

    console.error(`unknown command: ${cmd}`);
    return 1;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (invokedDirectly(import.meta.url)) process.exitCode = run(process.argv.slice(2));
