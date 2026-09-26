// Loading and validation of analysis.json (schemaVersion 1).
// Everything in an analysis is agent-authored data: it is validated, never obeyed.
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_TEXT = 4000;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const NODE_TYPES = ['behavior', 'consequence', 'assumption', 'question'];
// 'observed' is deliberately absent: only evidence captured by Forkfall can make something observed.
export const EPISTEMIC = ['inferred', 'hypothesized', 'unknown'];
export const ORIGINS = ['agent', 'human', 'imported'];
export const RELATIONS = ['depends_on', 'may_cause', 'conflicts_with', 'mitigates'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export class AnalysisError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.errors = errors;
  }
}

export function loadAnalysis(file) {
  const abs = path.resolve(file);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_FILE_BYTES) throw new AnalysisError([`${file}: larger than ${MAX_FILE_BYTES} bytes`]);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new AnalysisError([`${file}: invalid JSON (${e.message})`]);
  }
  const errors = validate(data);
  if (errors.length) throw new AnalysisError(errors);
  const dir = path.dirname(abs);
  const root = path.resolve(dir, data.subject.root);
  if (!fs.existsSync(root)) throw new AnalysisError([`subject.root does not exist: ${data.subject.root}`]);
  // Compare real paths so symlinks and Windows junctions can't smuggle the root outside the repository.
  const realRoot = fs.realpathSync(root);
  const top = fs.realpathSync(findRepoTop(dir));
  if (!isInside(top, realRoot) && !isInside(fs.realpathSync(dir), realRoot)) {
    throw new AnalysisError([`subject.root escapes the repository: ${data.subject.root}`]);
  }
  return { data, file: abs, dir, root, stateDir: path.join(dir, '.forkfall') };
}

export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function findRepoTop(dir) {
  let cur = dir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return dir;
    cur = up;
  }
}

export function validate(a) {
  const errs = [];
  const err = (m) => errs.push(m);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v, where, required = true) => {
    if (v === undefined && !required) return;
    if (typeof v !== 'string' || (required && v.trim() === '')) return err(`${where}: must be a non-empty string`);
    if (v.length > MAX_TEXT) err(`${where}: longer than ${MAX_TEXT} characters`);
  };
  const list = (v, where) => {
    if (!Array.isArray(v)) { err(`${where}: must be an array`); return []; }
    if (v.length > MAX_ITEMS) { err(`${where}: more than ${MAX_ITEMS} items`); return []; }
    return v;
  };
  const oneOf = (v, allowed, where) => {
    if (!allowed.includes(v)) err(`${where}: "${v}" is not one of ${allowed.join(', ')}`);
  };
  const relPath = (v, where) => {
    text(v, where);
    if (typeof v === 'string' && (path.isAbsolute(v) || v.split(/[\\/]/).includes('..'))) {
      err(`${where}: must be a relative path without ".."`);
    }
  };

  if (!isObj(a)) return ['analysis: must be a JSON object'];
  if (typeof a.schemaVersion !== 'number') err('schemaVersion: required');
  else if (a.schemaVersion > SCHEMA_VERSION) err(`schemaVersion ${a.schemaVersion} is newer than this Forkfall understands (${SCHEMA_VERSION})`);
  else if (a.schemaVersion !== SCHEMA_VERSION) err(`schemaVersion: must be ${SCHEMA_VERSION}`);
  if (errs.length) return errs;

  text(a.analysisId, 'analysisId');
  text(a.createdAt, 'createdAt');
  if (!isObj(a.producer)) err('producer: required object');
  else { text(a.producer.adapter, 'producer.adapter'); text(a.producer.agent, 'producer.agent'); text(a.producer.model, 'producer.model', false); }
  if (!isObj(a.subject)) err('subject: required object');
  else { text(a.subject.title, 'subject.title'); text(a.subject.objective, 'subject.objective'); text(a.subject.root, 'subject.root'); }
  if (!isObj(a.scope)) err('scope: required object');
  else {
    list(a.scope.includedPaths, 'scope.includedPaths').forEach((p, i) => relPath(p, `scope.includedPaths[${i}]`));
    list(a.scope.limitations, 'scope.limitations').forEach((p, i) => text(p, `scope.limitations[${i}]`));
  }
  if (errs.length) return errs;

  const ids = new Map();
  const claimId = (id, where, kind) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return err(`${where}.id: must match ${ID_RE}`);
    if (ids.has(id)) err(`${where}.id: duplicate id "${id}"`);
    ids.set(id, kind);
  };

  const nodes = list(a.nodes, 'nodes');
  nodes.forEach((n, i) => {
    const w = `nodes[${i}]`;
    if (!isObj(n)) return err(`${w}: must be an object`);
    oneOf(n.type, NODE_TYPES, `${w}.type`);
    claimId(n.id, w, n.type);
    text(n.title, `${w}.title`);
    text(n.description, `${w}.description`, false);
    oneOf(n.epistemic, EPISTEMIC, `${w}.epistemic`);
    oneOf(n.origin, ORIGINS, `${w}.origin`);
    if (n.type === 'behavior') {
      text(n.actor, `${w}.actor`); text(n.trigger, `${w}.trigger`); text(n.outcome, `${w}.outcome`);
      list(n.acceptance, `${w}.acceptance`).forEach((c, j) => text(c, `${w}.acceptance[${j}]`));
    }
    if (n.type === 'consequence') {
      text(n.affected, `${w}.affected`);
      oneOf(n.severity, SEVERITIES, `${w}.severity`);
      text(n.reversibility, `${w}.reversibility`);
    }
    if (n.type === 'assumption') {
      text(n.refutation, `${w}.refutation`);
      if (n.check !== undefined) {
        text(n.check.id, `${w}.check.id`);
        oneOf(n.check.holdsIf, ['pass', 'fail'], `${w}.check.holdsIf`);
      }
    }
    if (n.type === 'question') text(n.owner, `${w}.owner`);
  });

  const checks = list(a.checks, 'checks');
  checks.forEach((c, i) => {
    const w = `checks[${i}]`;
    if (!isObj(c)) return err(`${w}: must be an object`);
    claimId(c.id, w, 'check');
    text(c.description, `${w}.description`);
    text(c.command, `${w}.command`);
    relPath(c.cwd, `${w}.cwd`);
    list(c.verifies, `${w}.verifies`);
  });

  const decisions = list(a.decisions, 'decisions');
  decisions.forEach((d, i) => {
    const w = `decisions[${i}]`;
    if (!isObj(d)) return err(`${w}: must be an object`);
    claimId(d.id, w, 'decision');
    text(d.question, `${w}.question`);
    if (d.basis !== undefined) oneOf(d.basis, ['full', 'analysis'], `${w}.basis`);
    const optIds = new Set();
    const opts = list(d.options, `${w}.options`);
    if (opts.length < 1) err(`${w}.options: needs at least one option`);
    opts.forEach((o, j) => {
      if (!isObj(o)) return err(`${w}.options[${j}]: must be an object`);
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) err(`${w}.options[${j}].id: must match ${ID_RE}`);
      if (optIds.has(o.id)) err(`${w}.options[${j}].id: duplicate "${o.id}"`);
      optIds.add(o.id);
      text(o.label, `${w}.options[${j}].label`);
      text(o.consequence, `${w}.options[${j}].consequence`);
    });
    list(d.related ?? [], `${w}.related`);
  });

  const claims = list(a.claims ?? [], 'claims');
  claims.forEach((c, i) => {
    const w = `claims[${i}]`;
    if (!isObj(c)) return err(`${w}: must be an object`);
    claimId(c.id, w, 'claim');
    text(c.statement, `${w}.statement`);
    list(c.about, `${w}.about`);
  });

  const edges = list(a.edges, 'edges');
  edges.forEach((e, i) => {
    const w = `edges[${i}]`;
    if (!isObj(e)) return err(`${w}: must be an object`);
    oneOf(e.relation, RELATIONS, `${w}.relation`);
    text(e.rationale, `${w}.rationale`);
    oneOf(e.epistemic, EPISTEMIC, `${w}.epistemic`);
  });
  if (errs.length) return errs;

  // Reference integrity.
  const isNode = (id) => NODE_TYPES.includes(ids.get(id));
  edges.forEach((e, i) => {
    if (!isNode(e.from)) err(`edges[${i}].from: unknown node "${e.from}"`);
    if (!isNode(e.to)) err(`edges[${i}].to: unknown node "${e.to}"`);
  });
  checks.forEach((c, i) => c.verifies.forEach((v) => {
    if (ids.get(v) !== 'behavior') err(`checks[${i}].verifies: "${v}" is not a behavior`);
  }));
  nodes.forEach((n, i) => {
    if (n.type === 'assumption' && n.check && ids.get(n.check.id) !== 'check') err(`nodes[${i}].check.id: unknown check "${n.check.id}"`);
  });
  decisions.forEach((d, i) => (d.related ?? []).forEach((r) => {
    if (!isNode(r)) err(`decisions[${i}].related: unknown node "${r}"`);
  }));
  claims.forEach((c, i) => c.about.forEach((r) => {
    if (!isNode(r)) err(`claims[${i}].about: unknown node "${r}"`);
  }));
  return errs;
}
