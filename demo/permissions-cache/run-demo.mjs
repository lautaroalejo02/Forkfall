// Runs the full Fixture A story from a clean checkout, without editing JSON by hand:
// baseline → decision → fix → approval → TTL change → stale approval.
// It edits examples/permissions-cache/src/config.js and restores it at the end.
// The "human" decisions here are made by this script and labelled as such.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../packages/forkfall/bin/forkfall.js');
const analysis = path.join(here, 'analysis.json');
const config = path.resolve(here, '../../examples/permissions-cache/src/config.js');
const original = fs.readFileSync(config, 'utf8');
const BY = 'demo script (standing in for the product owner)';

const run = (...args) => {
  console.log(`\n$ forkfall ${args.join(' ')}`);
  try {
    process.stdout.write(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(e.stdout ?? '');
    process.stderr.write(e.stderr ?? '');
  }
};
const setConfig = (ttlMs, invalidateOnRevoke) => {
  fs.writeFileSync(config, `export const cacheConfig = { ttlMs: ${ttlMs}, invalidateOnRevoke: ${invalidateOnRevoke} };\n`);
  console.log(`\n# config.js -> ttlMs: ${ttlMs}, invalidateOnRevoke: ${invalidateOnRevoke}`);
};
const step = (s) => console.log(`\n=== ${s} ===`);

fs.rmSync(path.join(here, '.forkfall'), { recursive: true, force: true });
try {
  step('1. Naive cache: capture evidence');
  setConfig(300000, false);
  run('verify', analysis, '--yes');
  run('report', analysis, '--out', path.join(here, 'report-1-baseline.html'));

  step('2. The person answers the revocation question: no residual access');
  run('decide', analysis, 'd-revocation-policy', 'immediate', '--by', BY, '--note', 'Access must end the moment we revoke it.');

  step('3. Agent implements invalidation; capture evidence again');
  setConfig(300000, true);
  run('verify', analysis, '--yes');

  step('4. Approve the change as shown');
  run('decide', analysis, 'd-ship', 'approve-scope', '--by', BY);
  run('status', analysis);
  run('report', analysis, '--out', path.join(here, 'report-2-approved.html'));

  step('5. Someone later changes the TTL to 10 minutes');
  setConfig(600000, true);
  run('status', analysis);
  run('report', analysis, '--out', path.join(here, 'report-3-stale.html'));
} finally {
  fs.writeFileSync(config, original);
  console.log('\n# config.js restored');
}
