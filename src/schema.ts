export type EnvType = "string" | "number" | "boolean" | "url" | "email" | "enum" | "json";

export interface FieldSchema {
  type: EnvType;
  required?: boolean;
  default?: string;
  values?: string[];
  secret?: boolean;
  description?: string;
}

export interface EnvSchema {
  $schema?: string;
  name?: string;
  fields: Record<string, FieldSchema>;
}

export interface Issue {
  key: string;
  message: string;
  severity: "error" | "warning";
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);
const TYPES: EnvType[] = ["string", "number", "boolean", "url", "email", "enum", "json"];
const URL_SCHEMES = new Set(["http:", "https:", "postgres:", "postgresql:", "mysql:", "mongodb:", "mongo:", "redis:", "rediss:", "amqp:", "amqps:", "sqlite:"]);

export function parseSchema(raw: unknown, source = "schema"): EnvSchema {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: expected a JSON object with a "fields" map`);
  }
  const data = raw as Record<string, unknown>;
  if (!data.fields || typeof data.fields !== "object" || Array.isArray(data.fields)) {
    throw new Error(`${source}: missing "fields" object`);
  }
  const fields: Record<string, FieldSchema> = {};
  for (const [key, value] of Object.entries(data.fields as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`${source}: invalid field name "${key}"`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${source}: field ${key} must be an object`);
    }
    const field = value as Record<string, unknown>;
    if (!TYPES.includes(field.type as EnvType)) {
      throw new Error(`${source}: field ${key} has unknown type "${String(field.type)}"`);
    }
    if (field.type === "enum" && (!Array.isArray(field.values) || field.values.length === 0)) {
      throw new Error(`${source}: field ${key} (enum) needs a non-empty "values" array`);
    }
    fields[key] = {
      type: field.type as EnvType,
      required: field.required as boolean | undefined,
      default: field.default as string | undefined,
      values: field.values as string[] | undefined,
      secret: field.secret as boolean | undefined,
      description: typeof field.description === "string" ? field.description : undefined,
    };
  }
  return {
    $schema: typeof data.$schema === "string" ? data.$schema : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
    fields,
  };
}

export function coerce(value: string, field: FieldSchema): unknown {
  switch (field.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error("not a number");
      return n;
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (TRUE.has(lower)) return true;
      if (FALSE.has(lower)) return false;
      throw new Error("not a boolean (use true/false, 1/0, yes/no)");
    }
    case "url": {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("not a url");
      }
      if (!url.protocol || url.protocol === ":" || !url.host) {
        throw new Error("not a url");
      }
      if (!URL_SCHEMES.has(url.protocol)) {
        throw new Error(`url scheme "${url.protocol}" is not allowed`);
      }
      return value;
    }
    case "email": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("not an email");
      return value;
    }
    case "enum": {
      if (!field.values?.includes(value)) {
        throw new Error(`expected one of: ${(field.values ?? []).join(", ")}`);
      }
      return value;
    }
    case "json": {
      return JSON.parse(value);
    }
    default:
      return value;
  }
}

export function validateEnv(
  env: Record<string, string | undefined>,
  schema: EnvSchema,
): { ok: boolean; values: Record<string, unknown>; issues: Issue[] } {
  const issues: Issue[] = [];
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    const raw = env[key] === undefined || env[key] === "" ? field.default : env[key];
    if (raw === undefined || raw === "") {
      if (field.required !== false) {
        issues.push({ key, message: "missing required variable", severity: "error" });
      }
      continue;
    }
    try {
      values[key] = coerce(raw, field);
    } catch (error) {
      issues.push({
        key,
        message: (error as Error).message,
        severity: "error",
      });
    }
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) continue;
    if (!(key in schema.fields) && key.trim()) {
      issues.push({
        key,
        message: "variable is not declared in the schema",
        severity: "warning",
      });
    }
  }
  return { ok: issues.every((i) => i.severity !== "error"), values, issues };
}

export function exampleFromSchema(schema: EnvSchema): string {
  const lines = [
    `# generated by envsentinel — https://github.com/KodYazicam/envsentinel`,
    schema.name ? `# ${schema.name}` : "",
  ].filter(Boolean);
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.description) lines.push(`# ${field.description}`);
    const placeholder =
      field.default ??
      placeholderFor(key, field);
    lines.push(`${key}=${placeholder}`);
  }
  return `${lines.join("\n")}\n`;
}

export function typesFromSchema(schema: EnvSchema): string {
  const fields = Object.entries(schema.fields)
    .map(([key, field]) => {
      const optional = field.required === false && field.default === undefined;
      const ts = tsType(field);
      const comment = field.description ? `  /** ${sanitizeComment(field.description)} */\n` : "";
      return `${comment}  ${key}${optional ? "?" : ""}: ${ts};`;
    })
    .join("\n");
  const processFields = Object.entries(schema.fields)
    .map(([key]) => `    ${key}?: string;`)
    .join("\n");
  return `/* generated by envsentinel — https://github.com/KodYazicam/envsentinel */\nexport interface Env {\n${fields}\n}\n\ndeclare global {\n  namespace NodeJS {\n    interface ProcessEnv {\n${processFields}\n    }\n  }\n}\nexport {};\n`;
}

function placeholderFor(key: string, field: FieldSchema): string {
  const blob = `${key} ${field.description ?? ""}`.toLowerCase();
  if (field.type === "url" && /postgres|database|db_url|mongo|mysql|redis/.test(blob)) {
    if (blob.includes("mongo")) return "mongodb://localhost:27017/app";
    if (blob.includes("redis")) return "redis://localhost:6379";
    if (blob.includes("mysql")) return "mysql://user:pass@localhost:3306/app";
    return "postgres://user:pass@localhost:5432/app";
  }
  switch (field.type) {
    case "boolean":
      return "false";
    case "number":
      return "0";
    case "url":
      return "https://example.com";
    case "email":
      return "dev@example.com";
    case "enum":
      return field.values?.[0] ?? "";
    case "json":
      return "{}";
    default:
      return field.secret ? "change-me" : "";
  }
}

function sanitizeComment(value: string): string {
  return value.replaceAll("*/", "*∕").replaceAll("\n", " ");
}

function tsType(field: FieldSchema): string {
  switch (field.type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "enum":
      return (field.values ?? []).map((v) => JSON.stringify(v)).join(" | ") || "string";
    default:
      return "string";
  }
}
