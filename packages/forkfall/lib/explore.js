// Differential exploration: drive the candidate app with sequences of clicks and inputs,
// replay each sequence on the baseline, and report what only the candidate does.
// Every finding carries the exact steps that reproduce it.
import crypto from 'node:crypto';

export const DEFAULTS = { sequences: 40, maxSteps: 8, timeMs: 5 * 60_000, settleMs: 2500, seed: 1, waitForMs: 15_000 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

// Route patterns: "/listings/[id]" matches "/listings/42".
export const routePattern = (pathname) => pathname
  .split('/')
  .map((s) => (/^\d+$|^[0-9a-f-]{16,}$|^[A-Za-z0-9_-]{20,}$/i.test(s) ? ':id' : s))
  .join('/') || '/';
// "/cart.html", "/cart/index.html" and "/cart" are the same screen for matching purposes.
const bare = (r) => r.replace(/\.html?$/, '').replace(/\/index$/, '') || '/';
export const matchesRoute = (route, pathname) => {
  const a = bare(route.replace(/\[[^\]]+\]|:\w+/g, ':id')).split('/');
  const b = bare(routePattern(pathname)).split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || s === ':id' || b[i] === ':id');
};

// Runs in the page: lists interactive elements and keeps handles in window.__ffEls.
function enumerate() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText;
    }
    const wrap = el.closest('label');
    if (wrap && !['A', 'BUTTON'].includes(el.tagName)) return wrap.innerText;
    if (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type)) return el.value;
    return el.innerText || el.placeholder || el.name || el.title || '';
  };
  const els = [];
  const out = [];
  const counts = {};
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role=button]')) {
    if (!visible(el) || el.disabled || el.readOnly) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'file', 'image'].includes(type)) continue;
    let kind = 'click';
    if (tag === 'select') kind = 'select';
    else if (tag === 'textarea' || (tag === 'input' && !['submit', 'button', 'checkbox', 'radio', 'reset'].includes(type))) kind = 'fill';
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href) || el.target === '_blank') continue;
      if (el.origin !== location.origin) continue;
    }
    const name = nameOf(el).replace(/\s+/g, ' ').trim().slice(0, 60);
    const base = `${kind}|${tag}|${type}|${name}`;
    counts[base] = (counts[base] ?? -1) + 1;
    out.push({
      key: `${base}|${counts[base]}`, kind, tag, type, name, index: els.length,
      options: kind === 'select' ? [...el.options].map((o) => o.value) : undefined,
      empty: kind === 'fill' ? el.value === '' : undefined,
      inForm: !!el.closest('form'),
      href: tag === 'a' ? el.pathname : undefined,
      fieldHint: `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${name}`.toLowerCase(),
    });
    els.push(el);
  }
  window.__ffEls = els;
  return out;
}

function validValue(a) {
  const h = a.fieldHint;
  if (a.type === 'email' || /e-?mail/.test(h)) return 'test@example.com';
  if (a.type === 'number' || /qty|quantity|amount|count/.test(h)) return '1';
  if (a.type === 'tel' || /phone/.test(h)) return '5551234567';
  if (a.type === 'date') return '2030-01-15';
  if (a.type === 'password') return 'Password123!';
  if (/zip|postal/.test(h)) return '12345';
  if (/address|street/.test(h)) return '123 Main St';
  if (/city/.test(h)) return 'Springfield';
  if (/name/.test(h)) return 'Test User';
  if (/price|budget|offer|total/.test(h)) return '100';
  return 'Test';
}

function mutations(a, harvested) {
  if (a.type === 'number' || /qty|quantity|amount|count|price|budget|offer/.test(a.fieldHint)) return ['0', '-1', '2', '3', '99', '1.5', '', '1000000'];
  if (a.type === 'email' || /e-?mail/.test(a.fieldHint)) return ['not-an-email', '', 'a@b'];
  return ['', ...harvested, 'A'.repeat(300), "<b>O'Brien</b>", ' '];
}

const maskText = (t) => t
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
  .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
  .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g, '<time>')
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 400);

// One browser context per sequence, so cookies and storage never leak between runs.
export async function openSession(browser, baseUrl, contextOptions = {}) {
  const context = await browser.newContext({ baseURL: baseUrl, ...contextOptions });
  const page = await context.newPage();
  const events = [];
  page.on('pageerror', (e) => events.push({ type: 'pageerror', message: String(e.message).slice(0, 500) }));
  page.on('console', (m) => { if (m.type() === 'error') events.push({ type: 'console', message: m.text().slice(0, 500) }); });
  page.on('response', (r) => {
    const req = r.request();
    if (r.status() >= 400 && ['fetch', 'xhr', 'document'].includes(req.resourceType())) {
      const u = new URL(r.url());
      if (u.origin === new URL(baseUrl).origin) events.push({ type: 'http', message: `${req.method()} ${routePattern(u.pathname)} → ${r.status()}`, status: r.status() });
    }
  });
  page.on('dialog', (d) => { events.push({ type: 'dialog', message: d.message().slice(0, 300) }); d.dismiss().catch(() => {}); });
  return { context, page, events };
}

// Waits until the visible text stops changing (apps that poll never reach "network idle").
export async function settle(page, ms) {
  await page.waitForLoadState('load', { timeout: ms }).catch(() => {});
  const until = Date.now() + ms * 2;
  let last = null;
  let stableSince = Date.now();
  while (Date.now() < until) {
    const now = await page.evaluate(() => document.body?.innerText.length + ':' + document.body?.innerText.slice(0, 2000)).catch(() => null);
    if (now !== last) { last = now; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 600) return;
    await page.waitForTimeout(150);
  }
}

// Runs in the page: a rule-based check that needs no AI. For each row that has a quantity field
// and a unit price ("$24.00 each"), some amount in that row should equal quantity × unit price.
function arithmeticCheck() {
  const money = (s) => [...s.matchAll(/[$€£]\s?(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2}))/g)].map((m) => Number(m[1].replace(/[,.](?=\d{3}\b)/g, '').replace(',', '.')));
  const problems = [];
  for (const input of document.querySelectorAll('input')) {
    const hint = `${input.type} ${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''}`.toLowerCase();
    if (!(input.type === 'number' || /qty|quantity|cantidad/.test(hint)) || input.offsetParent === null || input.dataset.ffTyped) continue;
    const qty = Number(input.value);
    if (!Number.isFinite(qty) || qty < 2 || qty > 1000) continue;
    let row = input.parentElement;
    for (let d = 0; row && d < 6 && money(row.innerText).length < 2; d++) row = row.parentElement;
    if (!row || money(row.innerText).length < 2) continue;
    const unitMatch = row.innerText.match(/[$€£]\s?(\d+(?:[.,]\d{2}))\s*(?:each|\/\s*ea|c\/u|por unidad|x\b)/i);
    if (!unitMatch) continue;
    const unit = Number(unitMatch[1].replace(',', '.'));
    const expected = Math.round(unit * qty * 100) / 100;
    const amounts = money(row.innerText);
    if (!amounts.some((a) => Math.abs(a - expected) < 0.01)) {
      const label = input.getAttribute('aria-label') || input.name || 'quantity';
      problems.push(`${label} is ${qty} at ${unitMatch[0].trim()}, but no amount on that row equals ${expected.toFixed(2)} (shows ${amounts.map((a) => a.toFixed(2)).join(', ')})`);
    }
  }
  return problems;
}

export async function observe(page, events, since) {
  const url = new URL(page.url());
  let actions = [];
  let text = [];
  try {
    actions = await page.evaluate(enumerate);
    for (const p of await page.evaluate(arithmeticCheck).catch(() => [])) {
      if (!events.slice(since).some((e) => e.type === 'arithmetic' && e.message === p)) events.push({ type: 'arithmetic', message: p });
    }
    // innerText misses what form fields contain, and many display bugs live there.
    text = maskText(await page.evaluate(() => {
      const fields = [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.type !== 'hidden' && el.type !== 'password' && el.offsetParent !== null)
        .map((el) => {
          const label = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.name || el.placeholder || el.type;
          const value = el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : el.value;
          // The browser's own validation bubble is not page text; report it with the field.
          const invalid = el.validity && !el.validity.valid && el.validationMessage ? ` (invalid: ${el.validationMessage})` : '';
          return `[field] ${String(label).replace(/\s+/g, ' ').trim()}: ${value}${invalid}`;
        });
      return `${document.body?.innerText ?? ''}\n${fields.join('\n')}`;
    }));
  } catch { /* page navigating or crashed */ }
  const fingerprint = `${routePattern(url.pathname)}#${hash(actions.map((a) => a.key.replace(/\|\d+$/, '')).sort().join('\n'))}`;
  return { path: url.pathname + url.search, route: routePattern(url.pathname), fingerprint, actions, text, events: events.slice(since) };
}

export const describe = (step) => {
  switch (step.kind) {
    case 'goto': return `Open ${step.path}`;
    case 'click': return `Click ${step.tag === 'a' ? 'link' : 'button'} "${step.name || step.key}"`;
    case 'fill': return `Type ${JSON.stringify(step.value.length > 40 ? `${step.value.slice(0, 40)}…` : step.value)} into "${step.name || step.key}"`;
    case 'fillAll': return 'Fill every empty field with a valid value';
    case 'select': return `Choose "${step.value}" in "${step.name || step.key}"`;
    default: return step.kind;
  }
};

export async function perform(page, step, actions) {
  if (step.kind === 'goto') return page.goto(step.path);
  if (step.kind === 'fillAll') {
    for (const a of actions.filter((x) => x.kind === 'fill' && x.empty)) {
      const h = await page.evaluateHandle((i) => window.__ffEls[i], a.index);
      await h.asElement()?.fill(validValue(a), { timeout: 2000 }).catch(() => {});
    }
    return;
  }
  const target = actions.find((a) => a.key === step.key) ?? actions.find((a) => a.key.replace(/\|\d+$/, '') === step.key.replace(/\|\d+$/, ''));
  if (!target) return 'missing';
  const el = (await page.evaluateHandle((i) => window.__ffEls[i], target.index)).asElement();
  if (!el) return 'missing';
  if (step.kind === 'click') await el.click({ timeout: 3000 });
  else if (step.kind === 'fill') {
    await el.fill(step.value, { timeout: 3000 });
    // Typed but not yet applied: rule-based checks skip it until the page re-renders the field.
    await el.evaluate((e) => { e.dataset.ffTyped = '1'; }).catch(() => {});
  }
  else if (step.kind === 'select') await el.selectOption(step.value, { timeout: 3000 });
  return 'ok';
}

// Converts an agent-written scenario step ({ click: "Apply coupon" }) into a concrete action.
function resolveScenarioStep(s, actions) {
  if (s.goto) return { kind: 'goto', path: s.goto };
  if (s.fillAll) return { kind: 'fillAll' };
  const [kind, label] = s.click !== undefined ? ['click', s.click] : s.fill !== undefined ? ['fill', s.fill] : ['select', s.select];
  const want = String(label).toLowerCase();
  const a = actions.find((x) => x.kind === kind && x.name.toLowerCase() === want)
    ?? actions.find((x) => x.kind === kind && x.name.toLowerCase().includes(want));
  if (!a) return null;
  return { kind, key: a.key, name: a.name, tag: a.tag, ...(kind !== 'click' ? { value: String(s.value ?? '') } : {}) };
}

function chooseAction(obs, stats, focusRoutes, prev, rand, harvested, seen) {
  const options = [];
  // Controls present on most screens (header navigation) are "chrome": useful, but rarely where bugs hide.
  const chrome = (a) => seen.states >= 3 && (seen.keys.get(a.key) ?? 0) / seen.states > 0.6;
  const tried = (key) => stats.get(`${obs.fingerprint}>${key}`) ?? 0;
  const push = (step, w) => options.push({ step, w: w / (1 + tried(step.key ?? step.kind)) });
  const filledRecently = prev && (prev.kind === 'fill' || prev.kind === 'fillAll');
  if (obs.actions.some((a) => a.kind === 'fill' && a.empty)) push({ kind: 'fillAll' }, 4);
  for (const a of obs.actions) {
    const base = { key: a.key, name: a.name, tag: a.tag };
    if (a.kind === 'click') {
      let w = a.tag === 'a' ? 2 : 4;
      if (a.href && focusRoutes.some((r) => matchesRoute(r, a.href))) w *= 3;
      if (a.href && !seen.routes.has(routePattern(a.href))) w *= 3;
      if (a.tag !== 'a' && filledRecently) w *= 3;
      if (a.href && routePattern(a.href) === obs.route) w *= 0.3;
      if (chrome(a)) w *= 0.25;
      push({ kind: 'click', ...base }, w);
    } else if (a.kind === 'fill') {
      const pool = rand() < 0.5 ? [validValue(a)] : mutations(a, harvested);
      push({ kind: 'fill', ...base, value: pool[Math.floor(rand() * pool.length)] }, 1.5);
    } else if (a.kind === 'select' && a.options?.length) {
      push({ kind: 'select', ...base, value: a.options[Math.floor(rand() * a.options.length)] }, 1.5);
    }
  }
  if (!options.length) return null;
  const total = options.reduce((n, o) => n + o.w, 0);
  let r = rand() * total;
  for (const o of options) if ((r -= o.w) <= 0) return o.step;
  return options.at(-1).step;
}

export async function reset(url, cfg) {
  if (!cfg.resetPath) return;
  if (!cfg.resetPath.startsWith('/')) {
    throw new Error(`--reset-path must start with "/" (got "${cfg.resetPath}"). In Git Bash, set MSYS_NO_PATHCONV=1 so "/path" arguments aren't rewritten.`);
  }
  const res = await fetch(new URL(cfg.resetPath, url), { method: 'POST' });
  if (!res.ok) throw new Error(`reset ${cfg.resetPath} → HTTP ${res.status}`);
}

// Runs a sequence. With `plan` it replays; otherwise it generates actions as it goes.
async function runSequence(browser, url, cfg, { start, plan, scenario, rand, stats, focusRoutes, seen = { states: 0, keys: new Map(), routes: new Set() } }) {
  await reset(url, cfg);
  const { context, page, events } = await openSession(browser, url);
  const steps = [];
  try {
    let since = 0;
    const first = { kind: 'goto', path: start };
    await page.goto(start).catch(() => {});
    await settle(page, cfg.settleMs);
    let obs = await observe(page, events, since);
    since = events.length;
    steps.push({ action: first, ...obs, actions: undefined });
    const harvested = [];
    const limit = plan ? plan.length - 1 : scenario ? scenario.steps.length : cfg.maxSteps;
    for (let i = 1; i <= limit; i++) {
      for (const m of obs.text.join(' ').matchAll(/\b[A-Z][A-Z0-9]{3,11}\b/g)) if (!harvested.includes(m[0]) && harvested.length < 20) harvested.push(m[0]);
      let step;
      if (plan) step = plan[i];
      else if (scenario) {
        step = resolveScenarioStep(scenario.steps[i - 1], obs.actions);
        // Apps often reveal the next control only after an async reply; wait before giving up.
        for (const until = Date.now() + cfg.waitForMs; !step && Date.now() < until;) {
          await page.waitForTimeout(1000);
          obs = await observe(page, events, since);
          step = resolveScenarioStep(scenario.steps[i - 1], obs.actions);
        }
        if (!step) { steps.push({ action: { kind: 'note' }, note: `Scenario step not found: ${JSON.stringify(scenario.steps[i - 1])}` }); break; }
      } else {
        seen.states++;
        seen.routes.add(obs.route);
        for (const a of obs.actions) seen.keys.set(a.key, (seen.keys.get(a.key) ?? 0) + 1);
        step = chooseAction(obs, stats, focusRoutes, steps.at(-1)?.action, rand, harvested, seen);
        if (!step) break;
        const k = `${obs.fingerprint}>${step.key ?? step.kind}`;
        stats.set(k, (stats.get(k) ?? 0) + 1);
      }
      let outcome = 'ok';
      try {
        outcome = (await perform(page, step, obs.actions)) ?? 'ok';
        // Replays wait for late controls exactly like scenarios do, or async UIs look like divergence.
        for (const until = Date.now() + cfg.waitForMs; outcome === 'missing' && Date.now() < until;) {
          await page.waitForTimeout(1000);
          obs = await observe(page, events, since);
          outcome = (await perform(page, step, obs.actions)) ?? 'ok';
        }
      } catch (e) {
        outcome = `failed: ${String(e.message).split('\n')[0].slice(0, 200)}`;
      }
      if (outcome === 'missing') { steps.push({ action: step, missing: true }); break; }
      await settle(page, cfg.settleMs);
      obs = await observe(page, events, since);
      since = events.length;
      steps.push({ action: step, outcome, ...obs, actions: undefined });
      if (new URL(page.url()).origin !== new URL(url).origin) break;
    }
  } finally {
    await context.close();
  }
  return steps;
}

const multisetDiff = (a, b) => {
  const counts = new Map();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out = [];
  for (const x of a) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else out.push(x);
  }
  return out;
};

// The stretch where two orderings of the same lines disagree, e.g. before [A, B, C] vs after [B, C, A].
export function orderWindow(before, after) {
  if (before.length !== after.length) return null;
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  if (i === before.length) return null;
  let j = before.length - 1;
  while (j > i && before[j] === after[j]) j--;
  return { before: before.slice(i, Math.min(j + 1, i + 12)), after: after.slice(i, Math.min(j + 1, i + 12)) };
}

// orderNoise: step indexes where two runs of the baseline itself showed a different order.
function compare(cand, base, noise = new Set(), orderNoise = new Set()) {
  const findings = [];
  const n = Math.min(cand.length, base.length);
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i];
    if (c.action.kind === 'note') break; // a scenario step that was never performed: nothing to compare
    const b = i < n ? base[i] : null;
    if (b?.missing || (!b && i > 0)) {
      findings.push({ type: 'baseline-cannot-follow', step: i, route: c.route, detail: `The baseline has no "${c.action.name ?? c.action.kind}" here, so the paths diverge (often an intended UI change).` });
      break;
    }
    if (c.missing) break;
    const baseMsgs = new Set((b?.events ?? []).map((e) => `${e.type}:${e.message}`));
    for (const e of c.events ?? []) {
      const sig = `${e.type}:${e.message}`;
      const inBase = baseMsgs.has(sig);
      const type = e.type === 'http' ? (e.status >= 500 ? 'server-error' : 'http-failure') : e.type === 'dialog' ? 'dialog' : e.type === 'arithmetic' ? 'arithmetic' : 'js-error';
      findings.push({ type, step: i, route: c.route, detail: e.message, preexisting: inBase });
    }
    if (b && c.route !== b.route) {
      findings.push({ type: 'navigation-differs', step: i, route: c.route, detail: `Candidate is on ${c.route}, baseline on ${b.route}` });
    } else if (b) {
      const added = multisetDiff(c.text, b.text).filter((l) => !noise.has(l));
      const removed = multisetDiff(b.text, c.text).filter((l) => !noise.has(l));
      if (added.length || removed.length) {
        findings.push({ type: 'output-differs', step: i, route: c.route, detail: 'Visible text differs from the baseline', added: added.slice(0, 12), removed: removed.slice(0, 12) });
      } else if (!orderNoise.has(i)) {
        // Same lines, different order (e.g. a sort that now sorts wrong) is still a difference.
        const cs = c.text.filter((l) => !noise.has(l));
        const bs = b.text.filter((l) => !noise.has(l));
        const window = orderWindow(bs, cs);
        if (window) findings.push({ type: 'order-differs', step: i, route: c.route, detail: 'Same content, in a different order', added: window.after, removed: window.before });
      }
    }
  }
  return findings;
}

const SEVERITY = { arithmetic: 3, 'js-error': 3, 'server-error': 3, 'http-failure': 2, dialog: 1, 'navigation-differs': 2, 'output-differs': 1, 'order-differs': 1, 'baseline-cannot-follow': 0 };

export async function explore({ candidateUrl, baselineUrl, focusRoutes = [], startPaths = ['/'], scenarios = [], log = () => {}, ...opts }) {
  const cfg = { ...DEFAULTS, ...opts };
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const rand = rng(cfg.seed);
  const stats = new Map();
  const seen = { states: 0, keys: new Map(), routes: new Set() };
  const focusUrls = new Set(); // real URLs (with query) that landed on an affected screen
  const trace = [];
  const noise = new Set();     // text lines seen to change between two runs of the same version
  const noisyNav = new Set();
  const envDiff = new Set();   // lines that differ between the two environments before any action
  const deadline = Date.now() + cfg.timeMs;
  const findings = new Map();
  const visited = new Set();
  const states = new Set();
  let sequences = 0;
  let steps = 0;

  const record = (steps_, fs_, origin) => {
    for (const f of fs_) {
      // Pre-existing and new occurrences of the same message stay separate findings.
      const sig = hash(`${f.preexisting ? 'pre' : 'new'}|${f.type}|${f.route}|${f.type === 'output-differs' ? [...f.added, '/', ...f.removed].join('\n') : f.detail}`);
      const repro = steps_.slice(0, f.step + 1).map((s) => ({ ...s.action, text: describe(s.action) }));
      const existing = findings.get(sig);
      if (!existing) findings.set(sig, { id: `f-${sig}`, ...f, severity: f.preexisting ? 0 : SEVERITY[f.type], occurrences: 1, origin, repro, screen: steps_[f.step]?.text ?? [] });
      else {
        existing.occurrences++;
        if (repro.length < existing.repro.length) existing.repro = repro;
      }
    }
  };

  try {
    // Environment calibration: open each start page on both versions before any action.
    // Lines that already differ there come from data or configuration, not from the change.
    // Off by default: comparing the two versions before any action cannot tell data drift from
    // real changes visible on load, so it can hide exactly what we are looking for.
    if (baselineUrl && cfg.calibrateEnv) {
      const starts = [...new Set(['/', ...startPaths, ...scenarios.map((s) => s.start ?? '/')])].slice(0, 12);
      for (const start of starts) {
        const [c] = await runSequence(browser, candidateUrl, cfg, { start, plan: [{ kind: 'goto', path: start }], rand, stats: new Map(), focusRoutes });
        const [b] = await runSequence(browser, baselineUrl, cfg, { start, plan: [{ kind: 'goto', path: start }], rand, stats: new Map(), focusRoutes });
        for (const line of [...multisetDiff(c.text ?? [], b.text ?? []), ...multisetDiff(b.text ?? [], c.text ?? [])]) { noise.add(line); envDiff.add(line); }
      }
      log(`environment calibration: ${envDiff.size} line(s) already differ before any action`);
    }
    const plans = [
      ...scenarios.map((s) => ({ scenario: s, start: s.start ?? '/' })),
      ...Array.from({ length: cfg.sequences }, () => null),
    ];
    for (const p of plans) {
      if (Date.now() > deadline) break;
      const pool = focusUrls.size ? [...focusUrls] : startPaths;
      const start = p?.start ?? (rand() < 0.6 && pool.length ? pool[Math.floor(rand() * pool.length)] : '/');
      const cand = await runSequence(browser, candidateUrl, cfg, { start, scenario: p?.scenario, rand, stats, focusRoutes, seen });
      for (const s of cand) {
        if (s.route && focusRoutes.some((r) => matchesRoute(r, s.path)) && !(s.events ?? []).some((e) => e.type === 'http')) focusUrls.add(s.path);
      }
      sequences++;
      steps += cand.length;
      for (const s of cand) if (s.route) { visited.add(s.route); states.add(s.fingerprint); }
      let fs_;
      if (baselineUrl) {
        const plan = cand.filter((s) => s.action.kind !== 'note' && !s.missing).map((s) => s.action);
        const base = await runSequence(browser, baselineUrl, cfg, { start, plan, rand, stats: new Map(), focusRoutes });
        fs_ = compare(cand, base);
        if (fs_.some((f) => ['output-differs', 'navigation-differs', 'order-differs'].includes(f.type))) {
          // Run the baseline again: whatever differs between two runs of the same version is noise.
          const again = await runSequence(browser, baselineUrl, cfg, { start, plan, rand, stats: new Map(), focusRoutes });
          const orderNoise = new Set();
          for (let i = 0; i < Math.min(base.length, again.length); i++) {
            for (const line of [...multisetDiff(base[i].text ?? [], again[i].text ?? []), ...multisetDiff(again[i].text ?? [], base[i].text ?? [])]) noise.add(line);
            if (base[i].route !== again[i].route) noisyNav.add(i === 0 ? start : JSON.stringify(plan.slice(0, i + 1)));
            if (orderWindow(base[i].text ?? [], again[i].text ?? [])) orderNoise.add(i);
          }
          fs_ = compare(cand, base, noise, orderNoise).filter((f) => !(f.type === 'navigation-differs' && noisyNav.has(f.step === 0 ? start : JSON.stringify(plan.slice(0, f.step + 1)))));
        }
      } else {
        fs_ = compare(cand, cand.map((s) => ({ ...s, events: [] })));
        fs_ = fs_.filter((f) => f.type !== 'output-differs');
      }
      record(cand, fs_, p?.scenario ? `scenario: ${p.scenario.name}` : 'generated');
      trace.push({ origin: p?.scenario?.name ?? 'generated', steps: cand.map((s) => ({ text: s.note ?? describe(s.action), route: s.route, outcome: s.outcome, missing: s.missing, events: s.events?.map((e) => e.message) })) });
      log(`sequence ${sequences}: ${cand.length} steps, ${fs_.filter((f) => !f.preexisting && SEVERITY[f.type] >= 2).length} new problem(s)`);
    }
  } finally {
    await browser.close();
  }

  // A line that differs on 3+ different screens belongs to something shared by all of them
  // (a live feed, a header counter), not to one screen's behavior. Set those lines aside.
  const routesByLine = new Map();
  for (const f of findings.values()) {
    for (const l of [...(f.added ?? []), ...(f.removed ?? [])]) (routesByLine.get(l) ?? routesByLine.set(l, new Set()).get(l)).add(f.route);
  }
  const shared = new Set([...routesByLine].filter(([, r]) => r.size >= 3).map(([l]) => l));
  for (const [sig, f] of findings) {
    if (f.type !== 'output-differs' || !shared.size) continue;
    f.added = f.added.filter((l) => !shared.has(l));
    f.removed = f.removed.filter((l) => !shared.has(l));
    if (!f.added.length && !f.removed.length) findings.delete(sig);
  }
  const list = [...findings.values()].sort((a, b) => b.severity - a.severity || (b.type === 'arithmetic') - (a.type === 'arithmetic') || a.repro.length - b.repro.length);
  return {
    kind: 'forkfall.exploration',
    candidateUrl, baselineUrl,
    budget: { sequences: cfg.sequences, maxSteps: cfg.maxSteps, timeMs: cfg.timeMs, seed: cfg.seed },
    coverage: {
      sequences, steps, distinctStates: states.size,
      routesVisited: [...visited].sort(),
      focusRoutes: focusRoutes.map((r) => ({ route: r, visited: [...visited].some((v) => matchesRoute(r, v)) })),
      focusUrls: [...focusUrls].slice(0, 50),
    },
    findings: list,
    noise: { lines: noise.size, sample: [...noise].slice(0, 20), environment: [...envDiff].slice(0, 20), sharedAcrossScreens: [...shared].slice(0, 20) },
    trace,
    scenarioGaps: trace.filter((t) => t.origin !== 'generated').map((t) => ({ scenario: t.origin, completedSteps: t.steps.length - 1, stoppedAt: t.steps.find((s) => s.text?.startsWith('Scenario step not found'))?.text ?? null })).filter((g) => g.stoppedAt),
    limitations: [
      `Explored ${sequences} sequence(s) of up to ${cfg.maxSteps} steps; paths beyond that were not tried.`,
      'A difference from the baseline can be intended. Errors that also happen on the baseline are marked as pre-existing.',
      ...(shared.size ? [`${shared.size} line(s) differed on 3 or more screens (shared panels such as live feeds) and were set aside, e.g. "${[...shared][0].slice(0, 80)}".`] : []),
      ...(envDiff.size ? [`${envDiff.size} line(s) already differed between the two environments before any action (data or configuration) and were ignored, e.g. "${[...envDiff][0].slice(0, 80)}".`] : []),
    ],
  };
}
