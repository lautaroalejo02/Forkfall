// Project setup: forkfall.config.json, `init` (detect how to run the app, warn about unsafe
// environments) and `doctor` (check everything needed before exploring).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CONFIG_FILE = 'forkfall.config.json';
// Config keys map 1:1 to `explore` flags.
const KEYS = ['start', 'resetPath', 'readyMinutes', 'envFiles', 'baselineEnv', 'candidateEnv', 'lang', 'record', 'sequences', 'steps', 'minutes', 'scenarios', 'expect', 'intent'];
const toFlag = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const PATH_KEYS = new Set(['baselineEnv', 'candidateEnv', 'scenarios', 'expect']);

export function loadConfig(repo) {
  const file = path.join(repo, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${CONFIG_FILE}: invalid JSON (${e.message})`); }
  const flags = {};
  for (const k of KEYS) {
    if (cfg[k] === undefined || cfg[k] === null) continue;
    let v = cfg[k];
    if (PATH_KEYS.has(k)) v = path.resolve(repo, v);
    if (k === 'envFiles') { flags['env-file'] = v; continue; }
    flags[toFlag(k)] = typeof v === 'number' ? String(v) : v;
  }
  return flags;
}

const DB_KEYS = /^(DATABASE_URL|DB_URL|POSTGRES_URL\w*|POSTGRES_PRISMA_URL|MYSQL_URL|MONGO(DB)?_URI|MONGO_URL|REDIS_URL|SUPABASE_URL|NEON_\w+|PG(HOST|DATABASE))$/;
const PAID_KEYS = /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_(SECRET|API)_KEY|STRIPE_SECRET|SENDGRID_API_KEY|RESEND_API_KEY|POSTMARK\w*|TWILIO_\w+|MAILGUN\w*|AWS_SECRET_ACCESS_KEY)$/;
const LOCAL = /(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|host\.docker\.internal|file:|:memory:)/i;

// Looks at env files for things exploration must not touch. Never returns secret values.
export function scanEnv(repo, files) {
  const warnings = [];
  for (const f of files) {
    const db = { keys: [], hosts: new Set() };
    const paid = [];
    const abs = path.resolve(repo, f);
    if (!fs.existsSync(abs)) continue;
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[2].trim()) continue;
      const [, key, raw] = m;
      const value = raw.trim().replace(/^["']|["']$/g, '');
      if (DB_KEYS.test(key) && !LOCAL.test(value)) {
        db.keys.push(key);
        const host = value.match(/@([^/:?]+)/)?.[1] ?? (key.startsWith('PGHOST') ? value : null);
        if (host) db.hosts.add(host.replace(/-pooler(?=\.)/, ''));
      }
      if (PAID_KEYS.test(key)) paid.push(key);
    }
    if (db.keys.length) {
      warnings.push({ file: f, kind: 'database', message: `${f} points at a remote database${db.hosts.size ? ` (${[...db.hosts].join(', ')})` : ''} via ${db.keys.slice(0, 3).join(', ')}${db.keys.length > 3 ? ` and ${db.keys.length - 3} more` : ''}. Exploration clicks and submits forms, so it WRITES data there.` });
    }
    if (paid.length) {
      warnings.push({ file: f, kind: 'external', message: `${f} sets ${paid.join(', ')}. Exploration may call these services for real (cost, emails, charges). Prefer test keys or a demo mode.` });
    }
  }
  return warnings;
}

export function detect(repo) {
  const pkgFile = path.join(repo, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : null;
  const scripts = pkg?.scripts ?? {};
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const notes = [];
  let start = null;
  let framework = 'unknown';
  if (deps.next) {
    framework = 'Next.js';
    start = scripts.build && scripts.start ? 'npm run build && npm start' : 'npx next dev';
    notes.push('Next.js reads PORT, so each copy gets its own port automatically.');
  } else if (deps.vite) {
    framework = 'Vite';
    start = scripts.preview && scripts.build ? 'npm run build && npx vite preview --port {port}' : 'npx vite --port {port}';
    notes.push('Vite needs the port on the command line; {port} is replaced for each copy.');
  } else if (scripts.start) {
    framework = deps.express ? 'Express' : 'Node';
    start = 'npm start';
    notes.push('Make sure the server listens on process.env.PORT.');
  } else if (scripts.dev) {
    start = 'npm run dev';
    notes.push('Using the dev script. Make sure it listens on process.env.PORT.');
  }
  const envFiles = fs.readdirSync(repo).filter((f) => /^\.env(\..+)?$/.test(f) && !/example|sample|template/i.test(f));
  const resetGuess = [...['server.js', 'app.js', 'index.js'].map((f) => path.join(repo, f)), ...listSource(repo)]
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8').match(/['"`](\/(?:__)?(?:api\/)?(?:test\/)?reset)['"`]/)?.[1])
    .find(Boolean) ?? null;
  return { framework, start, envFiles, resetPath: resetGuess, notes, warnings: scanEnv(repo, envFiles) };
}

function listSource(repo) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 3 || out.length > 400) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(m?js|ts)$/.test(e.name) && /server|api|route|app/i.test(p)) out.push(p);
    }
  };
  walk(repo, 0);
  return out;
}

export function writeConfig(repo, d, { force = false } = {}) {
  const file = path.join(repo, CONFIG_FILE);
  if (fs.existsSync(file) && !force) return { file, written: false };
  const cfg = {
    $comment: 'Forkfall settings. Each version (before/after) runs in its own copy of the repo. Point baselineEnv/candidateEnv at env files with a SAFE database for each copy.',
    start: d.start,
    resetPath: d.resetPath,
    readyMinutes: d.framework === 'Next.js' ? 8 : 2,
    baselineEnv: null,
    candidateEnv: null,
    envFiles: [],
    lang: 'en',
    record: 3,
    sequences: 30,
    steps: 8,
    minutes: 8,
  };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  const gi = path.join(repo, '.gitignore');
  if (fs.existsSync(gi) && !/^\.forkfall\/?$/m.test(fs.readFileSync(gi, 'utf8'))) fs.appendFileSync(gi, '\n.forkfall/\n');
  return { file, written: true };
}

export async function doctor(repo) {
  const checks = [];
  const add = (ok, what, fix) => checks.push({ ok, what, fix });
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 22, `Node ${process.versions.node}`, 'Install Node 22 or newer.');
  const g = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' });
  add(g.status === 0, 'git repository', 'Run inside a git repository: Forkfall compares two commits.');
  try {
    const { chromium } = await import('playwright');
    add(fs.existsSync(chromium.executablePath()), 'Chromium for Playwright', 'Run: npx playwright install chromium');
  } catch {
    add(false, 'Playwright', 'Install it next to Forkfall: npm install playwright');
  }
  const cfgFile = path.join(repo, CONFIG_FILE);
  const hasCfg = fs.existsSync(cfgFile);
  add(hasCfg, CONFIG_FILE, 'Run: forkfall init');
  let cfg = {};
  if (hasCfg) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      add(!!cfg.start, 'start command', `Set "start" in ${CONFIG_FILE}.`);
      for (const k of ['baselineEnv', 'candidateEnv']) {
        if (cfg[k]) add(fs.existsSync(path.resolve(repo, cfg[k])), `${k} file exists`, `Create ${cfg[k]} or fix the path.`);
      }
    } catch (e) {
      add(false, `${CONFIG_FILE} is valid JSON`, e.message);
    }
  }
  const envs = [...(cfg.baselineEnv ? [cfg.baselineEnv] : []), ...(cfg.candidateEnv ? [cfg.candidateEnv] : [])];
  const scanned = envs.length ? envs : fs.readdirSync(repo).filter((f) => /^\.env(\..+)?$/.test(f) && !/example|sample|template/i.test(f));
  const warnings = scanEnv(repo, scanned);
  // Both copies on the same real database is the one setup that is never acceptable.
  if (!envs.length && warnings.some((w) => w.kind === 'database')) {
    add(false, 'separate, disposable databases', 'Both copies would use the database in your env files. Create two copies (a local DB, database branches, a demo mode) and set baselineEnv and candidateEnv in forkfall.config.json.');
  }
  add(process.env.TYPESAFE_API_KEY ? true : null, 'TYPESAFE_API_KEY (optional: Jev ranks differences)', 'Optional. Without it every difference is listed unranked.');
  return { checks, warnings, usingSeparateEnvs: envs.length === 2 };
}
