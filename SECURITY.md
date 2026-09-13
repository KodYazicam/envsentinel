# Security Policy

envsentinel reads `.env` files and source on the local machine. It never uploads them.

## What `scan` is

`scan` is a **linter**, not a secret-management product. It looks for well-known token shapes (AWS, GitHub, OpenAI, Anthropic, Stripe, Slack, PEM). It will miss entropy-only secrets and custom formats. Do not treat a green `scan` as “no secrets in git.”

`scan` prints **file:line and kind only**. It does not print the secret.

## `check` and process.env

By default `check` fills missing schema keys from `process.env` so CI can inject production values. Use `--strict-file` if you want the file alone to be the source of truth. Use `--strict` to fail on unknown keys in the file.

## Reporting

Open a private advisory on [KodYazicam/envsentinel](https://github.com/KodYazicam/envsentinel/security/advisories/new).
