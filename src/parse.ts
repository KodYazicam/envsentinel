export interface EnvMap {
  [key: string]: string;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
}

export function parseEnv(source: string): EnvMap {
  const out: EnvMap = {};
  const lines = source.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = cleaned.slice(eq + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      let i = 1;
      let escaped = false;
      let end = -1;
      for (; i < value.length; i += 1) {
        const ch = value[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          end = i;
          break;
        }
      }
      if (end >= 0) {
        value = value
          .slice(1, end)
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'");
      }
    } else {
      let comment = -1;
      for (let i = 1; i < value.length; i += 1) {
        if (value[i] === "#" && isWhitespace(value[i - 1])) {
          comment = i - 1;
          break;
        }
      }
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    out[key] = value;
  }
  return out;
}

export function stringifyEnv(map: EnvMap): string {
  return Object.entries(map)
    .map(([k, v]) => {
      const needsQuote = /[\s#"']/.test(v);
      const rendered = needsQuote ? `"${v.replaceAll('"', '\\"')}"` : v;
      return `${k}=${rendered}`;
    })
    .join("\n");
}
