<p align="center">
  <img src="assets/banner.svg" alt="envsentinel" width="100%">
</p>

<p align="center">
  <strong>Stop shipping broken env files.</strong><br/>
  Schema validation, secret scan, <code>.env.example</code> and TypeScript types from one JSON file.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/license-KYAL--1.0-7C3AED?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/author-KodYazicam-0D0D0D?style=flat-square" alt="Author">
</p>

---

`envsentinel` is the missing linter for environment variables. Point it at `env.schema.json` and it will:

- **check** — coerce and validate `.env` plus matching keys from `process.env`
- **scan** — find AWS / GitHub / OpenAI / Slack / PEM secrets (skips `.env.example`)
- **example** — generate `.env.example` (postgres URLs get `postgres://…`, not `https://example.com`)
- **types** — generate `env.d.ts` (`Env` plus `ProcessEnv` string fields)
- **diff** — compare `.env` against `.env.example` (the classic “works on my machine” bug)

```bash
npx envsentinel check
```

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Schema](#schema)
- [CLI](#cli)
- [What `check` actually reads](#what-check-actually-reads)
- [CI](#ci)
- [Library](#library)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license--kyal-10)

## Requirements

- Node.js **20+**
- `env.schema.json` or `envsentinel.schema.json` in the project (or `--schema`)

## Install

```bash
npx envsentinel check
npm install -g envsentinel

git clone https://github.com/KodYazicam/envsentinel.git
cd envsentinel
npm install
npm test
```

## Quick start

1. Copy the demo schema or write your own `env.schema.json`.
2. `npx envsentinel example` → `.env.example`
3. Copy to `.env` and fill real values.
4. `npx envsentinel check` in local scripts and CI.
5. `npx envsentinel types -o src/env.d.ts` so TypeScript knows the keys.

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
| `url` | any absolute URL (`https://`, `postgres://`, `redis://`, …) | `postgres://…` when the key/description looks like a database |
| `email` | simple `a@b.c` | `dev@example.com` |
| `enum` | must be in `values` | first value |
| `json` | `JSON.parse` | `{}` |

Field flags:

- `required` — default **true**. Set `false` to allow missing keys.
- `default` — used when the key is absent (still appears in the example file).
- `secret` — placeholder becomes `change-me`.
- `description` — comment above the example line.

## CLI

```bash
envsentinel check [--schema file] [--env file]
envsentinel scan [dir]
envsentinel example [--schema file] [-o .env.example]
envsentinel types [--schema file] [-o env.d.ts]
envsentinel diff [--example .env.example] [--env .env]
envsentinel --help
envsentinel --version
```

Default schema: `env.schema.json`, then `envsentinel.schema.json`.  
Default env file: `.env`.

Exit codes:

| Command | `0` | `1` |
| --- | --- | --- |
| `check` | no errors (warnings still print) | missing/invalid required fields |
| `scan` | no leaks | at least one leak |
| `diff` | keys match, or only extras | missing keys from the example |
| `example` / `types` | wrote the file | schema missing / I/O error |

## What `check` actually reads

1. Parse `--env` (default `.env`). Quoted values and `export KEY=` are supported. `#` comments are ignored.
2. For keys **declared in the schema only**, fill gaps from `process.env` (CI-friendly). Extra OS env vars are **not** treated as unknown keys.
3. Coerce + validate. Unknown keys that appear in the **file** are warnings, not errors.

`scan` walks `.env*`, `.ts`, `.js`, `.json`, `.yml`, `.py`, `.md`. It skips `.env.example`, `.env.sample`, `.env.template`, and lockfiles so documented placeholders do not fail CI.

## CI

```yaml
- run: npx envsentinel check
- run: npx envsentinel scan .
- run: npx envsentinel diff
```

Fail the job on missing production secrets; keep `.env.example` committed and `.env` gitignored.

## Library

```ts
import { readFileSync } from "node:fs";
import { validateEnv, parseEnv, scanText, typesFromSchema, exampleFromSchema } from "envsentinel";

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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `schema not found` | Add `env.schema.json` or `--schema path` |
| `url must be…` / `not a url` | Value must be absolute (`postgres://…` is valid; `localhost:5432` is not) |
| `scan` fails on the example file | Rename to `.env.example` (skipped) or remove the fake `sk-` placeholder |
| `check` warns about extra keys | Either add them to the schema or ignore warnings; they are not fatal |
| Types say `PORT: number` but `process.env.PORT` is a string | Use `validateEnv` for runtime values; `ProcessEnv` is optional strings |

## FAQ

**Does it load dotenv into `process.env`?** No. It reads the file itself. Pair with `dotenv` in the app if you want both.

**Can I use it without TypeScript?** Yes. `check` / `scan` / `example` / `diff` do not need `tsc`.

**Will it print secret values?** No. `scan` prints file:line and kind only.

## License — KYAL-1.0

Free to use and modify. **Attribution is mandatory.**

```
Author : Batuhan (KodYazicam)
Project: envsentinel
Source : https://github.com/KodYazicam/envsentinel
```

See [LICENSE](./LICENSE).

<p align="center"><sub>Built by <a href="https://github.com/KodYazicam">KodYazicam</a></sub></p>
