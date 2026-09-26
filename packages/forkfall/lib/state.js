// Evidence capture, human decisions and derived state.
// Validity is conservative: any change to the reviewed code, analysis or evidence outcome
// changes the review basis digest and makes earlier decisions stale.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isInside } from './analysis.js';

const OUTPUT_TAIL = 6000;
const CHECK_TIMEOUT_MS = 120_000;
export const ACTIONS = ['approve', 'reject', 'request_changes', 'accept_risk', 'revoke'];

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Content hash of everything in scope. Unlike a commit ref, this also covers uncommitted edits.
// The digest is over a manifest of (path, kind, per-entry hash) so entries cannot be spliced together.
// Symlinks are recorded by target instead of followed, so they can't point the digest outside the root.
export function subjectDigest(ctx) {
  const entries = [];
  const rel = (abs) => path.relative(ctx.root, abs).split(path.sep).join('/');
  const walk = (abs) => {
    if (!fs.existsSync(abs) && !isLink(abs)) return entries.push([rel(abs), 'missing', '']);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return entries.push([rel(abs), 'link', sha256(fs.readlinkSync(abs))]);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        if (name === '.git' || name === '.forkfall') continue;
        walk(path.join(abs, name));
      }
    } else if (st.isFile()) entries.push([rel(abs), 'file', sha256(fs.readFileSync(abs))]);
    else entries.push([rel(abs), 'other', '']);
  };
  for (const p of ctx.data.scope.includedPaths) {
    const abs = path.resolve(ctx.root, p);
    if (isInside(ctx.root, abs)) walk(abs);
  }
  entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return { digest: sha256(JSON.stringify(entries)), fileCount: entries.filter((e) => e[1] === 'file').length };
}

function isLink(abs) {
  try { return fs.lstatSync(abs).isSymbolicLink(); } catch { return false; }
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function redact(s) {
  return s
    .replace(/\b(sk|ghp|gho|xox[abp]|AKIA)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
}

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

function writeRecord(dir, prefix, record) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${prefix}-${crypto.randomBytes(3).toString('hex')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

// Runs one declared check and stores what actually happened. Only this function
// produces evidence with provenance "captured".
export function captureCheck(ctx, check) {
  const cwd = path.resolve(ctx.root, check.cwd);
  // Resolve links too, so a symlinked or junctioned directory can't move the check outside the root.
  if (!fs.existsSync(cwd) || !isInside(fs.realpathSync(ctx.root), fs.realpathSync(cwd))) {
    throw new Error(`check ${check.id}: cwd is missing or escapes subject root`);
  }
  const subject = subjectDigest(ctx);
  const started = Date.now();
  const r = spawnSync(check.command, { cwd, shell: true, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS });
  const output = redact(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  // If the code in scope changed while the check ran, the result says nothing about either version.
  const changedDuringRun = subjectDigest(ctx).digest !== subject.digest;
  const record = {
    kind: 'forkfall.evidence',
    provenance: 'captured',
    checkId: check.id,
    checkDigest: checkDigest(check),
    verifies: check.verifies,
    command: check.command,
    cwd: check.cwd,
    exitCode: r.status,
    timedOut: r.error?.code === 'ETIMEDOUT',
    result: changedDuringRun ? 'inconclusive' : r.status === 0 ? 'pass' : 'fail',
    capturedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    subjectDigest: subject.digest,
    commit: git(['rev-parse', 'HEAD'], ctx.root),
    dirty: (git(['status', '--porcelain', '--', '.'], ctx.root) ?? '') !== '',
    environment: { node: process.version, platform: process.platform },
    outputDigest: sha256(output),
    outputTail: output.slice(-OUTPUT_TAIL),
    limitations: [
      'Supports only the acceptance criteria this command exercises, in this environment.',
      ...(changedDuringRun ? ['Code in scope changed while the check ran; result is inconclusive.'] : []),
    ],
  };
  const file = writeRecord(path.join(ctx.stateDir, 'evidence'), check.id, record);
  return { record, file };
}

// Evidence only counts for the exact check definition that produced it.
export const checkDigest = (c) => sha256(canonical({ id: c.id, command: c.command, cwd: c.cwd, verifies: c.verifies }));

export function recordDecision(ctx, { decisionId, option, action, by, note, basis }) {
  const d = ctx.data.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error(`unknown decision "${decisionId}"`);
  if (!ACTIONS.includes(action)) throw new Error(`action must be one of ${ACTIONS.join(', ')}`);
  if (action !== 'revoke' && !d.options.some((o) => o.id === option)) {
    throw new Error(`decision "${decisionId}" has no option "${option}"`);
  }
  const state = deriveState(ctx);
  // The person must quote the basis shown in the report they read, so an approval can't silently
  // cover code or evidence that changed after the report was generated.
  const expected = state.basisFor(d);
  if (typeof basis !== 'string' || basis.length < 12 || !expected.startsWith(basis)) {
    const err = new Error(`basis mismatch: the current review basis for "${decisionId}" is ${expected.slice(0, 12)}. Regenerate the report, review it, and pass --basis from it.`);
    err.code = 'BASIS_MISMATCH';
    throw err;
  }
  const record = {
    kind: 'forkfall.decision',
    decisionId,
    option: action === 'revoke' ? null : option,
    action,
    by,
    attribution: 'local, unauthenticated',
    note: note ?? '',
    at: new Date().toISOString(),
    basis: d.basis ?? 'full',
    reviewBasisDigest: state.basisFor(d),
  };
  const file = writeRecord(path.join(ctx.stateDir, 'decisions'), decisionId, record);
  return { record, file };
}

export function deriveState(ctx) {
  const a = ctx.data;
  const subject = subjectDigest(ctx);
  const evidence = readJsonDir(path.join(ctx.stateDir, 'evidence')).filter((e) => e.kind === 'forkfall.evidence');
  const decisionsLog = readJsonDir(path.join(ctx.stateDir, 'decisions')).filter((d) => d.kind === 'forkfall.decision');

  const checks = {};
  for (const c of a.checks) {
    const mine = evidence.filter((e) => e.checkId === c.id && e.checkDigest === checkDigest(c))
      .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
    const latest = mine.at(-1) ?? null;
    const current = mine.filter((e) => e.subjectDigest === subject.digest).at(-1) ?? null;
    const status = current ? current.result : latest ? 'outdated' : 'never_run';
    // What enters the approval basis: the outcome, not timestamps.
    const outcome = current ? `${current.result}:${current.exitCode}:${current.timedOut}` : status;
    checks[c.id] = { check: c, status, outcome, current, latest, history: mine };
  }

  const assumptions = {};
  for (const n of a.nodes.filter((x) => x.type === 'assumption')) {
    let status = 'unexamined';
    if (n.check) {
      const s = checks[n.check.id].status;
      if (s === 'pass' || s === 'fail') status = s === n.check.holdsIf ? 'supported' : 'contradicted';
      else if (s === 'outdated') status = 'unexamined';
    }
    assumptions[n.id] = { status };
  }

  const behaviors = {};
  for (const n of a.nodes.filter((x) => x.type === 'behavior')) {
    const related = a.checks.filter((c) => c.verifies.includes(n.id)).map((c) => checks[c.id]);
    let status = 'not_verified';
    if (related.some((r) => r.status === 'fail')) status = 'failed';
    else if (related.length && related.every((r) => r.status === 'pass')) status = 'verified';
    const contradicted = a.edges
      .filter((e) => e.from === n.id && e.relation === 'depends_on' && assumptions[e.to]?.status === 'contradicted')
      .map((e) => e.to);
    behaviors[n.id] = { status, checks: related.map((r) => r.check.id), contradictedAssumptions: contradicted };
  }

  // Everything a reviewer sees: the analysis content, the code in scope and each check's outcome.
  const { createdAt, producer, ...semantic } = a;
  const reviewBasisDigest = sha256(canonical({
    analysis: semantic,
    subject: subject.digest,
    checks: Object.fromEntries(Object.entries(checks).map(([id, c]) => [id, c.outcome])),
  }));
  // Policy decisions (basis: "analysis") are about intent, so they only depend on the analysis text.
  const analysisBasisDigest = sha256(canonical({ analysis: semantic }));
  const basisFor = (d) => (d.basis === 'analysis' ? analysisBasisDigest : reviewBasisDigest);

  const decisions = {};
  for (const d of a.decisions) {
    const history = decisionsLog.filter((r) => r.decisionId === d.id).sort((x, y) => x.at.localeCompare(y.at));
    const latest = history.at(-1) ?? null;
    let status = 'pending';
    if (latest?.action === 'revoke') status = 'revoked';
    else if (latest && latest.reviewBasisDigest !== basisFor(d)) status = 'stale';
    else if (latest) status = 'current';
    decisions[d.id] = { status, latest, history, basis: basisFor(d) };
  }

  return { subject, checks, assumptions, behaviors, decisions, reviewBasisDigest, basisFor, commit: git(['rev-parse', 'HEAD'], ctx.root) };
}
