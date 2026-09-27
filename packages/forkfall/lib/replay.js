// Replay page: both versions play the same steps side by side, in lockstep.
// Each video plays one step and waits for the other, so a slow version never drifts ahead.
// All data is embedded as JSON and rendered with textContent.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const T = {
  en: { before: 'BEFORE', after: 'AFTER', play: 'Play', restart: 'Restart', step: 'Step', differs: 'Here they differ', onlyAfter: 'Only in the new version', onlyBefore: 'Only in the previous version', back: 'Back to the map', judged: 'Jev', explained: 'explained by the change', inconsistent: 'screen contradicts itself' },
  es: { before: 'ANTES', after: 'DESPUÉS', play: 'Reproducir', restart: 'Reiniciar', step: 'Paso', differs: 'Acá difieren', onlyAfter: 'Solo en la versión nueva', onlyBefore: 'Solo en la versión anterior', back: 'Volver al mapa', judged: 'Jev', explained: 'se explica por el cambio', inconsistent: 'la pantalla se contradice' },
};

export function renderReplay({ finding: f, impact, lang = 'en', typeLabel }) {
  const t = T[lang] ?? T.en;
  const data = {
    after: f.replay.afterTimeline,
    before: f.replay.beforeTimeline,
    t,
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const verdict = f.judgment?.verdict
    ? `${t.judged}: ${t.inconsistent} ${Math.round(f.judgment.screenInconsistent * 100)}% · ${t.explained} ${Math.round(f.judgment.explainedByIntent * 100)}%`
    : '';
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self' file:; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forkfall replay — ${esc(typeLabel)} ${esc(f.route)}</title>
<style>
body{margin:0;background:#101218;color:#f1f3f5;font:15px/1.45 system-ui,sans-serif}
header{padding:14px 22px 6px}h1{margin:0;font-size:20px}header p{margin:4px 0;color:#adb5bd}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:10px 22px}
.pane{background:#1a1d25;border-radius:10px;overflow:hidden;border:2px solid #2b303b}
.pane.after{border-color:#e03131}.pane.before{border-color:#f08c00}
.label{padding:6px 12px;font-weight:800;letter-spacing:.08em;font-size:13px}
.after .label{background:#e03131}.before .label{background:#f08c00;color:#1a1d25}
video{width:100%;display:block;background:#000}
.caption{margin:6px 22px;padding:12px 16px;background:#1a1d25;border-radius:10px;font-size:20px;font-weight:700;min-height:30px}
.caption.diff{background:#e03131}
.lines{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 22px}.lines ul{margin:4px 0;padding-left:18px;font-family:ui-monospace,monospace;font-size:13px}
.controls{padding:8px 22px 18px;display:flex;gap:10px;align-items:center}button{font:inherit;padding:6px 14px;border-radius:8px;border:0;background:#364fc7;color:#fff;cursor:pointer}
a{color:#91a7ff}.verdict{color:#d0bfff}
</style></head><body>
<header>
  <h1>${esc(typeLabel)} · <code>${esc(f.route)}</code></h1>
  <p>${esc(impact.message)} · ${esc(impact.baseCommit.slice(0, 7))} → ${esc(impact.headCommit?.slice(0, 7) ?? 'worktree')} ${verdict ? `· <span class="verdict">${esc(verdict)}</span>` : ''}</p>
</header>
<div class="grid">
  ${f.replay.before ? `<div class="pane before"><div class="label">${t.before} · ${esc(impact.baseCommit.slice(0, 7))}</div><video id="before" src="${esc(f.replay.before)}" muted playsinline preload="auto"></video></div>` : ''}
  <div class="pane after"><div class="label">${t.after} · ${esc(impact.headCommit?.slice(0, 7) ?? 'worktree')}</div><video id="after" src="${esc(f.replay.after)}" muted playsinline preload="auto"></video></div>
</div>
<div class="caption" id="caption"></div>
<div class="lines" id="lines" hidden>
  <div><strong>${t.onlyBefore}</strong><ul>${(f.removed ?? []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  <div><strong>${t.onlyAfter}</strong><ul>${(f.added ?? []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
</div>
<div class="controls"><button id="play">${t.play}</button><button id="restart">${t.restart}</button><a href="map.html#${esc(f.id)}">${t.back}</a></div>
<script type="application/json" id="data">${json}</script>
<script>
(() => {
  const d = JSON.parse(document.getElementById('data').textContent);
  const A = document.getElementById('after');
  const B = document.getElementById('before');
  const cap = document.getElementById('caption');
  const lines = document.getElementById('lines');
  const steps = d.after.filter((s) => !s.end);
  const n = B ? Math.min(steps.length, d.before.filter((s) => !s.end).length) : steps.length;
  const endOf = (tl, i) => (tl[i + 1] ? tl[i + 1].t : Infinity);
  const MIN_STEP_MS = 1500; // long enough to read each step's caption
  let i = 0, playing = false, final = false, stepStarted = 0;
  const show = () => {
    if (final) { cap.textContent = d.t.differs; cap.className = 'caption diff'; lines.hidden = false; return; }
    cap.textContent = d.t.step + ' ' + (i + 1) + '/' + n + ' · ' + steps[i].text;
    cap.className = 'caption'; lines.hidden = true;
  };
  const go = () => { stepStarted = performance.now(); show(); A.play(); if (B) B.play(); };
  const tick = () => {
    if (playing && !final) {
      if (!A.paused && A.currentTime >= endOf(d.after, i)) A.pause();
      if (B && !B.paused && B.currentTime >= endOf(d.before, i)) B.pause();
      if (A.paused && (!B || B.paused) && performance.now() - stepStarted >= MIN_STEP_MS) {
        if (i + 1 < n) { i++; go(); } else { final = true; go(); }
      }
    }
    requestAnimationFrame(tick);
  };
  document.getElementById('play').onclick = () => { if (!playing) { playing = true; go(); } };
  document.getElementById('restart').onclick = () => {
    i = 0; final = false; playing = true;
    A.currentTime = 0; if (B) B.currentTime = 0; go();
  };
  show();
  requestAnimationFrame(tick);
})();
</script>
</body></html>
`;
}
