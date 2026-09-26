import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/parse.js";
import { validateEnv, typesFromSchema, exampleFromSchema, parseSchema, type EnvSchema } from "../src/schema.js";
import { scanText, diffExample } from "../src/scan.js";
import { run } from "../src/cli.js";

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
    expect(scanText("conf.env", 'G_KEY="AIzaSyA1234567890abcdefghijklmnopqrstuv"\n')[0]?.kind).toBe("google-api-key");
    expect(scanText("conf.env", 'TG=123456789:AAEqwertyuiopasdfghjklzxcvbnm_12345\n')[0]?.kind).toBe("telegram-bot-token");
    expect(scanText("conf.env", 'NPM=npm_Nkqrstuvwxyz0123456789abcdefghijklmn\n')[0]?.kind).toBe("npm-token");
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

describe("parseSchema", () => {
  it("rejects missing fields and unknown types", () => {
    expect(() => parseSchema({})).toThrow(/fields/);
    expect(() => parseSchema({ fields: { X: { type: "nope" } } })).toThrow(/unknown type/);
  });
});
