import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffEnv,
  generateExample,
  generateTypes,
  scanSecrets,
  validateEnvironment,
} from "../src/mcp-tools.js";
import { createMcpServer } from "../src/mcp.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "envsentinel-mcp-"));
  writeFileSync(
    join(root, "env.schema.json"),
    JSON.stringify(
      {
        name: "demo",
        fields: {
          PORT: { type: "number", default: "3000" },
          DATABASE_URL: { type: "url", required: true },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, ".env"),
    "PORT=4000\nDATABASE_URL=https://db.local\n",
  );
  writeFileSync(join(root, ".env.example"), "PORT=0\nDATABASE_URL=postgres://user:pass@localhost:5432/app\n");
  writeFileSync(join(root, "leak.env"), "TOKEN=sk-abcdefghijklmnopqrstuvwxyz123456\n");
  return root;
}

describe("envsentinel mcp tools", () => {
  it("validates an env file without returning values", () => {
    const root = fixture();
    const result = validateEnvironment({ root });
    expect(result.ok).toBe(true);
    expect(result.variables).toBe(2);
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("https://db.local");
    expect(JSON.stringify(result)).not.toContain("4000");
  });

  it("reports missing keys without values", () => {
    const root = mkdtempSync(join(tmpdir(), "envsentinel-mcp-missing-"));
    writeFileSync(
      join(root, "env.schema.json"),
      JSON.stringify({ fields: { DATABASE_URL: { type: "url", required: true } } }),
    );
    writeFileSync(join(root, ".env"), "");
    const result = validateEnvironment({ root });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.key === "DATABASE_URL")).toBe(true);
  });

  it("scans a repository and skips the example file", () => {
    const root = fixture();
    const result = scanSecrets({ root });
    expect(result.root).toBe(root);
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.leaks.some((leak) => leak.file === "leak.env")).toBe(true);
    expect(result.leaks.some((leak) => leak.file === ".env.example")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("scans text without touching the filesystem", () => {
    const result = scanSecrets({ text: "TOKEN=sk-abcdefghijklmnopqrstuvwxyz123456\n" });
    expect(result.root).toBeNull();
    expect(result.leaks[0]?.file).toBe("<text>");
    expect(result.leaks[0]?.kind).toBe("openai-key");
  });

  it("generates example and type content", () => {
    const root = fixture();
    const example = generateExample({ root });
    expect(example.content).toContain("DATABASE_URL=");
    const types = generateTypes({ root });
    expect(types.content).toContain("export interface Env");
    expect(types.content).toContain("PORT: number");
  });

  it("diffs env and example keys", () => {
    const root = fixture();
    const result = diffEnv({ root });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it("creates an MCP server with tools registered", () => {
    const server = createMcpServer();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });
});
