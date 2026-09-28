// Vercel mode: compare two preview deployments instead of building the app locally.
// Everything goes through the user's own logged-in Vercel CLI (`vercel api`, `vercel deploy`).
// Secret values are never printed: safety checks only look at which environments a variable targets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DB_KEYS = /^(DATABASE_URL|DB_URL|POSTGRES_URL\w*|POSTGRES_PRISMA_URL|MYSQL_URL|MONGO(DB)?_URI|MONGO_URL|REDIS_URL|KV_URL|SUPABASE_URL|PG(HOST|DATABASE))$/;
const PAID_KEYS = /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_(SECRET|API)_KEY|STRIPE_SECRET|SENDGRID_API_KEY|RESEND_API_KEY|POSTMARK\w*|TWILIO_\w+|MAILGUN\w*|AWS_SECRET_ACCESS_KEY)$/;

function vercel(repo, args, { json = true } = {}) {
  const r = spawnSync('vercel', args, {
    cwd: repo, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1', FORCE_COLOR: '0' },
  });
  if (r.error) throw new Error(`cannot run the Vercel CLI: ${r.error.message}. Install it with: npm i -g vercel`);
  if (r.status !== 0) throw new Error(`vercel ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
  if (!json) return r.stdout;
  try { return JSON.parse(r.stdout); } catch { throw new Error(`vercel ${args.join(' ')} did not return JSON`); }
}

const git = (repo, ...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

export function readLink(repo) {
  const file = path.join(repo, '.vercel', 'project.json');
  if (!fs.existsSync(file)) throw new Error('This folder is not linked to a Vercel project. Run: vercel link');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Safety checks that decide whether preview deployments can be clicked through.
export function preflight(repo, { previewsIsolated = false } = {}) {
  const link = readLink(repo);
  const project = vercel(repo, ['api', `/v9/projects/${link.projectId}`]);
  const { envs = [] } = vercel(repo, ['api', `/v10/projects/${link.projectId}/env`]);
  const problems = [];
  const warnings = [];
  const notes = [];

  // Marketplace databases (e.g. Neon from Vercel Storage) record, per connected project, which
  // deployment actions run; a Preview action means each preview gets its own database branch,
  // injected at deploy time (so it never shows in the project's env settings).
  let stores = [];
  try { stores = vercel(repo, ['api', '/v1/storage/stores']).stores ?? []; } catch { /* no storage access */ }
  const connections = stores.flatMap((s) => (s.projectsMetadata ?? [])
    .filter((c) => c.projectId === link.projectId)
    .map((c) => ({ store: s.name, product: s.product?.name ?? s.type, vars: new Set(c.environmentVariables ?? []), actions: c.deployments?.actions ?? [] })));
  const branchedVars = new Set(connections.filter((c) => c.actions.some((a) => JSON.stringify(a).toLowerCase().includes('preview'))).flatMap((c) => [...c.vars]));
  for (const c of connections.filter((c) => c.actions.length)) notes.push(`${c.product} "${c.store}" runs deployment actions: ${JSON.stringify(c.actions).slice(0, 120)}`);

  const dbEntries = envs.filter((e) => DB_KEYS.test(e.key));
  const sharedAll = dbEntries.filter((e) => e.target?.includes('production') && e.target?.includes('preview'));
  const shared = sharedAll.filter((e) => !branchedVars.has(e.key));
  if (sharedAll.length > shared.length) notes.push(`Previews get their own database branch (${connections.find((c) => c.actions.length)?.store}).`);
  const owner = connections.find((c) => shared.some((e) => c.vars.has(e.key)));
  if (shared.length && previewsIsolated) {
    notes.push(`Production and Preview share ${shared[0].key} in settings; you confirmed previews get their own branch (--previews-isolated).`);
  } else if (shared.length) {
    problems.push({
      what: 'Preview deployments use your production database',
      detail: `${shared.map((e) => e.key).slice(0, 3).join(', ')}${shared.length > 3 ? ` and ${shared.length - 3} more` : ''} ${shared.length === 1 ? 'is' : 'are'} set for Production and Preview together. Exploring a preview would click buttons and write real data.`,
      fix: owner
        ? `Turn on preview branching for this connection: Vercel → Storage → ${owner.store} → Connect Project → ${link.projectName} → Advanced Options → Deployments Configuration → enable Preview. Do not disconnect the project (that removes the variables from Production).`
        : 'Give each preview its own database branch. Neon from Vercel Storage: Storage → your database → connect/manage the project → Advanced Options → Deployments Configuration → turn on Preview and "Resource must be active before deployment". Branch variables are then injected per deployment and do not show in project settings, so this check cannot see them: after enabling it, run again with --previews-isolated.',
    });
  }
  const previewDb = dbEntries.filter((e) => e.target?.includes('preview') && !e.target?.includes('production'));
  if (!shared.length && !previewDb.length && dbEntries.length) {
    warnings.push('No database variable targets Preview. If the app needs a database, previews may fail to load.');
  }
  if (previewDb.some((e) => e.configurationId)) notes.push('Preview database comes from an integration (usually one branch per deployment).');

  const paid = envs.filter((e) => PAID_KEYS.test(e.key) && e.target?.includes('preview')).map((e) => e.key);
  if (paid.length) warnings.push(`${[...new Set(paid)].join(', ')} ${paid.length === 1 ? 'is' : 'are'} available to previews: exploration may call these services for real.`);

  // Protected previews need the "Protection Bypass for Automation" secret. It is read from the
  // project with your own credentials and only ever sent as a header to your own deployments.
  const protectedPreviews = !!(project.ssoProtection || project.passwordProtection);
  const bypass = Object.entries(project.protectionBypass ?? {}).find(([, v]) => v?.scope === 'automation-bypass')?.[0] ?? null;
  if (protectedPreviews && !bypass) {
    problems.push({
      what: 'Preview deployments are protected and there is no automation bypass',
      detail: 'Forkfall cannot open protected previews without the Protection Bypass for Automation secret.',
      fix: 'Vercel dashboard → Project → Settings → Deployment Protection → Protection Bypass for Automation → Add.',
    });
  }
  return {
    link, project: { name: project.name, framework: project.framework, repo: project.link?.repo ?? null },
    problems, warnings, notes, protectedPreviews,
    headers: protectedPreviews && bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : null,
  };
}

// Latest ready preview deployment for a git branch or commit.
export function findPreview(repo, link, { branch, sha }) {
  const { deployments = [] } = vercel(repo, ['api', `/v6/deployments?projectId=${link.projectId}&target=preview&limit=50`]);
  const ready = deployments.filter((d) => (d.state ?? d.readyState) === 'READY');
  const hit = ready.find((d) => (sha && d.meta?.githubCommitSha === sha) || (!sha && branch && d.meta?.githubCommitRef === branch));
  return hit ? { url: `https://${hit.url}`, sha: hit.meta?.githubCommitSha ?? null, branch: hit.meta?.githubCommitRef ?? null, created: hit.createdAt } : null;
}

// Deploys a commit as a Preview (never production) from a temporary worktree.
export function deployPreview(repo, link, ref, log = () => {}) {
  const dir = path.join(os.tmpdir(), `forkfall-vercel-${crypto.randomBytes(3).toString('hex')}`);
  if (git(repo, 'worktree', 'add', '--detach', dir, ref) === null) throw new Error(`cannot check out ${ref}`);
  try {
    fs.mkdirSync(path.join(dir, '.vercel'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.vercel', 'project.json'), JSON.stringify({ projectId: link.projectId, orgId: link.orgId, projectName: link.projectName }));
    log(`deploying ${ref.slice(0, 7)} as a preview (this builds on Vercel, usually 1-2 minutes)`);
    const out = vercel(dir, ['deploy', '--yes', '--target', 'preview', '--meta', `forkfall=baseline`, '--meta', `githubCommitSha=${git(repo, 'rev-parse', ref)}`], { json: false });
    const url = out.trim().split(/\s+/).reverse().find((s) => /^https:\/\/\S+\.vercel\.app$/.test(s));
    if (!url) throw new Error('vercel deploy did not print a deployment URL');
    return { url, sha: git(repo, 'rev-parse', ref), deployed: true };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo });
  }
}

// Picks what to compare: the current branch's preview against a preview of its base commit.
// With `head` (a commit), both versions can be deployed as previews without opening a PR.
export function resolveDeployments(repo, link, { base = 'main', head, candidateUrl, baselineUrl, deploy = true, log = () => {} }) {
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  const headSha = head ? git(repo, 'rev-parse', head) : null;
  let candidate = candidateUrl ? { url: candidateUrl, sha: headSha ?? git(repo, 'rev-parse', 'HEAD') } : findPreview(repo, link, headSha ? { sha: headSha } : { branch });
  if (!candidate && headSha && deploy) candidate = deployPreview(repo, link, headSha, log);
  if (!candidate) throw new Error(`No ready preview deployment for branch "${branch}". Push the branch (or open a PR) so Vercel builds one, pass --head <commit> to deploy one, or pass --candidate-url.`);
  const baseSha = git(repo, 'merge-base', base, candidate.sha ?? 'HEAD') ?? git(repo, 'rev-parse', base);
  let baseline = baselineUrl ? { url: baselineUrl, sha: baseSha } : findPreview(repo, link, { sha: baseSha });
  if (!baseline) {
    if (!deploy) throw new Error(`No preview deployment of the base commit ${baseSha?.slice(0, 7)}. Pass --baseline-url, or allow Forkfall to deploy one.`);
    baseline = deployPreview(repo, link, baseSha, log);
  }
  return { branch, candidate, baseline, baseSha };
}
