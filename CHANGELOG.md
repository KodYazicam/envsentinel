# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Added positive and negative fixtures for every secret pattern.
- Secret fixtures in the scanner tests are now assembled at runtime.

### Security

- Replaced potentially backtracking regular expressions in `.env` parsing,
  email validation, and assignment detection with bounded linear scans.

## [1.0.1] - 2026-11-01

### Fixed

- Release workflow treats npm dist-tags as an already-published fallback while
  package metadata is still propagating.

## [1.0.0] - 2026-11-01

### Added

- First public npm release: `@kodyazicam/envsentinel`.
- Schema validation for `.env` files with coercion for string, number, boolean,
  URL, email, enum, and JSON fields.
- Secret scanning for AWS, GitHub, OpenAI, Anthropic, Stripe, Slack, Google,
  Telegram, npm, and PEM private key patterns.
- `.env.example` and TypeScript declaration generation from one JSON schema.
- `.env` versus `.env.example` key diff.
- GitHub Action for CI validation and secret scanning.
- `envsentinel mcp`: a local stdio Model Context Protocol server.
- MCP tools: `validate_env`, `scan_secrets`, `generate_example`,
  `generate_types`, and `diff_env`.
- `envsentinel/mcp` export for building the MCP server programmatically.

### Notes

- MCP output never includes environment values or secret values.
- `@modelcontextprotocol/server` and `zod` are optional dependencies, loaded
  only by the MCP command.
- No network calls, no cloud service, and no API keys.
