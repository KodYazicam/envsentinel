import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseEnv } from "./parse.js";
import { loadEnvFile, loadSchema, walkScanFiles } from "./project.js";
import {
  exampleFromSchema,
  typesFromSchema,
  validateEnv,
  type Issue,
} from "./schema.js";
import { diffExample, scanText, type Leak } from "./scan.js";

export interface ProjectInput {
  root?: string;
  schema?: string;
}

export interface ValidateEnvInput extends ProjectInput {
  env?: string;
  strict?: boolean;
  strictFile?: boolean;
}

export interface ValidateEnvOutput {
  ok: boolean;
  schema: string;
  env: string;
  variables: number;
  issues: Issue[];
}

export interface GeneratedOutput {
  schema: string;
  content: string;
}

export interface ScanSecretsInput {
  root?: string;
  text?: string;
  limit?: number;
}

export interface ScanSecretsOutput {
  root: string | null;
  scannedFiles: number;
  count: number;
  truncated: boolean;
  leaks: Leak[];
}

export interface DiffEnvInput {
  root?: string;
  example?: string;
  env?: string;
}

export interface DiffEnvOutput {
  ok: boolean;
  example: string;
  env: string;
  missing: string[];
  extra: string[];
}

const DEFAULT_SCAN_LIMIT = 500;

function schemaLabel(root: string, path: string): string {
  return relative(root, path) || path;
}

export function validateEnvironment(input: ValidateEnvInput = {}): ValidateEnvOutput {
  const root = resolve(input.root ?? process.cwd());
  const loaded = loadSchema(root, input.schema);
  const envName = input.env ?? ".env";
  const fileEnv = loadEnvFile(root, envName);
  const merged: Record<string, string | undefined> = { ...fileEnv };
  if (!(input.strictFile ?? true)) {
    for (const key of Object.keys(loaded.schema.fields)) {
      if (merged[key] === undefined && process.env[key] !== undefined) {
        merged[key] = process.env[key];
      }
    }
  }

  const result = validateEnv(merged, loaded.schema);
  const unknown = result.issues.filter((issue) => issue.severity === "warning");
  const strictFailed = (input.strict ?? false) && unknown.length > 0;
  const issues: Issue[] = strictFailed
    ? [
        ...result.issues,
        { key: "--strict", message: "unknown keys are not allowed", severity: "error" },
      ]
    : result.issues;

  return {
    ok: result.ok && !strictFailed,
    schema: schemaLabel(root, loaded.path),
    env: envName,
    variables: Object.keys(result.values).length,
    issues,
  };
}

export function generateExample(input: ProjectInput = {}): GeneratedOutput {
  const root = resolve(input.root ?? process.cwd());
  const loaded = loadSchema(root, input.schema);
  return {
    schema: schemaLabel(root, loaded.path),
    content: exampleFromSchema(loaded.schema),
  };
}

export function generateTypes(input: ProjectInput = {}): GeneratedOutput {
  const root = resolve(input.root ?? process.cwd());
  const loaded = loadSchema(root, input.schema);
  return {
    schema: schemaLabel(root, loaded.path),
    content: typesFromSchema(loaded.schema),
  };
}

export function scanSecrets(input: ScanSecretsInput = {}): ScanSecretsOutput {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SCAN_LIMIT, 5_000));
  if (input.text !== undefined) {
    const leaks = scanText("<text>", input.text);
    return {
      root: null,
      scannedFiles: 1,
      count: leaks.length,
      truncated: leaks.length > limit,
      leaks: leaks.slice(0, limit),
    };
  }

  const root = resolve(input.root ?? process.cwd());
  const files = walkScanFiles(root);
  const leaks: Leak[] = [];
  let scannedFiles = 0;
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scannedFiles += 1;
    leaks.push(...scanText(relative(root, file) || file, source));
  }
  return {
    root,
    scannedFiles,
    count: leaks.length,
    truncated: leaks.length > limit,
    leaks: leaks.slice(0, limit),
  };
}

export function diffEnv(input: DiffEnvInput = {}): DiffEnvOutput {
  const root = resolve(input.root ?? process.cwd());
  const exampleName = input.example ?? ".env.example";
  const envName = input.env ?? ".env";
  const examplePath = resolve(root, exampleName);
  if (!existsSync(examplePath)) {
    throw new Error(`missing ${exampleName}`);
  }
  const example = parseEnv(readFileSync(examplePath, "utf8"));
  const envPath = resolve(root, envName);
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  const { missing, extra } = diffExample(Object.keys(example), Object.keys(env));
  return {
    ok: missing.length === 0,
    example: exampleName,
    env: envName,
    missing,
    extra,
  };
}
