<p align="center">
  <img src="assets/banner.svg" alt="envsentinel" width="100%">
</p>

<p align="center">
  <strong>Stop shipping broken env files.</strong><br/>
  Schema validation, secret scan, <code>.env.example</code> and TypeScript types from one JSON file.
</p>

<p align="center">
  <a href="https://github.com/KodYazicam/envsentinel/actions"><img src="https://img.shields.io/github/actions/workflow/status/KodYazicam/envsentinel/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@kodyazicam/envsentinel"><img src="https://img.shields.io/npm/v/@kodyazicam/envsentinel?style=flat-square" alt="npm"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/license-KYAL--1.0-7C3AED?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/author-KodYazicam-0D0D0D?style=flat-square" alt="Author">
</p>

---

`envsentinel` is the missing linter for environment variables. Point it at `env.schema.json` and it will:

- **check** — coerce and validate `.env`, optionally filling gaps from `process.env`
- **scan** — find AWS / GitHub / OpenAI / Anthropic / Stripe / Slack / Google / Telegram / npm / PEM secrets (skips `.env.example` and lockfiles)
- **example** — generate `.env.example` (postgres URLs get `postgres://…`, not `https://example.com`)
- **types** — generate `env.d.ts` (`Env` plus `ProcessEnv` string fields)
- **diff** — compare `.env` against `.env.example` (the classic “works on my machine” bug)

```bash
npx @kodyazicam/envsentinel check
```

Or install it globally:

```bash
npm install -g @kodyazicam/envsentinel
envsentinel check
```

This is a **linter**, not a vault. A green `scan` does not mean “no secrets in git.” See [SECURITY.md](./SECURITY.md).

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [MCP server for AI agents](#mcp-server-for-ai-agents)
- [Schema](#schema)
- [CLI](#cli)
- [What `check` actually reads](#what-check-actually-reads)
- [GitHub Action](#github-action)
- [CI](#ci)
- [Library](#library)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license--kyal-10)

## Requirements

- Node.js **20+**
- `env.schema.json` or `envsentinel.schema.json` in the project (or `--schema`)

## Install

Global CLI:

```bash
npm install -g @kodyazicam/envsentinel
envsentinel check
```

One-off use:

```bash
npx @kodyazicam/envsentinel check
```

Library:

```bash
npm install @kodyazicam/envsentinel
```

From source:

```bash
git clone https://github.com/KodYazicam/envsentinel.git
cd envsentinel
npm ci
npm test
npm run build
node dist/cli.js check
# optional: npm link   →  envsentinel check
```

## Quick start

1. Write `env.schema.json` (copy the demo in this repo if you want a start).
2. `node dist/cli.js example` → `.env.example`
3. Copy to `.env` and fill real values.
4. `envsentinel check` in local scripts and CI.
5. `envsentinel types -o src/env.d.ts` so TypeScript knows the keys.

Broken JSON in the schema is a **clear error**, not a stack trace. Unknown `type` values are rejected up front.

## MCP server for AI agents

`envsentinel` can run as a stdio [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude Desktop, Claude Code, Cursor, and other MCP clients can validate environment files and scan for leaks as tools:

```bash
envsentinel mcp
```

| Tool | What it does |
| --- | --- |
| `validate_env` | Validates `.env` against the schema and returns issues/counts, never values. |
| `scan_secrets` | Scans a directory or text for leaked secrets and returns file:line/kind, never values. |
| `generate_example` | Returns generated `.env.example` content without writing it. |
| `generate_types` | Returns generated `env.d.ts` content without writing it. |
| `diff_env` | Compares `.env` with `.env.example` and returns missing/extra keys. |

Example client configuration:

```json
{
  "mcpServers": {
    "envsentinel": {
      "command": "npx",
      "args": ["-y", "@kodyazicam/envsentinel", "mcp"]
    }
  }
}
```

For Claude Code:

```bash
claude mcp add envsentinel -- npx -y @kodyazicam/envsentinel mcp
```

The MCP command is optional: normal CLI and library use does not load the SDK. The MCP dependencies are installed by default; if you install with `--omit=optional`, install them explicitly with `npm install @modelcontextprotocol/server zod`.

## Schema

```json
{
  "name": "api",
  "fields": {
    "PORT": { "type": "number", "default": "3000", "description": "HTTP port" },
    "DATABASE_URL": { "type": "url", "required": true, "description": "Postgres connection string" },
    "NODE_ENV": { "type": "enum", "values": ["development", "test", "production"] },
    "DEBUG": { "type": "boolean", "required": false }
  }
}
```

| Type | Coercion | Example placeholder |
| --- | --- | --- |
| `string` | as-is | empty / `change-me` if `secret` |
| `number` | `Number`, must be finite | `0` |
| `boolean` | `true/false/1/0/yes/no/on/off` | `false` |
| `url` | absolute URL with an allowed scheme (`https`, `postgres`, `redis`, `mysql`, `mongodb`, `amqp`, `sqlite`) | `postgres://…` when the key/description looks like a database |
| `email` | simple `a@b.c` | `dev@example.com` |
| `enum` | must be in `values` | first value |
| `json` | `JSON.parse` | `{}` |

`javascript:` and `file:` URLs are **rejected**. Empty values fall back to `default` when one is declared (`PORT=` with `"default": "3000"` is valid).

Field flags:

- `required` — default **true**. Set `false` to allow missing keys.
- `default` — used when the key is absent or empty.
- `secret` — placeholder becomes `change-me`.
- `description` — comment above the example line. `*/` in descriptions cannot break generated TS comments.

## CLI

```bash
envsentinel check [--schema file] [--env file] [--strict] [--strict-file] [--json]
envsentinel scan [dir] [--json]
envsentinel example [--schema file] [-o .env.example]
envsentinel types [--schema file] [-o env.d.ts]
envsentinel diff [--example .env.example] [--env .env]
envsentinel mcp
envsentinel --help
envsentinel --version
```

Default schema: `env.schema.json`, then `envsentinel.schema.json`.  
Default env file: `.env`.

| Flag | Meaning |
| --- | --- |
| `--strict` | Unknown keys in the env file are errors, not warnings |
| `--strict-file` | Do not fill missing schema keys from `process.env` |
| `--json` | `check` / `scan` print one machine-readable JSON object instead of the human report |

`--json` never contains **values** — only issue metadata, counts, and leak locations — so piping the report into CI logs or another tool cannot leak secrets:

```json
{ "ok": false, "env": ".env", "variables": 0,
  "issues": [{ "key": "DATABASE_URL", "message": "required", "severity": "error" }] }
```

Exit codes:

| Command | `0` | `1` |
| --- | --- | --- |
| `check` | no errors (warnings still print unless `--strict`) | missing/invalid required fields, or `--strict` unknowns |
| `scan` | no leaks | at least one leak |
| `diff` | keys match, or only extras | missing keys from the example |
| `example` / `types` | wrote the file | schema missing / I/O error |

## What `check` actually reads

1. Parse `--env` (default `.env`). Quoted values and `export KEY=` are supported. `#` comments are ignored.
2. Unless `--strict-file`, for keys **declared in the schema only**, fill gaps from `process.env` (CI-friendly). Extra OS env vars are **not** treated as unknown keys.
3. Coerce + validate. Unknown keys that appear in the **file** are warnings, or errors with `--strict`.

`scan` walks `.env*`, `.ts`, `.js`, `.json`, `.yml`, `.py`, `.md`. It skips `node_modules`, `.git`, `dist`, `build`, `coverage`, `.venv`, `vendor`, `.env.example`, `.env.sample`, `.env.template`, and lockfiles so documented placeholders do not fail CI.

## GitHub Action

```yaml
- uses: KodYazicam/envsentinel@main
  with:
    schema: env.schema.json
    env-file: .env
    scan: true
    strict: false
    strict-file: false
```

The action builds this repository (no npm registry) and runs `check` (then `scan` unless you set `scan: false`).

## CI

```yaml
- run: npx @kodyazicam/envsentinel check --strict-file
- run: npx @kodyazicam/envsentinel scan .
- run: npx @kodyazicam/envsentinel diff
```

Fail the job on missing production secrets; keep `.env.example` committed and `.env` gitignored.

## Library

```ts
import { readFileSync } from "node:fs";
import { validateEnv, parseEnv, parseSchema, scanText, typesFromSchema, exampleFromSchema } from "@kodyazicam/envsentinel";
// after: npm install @kodyazicam/envsentinel

const schema = parseSchema(JSON.parse(readFileSync("env.schema.json", "utf8")));
const env = parseEnv(readFileSync(".env", "utf8"));
const result = validateEnv(env, schema);
if (!result.ok) {
  for (const issue of result.issues) console.error(issue.key, issue.message);
  process.exit(1);
}

result.values.PORT; // number after coerce
```

`typesFromSchema` emits:

```ts
export interface Env {
  PORT: number;
  DATABASE_URL: string;
}
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      DATABASE_URL?: string;
    }
  }
}
```

`ProcessEnv` stays strings because `process.env` is always strings. Coerce at the boundary with `validateEnv`.

To build the MCP server programmatically:

```ts
import { createMcpServer } from "@kodyazicam/envsentinel/mcp";
const server = createMcpServer();
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `schema not found` | Add `env.schema.json` or `--schema path` |
| `invalid JSON` | The schema file is not valid JSON |
| `url scheme "javascript:" is not allowed` | Use `https://` or `postgres://` |
| `scan` fails on the example file | Rename to `.env.example` (skipped) or remove the fake `sk-` placeholder |
| `check` warns about extra keys | Add them to the schema, or pass `--strict` if you want that to fail |
| CI is green but `.env` is empty | You filled keys from `process.env`. Use `--strict-file` |
| Types say `PORT: number` but `process.env.PORT` is a string | Use `validateEnv` for runtime values; `ProcessEnv` is optional strings |

## FAQ

**Does it load dotenv into `process.env`?** No. It reads the file itself. Pair with `dotenv` in the app if you want both.

**Can I use it without TypeScript?** Yes. `check` / `scan` / `example` / `diff` do not need `tsc`.

**Will it print secret values?** No. `scan` prints file:line and kind only.

**Is this Zod?** No. The schema is a small JSON language. Zod is only an optional dependency of the MCP server.

**Is it on npm?** Yes: `npx @kodyazicam/envsentinel` or `npm install -g @kodyazicam/envsentinel`.

## License — KYAL-1.0

Free to use and modify. **Attribution is mandatory.** Not OSI-approved; MIT-shaped plus credit.

```
Author : Batuhan (KodYazicam)
Project: envsentinel
Source : https://github.com/KodYazicam/envsentinel
```

See [LICENSE](./LICENSE).

<p align="center"><sub>Built by <a href="https://github.com/KodYazicam">KodYazicam</a></sub></p>
