// `forkfall demo`: a self-contained run on a bundled shop whose change hides a cart bug.
// Builds a throwaway git repo (baseline commit + change commit) in the temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEMO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'shop');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=forkfall-demo', '-c', 'user.email=demo@forkfall.local', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

export function prepareDemo() {
  const dir = path.join(os.tmpdir(), `forkfall-demo-${crypto.randomBytes(3).toString('hex')}`);
  fs.cpSync(path.join(DEMO, 'app'), dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'baseline');
  git(dir, 'apply', '--ignore-whitespace', path.join(DEMO, 'change.patch'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', fs.readFileSync(path.join(DEMO, 'message.txt'), 'utf8').trim());
  return {
    repo: dir,
    options: {
      start: 'npm start',
      'reset-path': '/__reset',
      scenarios: path.join(DEMO, 'scenarios.json'),
      sequences: '4',
      steps: '8',
      minutes: '4',
      record: '2',
      'out-dir': path.join(dir, '.forkfall', 'demo-run'),
    },
  };
}

export function openInBrowser(file) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  spawnSync(cmd[0], cmd[1], { stdio: 'ignore' });
}
