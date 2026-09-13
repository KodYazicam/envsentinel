# Contributing to envsentinel

```bash
npm ci
npm test
npm run typecheck
```

- Schema load must go through `parseSchema` (no raw `JSON.parse` casts).
- `scan` must not print secret values.
- New field types need coerce + example placeholder + a test.
- Keep KYAL-1.0 attribution.
