#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseEnv } from "./parse.js";
import { validateEnv, exampleFromSchema, typesFromSchema } from "./schema.js";
import { scanText, diffExample } from "./scan.js";
import { loadSchema, loadEnvFile, walkScanFiles } from "./project.js";
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
  envsentinel mcp

MCP:
  envsentinel mcp starts a stdio Model Context Protocol server for AI agents.
  Tools: validate_env, scan_secrets, generate_example, generate_types, diff_env.

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

function mcpHelp(): string {
  return `
envsentinel mcp — Model Context Protocol server

Usage:
  envsentinel mcp

Starts a stdio MCP server. stdout is reserved for the protocol; diagnostics
go to stderr. The server exposes:

  validate_env      Validate .env against the schema; never returns values.
  scan_secrets      Scan a tree or text for leaked secrets.
  generate_example  Generate .env.example content.
  generate_types    Generate env.d.ts content.
  diff_env          Compare .env with .env.example.

Example client configuration:

  {
    "mcpServers": {
      "envsentinel": {
        "command": "npx",
        "args": ["-y", "envsentinel", "mcp"]
      }
    }
  }

Runs locally. No network access, no API key, and no telemetry.
`.trim();
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
  if (cmd === "mcp") {
    if (argv.includes("-h") || argv.includes("--help")) {
      console.log(mcpHelp());
      return 0;
    }
    console.error("envsentinel mcp is a stdio server; run it directly as `envsentinel mcp`.");
    return 1;
  }

  const flag = (name: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx >= 0) return argv[idx + 1];
    return fallback;
  };
  const has = (name: string): boolean => argv.includes(name);

  try {
    if (cmd === "check") {
      const { schema } = loadSchema(cwd, flag("--schema"));
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
      const files = statSync(target).isDirectory() ? walkScanFiles(target) : [target];
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
      const { schema } = loadSchema(cwd, flag("--schema"));
      const out = flag("-o") ?? flag("--out") ?? ".env.example";
      writeFileSync(resolve(cwd, out), exampleFromSchema(schema));
      console.log(`wrote ${out}`);
      return 0;
    }

    if (cmd === "types") {
      const { schema } = loadSchema(cwd, flag("--schema"));
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

function startMcp(): void {
  import("./mcp.js")
    .then(({ runMcpServer }) => {
      runMcpServer();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`envsentinel mcp: ${message}`);
      console.error(
        "Install the optional MCP dependencies with: npm install @modelcontextprotocol/server zod",
      );
      process.exitCode = 1;
    });
}

if (invokedDirectly(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] === "mcp" && !argv.includes("-h") && !argv.includes("--help")) {
    const rest = argv.slice(1);
    if (rest.length > 0) {
      console.error(`envsentinel mcp: unexpected argument(s): ${rest.join(" ")}`);
      process.exitCode = 1;
    } else {
      startMcp();
    }
  } else {
    process.exitCode = run(argv);
  }
}
