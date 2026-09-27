import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'forkfall.js');

test('the CLI loads and prints its usage', () => {
  const r = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const cmd of ['demo', 'init', 'doctor', 'impact', 'explore', 'judge']) assert.match(r.stdout, new RegExp(`forkfall ${cmd}`));
});

test('every module imports cleanly', async () => {
  for (const f of fs.readdirSync(path.join(root, 'lib'))) await import(`../lib/${f}`);
});

test('no stray control characters in sources', () => {
  for (const dir of ['bin', 'lib']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      const s = fs.readFileSync(path.join(root, dir, f), 'utf8');
      const bad = [...s].filter((c) => c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c));
      assert.equal(bad.length, 0, `${dir}/${f} has control characters`);
    }
  }
});
