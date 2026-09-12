export interface Leak {
  file: string;
  line: number;
  kind: string;
  key?: string;
}

const SECRET_VALUE = [
  { kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { kind: "openai-key", regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function scanText(file: string, source: string): Leak[] {
  const leaks: Leak[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("#")) continue;
    const assign = line.match(ENV_ASSIGN);
    for (const { kind, regex } of SECRET_VALUE) {
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
