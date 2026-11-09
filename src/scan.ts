export interface Leak {
  file: string;
  line: number;
  kind: string;
  key?: string;
}

const SECRET_VALUE = [
  { kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { kind: "github-fine-grained", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "openai-key", regex: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "openai-key", regex: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { kind: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "stripe-key", regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { kind: "stripe-webhook", regex: /\bwhsec_[A-Za-z0-9]{16,}\b/g },
  { kind: "private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "slack-webhook", regex: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{10,}\b/g },
  { kind: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "telegram-bot-token", regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { kind: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
];

const SKIP_SCAN =
  /(^|\/)(\.env\.example|\.env\.sample|\.env\.template|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|bun\.lock|Cargo\.lock|go\.sum)$/i;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  ".turbo",
  ".cache",
]);

function isEnvKey(key: string): boolean {
  if (!key) return false;
  const first = key.charCodeAt(0);
  const firstOk = first === 95 || (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
  if (!firstOk) return false;
  for (let i = 1; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    const ok = code === 95 || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!ok) return false;
  }
  return true;
}

function assignmentKey(line: string): string | undefined {
  const equals = line.indexOf("=");
  if (equals <= 0) return undefined;
  const key = line.slice(0, equals).trim();
  return isEnvKey(key) ? key : undefined;
}

export function shouldScanFile(file: string): boolean {
  return !SKIP_SCAN.test(file.replaceAll("\\", "/"));
}

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

export function scanText(file: string, source: string): Leak[] {
  if (!shouldScanFile(file)) return [];
  const leaks: Leak[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("#")) continue;
    const key = assignmentKey(line);
    for (const { kind, regex } of SECRET_VALUE) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        leaks.push({ file, line: i + 1, kind, key });
      }
    }
  }
  return leaks;
}

export function diffExample(
  exampleKeys: string[],
  actualKeys: string[],
): { missing: string[]; extra: string[] } {
  const example = new Set(exampleKeys);
  const actual = new Set(actualKeys);
  return {
    missing: [...example].filter((k) => !actual.has(k)),
    extra: [...actual].filter((k) => !example.has(k)),
  };
}
