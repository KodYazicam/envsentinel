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

const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

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
    const assign = line.match(ENV_ASSIGN);
    for (const { kind, regex } of SECRET_VALUE) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        leaks.push({ file, line: i + 1, kind, key: assign?.[1] });
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
