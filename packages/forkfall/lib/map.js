// Consequence map: change → changed files → reachable screens/APIs → what exploration found.
// Static HTML + SVG, no scripts; all text escaped.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const T = {
  en: {
    title: 'Consequences of this change', change: 'Change', files: 'Changed files', entries: 'Reachable screens and APIs', findings: 'What exploration found',
    unpredicted: 'Screens static analysis did not predict', confirmed: 'Confirmed problems', confirmedHint: 'Seen happening in the new version and not in the previous one. Each comes with the steps to reproduce it.',
    diffs: 'Behavior differences', diffsHint: 'The new version shows something different from the previous one after the same steps. May be intended.',
    pre: 'Problems that already existed', preHint: 'Also happen in the previous version, so this change did not cause them.',
    replay: 'Watch both versions side by side',
    againstPlan: 'Against the plan', planSeen: 'Planned change seen', planMaybe: 'On a planned screen (not judged)', planNotSeen: 'Planned change not seen: not implemented, or exploration never reached it',
    planUnexpected: 'Changed without being in the plan', planUnexpectedHint: 'These differences are not explained by any planned change. Treat them as failures until someone decides otherwise.',
    expectedTag: 'EXPECTED', unexpectedTag: 'NOT IN THE PLAN',
    divergedHint: 'The previous version could not perform a step the new one did, so comparison stopped there. Often a new or renamed control; otherwise a regression in the previous flow.',
    gaps: 'Scenarios that could not finish', gapsHint: 'The explorer could not find a control the scenario asked for, so everything after that step was not tested.',
    unexplored: 'Affected but not explored', unexploredHint: 'Reachable from the change, but exploration never got there. No evidence either way.',
    why: 'Why each screen is affected', limits: 'Limits', steps: 'Steps to reproduce', seen: 'seen', times: 'time(s)', where: 'on',
    added: 'Only in the new version', removed: 'Only in the previous version', none: 'None found.',
    sequences: 'sequences explored', states: 'distinct screen states', screens: 'screens/APIs reachable', changedN: 'files changed', problems: 'confirmed problems', differences: 'differences',
    confirmedTag: 'CONFIRMED', possibleTag: 'POSSIBLE', suspiciousTag: 'SUSPICIOUS', intendedTag: 'LOOKS INTENDED', unexplainedTag: 'NOT EXPLAINED BY THE CHANGE',
    judged: "Jev's judgment (a judgment, not a verification)", explainedP: 'explained by the change', inconsistentP: 'screen contradicts itself',
    suspicious: 'Suspicious differences', suspiciousHint: 'Differences where Jev judged that the new screen contradicts itself. Check these first.', noEvidence: 'NOT EXPLORED', explored: 'explored', notExplored: 'not explored',
    types: { 'js-error': 'JavaScript error', 'server-error': 'Server error', 'http-failure': 'Request failed', dialog: 'Unexpected dialog', 'navigation-differs': 'Goes somewhere else', 'output-differs': 'Shows something different', 'baseline-cannot-follow': 'New or changed controls' },
  },
  es: {
    title: 'Consecuencias de este cambio', change: 'Cambio', files: 'Archivos cambiados', entries: 'Pantallas y APIs alcanzadas', findings: 'Lo que encontró la exploración',
    unpredicted: 'Pantallas que el análisis estático no predijo', confirmed: 'Problemas confirmados', confirmedHint: 'Se vieron pasar en la versión nueva y no en la anterior. Cada uno trae los pasos para reproducirlo.',
    diffs: 'Diferencias de comportamiento', diffsHint: 'Con los mismos pasos, la versión nueva muestra algo distinto que la anterior. Puede ser intencional.',
    pre: 'Problemas que ya existían', preHint: 'También pasan en la versión anterior; este cambio no los causó.',
    replay: 'Ver las dos versiones lado a lado',
    againstPlan: 'Contra el plan', planSeen: 'Cambio planeado visto', planMaybe: 'En una pantalla del plan (sin juzgar)', planNotSeen: 'Cambio planeado no visto: no se implementó, o la exploración no llegó',
    planUnexpected: 'Cambió sin estar en el plan', planUnexpectedHint: 'Ninguno de los cambios planeados explica estas diferencias. Tratalas como fallas hasta que alguien decida lo contrario.',
    expectedTag: 'ESPERADO', unexpectedTag: 'FUERA DEL PLAN',
    divergedHint: 'La versión anterior no pudo hacer un paso que la nueva sí, así que la comparación se cortó ahí. Suele ser un control nuevo o renombrado.',
    gaps: 'Escenarios que no se pudieron completar', gapsHint: 'El explorador no encontró un control que el escenario pedía, así que lo que venía después no se probó.',
    unexplored: 'Afectadas pero no exploradas', unexploredHint: 'El cambio llega hasta acá, pero la exploración no pasó por estas pantallas. No hay evidencia ni a favor ni en contra.',
    why: 'Por qué cada pantalla está afectada', limits: 'Límites', steps: 'Pasos para reproducirlo', seen: 'visto', times: 'vez/veces', where: 'en',
    added: 'Solo en la versión nueva', removed: 'Solo en la versión anterior', none: 'No se encontró ninguno.',
    sequences: 'secuencias exploradas', states: 'estados de pantalla distintos', screens: 'pantallas/APIs alcanzadas', changedN: 'archivos cambiados', problems: 'problemas confirmados', differences: 'diferencias',
    confirmedTag: 'CONFIRMADO', possibleTag: 'POSIBLE', suspiciousTag: 'SOSPECHOSO', intendedTag: 'PARECE INTENCIONAL', unexplainedTag: 'NO SE EXPLICA POR EL CAMBIO',
    judged: 'Juicio de Jev (es un juicio, no una verificación)', explainedP: 'se explica por el cambio', inconsistentP: 'la pantalla se contradice',
    suspicious: 'Diferencias sospechosas', suspiciousHint: 'Diferencias donde Jev juzgó que la pantalla nueva se contradice. Revisá estas primero.', noEvidence: 'SIN EXPLORAR', explored: 'explorada', notExplored: 'sin explorar',
    types: { 'js-error': 'Error de JavaScript', 'server-error': 'Error del servidor', 'http-failure': 'Falló un pedido', dialog: 'Diálogo inesperado', 'navigation-differs': 'Lleva a otro lado', 'output-differs': 'Muestra algo distinto', 'baseline-cannot-follow': 'Controles nuevos o cambiados' },
  },
};

export const typeLabel = (type, lang = 'en') => (T[lang] ?? T.en).types[type] ?? type;

const routeKey = (r) => r.replace(/\[[^\]]+\]|:\w+/g, ':id').replace(/\.html?$/, '').replace(/\/index$/, '') || '/';

export function renderMap({ impact, exploration, lang = 'en' }) {
  const t = T[lang] ?? T.en;
  const findings = exploration?.findings ?? [];
  const confirmed = findings.filter((f) => !f.preexisting && f.severity >= 2);
  const allDiffs = findings.filter((f) => !f.preexisting && f.severity === 1);
  const suspiciousOf = (f) => f.judgment?.verdict === 'suspicious';
  const byRisk = (a, b) => (b.judgment?.screenInconsistent ?? 0) - (a.judgment?.screenInconsistent ?? 0) || (a.judgment?.explainedByIntent ?? 1) - (b.judgment?.explainedByIntent ?? 1);
  const suspicious = allDiffs.filter(suspiciousOf).sort(byRisk);
  const diffs = allDiffs.filter((f) => !suspiciousOf(f));
  const pre = findings.filter((f) => f.preexisting);
  const diverged = findings.filter((f) => f.type === 'baseline-cannot-follow');
  const pages = impact.entries;
  const visited = new Set((exploration?.coverage.routesVisited ?? []).map(routeKey));
  const isVisited = (e) => visited.has(routeKey(e.route));

  // ---- graph layout
  const colX = [20, 250, 520, 820];
  const W = 1100;
  const rowH = 40;
  const col = [[], [], [], []];
  col[0].push({ id: 'change', label: cut(impact.message, 30), cls: 'change' });
  for (const c of impact.changed) col[1].push({ id: `file-${c.file}`, label: cut(c.file.split('/').slice(-2).join('/'), 30), cls: 'file', href: '#why' });
  const entryNode = new Map();
  for (const e of pages) {
    const n = { id: `entry-${e.kind}-${e.route}`, label: cut(`${e.kind === 'api' ? 'API ' : ''}${e.route}`, 34), cls: exploration ? (isVisited(e) ? 'entry visited' : 'entry unvisited') : 'entry', href: '#why' };
    entryNode.set(routeKey(e.route), n);
    col[2].push(n);
  }
  const shown = [...confirmed, ...suspicious, ...diffs].slice(0, 30);
  let unpredicted = null;
  for (const f of shown) {
    col[3].push({ id: f.id, label: cut(`${suspiciousOf(f) ? '⚠ ' : ''}${t.types[f.type]} ${t.where} ${f.route}`, 40), cls: f.severity >= 2 ? 'finding bad' : suspiciousOf(f) ? 'finding sus' : 'finding diff', href: `#${f.id}`, route: f.route });
    if (!entryNode.has(routeKey(f.route)) && !unpredicted) {
      unpredicted = { id: 'unpredicted', label: cut(t.unpredicted, 34), cls: 'entry unpredicted' };
      col[2].push(unpredicted);
    }
  }
  const pos = new Map();
  const height = Math.max(...col.map((c) => c.length), 1) * rowH + 40;
  col.forEach((nodes, ci) => nodes.forEach((n, i) => {
    const offset = (height - nodes.length * rowH) / 2;
    pos.set(n.id, { x: colX[ci], y: offset + i * rowH, w: ci === 3 ? 260 : 220 });
  }));
  const edges = [];
  for (const c of impact.changed) edges.push(['change', `file-${c.file}`, '']);
  for (const e of pages) {
    const src = impact.changed.find((c) => c.file === e.chain[0]);
    if (src) edges.push([`file-${src.file}`, `entry-${e.kind}-${e.route}`, '']);
  }
  for (const f of shown) {
    const target = entryNode.get(routeKey(f.route)) ?? unpredicted;
    edges.push([target.id, f.id, f.severity >= 2 ? 'bad' : suspiciousOf(f) ? 'sus' : 'diff']);
  }
  const edgeSvg = edges.filter(([a, b]) => pos.has(a) && pos.has(b)).map(([a, b, cls]) => {
    const p = pos.get(a);
    const q = pos.get(b);
    const x1 = p.x + p.w;
    const y1 = p.y + 14;
    const x2 = q.x;
    const y2 = q.y + 14;
    const mx = (x1 + x2) / 2;
    return `<path class="edge ${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
  }).join('');
  const nodeSvg = col.flat().map((n) => {
    const p = pos.get(n.id);
    const box = `<rect class="${n.cls}" x="${p.x}" y="${p.y}" width="${p.w}" height="28" rx="6"/><text x="${p.x + 8}" y="${p.y + 18}">${esc(n.label)}</text>`;
    return n.href ? `<a href="${esc(n.href)}">${box}</a>` : box;
  }).join('');
  const heads = [t.change, t.files, t.entries, t.findings].map((h, i) => `<text class="colhead" x="${colX[i]}" y="16">${esc(h)}</text>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${height + 20}" role="img" aria-label="${esc(t.title)}"><g transform="translate(0,20)">${edgeSvg}${nodeSvg}</g>${heads}</svg>`;

  // ---- cards
  const pct = (x) => `${Math.round(x * 100)}%`;
  const tagFor = (f) => (f.plan?.status === 'unexpected' ? ['bad', t.unexpectedTag] : f.plan?.status === 'expected' ? ['ok', `${t.expectedTag}: ${f.plan.change}`] : f.severity >= 2 && !f.preexisting ? ['bad', t.confirmedTag] : suspiciousOf(f) ? ['sus', t.suspiciousTag] : f.judgment?.verdict === 'unexplained' ? ['warn', t.unexplainedTag] : f.judgment?.verdict ? ['warn', t.intendedTag] : ['warn', t.possibleTag]);
  const findingCard = (f) => `<article class="card ${f.severity >= 2 && !f.preexisting ? 'bad' : suspiciousOf(f) ? 'sus' : ''}" id="${esc(f.id)}">
    <h3><span class="tag ${tagFor(f)[0]}">${tagFor(f)[1]}</span> ${esc(t.types[f.type])} ${t.where} <code>${esc(f.route)}</code></h3>
    <p>${esc(f.detail)}</p>
    ${f.replay ? `<p><a class="replay" href="${esc(f.replay.page)}">▶ ${t.replay}</a></p>` : ''}
    ${f.judgment?.verdict ? `<p class="judge">${t.judged}: ${t.explainedP} <strong>${pct(f.judgment.explainedByIntent)}</strong> · ${t.inconsistentP} <strong>${pct(f.judgment.screenInconsistent)}</strong></p>` : ''}
    ${f.added?.length ? `<p class="meta">${t.added}:</p><ul class="diff add">${f.added.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${f.removed?.length ? `<p class="meta">${t.removed}:</p><ul class="diff rem">${f.removed.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <p class="meta">${t.steps} (${t.seen} ${f.occurrences} ${t.times}):</p>
    <ol>${f.repro.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>
  </article>`;

  const unexplored = exploration ? pages.filter((e) => e.kind === 'page' && !isVisited(e)) : [];
  const cov = exploration?.coverage;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forkfall — ${esc(impact.message)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:1rem 1.5rem;color:#1b1b1b;background:#fafafa}
h2{margin-top:2rem;border-bottom:2px solid #ddd}.meta{color:#555;font-size:.9em;margin:.3rem 0}
svg{width:100%;height:auto;background:#fff;border:1px solid #ddd;border-radius:8px}
svg text{font:12px system-ui,sans-serif;fill:#1b1b1b}svg .colhead{font-weight:700;fill:#555}
rect{fill:#fff;stroke:#888;stroke-width:1.5}rect.change{fill:#e8eefc;stroke:#1a5fb4}rect.file{fill:#f3f3f3}
rect.visited{stroke:#0b6b2e}rect.unvisited{stroke:#999;stroke-dasharray:4 3}rect.unpredicted{fill:#fff4e5;stroke:#8a5300;stroke-dasharray:2 2}
rect.bad{fill:#fdecec;stroke:#a4161a;stroke-width:3}rect.diff{fill:#fff8e1;stroke:#8a5300}
.edge{fill:none;stroke:#bbb;stroke-width:1.5}.edge.sus{stroke:#d9480f;stroke-width:2.5}rect.sus{fill:#fff0e6;stroke:#d9480f;stroke-width:2.5}
.card.sus{border-left-color:#d9480f}.tag.sus{color:#d9480f;border-width:3px}.judge{background:#f4f1ff;padding:.3rem .6rem;border-radius:4px;font-size:.9em}.edge.bad{stroke:#a4161a;stroke-width:2.5}.edge.diff{stroke:#c98a00}
.summary{display:flex;gap:.8rem;flex-wrap:wrap}.summary div{background:#fff;border:1px solid #ccc;border-radius:6px;padding:.4rem .9rem}
.card{background:#fff;border:1px solid #ccc;border-left:6px solid #c98a00;border-radius:6px;padding:.5rem 1rem;margin:.8rem 0}.card.bad{border-left-color:#a4161a}
.tag{font-size:.75em;font-weight:700;padding:.1rem .5rem;border-radius:1rem;border:2px solid}.tag.bad{color:#a4161a;border-style:double;border-width:3px}.tag.warn{color:#8a5300;border-style:dashed}.tag.ok{color:#0b6b2e}ul.plan{list-style:none;padding-left:0}ul.plan li{margin:.5rem 0}
.diff{font-family:ui-monospace,monospace;font-size:.85em}.diff.add li{color:#0b6b2e}.diff.rem li{color:#a4161a;text-decoration:line-through}
a.replay{display:inline-block;background:#364fc7;color:#fff;padding:.25rem .8rem;border-radius:6px;text-decoration:none;font-weight:600}
code{background:#eee;padding:0 .3rem;border-radius:3px}a:focus{outline:3px solid #1a5fb4}
</style></head><body>
<h1>${esc(t.title)}</h1>
<p><strong>${esc(impact.message)}</strong> <span class="meta">${esc(impact.baseCommit.slice(0, 7))} → ${esc(impact.headCommit?.slice(0, 7) ?? 'worktree')}</span></p>
<section class="summary" aria-label="Summary">
  <div><strong>${impact.changed.length}</strong> ${t.changedN}</div>
  <div><strong>${pages.length}</strong> ${t.screens}</div>
  ${cov ? `<div><strong>${cov.sequences}</strong> ${t.sequences} · <strong>${cov.distinctStates}</strong> ${t.states}</div>
  <div><strong>${confirmed.length}</strong> ${t.problems}${suspicious.length ? ` · <strong>${suspicious.length}</strong> ${t.suspicious.toLowerCase()}` : ''} · <strong>${diffs.length}</strong> ${t.differences}</div>` : ''}
</section>
${svg}
${exploration?.plan ? `<h2 id="plan">${t.againstPlan}</h2>
<ul class="plan">${exploration.plan.changes.map((c) => `<li><span class="tag ${c.status === 'seen' ? 'ok' : 'warn'}">${c.status === 'seen' ? '✔' : '?'}</span> <strong>${esc(c.id)}</strong>: ${c.status === 'seen' ? `${t.planSeen} (${c.seen.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(', ')})` : c.status === 'maybe' ? t.planMaybe : t.planNotSeen}<br><span class="meta">${esc(c.description)}</span></li>`).join('')}</ul>
<h3>${t.planUnexpected} (${exploration.plan.unexpected.length})</h3><p class="meta">${t.planUnexpectedHint}</p>
${exploration.plan.unexpected.map((id) => findings.find((f) => f.id === id)).filter(Boolean).map(findingCard).join('') || `<p>${t.none}</p>`}` : ''}
<h2 id="confirmed">${t.confirmed}</h2><p class="meta">${t.confirmedHint}</p>
${confirmed.map(findingCard).join('') || `<p>${t.none}</p>`}
${suspicious.length ? `<h2 id="suspicious">${t.suspicious}</h2><p class="meta">${t.suspiciousHint}</p>${suspicious.map(findingCard).join('')}` : ''}
<h2 id="diffs">${t.diffs}</h2><p class="meta">${t.diffsHint}</p>
${diffs.map(findingCard).join('') || `<p>${t.none}</p>`}
${unexplored.length ? `<h2 id="unexplored">${t.unexplored}</h2><p class="meta">${t.unexploredHint}</p><ul>${unexplored.map((e) => `<li><span class="tag warn">${t.noEvidence}</span> <code>${esc(e.route)}</code></li>`).join('')}</ul>` : ''}
${pre.length ? `<h2 id="pre">${t.pre}</h2><p class="meta">${t.preHint}</p>${pre.map(findingCard).join('')}` : ''}
${diverged.length ? `<h2 id="diverged">${t.types['baseline-cannot-follow']}</h2><p class="meta">${t.divergedHint}</p>${diverged.map(findingCard).join('')}` : ''}
${exploration?.scenarioGaps?.length ? `<h2 id="gaps">${t.gaps}</h2><p class="meta">${t.gapsHint}</p><ul>${exploration.scenarioGaps.map((g) => `<li><strong>${esc(g.scenario)}</strong>: ${esc(g.stoppedAt)} (${g.completedSteps})</li>`).join('')}</ul>` : ''}
<h2 id="why">${t.why}</h2>
<ul>${pages.map((e) => `<li><code>${esc(e.route)}</code>${exploration ? ` (${isVisited(e) ? t.explored : t.notExplored})` : ''}: ${e.chain.map((c) => esc(c)).join(' → ')}</li>`).join('')}</ul>
<h2 id="limits">${t.limits}</h2>
<ul>${[...impact.limitations, ...(exploration?.limitations ?? [])].map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</body></html>
`;
}
