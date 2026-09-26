#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadAnalysis, AnalysisError } from '../lib/analysis.js';
import { captureCheck, deriveState, recordDecision, ACTIONS } from '../lib/state.js';
import { renderReport } from '../lib/report.js';

const USAGE = `forkfall — decide on behavior, not diffs

Usage:
  forkfall validate <analysis.json>
  forkfall status   <analysis.json>
  forkfall verify   <analysis.json> [--check <id>] [--yes]
  forkfall report   <analysis.json> [--out report.html]
  forkfall decide   <analysis.json> <decisionId> <optionId> --by <name> [--action approve] [--note text]
  forkfall revoke   <analysis.json> <decisionId> --by <name> [--note text]

Exit codes: 0 ok · 1 invalid input or failed check · 2 usage error · 3 decisions pending or stale (status)
Actions: ${ACTIONS.join(', ')}`;

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' }, check: { type: 'string' }, yes: { type: 'boolean' },
      by: { type: 'string' }, action: { type: 'string' }, note: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, file, ...rest] = positionals;
  if (values.help || !cmd) { console.log(USAGE); return 0; }
  if (!file) { console.error(USAGE); return 2; }

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
        decisionId, option, action: cmd === 'revoke' ? 'revoke' : (values.action ?? 'approve'), by: values.by, note: values.note,
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
        console.log(`decision   ${id}: ${d.status}${d.latest ? ` (last: ${d.latest.action} ${d.latest.option ?? ''} by ${d.latest.by})` : ''}`);
      }
      return open ? 3 : 0;
    }

    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof AnalysisError) {
    console.error(`invalid analysis:\n  ${e.errors.join('\n  ')}`);
    process.exitCode = 1;
  } else if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ENOENT') {
    console.error(e.message);
    process.exitCode = 2;
  } else {
    console.error(e.message);
    process.exitCode = 1;
  }
}
