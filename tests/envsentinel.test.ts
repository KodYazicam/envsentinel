import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/parse.js";
import { validateEnv, typesFromSchema, exampleFromSchema, parseSchema, type EnvSchema } from "../src/schema.js";
import { scanText, diffExample } from "../src/scan.js";
import { run } from "../src/cli.js";
import { invokedDirectly } from "../src/main.js";

const schema: EnvSchema = {
  name: "demo",
  fields: {
    PORT: { type: "number", default: "3000", description: "HTTP port" },
    DATABASE_URL: { type: "url", required: true },
    NODE_ENV: { type: "enum", values: ["development", "test", "production"] },
    DEBUG: { type: "boolean", required: false },
  },
};

describe("parseEnv", () => {
  it("parses quotes, export, and comments", () => {
    const env = parseEnv(`
# comment
export FOO=bar
BAZ="hello world" # trailing
EMPTY=
BAD
`);
    expect(env.FOO).toBe("bar");
    expect(env.BAZ).toBe("hello world");
    expect(env.EMPTY).toBe("");
  });

  it("only strips inline comments after whitespace", () => {
    const env = parseEnv('A=value#fragment\nB=value # comment\nC="quoted # kept" # comment\n');
    expect(env.A).toBe("value#fragment");
    expect(env.B).toBe("value");
    expect(env.C).toBe("quoted # kept");
  });
});

describe("validateEnv", () => {
  it("coerces types and reports missing keys", () => {
    const result = validateEnv(
      { PORT: "8080", DATABASE_URL: "https://db.example", NODE_ENV: "test" },
      schema,
    );
    expect(result.ok).toBe(true);
    expect(result.values.PORT).toBe(8080);
    expect(result.values.NODE_ENV).toBe("test");
  });

  it("accepts postgres connection strings as urls", () => {
    const result = validateEnv(
      {
        PORT: "8080",
        DATABASE_URL: "postgres://user:pass@localhost:5432/app",
        NODE_ENV: "test",
      },
      schema,
    );
    expect(result.ok).toBe(true);
  });

  it("fails on bad enum and missing url", () => {
    const result = validateEnv({ PORT: "x", NODE_ENV: "staging" }, schema);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.key === "DATABASE_URL")).toBe(true);
    expect(result.issues.some((i) => i.key === "NODE_ENV")).toBe(true);
  });

  it("validates email fields without regex backtracking", () => {
    const emailSchema: EnvSchema = { fields: { EMAIL: { type: "email", required: true } } };
    expect(validateEnv({ EMAIL: "dev@example.com" }, emailSchema).ok).toBe(true);
    for (const bad of [
      "dev@",
      "@example.com",
      "dev@@example.com",
      "dev@example",
      "dev @example.com",
      "dev@example..com",
      `${"a".repeat(65)}@example.com`,
    ]) {
      expect(validateEnv({ EMAIL: bad }, emailSchema).ok).toBe(false);
    }
  });
});

describe("codegen", () => {
  it("emits types and example", () => {
    const types = typesFromSchema(schema);
    expect(types).toContain("PORT: number");
    expect(types).toContain('NODE_ENV: "development" | "test" | "production"');
    expect(types).toContain("interface ProcessEnv");
    expect(types).toContain("PORT?: string");
    expect(exampleFromSchema(schema)).toContain("DATABASE_URL=postgres://user:pass@localhost:5432/app");
  });
});

describe("scan + diff", () => {
  it("detects openai keys", () => {
    const leaks = scanText(".env", 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n');
    expect(leaks[0]?.kind).toBe("openai-key");
  });

  it("detects google, telegram, npm, and slack webhook leaks", () => {
    const joinSecret = (...parts: string[]) => parts.join("");
    const google = joinSecret("AIza", "SyA1234567890abcdefghijklmnopqrstuv");
    const telegram = joinSecret("123456789", ":", "AAEqwertyuiopasdfghjklzxcvbnm_12345");
    const npm = joinSecret("npm_", "Nkqrstuvwxyz0123456789abcdefghijklmn");
    expect(scanText("conf.env", `G_KEY="${google}"\n`)[0]?.kind).toBe("google-api-key");
    expect(scanText("conf.env", `TG=${telegram}\n`)[0]?.kind).toBe("telegram-bot-token");
    expect(scanText("conf.env", `NPM=${npm}\n`)[0]?.kind).toBe("npm-token");
    const webhook = ["https://hooks.slack.com/services/T00000000", "B11111111", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("/");
    expect(scanText("conf.env", `HOOK=${webhook}\n`)[0]?.kind).toBe("slack-webhook");
  });

  it("skips example env files", () => {
    const leaks = scanText(".env.example", 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n');
    expect(leaks).toEqual([]);
  });

  it("diffs example vs env", () => {
    const d = diffExample(["A", "B"], ["B", "C"]);
    expect(d.missing).toEqual(["A"]);
    expect(d.extra).toEqual(["C"]);
  });
});

describe("secret pattern fixtures", () => {
  const parts = (...values: string[]) => values.join("");
  const slackWebhook = (suffix: string) =>
    ["https:", "", "hooks." + "slack.com", "services", suffix].join("/");
  const positiveFixtures: Array<{ kind: string; value: string }> = [
    { kind: "aws-access-key", value: parts("AKIA", "1234567890ABCDEF") },
    { kind: "github-token", value: parts("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789") },
    {
      kind: "github-fine-grained",
      value: parts("github_pat_", "abcdefghijklmnopqrstuvwxyz0123456789"),
    },
    { kind: "openai-key", value: parts("sk-", "abcdefghijklmnopqrstuvwxyz123456") },
    { kind: "openai-key", value: parts("sk-", "proj-", "abcdefghijklmnopqrstuvwxyz123456") },
    { kind: "openai-key", value: parts("sk-", "svcacct-", "abcdefghijklmnopqrstuvwxyz123456") },
    { kind: "anthropic-key", value: parts("sk-", "ant-", "abcdefghijklmnopqrstuvwxyz123456") },
    { kind: "stripe-key", value: parts("sk_", "live_", "abcdefghijklmnopqrstuvwx") },
    { kind: "stripe-webhook", value: parts("wh", "sec_", "abcdefghijklmnopqrstuvwx") },
    { kind: "private-key", value: parts("-----BEGIN ", "RSA PRIVATE KEY", "-----") },
    { kind: "slack-token", value: parts("xoxb-", "123456789012") },
    { kind: "slack-webhook", value: slackWebhook("T00000000/B11111111/XXXXXXXXXXXXXXXXXXXXXXXX") },
    { kind: "google-api-key", value: parts("AIza", "SyA1234567890abcdefghijklmnopqrstuv") },
    {
      kind: "telegram-bot-token",
      value: parts("123456789", ":", "AAEqwertyuiopasdfghjklzxcvbnm_12345"),
    },
    { kind: "npm-token", value: parts("npm_", "Nkqrstuvwxyz0123456789abcdefghijklmn") },
  ];

  const negativeFixtures: Array<{ kind: string; value: string }> = [
    { kind: "aws-access-key", value: parts("AKIA", "1234567890ABCDE") },
    { kind: "github-token", value: parts("ghp_", "short") },
    { kind: "github-fine-grained", value: parts("github_pat_", "short") },
    { kind: "openai-key", value: parts("sk-", "abcdefghijklmnopqrstuvwxyz12345") },
    { kind: "anthropic-key", value: parts("sk-", "ant-", "short") },
    { kind: "stripe-key", value: parts("sk_", "test_", "abcdefghijklmnopqrstuvwx") },
    { kind: "stripe-webhook", value: parts("wh", "sec_", "short") },
    { kind: "private-key", value: parts("-----BEGIN ", "PUBLIC KEY", "-----") },
    { kind: "slack-token", value: parts("xoxz-", "123456789012") },
    { kind: "slack-webhook", value: slackWebhook("short") },
    { kind: "google-api-key", value: parts("AIza", "SyA1234567890abcdefghijklmnopqrstu") },
    {
      kind: "telegram-bot-token",
      value: parts("123456789", ":", "AAEqwertyuiopasdfghjklzxcvbnm_1234"),
    },
    { kind: "npm-token", value: parts("npm_", "Nkqrstuvwxyz0123456789abcdefghijklm") },
  ];

  it.each(positiveFixtures)("detects $kind", ({ kind, value }) => {
    const leaks = scanText("fixture.env", `VALUE=${value}\n`);
    expect(leaks.some((leak) => leak.kind === kind)).toBe(true);
  });

  it.each(negativeFixtures)("does not flag $kind lookalikes", ({ value }) => {
    expect(scanText("fixture.env", `VALUE=${value}\n`)).toEqual([]);
  });

  it("skips every positive fixture in example files", () => {
    const source = positiveFixtures.map(({ value }, index) => `KEY_${index}=${value}`).join("\n");
    expect(scanText(".env.example", source)).toEqual([]);
  });
});

describe("cli", () => {
  it("check / types / example / scan round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsentinel-"));
    writeFileSync(join(dir, "env.schema.json"), JSON.stringify(schema, null, 2));
    writeFileSync(
      join(dir, ".env"),
      "PORT=4000\nDATABASE_URL=https://db.local\nNODE_ENV=development\nDEBUG=false\n",
    );
    expect(run(["example", "-o", ".env.example"], dir)).toBe(0);
    expect(run(["types", "-o", "env.d.ts"], dir)).toBe(0);
    expect(run(["check"], dir)).toBe(0);
    expect(run(["diff"], dir)).toBe(0);
    expect(readFileSync(join(dir, "env.d.ts"), "utf8")).toContain("export interface Env");
    writeFileSync(join(dir, "leak.env"), "TOKEN=sk-abcdefghijklmnopqrstuvwxyz123456\n");
    expect(run(["scan"], dir)).toBe(1);
  });

  it("rejects a broken schema and --strict unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsentinel-bad-"));
    writeFileSync(join(dir, "env.schema.json"), "{not json");
    expect(run(["check"], dir)).toBe(1);
    writeFileSync(join(dir, "env.schema.json"), JSON.stringify({ fields: { PORT: { type: "number", default: "1" } } }));
    writeFileSync(join(dir, ".env"), "PORT=1\nUNKNOWN=1\n");
    expect(run(["check", "--strict"], dir)).toBe(1);
  });

  it("check --json prints a machine-readable report without values", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsentinel-json-"));
    writeFileSync(
      join(dir, "env.schema.json"),
      JSON.stringify({ fields: { DATABASE_URL: { type: "url", required: true } } }),
    );
    writeFileSync(join(dir, ".env"), "");

    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (msg?: unknown) => {
      logs.push(String(msg ?? ""));
    };
    console.error = () => {};
    const code = run(["check", "--json"], dir);
    console.log = origLog;
    console.error = origErr;
    expect(code).toBe(1);
    const report = JSON.parse(logs.join("\n"));
    expect(report.ok).toBe(false);
    expect(report.variables).toBe(0);
    expect(report.issues.some((i: { key: string }) => i.key === "DATABASE_URL")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });

  it("scan --json counts files and lists leaks", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsentinel-scan-json-"));
    writeFileSync(
      join(dir, ".env"),
      "PORT=1\n",
    );
    writeFileSync(
      join(dir, "leak.env"),
      "TOKEN=sk-abcdefghijklmnopqrstuvwxyz123456\n",
    );

    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (msg?: unknown) => {
      logs.push(String(msg ?? ""));
    };
    console.error = () => {};
    const code = run(["scan", "--json"], dir);
    console.log = origLog;
    console.error = origErr;
    expect(code).toBe(1);
    const report = JSON.parse(logs.join("\n"));
    expect(report.ok).toBe(false);
    expect(report.filesScanned).toBeGreaterThanOrEqual(2);
    expect(report.leaks.some((l: { file: string }) => l.file === "leak.env")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});

describe("invokedDirectly", () => {
  it("recognizes an npm bin symlink as the CLI entrypoint", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsentinel-bin-"));
    const target = join(dir, "cli.js");
    const link = join(dir, "envsentinel");
    writeFileSync(target, "#!/usr/bin/env node\n");
    symlinkSync(target, link);
    const original = process.argv[1];
    process.argv[1] = link;
    try {
      expect(invokedDirectly(pathToFileURL(target).href)).toBe(true);
    } finally {
      process.argv[1] = original;
    }
  });
});

describe("parseSchema", () => {
  it("rejects missing fields and unknown types", () => {
    expect(() => parseSchema({})).toThrow(/fields/);
    expect(() => parseSchema({ fields: { X: { type: "nope" } } })).toThrow(/unknown type/);
  });
});
