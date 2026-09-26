// Static change-impact analysis: from a git diff to the pages and API endpoints it can reach.
// Import graph for JS/TS (relative imports, tsconfig path aliases, HTML <script src>), then
// a reverse walk from the changed files to entry points, keeping the chain that explains each hit.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SCAN_EXT = [...SOURCE_EXT, '.html'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out', '.turbo', '.vercel', 'test-results', 'playwright-report', '.forkfall']);
const MAX_FILES = 20000;

function git(repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`cannot run git in "${repo}": ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

const posix = (p) => p.split(path.sep).join('/');

function listFiles(repo) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) walk(path.join(dir, ent.name));
      } else if (ent.isFile() && SCAN_EXT.includes(path.extname(ent.name))) {
        out.push(posix(path.relative(repo, path.join(dir, ent.name))));
      }
    }
  };
  walk(repo);
  return out;
}

// tsconfig/jsconfig "paths" aliases, e.g. { "@/*": ["./src/*"] }. Comments and trailing commas tolerated.
function loadAliases(repo) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(repo, name);
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, 'utf8')
        .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
        .replace(/,\s*([}\]])/g, '$1');
      const opts = JSON.parse(text).compilerOptions ?? {};
      const base = opts.baseUrl ?? '.';
      return Object.entries(opts.paths ?? {}).map(([pattern, targets]) => ({
        prefix: pattern.replace(/\*$/, ''),
        wildcard: pattern.endsWith('*'),
        targets: targets.map((t) => posix(path.join(base, t.replace(/\*$/, '')))),
      }));
    } catch { /* unreadable config: no aliases */ }
  }
  return [];
}

const IMPORT_RES = [
  /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const HTML_RES = [/<script[^>]*\bsrc=["']([^"']+)["']/g, /<link[^>]*\bhref=["']([^"']+\.(?:css|js|mjs))["']/g];

export function extractSpecifiers(file, text) {
  const specs = new Set();
  const res = file.endsWith('.html') ? HTML_RES : IMPORT_RES;
  const src = file.endsWith('.html') ? text : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const re of res) for (const m of src.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

function makeResolver(repo, fileSet, aliases) {
  const tryFile = (p) => {
    const n = posix(path.normalize(p)).replace(/^\.\//, '');
    if (n.startsWith('..')) return null;
    if (fileSet.has(n)) return n;
    const noExt = n.replace(/\.(m|c)?js$|\.jsx$/, '');
    for (const ext of SOURCE_EXT) if (fileSet.has(noExt + ext)) return noExt + ext;
    for (const ext of SOURCE_EXT) if (fileSet.has(`${n}/index${ext}`)) return `${n}/index${ext}`;
    return null;
  };
  // Static web roots: "/js/app.js" in HTML may be served from public/ or static/.
  const webRoots = ['', 'public', 'static', 'src', 'www'];
  return (from, spec) => {
    if (/^(https?:|data:|\/\/)/.test(spec)) return null;
    if (spec.startsWith('.')) return tryFile(path.join(path.dirname(from), spec));
    if (spec.startsWith('/')) {
      for (const root of webRoots) {
        const hit = tryFile(path.join(root, spec.slice(1)));
        if (hit) return hit;
      }
      return null;
    }
    for (const a of aliases) {
      if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix) {
        for (const t of a.targets) {
          const hit = tryFile(a.wildcard ? path.join(t, spec.slice(a.prefix.length)) : t);
          if (hit) return hit;
        }
      }
    }
    return null; // bare package import: outside the repo's own graph
  };
}

// Entry points a user or client can reach directly.
export function classifyEntry(file) {
  const m = file.match(/^(?:src\/)?app\/(.*?)(?:^|\/)?(page|route|layout)\.(?:t|j)sx?$/);
  if (m) {
    const segs = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
    const route = `/${segs.join('/')}`;
    if (m[2] === 'page') return { kind: 'page', route, file };
    if (m[2] === 'route') return { kind: 'api', route, file };
    return { kind: 'layout', route, file };
  }
  const p = file.match(/^(?:src\/)?pages\/(.*)\.(?:t|j)sx?$/);
  if (p && !/(^|\/)_/.test(p[1])) {
    const route = `/${p[1].replace(/(^|\/)index$/, '')}`;
    return { kind: p[1].startsWith('api/') ? 'api' : 'page', route, file };
  }
  if (file.endsWith('.html')) {
    const route = `/${file.replace(/^(public|static|www)\//, '').replace(/(^|\/)index\.html$/, '$1')}`;
    return { kind: 'page', route: route.replace(/\/$/, '') || '/', file };
  }
  return null;
}

// Endpoints declared in server code (Express/Hono/Fastify style or plain pathname checks),
// and endpoints called from client code via fetch/axios string literals.
const DECLARE_RES = [
  /\b(?:app|router|server|api|fastify|hono)\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/gi,
  /\b(?:pathname|url|path)\s*===\s*['"`](\/[^'"`]*)['"`]/g,
  /\bcase\s+['"`]((?:GET|POST|PUT|PATCH|DELETE)\s+\/[^'"`]*)['"`]/g,
];
const CALL_RES = [/\bfetch\(\s*['"`](\/[^'"`?]*)/g, /\baxios\.\w+\(\s*['"`](\/[^'"`?]*)/g, /\b(?:action|href)=\{?['"`](\/api\/[^'"`?]*)/g];

const normalizeRoute = (r) => r.replace(/\$\{[^}]*\}/g, ':param').replace(/\[([^\]]+)\]/g, ':$1').replace(/\/+$/, '') || '/';
const routeMatches = (pattern, url) => {
  const a = normalizeRoute(pattern).split('/');
  const b = normalizeRoute(url).split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || s.startsWith(':') || b[i].startsWith(':'));
};

function scanEndpoints(text) {
  const declared = new Set();
  const called = new Set();
  for (const re of DECLARE_RES) for (const m of text.matchAll(re)) {
    const r = m[2] ?? m[1];
    declared.add(normalizeRoute(r.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/, '')));
  }
  for (const re of CALL_RES) for (const m of text.matchAll(re)) called.add(normalizeRoute(m[1]));
  return { declared: [...declared], called: [...called] };
}

// Top-level declarations whose line ranges overlap the changed lines.
const DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)|class\s+([\w$]+)|(?:interface|type|enum)\s+([\w$]+))/;
function changedSymbols(text, ranges) {
  const lines = text.split('\n');
  const decls = [];
  lines.forEach((l, i) => {
    const m = l.match(DECL_RE);
    if (m) decls.push({ name: m[1] ?? m[2] ?? m[3] ?? m[4], start: i + 1 });
  });
  const out = new Set();
  for (const [s, e] of ranges) {
    for (let k = 0; k < decls.length; k++) {
      const start = decls[k].start;
      const end = (decls[k + 1]?.start ?? lines.length + 1) - 1;
      if (s <= end && e >= start) out.add(decls[k].name);
    }
  }
  return [...out];
}

function parseDiff(diffText) {
  const files = new Map();
  let cur = null;
  for (const line of diffText.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.*)$/);
    if (f) { cur = f[1]; files.set(cur, []); continue; }
    if (line.startsWith('+++ /dev/null')) { cur = null; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && cur) {
      const start = Number(h[1]);
      const len = h[2] === undefined ? 1 : Number(h[2]);
      files.get(cur).push([start, Math.max(start, start + len - 1)]);
    }
  }
  return files;
}

export function analyzeImpact({ repo, base = 'HEAD~1', head = 'HEAD', maxDepth = 12 }) {
  repo = path.resolve(repo);
  const worktree = head === 'WORKTREE';
  const range = worktree ? [base] : [base, head];
  const nameStatus = git(repo, ['diff', '--name-status', '-M', ...range]).trim().split('\n').filter(Boolean);
  const hunks = parseDiff(git(repo, ['diff', '-U0', ...range]));
  const readAtHead = (f) => {
    if (worktree) return fs.existsSync(path.join(repo, f)) ? fs.readFileSync(path.join(repo, f), 'utf8') : '';
    const r = spawnSync('git', ['show', `${head}:${f}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : '';
  };

  // Snapshot of the head tree for the graph.
  let files;
  if (worktree) files = listFiles(repo);
  else files = git(repo, ['ls-tree', '-r', '--name-only', head]).split('\n')
    .filter((f) => SCAN_EXT.includes(path.extname(f)) && !f.split('/').some((s) => SKIP_DIRS.has(s)));
  const fileSet = new Set(files);
  const aliases = loadAliases(repo);
  const resolve = makeResolver(repo, fileSet, aliases);

  const deps = new Map();       // file -> imported files
  const rdeps = new Map();      // file -> files importing it
  const endpoints = new Map();  // file -> { declared, called }
  for (const f of files) {
    const text = readAtHead(f);
    const out = new Set();
    for (const spec of extractSpecifiers(f, text)) {
      const hit = resolve(f, spec);
      if (hit && hit !== f) out.add(hit);
    }
    deps.set(f, out);
    for (const d of out) (rdeps.get(d) ?? rdeps.set(d, new Set()).get(d)).add(f);
    const ep = scanEndpoints(text);
    if (ep.declared.length || ep.called.length) endpoints.set(f, ep);
  }

  const changed = nameStatus.map((l) => {
    const [status, ...paths] = l.split('\t');
    const file = paths.at(-1);
    const text = SOURCE_EXT.includes(path.extname(file)) ? readAtHead(file) : '';
    return { file, status: status[0], previous: paths.length > 1 ? paths[0] : undefined, symbols: text ? changedSymbols(text, hunks.get(file) ?? []) : [] };
  });

  // Reverse BFS from changed files; `via` keeps the shortest explanation chain.
  const via = new Map();
  const queue = [];
  for (const c of changed) if (fileSet.has(c.file) || c.status === 'D') { via.set(c.file, [c.file]); queue.push(c.file); }
  // Deleted files: their former importers are affected too (they now point at nothing).
  while (queue.length) {
    const f = queue.shift();
    if (via.get(f).length > maxDepth) continue;
    for (const importer of rdeps.get(f) ?? []) {
      if (!via.has(importer)) { via.set(importer, [...via.get(f), importer]); queue.push(importer); }
    }
  }

  // Server endpoints declared in affected files, then client files that call them.
  const affectedEndpoints = new Map();
  for (const [f, chain] of via) {
    const entry = classifyEntry(f);
    if (entry?.kind === 'api') affectedEndpoints.set(normalizeRoute(entry.route), { route: entry.route, chain });
    for (const r of endpoints.get(f)?.declared ?? []) if (!affectedEndpoints.has(r)) affectedEndpoints.set(r, { route: r, chain });
  }
  for (const [f, ep] of endpoints) {
    for (const called of ep.called) {
      for (const [route, info] of affectedEndpoints) {
        if (routeMatches(route, called) && !via.has(f)) {
          const chain = [...info.chain, `→ ${called} (HTTP)`, f];
          via.set(f, chain);
          // Everything that imports this client file is affected through the network call.
          const q = [f];
          while (q.length) {
            const x = q.shift();
            for (const imp of rdeps.get(x) ?? []) if (!via.has(imp)) { via.set(imp, [...via.get(x), imp]); q.push(imp); }
          }
        }
      }
    }
  }

  const entries = [];
  const seen = new Set();
  for (const [f, chain] of via) {
    const e = classifyEntry(f);
    if (!e) continue;
    if (e.kind === 'layout') {
      // A layout affects every page under it.
      for (const g of files) {
        const p = classifyEntry(g);
        if (p?.kind === 'page' && (p.route + '/').startsWith(e.route === '/' ? '/' : `${e.route}/`) && !seen.has(p.route)) {
          seen.add(p.route);
          entries.push({ ...p, chain: [...chain, `(layout wraps) ${g}`], distance: chain.length });
        }
      }
      continue;
    }
    const key = `${e.kind} ${e.route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ ...e, chain, distance: chain.filter((c) => !c.startsWith('→')).length - 1 });
  }
  for (const [route, info] of affectedEndpoints) {
    if (!entries.some((e) => e.kind === 'api' && routeMatches(e.route, route))) {
      entries.push({ kind: 'api', route, file: info.chain.at(-1), chain: info.chain, distance: info.chain.length - 1 });
    }
  }
  entries.sort((a, b) => a.distance - b.distance || a.route.localeCompare(b.route));

  return {
    kind: 'forkfall.impact',
    repo: posix(repo),
    base, head,
    baseCommit: git(repo, ['rev-parse', base]).trim(),
    headCommit: worktree ? null : git(repo, ['rev-parse', head]).trim(),
    message: worktree ? '(uncommitted changes)' : git(repo, ['log', '-1', '--format=%s', head]).trim(),
    graph: { files: files.length, edges: [...deps.values()].reduce((n, s) => n + s.size, 0), aliases: aliases.map((a) => a.prefix) },
    changed,
    affectedFiles: [...via.entries()].map(([file, chain]) => ({ file, chain })),
    entries,
    limitations: [
      'Static import graph from regular expressions: dynamic imports with computed paths, dependency injection and reflection are not followed.',
      'Links between client and server are inferred from literal fetch/axios URLs.',
      'A file being reachable from a change does not mean its behavior changed.',
    ],
  };
}
