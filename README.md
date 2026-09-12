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

- **check** — coerce and validate `.env` + `process.env`
- **scan** — find AWS / GitHub / OpenAI / Slack / PEM secrets in the tree
- **example** — generate `.env.example`
- **types** — generate `env.d.ts`
- **diff** — compare `.env` against `.env.example` (the classic "works on my machine" bug)

```bash
npx envsentinel check
```

## Schema

```json
{
  "name": "api",
  "fields": {
    "PORT": { "type": "number", "default": "3000" },
    "DATABASE_URL": { "type": "url", "required": true },
    "NODE_ENV": { "type": "enum", "values": ["development", "test", "production"] },
    "DEBUG": { "type": "boolean", "required": false }
  }
}
```

Supported types: `string` · `number` · `boolean` · `url` · `email` · `enum` · `json`

## CLI

```bash
npm install -g envsentinel

envsentinel check --schema env.schema.json --env .env
envsentinel scan .
envsentinel example -o .env.example
envsentinel types -o src/env.d.ts
envsentinel diff --example .env.example --env .env
```

CI:

```yaml
- run: npx envsentinel check
- run: npx envsentinel scan .
```

## Library

```ts
import { validateEnv, parseEnv, scanText } from "envsentinel";

const env = parseEnv(readFileSync(".env", "utf8"));
const result = validateEnv(env, schema);
if (!result.ok) process.exit(1);
```

## License — KYAL-1.0

Free to use and modify. **Attribution is mandatory.**

```
Author : Batuhan (KodYazicam)
Project: envsentinel
Source : https://github.com/KodYazicam/envsentinel
```

See [LICENSE](./LICENSE).

<p align="center"><sub>Built by <a href="https://github.com/KodYazicam">KodYazicam</a></sub></p>
