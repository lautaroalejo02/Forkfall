# Forkfall

Decide on the **behavior, assumptions and consequences** of a code change without reading the code. An agent writes a structured `analysis.json`; Forkfall validates it, runs its checks and records the output, renders an offline report, and records human decisions. An approval expires as soon as anything it covered changes.

Status: first vertical slice (Fixture A: permission cache). Zero dependencies, Node 22+.

```sh
node demo/permissions-cache/run-demo.mjs      # full story: fail → decide → fix → approve → change → stale
cd packages/forkfall && npm test              # core rules
```

CLI (`packages/forkfall/bin/forkfall.js`):

```text
forkfall validate <analysis.json>
forkfall status   <analysis.json>                 exit 3 while decisions are pending/stale
forkfall verify   <analysis.json> [--check id] [--yes]   runs checks, stores captured evidence
forkfall report   <analysis.json> [--out file.html]
forkfall decide   <analysis.json> <decision> <option> --by <name> [--action approve|reject|request_changes|accept_risk]
forkfall revoke   <analysis.json> <decision> --by <name>
```

Rules the core enforces:

- Agents cannot mark anything `observed`. Only checks run by `forkfall verify` produce evidence, and agent statements are shown as "not evidence".
- Evidence is tied to a content digest of the files in scope, so evidence from another version of the code doesn't count.
- A decision records the digest of what the person saw. Any change to code, analysis or check outcome makes it stale. Decisions with `"basis": "analysis"` (policy choices) depend only on the analysis.
- The report has no scripts (CSP `default-src 'none'`) and escapes all analysis text.
- Decisions are local and unauthenticated in this slice.
