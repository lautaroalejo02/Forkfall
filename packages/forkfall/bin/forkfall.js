#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadAnalysis, AnalysisError } from '../lib/analysis.js';
import { captureCheck, deriveState, recordDecision, ACTIONS } from '../lib/state.js';
import { renderReport } from '../lib/report.js';
import { analyzeImpact } from '../lib/impact.js';
import { renderMap } from '../lib/map.js';
import { loadConfig, detect, writeConfig, doctor, scanEnv } from '../lib/setup.js';

const USAGE = `forkfall — decide on behavior, not diffs

Usage:
  forkfall demo              try it: a bundled shop whose change hides a bug two screens away
  forkfall init     [repo]   detect how to run the app, write forkfall.config.json, warn about unsafe envs
  forkfall doctor   [repo]   check that everything needed is in place
  forkfall impact   <repo> [--base HEAD~1] [--head HEAD|WORKTREE] [--files a.ts,b.ts] [--out impact.json]
                    --files: predict impact from a plan's files instead of a diff
  forkfall explore  <repo> --start "<command using $PORT>" [--base HEAD~1] [--head HEAD]
                    [--reset-path /__reset] [--scenarios file.json] [--sequences 40] [--steps 8]
                    [--minutes 5] [--seed 1] [--env-file .env] [--lang es|en] [--out-dir dir]
                    [--intent "what the change is meant to do"] [--ready-minutes 2]
                    [--baseline-env file --candidate-env file]  (copied to each copy as .env.local)
                    [--record 3]  record side-by-side replays of the top findings (0 = off)
                    [--expect expected.json]  check every difference against a plan's expected changes
                    [--calibrate-env]  ignore lines that already differ before any action (data drift);
                                       can hide real changes visible on load
                    or, for apps you already run: --candidate-url URL [--baseline-url URL]
  forkfall judge    <run-dir> [--intent "..."] [--lang es|en]   re-judge a run with Jev (needs TYPESAFE_API_KEY)
  forkfall validate <analysis.json>
  forkfall status   <analysis.json>
  forkfall verify   <analysis.json> [--check <id>] [--yes]
  forkfall report   <analysis.json> [--out report.html]
  forkfall decide   <analysis.json> <decisionId> <optionId> --by <name> --basis <digest> [--action approve] [--note text]
  forkfall revoke   <analysis.json> <decisionId> --by <name> --basis <digest> [--note text]

  --basis is the review basis printed on the decision in the report you read.

Exit codes: 0 ok · 1 invalid input, failed check or basis mismatch · 2 usage error · 3 decisions pending or stale (status)
Actions: ${ACTIONS.join(', ')}`;

async function runExplore(repo, v) {
  const { explore } = await import('../lib/explore.js');
  const { startApps } = await import('../lib/apps.js');
  const base = v.base ?? 'HEAD~1';
  const head = v.head ?? 'HEAD';
  const impact = analyzeImpact({ repo, base, head });
  printImpact(impact);
  const outDir = v['out-dir'] ?? path.join(repo, '.forkfall', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });

  let apps = null;
  let candidateUrl = v['candidate-url'];
  let baselineUrl = v['baseline-url'];
  if (!candidateUrl) {
    if (!v.start) { console.error('explore needs --start "<command>" or --candidate-url'); return 2; }
    // Env files copied into BOTH copies must not point at a real database.
    const shared = scanEnv(repo, v['env-file'] ?? []).filter((w) => w.kind === 'database');
    if (shared.length && !v['allow-shared-db']) {
      for (const w of shared) console.error(`refusing to start: ${w.message}`);
      console.error('Both copies would share it. Use baselineEnv/candidateEnv with disposable databases, or pass --allow-shared-db if that database is disposable.');
      return 2;
    }
    apps = await startApps({
      repo, base, head, start: v.start, envFiles: v['env-file'] ?? [],
      baselineEnv: v['baseline-env'], candidateEnv: v['candidate-env'],
      readyTimeoutMs: Number(v['ready-minutes'] ?? 2) * 60_000, log: (m) => console.log(m),
    });
    candidateUrl = apps.candidate.url;
    baselineUrl = apps.baseline.url;
  }
  const pages = impact.entries.filter((e) => e.kind === 'page');
  let exploration;
  try {
    exploration = await explore({
      candidateUrl, baselineUrl,
      focusRoutes: pages.map((e) => e.route),
      startPaths: [...new Set(['/', ...pages.filter((e) => !/\[|:/.test(e.route)).map((e) => e.route)])],
      scenarios: v.scenarios ? JSON.parse(fs.readFileSync(v.scenarios, 'utf8')) : [],
      resetPath: v['reset-path'],
      sequences: Number(v.sequences ?? 40), maxSteps: Number(v.steps ?? 8),
      timeMs: Number(v.minutes ?? 5) * 60_000, seed: Number(v.seed ?? 1), calibrateEnv: !!v['calibrate-env'],
      log: (m) => console.log(m),
    });
    // Judge and record while both apps are still running: recording replays the steps.
    if (process.env.TYPESAFE_API_KEY) await judgeRun({ impact, exploration, v, outDir });
    if (v.expect) await planRun({ exploration, v });
    await recordRun({ exploration, impact, candidateUrl, baselineUrl, v, outDir });
  } finally {
    apps?.stop();
  }
  fs.writeFileSync(path.join(outDir, 'impact.json'), `${JSON.stringify(impact, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'exploration.json'), `${JSON.stringify(exploration, null, 2)}\n`);
  const mapFile = path.join(outDir, 'map.html');
  fs.writeFileSync(mapFile, renderMap({ impact, exploration, lang: v.lang ?? 'en' }));
  const bad = exploration.findings.filter((f) => !f.preexisting && f.severity >= 2);
  if (exploration.plan) printPlan(exploration);
  console.log(`\n${exploration.coverage.sequences} sequences, ${exploration.coverage.distinctStates} states, ${bad.length} confirmed problem(s), ${exploration.findings.filter((f) => !f.preexisting && f.severity === 1).length} difference(s)`);
  for (const f of bad) console.log(`  [${f.type}] ${f.route}: ${f.detail}\n    ${f.repro.map((s) => s.text).join(' → ')}`);
  const top = exploration.findings.filter((f) => f.replay).sort((a, b) => replayRank(a) - replayRank(b))[0];
  if (top) console.log(`replay: ${path.join(outDir, top.replay.page)}`);
  console.log(`map: ${mapFile}`);
  return bad.length || exploration.plan?.unexpected.length ? 1 : 0;
}

async function runDemo(v) {
  const { prepareDemo, openInBrowser } = await import('../lib/demo.js');
  const { repo, options } = prepareDemo();
  console.log(`demo: a small shop in ${repo}`);
  console.log('The change "remember product quantity selections" touched a shared helper. Let\'s see what it did.\n');
  const code = await runExplore(repo, { ...options, lang: v.lang ?? 'en' });
  const exploration = JSON.parse(fs.readFileSync(path.join(options['out-dir'], 'exploration.json'), 'utf8'));
  const top = exploration.findings.filter((f) => f.replay).sort((a, b) => replayRank(a) - replayRank(b))[0];
  const target = top ? path.join(options['out-dir'], top.replay.page) : path.join(options['out-dir'], 'map.html');
  if (!v['no-open']) openInBrowser(target);
  console.log(`\nopened ${target}`);
  return code;
}

function runInit(repo, v) {
  const d = detect(repo);
  const { file, written } = writeConfig(repo, d, { force: v.force });
  console.log(`framework: ${d.framework}`);
  console.log(`start:     ${d.start ?? '(not found: set "start" by hand)'}`);
  console.log(`reset:     ${d.resetPath ?? '(none found: sequences will share state; add a reset endpoint if you can)'}`);
  for (const n of d.notes) console.log(`note: ${n}`);
  for (const w of d.warnings) console.log(`WARNING: ${w.message}`);
  console.log(written ? `
wrote ${file}` : `
${file} already exists (use --force to overwrite)`);
  console.log('next: edit baselineEnv/candidateEnv if your app needs a database, then run: forkfall doctor');
  return 0;
}

async function runDoctor(repo) {
  const r = await doctor(repo);
  for (const c of r.checks) console.log(`${c.ok === true ? 'ok  ' : c.ok === null ? '--  ' : 'FAIL'} ${c.what}${c.ok === true ? '' : `  → ${c.fix}`}`);
  for (const w of r.warnings) console.log(`WARN ${w.message}`);
  const failed = r.checks.filter((c) => c.ok === false).length;
  console.log(failed ? `
${failed} problem(s) to fix before exploring.` : `
ready: forkfall explore ${repo}`);
  return failed ? 1 : 0;
}

async function planRun({ exploration, v }) {
  const { checkAgainstPlan, validateExpected } = await import('../lib/expect.js');
  const expected = JSON.parse(fs.readFileSync(v.expect, 'utf8'));
  const errs = validateExpected(expected);
  if (errs.length) throw new Error(`invalid ${v.expect}:\n  ${errs.join('\n  ')}`);
  exploration.plan = await checkAgainstPlan({ exploration, expected, apiKey: process.env.TYPESAFE_API_KEY, log: (m) => console.log(m) });
}

function printPlan(exploration) {
  const p = exploration.plan;
  console.log('\nagainst the plan:');
  for (const c of p.changes) console.log(`  ${c.status === 'seen' ? 'SEEN    ' : c.status === 'maybe' ? 'MAYBE   ' : 'NOT SEEN'} ${c.id}${c.seen.length ? ` (${c.seen.length} finding(s))` : ''}`);
  for (const id of p.unexpected) {
    const f = exploration.findings.find((x) => x.id === id);
    console.log(`  UNEXPECTED ${f.type} on ${f.route} (${f.plan.reason}): ${[...(f.added ?? []), f.detail].filter(Boolean)[0]?.slice(0, 100)}\n    ${f.repro.map((s) => s.text).join(' → ')}`);
  }
}

// Most interesting first: outside the plan, suspicious, confirmed errors, then the rest.
const replayRank = (f) => (f.plan?.status === 'unexpected' ? 0 : f.judgment?.verdict === 'suspicious' ? 1 : f.severity >= 2 ? 2 : f.judgment?.verdict === 'unexplained' ? 3 : 4);

async function recordRun({ exploration, impact, candidateUrl, baselineUrl, v, outDir }) {
  const max = Number(v.record ?? 3);
  const chosen = exploration.findings
    .filter((f) => !f.preexisting && f.severity >= 1 && f.repro?.length)
    .sort((a, b) => replayRank(a) - replayRank(b) || a.repro.length - b.repro.length);
  if (!max || !chosen.length) return;
  const { recordFindings } = await import('../lib/record.js');
  const { renderReplay } = await import('../lib/replay.js');
  const { typeLabel } = await import('../lib/map.js');
  const lang = v.lang ?? 'en';
  const done = await recordFindings({ candidateUrl, baselineUrl, findings: chosen, outDir, max, resetPath: v['reset-path'], log: (m) => console.log(m) });
  for (const f of done) fs.writeFileSync(path.join(outDir, f.replay.page), renderReplay({ finding: f, impact, lang, typeLabel: typeLabel(f.type, lang) }));
}

async function judgeRun({ impact, exploration, v, outDir }) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) { console.log('(no TYPESAFE_API_KEY: differences are not judged)'); return; }
  const { judgeFindings } = await import('../lib/judge.js');
  const usage = await judgeFindings({ exploration, impact, intent: v.intent, apiKey, log: (m) => console.log(m) });
  exploration.judge = { intent: v.intent ?? impact.message, usage };
  fs.writeFileSync(path.join(outDir, 'exploration.json'), `${JSON.stringify(exploration, null, 2)}
`);
  fs.writeFileSync(path.join(outDir, 'map.html'), renderMap({ impact, exploration, lang: v.lang ?? 'en' }));
  console.log(`judged ${usage.requests} finding(s) with Jev (${usage.input_tokens} in / ${usage.output_tokens} out tokens)`);
  for (const f of exploration.findings.filter((x) => x.judgment?.verdict === 'suspicious' || x.judgment?.verdict === 'unexplained')) {
    console.log(`  ${f.judgment.verdict.toUpperCase()} ${f.route} (explained ${f.judgment.explainedByIntent.toFixed(2)}, inconsistent ${f.judgment.screenInconsistent.toFixed(2)}): ${f.repro.map((s) => s.text).join(' → ')}`);
  }
  console.log(`map: ${path.join(outDir, 'map.html')}`);
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' }, files: { type: 'string' },
      start: { type: 'string' }, 'reset-path': { type: 'string' }, scenarios: { type: 'string' },
      sequences: { type: 'string' }, steps: { type: 'string' }, minutes: { type: 'string' }, seed: { type: 'string' },
      'env-file': { type: 'string', multiple: true }, lang: { type: 'string' }, 'out-dir': { type: 'string' },
      'candidate-url': { type: 'string' }, intent: { type: 'string' },
      'baseline-env': { type: 'string' }, record: { type: 'string' }, expect: { type: 'string' }, force: { type: 'boolean' }, 'calibrate-env': { type: 'boolean' }, 'no-open': { type: 'boolean' }, 'allow-shared-db': { type: 'boolean' },
      'candidate-env': { type: 'string' }, 'ready-minutes': { type: 'string' }, 'baseline-url': { type: 'string' }, check: { type: 'string' }, yes: { type: 'boolean' },
      by: { type: 'string' }, basis: { type: 'string' }, action: { type: 'string' }, note: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, file, ...rest] = positionals;
  if (values.help || !cmd) { console.log(USAGE); return 0; }
  if (cmd === 'demo') return runDemo(values);
  if (cmd === 'init') return runInit(file ?? '.', values);
  if (cmd === 'doctor') return runDoctor(file ?? '.');
  if (!file && cmd !== 'explore') { console.error(USAGE); return 2; }

  if (cmd === 'impact') {
    const result = analyzeImpact({ repo: file, base: values.base ?? 'HEAD~1', head: values.head ?? 'HEAD', files: values.files?.split(',').map((f) => f.trim()).filter(Boolean) });
    if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(result, null, 2)}
`);
    printImpact(result);
    return 0;
  }

  if (cmd === 'explore') {
    const repo = file ?? '.';
    // Settings from forkfall.config.json; command-line flags win.
    return runExplore(repo, { ...loadConfig(repo), ...values });
  }
  if (cmd === 'judge') {
    const impact = JSON.parse(fs.readFileSync(path.join(file, 'impact.json'), 'utf8'));
    const exploration = JSON.parse(fs.readFileSync(path.join(file, 'exploration.json'), 'utf8'));
    await judgeRun({ impact, exploration, v: values, outDir: file });
    if (values.expect) {
      await planRun({ exploration, v: values });
      printPlan(exploration);
      fs.writeFileSync(path.join(file, 'exploration.json'), `${JSON.stringify(exploration, null, 2)}
`);
      fs.writeFileSync(path.join(file, 'map.html'), renderMap({ impact, exploration, lang: values.lang ?? 'en' }));
    }
    return 0;
  }

  const ctx = loadAnalysis(file);
  ctx.relFile = path.relative(process.cwd(), ctx.file).split(path.sep).join('/');

  switch (cmd) {
    case 'validate':
      console.log(`valid: ${ctx.relFile} (schemaVersion ${ctx.data.schemaVersion}, ${ctx.data.nodes.length} nodes, ${ctx.data.checks.length} checks)`);
      return 0;

    case 'verify': {
      const checks = ctx.data.checks.filter((c) => !values.check || c.id === values.check);
      if (!checks.length) { console.error(`no check "${values.check}"`); return 2; }
      if (!values.yes) {
        console.log('These commands come from the analysis file. Review them, then re-run with --yes:');
        for (const c of checks) console.log(`  [${c.id}] (in ${c.cwd}) ${c.command}`);
        return 2;
      }
      let failed = 0;
      for (const c of checks) {
        const { record, file: out } = captureCheck(ctx, c);
        if (record.result !== 'pass') failed++;
        console.log(`${record.result.toUpperCase()} ${c.id} (exit ${record.exitCode}) -> ${path.relative(process.cwd(), out)}`);
      }
      return failed ? 1 : 0;
    }

    case 'report': {
      const out = values.out ?? path.join(ctx.dir, 'report.html');
      fs.writeFileSync(out, renderReport(ctx, deriveState(ctx)));
      console.log(`report: ${out}`);
      return 0;
    }

    case 'decide':
    case 'revoke': {
      const [decisionId, option] = cmd === 'revoke' ? [rest[0], null] : rest;
      if (!decisionId || (cmd === 'decide' && !option) || !values.by) { console.error(USAGE); return 2; }
      const { record } = recordDecision(ctx, {
        decisionId, option, action: cmd === 'revoke' ? 'revoke' : (values.action ?? 'approve'), by: values.by, note: values.note, basis: values.basis,
      });
      console.log(`recorded ${record.action} on ${decisionId} by ${record.by} (basis ${record.reviewBasisDigest.slice(0, 12)})`);
      return 0;
    }

    case 'status': {
      const s = deriveState(ctx);
      console.log(`code digest ${s.subject.digest.slice(0, 12)} · review basis ${s.reviewBasisDigest.slice(0, 12)}`);
      for (const [id, b] of Object.entries(s.behaviors)) {
        console.log(`behavior   ${id}: ${b.status}${b.contradictedAssumptions.length ? ` (contradicted: ${b.contradictedAssumptions.join(', ')})` : ''}`);
      }
      for (const [id, x] of Object.entries(s.assumptions)) console.log(`assumption ${id}: ${x.status}`);
      for (const [id, c] of Object.entries(s.checks)) console.log(`check      ${id}: ${c.status}`);
      let open = 0;
      for (const [id, d] of Object.entries(s.decisions)) {
        if (d.status !== 'current') open++;
        console.log(`decision   ${id}: ${d.status} [basis ${d.basis.slice(0, 12)}]${d.latest ? ` (last: ${d.latest.action} ${d.latest.option ?? ''} by ${d.latest.by})` : ''}`);
      }
      return open ? 3 : 0;
    }

    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof AnalysisError) {
    console.error(`invalid analysis:\n  ${e.errors.join('\n  ')}`);
    process.exitCode = 1;
  } else if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ENOENT') {
    console.error(e.message);
    process.exitCode = 2;
  } else {
    console.error(process.env.FORKFALL_DEBUG ? e.stack : e.message);
    if (process.env.FORKFALL_DEBUG && e.cause) console.error('cause:', e.cause);
    process.exitCode = 1;
  }
}

function printImpact(r) {
  console.log(`${r.message}  (${r.baseCommit.slice(0, 7)}..${r.headCommit?.slice(0, 7) ?? 'worktree'})`);
  console.log(`graph: ${r.graph.files} files, ${r.graph.edges} imports${r.graph.aliases.length ? `, aliases ${r.graph.aliases.join(' ')}` : ''}`);
  console.log(`
changed (${r.changed.length}):`);
  for (const c of r.changed) console.log(`  ${c.status} ${c.file}${c.symbols.length ? `  [${c.symbols.join(', ')}]` : ''}`);
  console.log(`
affected files: ${r.affectedFiles.length}`);
  console.log(`
reachable entry points (${r.entries.length}):`);
  for (const e of r.entries) console.log(`  ${e.kind.padEnd(4)} ${e.route.padEnd(40)} via ${e.chain.join(' > ')}`);
}
