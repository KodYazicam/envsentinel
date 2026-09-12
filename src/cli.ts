#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { parseEnv } from "./parse.js";
import {
  validateEnv,
  exampleFromSchema,
  typesFromSchema,
  type EnvSchema,
} from "./schema.js";
import { scanText, diffExample } from "./scan.js";
import { invokedDirectly } from "./main.js";

function help(): string {
  return `
envsentinel — validate env files, scan secrets, generate types

Usage:
  envsentinel check [--schema file] [--env file]
  envsentinel scan [dir]
  envsentinel example [--schema file] [-o .env.example]
  envsentinel types [--schema file] [-o env.d.ts]
  envsentinel diff [--example .env.example] [--env .env]

Default schema: env.schema.json  (or envsentinel.schema.json)
Default env:    .env

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
      return JSON.parse(readFileSync(path, "utf8")) as EnvSchema;
    }
  }
  throw new Error(
    `schema not found (looked for ${candidates.join(", ")}). Run: envsentinel example`,
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
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
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
    console.log("1.0.0");
    return 0;
  }

  const flag = (name: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx >= 0) return argv[idx + 1];
    return fallback;
  };

  try {
    if (cmd === "check") {
      const schema = loadSchema(cwd, flag("--schema"));
      const envName = flag("--env", ".env") as string;
      const fileEnv = loadEnvFile(cwd, envName);
      const merged: Record<string, string | undefined> = { ...fileEnv };
      for (const key of Object.keys(schema.fields)) {
        if (merged[key] === undefined && process.env[key] !== undefined) {
          merged[key] = process.env[key];
        }
      }
      const result = validateEnv(merged, schema);
      for (const issue of result.issues) {
        const tag = issue.severity === "error" ? "error" : "warn ";
        console.error(`${tag}  ${issue.key}: ${issue.message}`);
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
      for (const file of files) {
        let source = "";
        try {
          source = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const leaks = scanText(relative(cwd, file) || file, source);
        for (const leak of leaks) {
          count += 1;
          console.error(`secret  ${leak.file}:${leak.line}  ${leak.kind}${leak.key ? `  (${leak.key})` : ""}`);
        }
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
