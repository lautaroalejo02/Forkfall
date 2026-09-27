// Side-by-side replay: re-runs a finding's steps on both versions while recording video,
// highlights what differs at the final step, and writes a page that plays both in sync.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, openSession, settle, observe, perform, describe, reset } from './explore.js';

const VIEWPORT = { width: 1100, height: 760 };
const HOLD_MS = 3000;

// Runs in the page: outlines elements that show one of `lines` (text lines or "[field] Label: value").
function highlight({ lines, color }) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const hits = new Set();
  const all = [...document.body.querySelectorAll('*')].filter((e) => e.getClientRects().length > 0);
  for (const line of lines) {
    const field = line.match(/^\[field\] (.*): (.*)$/);
    if (field) {
      for (const el of document.querySelectorAll('input, select, textarea')) {
        const label = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.name || el.placeholder || '';
        if (norm(label) === field[1]) hits.add(el);
      }
      continue;
    }
    const matching = all.filter((e) => norm(e.innerText).includes(line));
    for (const e of matching.filter((e) => !matching.some((o) => o !== e && e.contains(o))).slice(0, 3)) hits.add(e);
  }
  for (const h of hits) {
    h.style.outline = `4px solid ${color}`;
    h.style.outlineOffset = '3px';
    h.style.boxShadow = `0 0 0 10px ${color}33`;
    h.style.transition = 'none';
  }
  [...hits][0]?.scrollIntoView({ block: 'center' });
  return hits.size;
}

// Runs in the page: a banner for problems that have no on-screen text to outline (errors, failed requests).
function banner({ text, color }) {
  const b = document.createElement('div');
  b.textContent = text;
  b.style.cssText = `position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:14px 18px;border-radius:10px;background:${color};color:#fff;font:700 18px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)`;
  document.body.appendChild(b);
}

async function recordOne(browser, url, cfg, repro, lines, color, file, note) {
  await reset(url, cfg);
  const dir = path.dirname(file);
  const { context, page, events } = await openSession(browser, url, { viewport: VIEWPORT, recordVideo: { dir, size: VIEWPORT } });
  const t0 = Date.now();
  const timeline = [];
  let highlighted = 0;
  try {
    for (let i = 0; i < repro.length; i++) {
      const step = repro[i];
      timeline.push({ t: (Date.now() - t0) / 1000, text: step.text ?? describe(step) });
      if (i === 0) await page.goto(step.path).catch(() => {});
      else {
        let obs = await observe(page, events, 0);
        let outcome = await perform(page, step, obs.actions).catch(() => 'failed');
        for (const until = Date.now() + cfg.waitForMs; outcome === 'missing' && Date.now() < until;) {
          await page.waitForTimeout(1000);
          obs = await observe(page, events, 0);
          outcome = await perform(page, step, obs.actions).catch(() => 'failed');
        }
        if (outcome === 'missing') { timeline.at(-1).missing = true; break; }
      }
      await settle(page, cfg.settleMs);
    }
    highlighted = lines.length ? await page.evaluate(highlight, { lines, color }).catch(() => 0) : 0;
    if (note) await page.evaluate(banner, { text: note, color }).catch(() => {});
    timeline.push({ t: (Date.now() - t0) / 1000, text: null, end: true });
    await page.waitForTimeout(HOLD_MS);
  } finally {
    const video = page.video();
    await context.close();
    await video.saveAs(file);
    await video.delete();
  }
  return { timeline, highlighted, duration: (Date.now() - t0) / 1000 };
}

// Records up to `max` findings; returns them annotated with `replay` file names.
export async function recordFindings({ candidateUrl, baselineUrl, findings, outDir, max = 5, log = () => {}, ...opts }) {
  const cfg = { ...DEFAULTS, ...opts };
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const done = [];
  try {
    for (const f of findings.slice(0, max)) {
      const base = `replay-${f.id}`;
      log(`recording ${f.id} (${f.repro.length} steps) on both versions`);
      const isError = ['js-error', 'server-error', 'http-failure', 'dialog'].includes(f.type);
      const cand = await recordOne(browser, candidateUrl, cfg, f.repro, f.added ?? [], '#e03131', path.join(outDir, `${base}-after.webm`), isError ? `⚠ ${f.detail}` : null);
      const prev = baselineUrl
        ? await recordOne(browser, baselineUrl, cfg, f.repro, f.removed ?? [], '#f08c00', path.join(outDir, `${base}-before.webm`))
        : null;
      f.replay = { page: `${base}.html`, after: `${base}-after.webm`, before: prev ? `${base}-before.webm` : null, afterTimeline: cand.timeline, beforeTimeline: prev?.timeline ?? null, highlighted: { after: cand.highlighted, before: prev?.highlighted ?? 0 } };
      done.push(f);
    }
  } finally {
    await browser.close();
  }
  return done;
}
