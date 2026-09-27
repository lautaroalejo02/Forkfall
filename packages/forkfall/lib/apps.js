// Starts two isolated copies of an app (baseline and candidate) from git worktrees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export async function waitForHttp(url, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`app did not respond at ${url} within ${timeoutMs / 1000}s`);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

// Checks out `ref` into a temporary worktree, links node_modules from the main checkout,
// copies the listed env files, and runs `start` with PORT set.
// `envFile` (outside the repo) is copied to the worktree as .env.local, so each copy can use its own database.
async function startOne({ repo, ref, label, start, port, envFiles, envFile, readyTimeoutMs, log }) {
  const dir = path.join(os.tmpdir(), `forkfall-${label}-${crypto.randomBytes(3).toString('hex')}`);
  git(repo, ['worktree', 'add', '--detach', dir, ref]);
  const nm = path.join(repo, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'junction');
  for (const f of envFiles) {
    if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(dir, f));
  }
  if (envFile) fs.copyFileSync(envFile, path.join(dir, '.env.local'));
  const logFile = path.join(os.tmpdir(), `forkfall-${label}.log`);
  const out = fs.openSync(logFile, 'w');
  // "{port}" in the start command is replaced per copy; PORT is also set in the environment.
  const child = spawn(start.replaceAll('{port}', String(port)), {
    cwd: dir, shell: true, detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', out, out],
  });
  const url = `http://127.0.0.1:${port}`;
  log?.(`started ${label} (${ref}) at ${url}, log ${logFile}`);
  try {
    await waitForHttp(url, readyTimeoutMs);
  } catch (e) {
    killTree(child);
    throw new Error(`${e.message}. See ${logFile}`);
  }
  return {
    url, dir, logFile,
    stop() {
      killTree(child);
      // node_modules is a link to the real checkout's packages. Remove only the link, and never
      // delete the worktree while it still exists: a recursive delete could follow it.
      const nmLink = path.join(dir, 'node_modules');
      if (fs.existsSync(nmLink)) {
        if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', nmLink]); // junction: removes the link only
        else if (fs.lstatSync(nmLink).isSymbolicLink()) fs.unlinkSync(nmLink);
      }
      if (fs.existsSync(nmLink)) {
        log?.(`left ${dir} in place: could not unlink its node_modules link safely`);
        return;
      }
      for (let i = 0; i < 5; i++) {
        const r = spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo });
        if (r.status === 0 || !fs.existsSync(dir)) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); // processes may still hold files
      }
      spawnSync('git', ['worktree', 'prune'], { cwd: repo });
    },
  };
}

export async function startApps({ repo, base, head, start, port = 4610, envFiles = [], baselineEnv, candidateEnv, readyTimeoutMs = 120_000, log }) {
  const apps = {};
  try {
    // Started in parallel: builds can take minutes.
    const [b, c] = await Promise.allSettled([
      startOne({ repo, ref: base, label: 'baseline', start, port, envFiles, envFile: baselineEnv, readyTimeoutMs, log }),
      startOne({ repo, ref: head, label: 'candidate', start, port: port + 1, envFiles, envFile: candidateEnv, readyTimeoutMs, log }),
    ]);
    if (b.status === 'fulfilled') apps.baseline = b.value;
    if (c.status === 'fulfilled') apps.candidate = c.value;
    if (b.status === 'rejected') throw b.reason;
    if (c.status === 'rejected') throw c.reason;
  } catch (e) {
    for (const a of Object.values(apps)) a.stop();
    throw e;
  }
  return { ...apps, stop: () => { for (const a of [apps.baseline, apps.candidate]) a?.stop(); } };
}
