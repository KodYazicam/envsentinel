import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { packageVersion } from "./version.js";
import {
  diffEnv,
  generateExample,
  generateTypes,
  scanSecrets,
  validateEnvironment,
} from "./mcp-tools.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const rootSchema = z
  .string()
  .optional()
  .describe("Project directory. Defaults to the server process's current working directory.");

const schemaPathSchema = z
  .string()
  .optional()
  .describe("Schema path relative to root. Default: env.schema.json, then envsentinel.schema.json.");

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `envsentinel: ${message}` }],
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "envsentinel",
    version: packageVersion(),
  });

  server.registerTool(
    "validate_env",
    {
      title: "Validate environment file",
      description:
        "Validate a local .env file against env.schema.json. Returns issue metadata and counts, never variable values. " +
        "Use this after generating or editing .env, config, or deployment docs. By default, missing keys are not filled from the server process environment; set strictFile=false to match the CLI. " +
        "Runs locally; no network access.",
      inputSchema: z.object({
        root: rootSchema,
        schema: schemaPathSchema,
        env: z.string().optional().describe("Env file path relative to root. Default: .env."),
        strict: z.boolean().optional().describe("Treat unknown keys as errors. Default: false."),
        strictFile: z
          .boolean()
          .optional()
          .describe("Do not fill missing schema keys from process.env. Default: true in MCP."),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        schema: z.string(),
        env: z.string(),
        variables: z.number().int(),
        issues: z.array(
          z.object({
            key: z.string(),
            message: z.string(),
            severity: z.enum(["error", "warning"]),
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const output = validateEnvironment(input);
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "scan_secrets",
    {
      title: "Scan for leaked secrets",
      description:
        "Scan a local directory tree or a text string for leaked API keys, tokens, private keys, and webhook URLs. " +
        "Returns file:line, kind, and optional env key; never returns the secret value. Skips .env.example, lockfiles, node_modules, and build output. " +
        "Runs locally; no network access.",
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe("Scan this text instead of a directory. Cannot be combined with root."),
        root: rootSchema,
        limit: z
          .number()
          .int()
          .positive()
          .max(5_000)
          .optional()
          .describe("Maximum leaks to return. Default: 500."),
      }),
      outputSchema: z.object({
        root: z.string().nullable(),
        scannedFiles: z.number().int(),
        count: z.number().int(),
        truncated: z.boolean(),
        leaks: z.array(
          z.object({
            file: z.string(),
            line: z.number().int(),
            kind: z.string(),
            key: z.string().optional(),
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        if (input.text !== undefined && input.root !== undefined) {
          return errorResult("scan_secrets accepts either text or root, not both");
        }
        const output = scanSecrets(input);
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_example",
    {
      title: "Generate .env.example",
      description:
        "Generate an .env.example file from env.schema.json without writing to disk. " +
        "Returns the complete file content, including comments and safe placeholders. Use this when onboarding a project or documenting required environment variables.",
      inputSchema: z.object({
        root: rootSchema,
        schema: schemaPathSchema,
      }),
      outputSchema: z.object({
        schema: z.string(),
        content: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const output = generateExample(input);
        return {
          content: [{ type: "text", text: output.content }],
          structuredContent: output,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_types",
    {
      title: "Generate TypeScript env types",
      description:
        "Generate TypeScript declarations (Env plus ProcessEnv fields) from env.schema.json without writing to disk. " +
        "Returns the complete env.d.ts content. Use this after changing the schema; values are not included.",
      inputSchema: z.object({
        root: rootSchema,
        schema: schemaPathSchema,
      }),
      outputSchema: z.object({
        schema: z.string(),
        content: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const output = generateTypes(input);
        return {
          content: [{ type: "text", text: output.content }],
          structuredContent: output,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "diff_env",
    {
      title: "Diff .env against .env.example",
      description:
        "Compare a local .env file with .env.example and return missing and extra keys. " +
        "Use this before deployment to catch the classic works-on-my-machine configuration bug. Only key names are returned, never values.",
      inputSchema: z.object({
        root: rootSchema,
        example: z
          .string()
          .optional()
          .describe("Example file path relative to root. Default: .env.example."),
        env: z.string().optional().describe("Env file path relative to root. Default: .env."),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        example: z.string(),
        env: z.string(),
        missing: z.array(z.string()),
        extra: z.array(z.string()),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const output = diffEnv(input);
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

/**
 * Start the stdio MCP server. stdout is reserved for protocol messages;
 * diagnostics go to stderr.
 */
export function runMcpServer(): void {
  serveStdio(createMcpServer, {
    onerror: (error) => {
      console.error(`envsentinel mcp: ${error.message}`);
    },
  });
}
