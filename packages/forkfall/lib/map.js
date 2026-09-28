// Consequence map: change → changed files → reachable screens/APIs → what exploration found.
// Static, self-contained HTML. No scripts, no external resources; all data escaped.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const T = {
  en: {
    kicker: 'Consequences of this change',
    verdict: (n, s) => (n === 0 ? 'No regressions found in what was explored' : `${n} problem${n === 1 ? '' : 's'} found in ${s} screen${s === 1 ? '' : 's'}`),
    verdictUnexplored: 'This change was not explored',
    worktree: 'worktree',
    sequences: 'sequences explored', screensReached: 'screens reached',

    statusConfirmed: 'Confirmed', statusSuspicious: 'Suspicious', statusChanged: 'Changed', statusNotInPlan: 'Not in plan', statusPreexisting: 'Pre-existing', statusDiverged: 'Diverged',

    againstPlan: 'Against the plan',
    planStatusSeen: 'Seen', planStatusMaybe: 'Possible', planStatusNotSeen: 'Not seen',
    findingOne: 'finding', findingMany: 'findings',

    problems: 'Problems', problemsHint: 'Confirmed regressions, suspicious differences, and differences not explained by the plan.',
    otherDiffs: 'Other differences', otherDiffsHint: 'The new version shows something different after the same steps. Likely intended; check if unsure.',
    pre: 'Pre-existing problems', preHint: 'Also happen in the previous version, so this change did not cause them.',

    coverage: 'Coverage',
    screenCol: 'Screen', reachedCol: 'Reached', findingsCol: 'Findings',
    yes: 'Yes', no: 'No', notExploredCell: '—',
    apiSummary: (n) => `${n} API endpoint${n === 1 ? '' : 's'} reachable from the change; not explored directly (exploration clicks through pages).`,
    gaps: 'Scenarios that could not finish', gapsHint: 'The explorer could not find a control the scenario asked for; everything after that step was not tested.',
    diverged: 'Diverged paths', divergedHint: "The previous version could not perform a step the new one did, so comparison stopped there. Often a new or renamed control; otherwise a regression in the previous version.",

    why: 'How the change reaches each screen', explored: 'explored', notExplored: 'not explored',
    apiChains: (n) => `API endpoints (${n})`,
    limits: 'Limits',

    steps: 'Steps to reproduce', seen: 'seen', times: 'time(s)',
    before: 'Before', after: 'After', empty: '—',
    replay: 'Replay',
    judged: "Jev's judgment (a judgment, not a verification)", explainedP: 'explained by the change', inconsistentP: 'screen contradicts itself',
    judgeVerdict: { suspicious: 'suspicious', unexplained: 'not explained by the change', 'likely-intended': 'likely intended' },
    none: 'None found.',
    types: { 'order-differs': 'Same content, different order', arithmetic: 'Numbers do not add up', 'js-error': 'JavaScript error', 'server-error': 'Server error', 'http-failure': 'Request failed', dialog: 'Unexpected dialog', 'navigation-differs': 'Goes somewhere else', 'output-differs': 'Shows something different', 'baseline-cannot-follow': 'New or changed controls' },
  },
  es: {
    kicker: 'Consecuencias de este cambio',
    verdict: (n, s) => (n === 0 ? 'No se encontraron regresiones en lo explorado' : `${n} problema${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'} en ${s} pantalla${s === 1 ? '' : 's'}`),
    verdictUnexplored: 'Este cambio no se exploró',
    worktree: 'worktree',
    sequences: 'secuencias exploradas', screensReached: 'pantallas alcanzadas',

    statusConfirmed: 'Confirmado', statusSuspicious: 'Sospechoso', statusChanged: 'Cambió', statusNotInPlan: 'Fuera del plan', statusPreexisting: 'Preexistente', statusDiverged: 'Divergió',

    againstPlan: 'Contra el plan',
    planStatusSeen: 'Visto', planStatusMaybe: 'Posible', planStatusNotSeen: 'No visto',
    findingOne: 'hallazgo', findingMany: 'hallazgos',

    problems: 'Problemas', problemsHint: 'Regresiones confirmadas, diferencias sospechosas y diferencias que el plan no explica.',
    otherDiffs: 'Otras diferencias', otherDiffsHint: 'Con los mismos pasos, la versión nueva muestra algo distinto. Probablemente intencional; revisá si tenés dudas.',
    pre: 'Problemas preexistentes', preHint: 'También pasan en la versión anterior; este cambio no los causó.',

    coverage: 'Cobertura',
    screenCol: 'Pantalla', reachedCol: 'Alcanzada', findingsCol: 'Hallazgos',
    yes: 'Sí', no: 'No', notExploredCell: '—',
    apiSummary: (n) => `${n} endpoint${n === 1 ? '' : 's'} de API alcanzable${n === 1 ? '' : 's'} desde el cambio; no se exploran directamente (la exploración navega por las pantallas).`,
    gaps: 'Escenarios que no se pudieron completar', gapsHint: 'El explorador no encontró un control que el escenario pedía; lo que venía después no se probó.',
    diverged: 'Rutas que divergieron', divergedHint: 'La versión anterior no pudo hacer un paso que la nueva sí, así que la comparación se cortó ahí. Suele ser un control nuevo o renombrado; si no, una regresión en la versión anterior.',

    why: 'Cómo llega el cambio a cada pantalla', explored: 'explorada', notExplored: 'sin explorar',
    apiChains: (n) => `Endpoints de API (${n})`,
    limits: 'Límites',

    steps: 'Pasos para reproducirlo', seen: 'visto', times: 'vez/veces',
    before: 'Antes', after: 'Después', empty: '—',
    replay: 'Repetición',
    judged: 'Juicio de Jev (es un juicio, no una verificación)', explainedP: 'se explica por el cambio', inconsistentP: 'la pantalla se contradice',
    judgeVerdict: { suspicious: 'sospechoso', unexplained: 'no se explica por el cambio', 'likely-intended': 'parece intencional' },
    none: 'No se encontró ninguno.',
    types: { 'order-differs': 'Mismo contenido, otro orden', arithmetic: 'Los números no cierran', 'js-error': 'Error de JavaScript', 'server-error': 'Error del servidor', 'http-failure': 'Falló un pedido', dialog: 'Diálogo inesperado', 'navigation-differs': 'Lleva a otro lado', 'output-differs': 'Muestra algo distinto', 'baseline-cannot-follow': 'Controles nuevos o cambiados' },
  },
};

export const typeLabel = (type, lang = 'en') => (T[lang] ?? T.en).types[type] ?? type;

const routeKey = (r) => r.replace(/\[[^\]]+\]|:\w+/g, ':id').replace(/\.html?$/, '').replace(/\/index$/, '') || '/';

export function renderMap({ impact, exploration, lang = 'en' }) {
  const t = T[lang] ?? T.en;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const pages = impact.entries;
  const pageEntries = pages.filter((e) => e.kind === 'page');
  const apiEntries = pages.filter((e) => e.kind === 'api');
  const visited = new Set((exploration?.coverage?.routesVisited ?? []).map(routeKey));
  const isVisited = (e) => visited.has(routeKey(e.route));

  const findings = exploration?.findings ?? [];
  const suspiciousOf = (f) => f.judgment?.verdict === 'suspicious';
  const byRisk = (a, b) => (b.judgment?.screenInconsistent ?? 0) - (a.judgment?.screenInconsistent ?? 0) || (a.judgment?.explainedByIntent ?? 1) - (b.judgment?.explainedByIntent ?? 1);
  const unexpectedIds = new Set(exploration?.plan?.unexpected ?? []);

  // ---- group findings once, in priority order, so each appears in exactly one bucket
  const diverged = findings.filter((f) => f.type === 'baseline-cannot-follow');
  const divergedIds = new Set(diverged.map((f) => f.id));
  const rest = findings.filter((f) => !divergedIds.has(f.id));
  const pre = rest.filter((f) => f.preexisting);
  const active = rest.filter((f) => !f.preexisting);

  const confirmed = active.filter((f) => f.severity >= 2);
  const confirmedIds = new Set(confirmed.map((f) => f.id));
  const suspicious = active.filter((f) => f.severity === 1 && suspiciousOf(f)).sort(byRisk);
  const suspiciousIds = new Set(suspicious.map((f) => f.id));
  const notInPlan = active.filter((f) => unexpectedIds.has(f.id) && !confirmedIds.has(f.id) && !suspiciousIds.has(f.id));
  const notInPlanIds = new Set(notInPlan.map((f) => f.id));
  const otherDiffs = active.filter((f) => f.severity === 1 && !suspiciousOf(f) && !notInPlanIds.has(f.id));

  // findings with a replay come first within each group; description quality falls off
  // from confirmed (concrete errors) to not-in-plan to suspicious (often just "contradicts itself")
  const replayFirst = (list) => [...list.filter((f) => f.replay), ...list.filter((f) => !f.replay)];
  const problems = [...replayFirst(confirmed), ...replayFirst(notInPlan), ...replayFirst(suspicious)];

  const statusOf = (f) => {
    if (divergedIds.has(f.id)) return ['diverged', t.statusDiverged];
    if (confirmedIds.has(f.id)) return ['bad', t.statusConfirmed];
    if (suspiciousIds.has(f.id)) return ['warn', t.statusSuspicious];
    if (notInPlanIds.has(f.id)) return ['bad', t.statusNotInPlan];
    if (f.preexisting) return ['muted', t.statusPreexisting];
    return ['warn', t.statusChanged];
  };

  // ---- one row per finding: status word, route, one-line description, optional replay link;
  // details (repro steps, before/after, Jev judgment) inside a native <details>.
  // for output/order/navigation differences, the description is the actual before → after change,
  // not a generic type label, so rows can be scanned instead of read one by one.
  const short = (s) => cut(String(s ?? ''), 70);
  const ordinal = (n) => {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
  };
  // Shows only what changed between two similar lines: "…is included → …is included in the total below."
  const trimCommon = (a, b) => {
    const wa = a.split(' ');
    const wb = b.split(' ');
    let p = 0;
    while (p < wa.length && p < wb.length && wa[p] === wb[p]) p++;
    const keep = Math.max(0, p - 2); // keep two words of context
    if (keep < 3) return [a, b];
    return [`…${wa.slice(keep).join(' ')}`, `…${wb.slice(keep).join(' ')}`];
  };
  const fieldPair = (before, after) => {
    const fieldRe = /^\[field\] (.+?):\s*(.*)$/;
    const bm = fieldRe.exec(before);
    const am = fieldRe.exec(after);
    if (bm && am && bm[1] === am[1]) return `${bm[1]}: ${short(bm[2])} → ${short(am[2])}`;
    const [b, a] = trimCommon(before, after);
    return `${short(b)} → ${short(a)}`;
  };
  // Pairs the removed and added lines that look most alike (shared words), so the summary compares
  // a line with its new version instead of with whatever happened to sit at the same position.
  const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9$.]+/).filter(Boolean));
  const likeness = (a, b) => {
    const wa = words(a);
    const wb = words(b);
    let common = 0;
    for (const w of wa) if (wb.has(w)) common++;
    return common / Math.max(1, Math.min(wa.size, wb.size));
  };
  const bestPair = (removed, added) => {
    let best = [removed[0], added[0], -1];
    for (const r of removed.slice(0, 12)) {
      for (const a of added.slice(0, 12)) {
        const field = /^\[field\] (.+?):/.exec(r)?.[1];
        const score = field && a.startsWith(`[field] ${field}:`) ? 2 : likeness(r, a);
        if (score > best[2]) best = [r, a, score];
      }
    }
    return best;
  };
  const orderMoveSummary = (f) => {
    // an "item name" line: has letters, isn't a price, isn't a full sentence, isn't a CTA label
    const isItemName = (s) => /[A-Za-zÀ-ÿ]{2,}/.test(s) && !s.startsWith('$') && !/[.!?]$/.test(s.trim()) && !/^View /.test(s) && s.length <= 40;
    const names = (arr) => (arr ?? []).filter(isItemName);
    const before = names(f.removed);
    const after = names(f.added);
    for (let i = 0; i < before.length; i++) {
      const j = after.indexOf(before[i]);
      if (j !== -1 && j !== i) return `${short(before[i])}: ${ordinal(i + 1)} → ${ordinal(j + 1)}`;
    }
    return null;
  };
  const diffSummary = (f) => {
    const added = f.added ?? [];
    const removed = f.removed ?? [];
    if (f.type === 'order-differs') {
      const moved = orderMoveSummary(f);
      if (moved) return moved;
    }
    if (removed.length && added.length) {
      const [r, a, score] = bestPair(removed, added);
      // Nothing alike on both sides: say what appeared rather than pairing unrelated lines.
      if (score < 0.3) return `+ ${short(added[0])}`;
      return fieldPair(r, a);
    }
    if (added.length) return `+ ${short(added[0])}`;
    if (removed.length) return `− ${short(removed[0])}`;
    return null;
  };
  const SUMMARY_TYPES = new Set(['output-differs', 'order-differs', 'navigation-differs']);
  const row = (f, open) => {
    const [cls, label] = statusOf(f);
    const typeWord = t.types[f.type] ?? f.type;
    const detail = cut(f.detail, 160);
    let desc = detail;
    let descMono = false;
    if (SUMMARY_TYPES.has(f.type)) {
      const s = diffSummary(f);
      if (s) { desc = s; descMono = true; }
      // else: no added/removed data to build a change summary from — fall back to the plain
      // detail text, still without the type label (it rarely adds anything for these types).
    } else {
      const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const a = words(typeWord);
      const b = words(detail);
      const shared = [...a].filter((w) => b.has(w)).length;
      const saysTheSameThing = a.size > 0 && shared / a.size >= 0.6;
      desc = saysTheSameThing ? detail : `${typeWord}: ${detail}`;
    }
    const hasDiff = (f.added?.length ?? 0) > 0 || (f.removed?.length ?? 0) > 0;
    const judge = f.judgment?.verdict
      ? `<p class="judge">${esc(t.judged)}: ${esc(t.explainedP)} ${pct(f.judgment.explainedByIntent)} · ${esc(t.inconsistentP)} ${pct(f.judgment.screenInconsistent)} · ${esc(t.judgeVerdict[f.judgment.verdict] ?? f.judgment.verdict)}</p>`
      : '';
    return `<details class="row" id="${esc(f.id)}"${open ? ' open' : ''}>
      <summary>
        <span class="stat st-${cls}">${esc(label)}</span>
        <code class="path">${esc(f.route)}</code>
        <span class="desc${descMono ? ' mono' : ''}">${esc(desc)}</span>
        ${f.replay ? `<a class="rowlink" href="${esc(f.replay.page)}">${esc(t.replay)}</a>` : ''}
      </summary>
      <div class="body">
        <p class="label">${esc(t.steps)} (${esc(t.seen)} ${f.occurrences} ${esc(t.times)})</p>
        <ol>${f.repro.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>
        ${hasDiff ? `<div class="diffgrid">
          <div><p class="label">${esc(t.before)}</p><ul class="diffcol">${(f.removed ?? []).map((l) => `<li>${esc(l)}</li>`).join('') || `<li class="none">${esc(t.empty)}</li>`}</ul></div>
          <div><p class="label">${esc(t.after)}</p><ul class="diffcol">${(f.added ?? []).map((l) => `<li>${esc(l)}</li>`).join('') || `<li class="none">${esc(t.empty)}</li>`}</ul></div>
        </div>` : ''}
        ${judge}
      </div>
    </details>`;
  };

  // the first confirmed/suspicious finding starts open; everything else starts closed
  const firstOpenId = (problems.find((f) => confirmedIds.has(f.id) || suspiciousIds.has(f.id)) ?? {}).id;
  const rows = (list) => list.map((f) => row(f, f.id === firstOpenId)).join('');

  // ---- verdict + meta line
  const problemRoutes = new Set(problems.map((f) => routeKey(f.route)));
  const verdictLine = exploration ? t.verdict(problems.length, problemRoutes.size) : t.verdictUnexplored;
  const headShort = impact.headCommit ? impact.headCommit.slice(0, 7) : t.worktree;
  const metaBits = [cut(impact.message, 90), `${impact.baseCommit.slice(0, 7)} → ${headShort}`];
  if (exploration?.coverage) {
    const reached = pageEntries.filter(isVisited).length;
    metaBits.push(`${exploration.coverage.sequences} ${t.sequences}`, `${reached}/${pageEntries.length} ${t.screensReached}`);
  }

  // ---- against the plan (only if exploration.plan): one row per planned change, same row
  // style as findings. Only the first sentence shows; the full description is inside <details>.
  // Finding ids are never shown as text — just a count linking to the first one.
  const firstSentence = (s) => {
    const m = /^.*?[.!?](?=\s|$)/.exec(s ?? '');
    return m ? m[0] : (s ?? '');
  };
  const findingCount = (n) => `${n} ${n === 1 ? t.findingOne : t.findingMany}`;
  const planSection = exploration?.plan ? `
<section>
  <h2>${esc(t.againstPlan)}</h2>
  ${exploration.plan.changes.map((c) => {
    const [cls, label] = c.status === 'seen' ? ['ok', t.planStatusSeen] : c.status === 'maybe' ? ['warn', t.planStatusMaybe] : ['bad', t.planStatusNotSeen];
    const seenLink = c.status === 'seen' && c.seen?.length
      ? `<a class="rowlink" href="#${esc(c.seen[0])}">${esc(findingCount(c.seen.length))}</a>` : '';
    return `<details class="row">
      <summary>
        <span class="stat st-${cls}">${esc(label)}</span>
        <code class="path">${esc(c.id)}</code>
        <span class="desc">${esc(firstSentence(c.description))}</span>
        ${seenLink}
      </summary>
      <div class="body"><p>${esc(c.description)}</p></div>
    </details>`;
  }).join('')}
</section>` : '';

  // ---- problems (confirmed + suspicious + not-in-plan)
  const problemsSection = exploration ? `
<section>
  <h2>${esc(t.problems)} (${problems.length})</h2>
  <p class="hint">${esc(t.problemsHint)}</p>
  ${problems.length ? rows(problems) : `<p class="hint">${esc(t.none)}</p>`}
</section>` : '';

  // ---- other differences, collapsed by default
  const otherSection = exploration ? `
<details class="section">
  <summary><h2>${esc(t.otherDiffs)} (${otherDiffs.length})</h2></summary>
  <div class="body">
    <p class="hint">${esc(t.otherDiffsHint)}</p>
    ${otherDiffs.length ? rows(otherDiffs) : `<p class="hint">${esc(t.none)}</p>`}
  </div>
</details>` : '';

  const preSection = pre.length ? `
<details class="section">
  <summary><h2>${esc(t.pre)} (${pre.length})</h2></summary>
  <div class="body">
    <p class="hint">${esc(t.preHint)}</p>
    ${rows(pre)}
  </div>
</details>` : '';

  // ---- coverage: reached vs not, scenario gaps, diverged paths — replaces the old box-and-arrow graph.
  // Only pages get a row: exploration clicks through pages, so "reached" is meaningful there;
  // APIs are summarized in one line instead of padding the table with routes that were never visited directly.
  const countByRoute = new Map();
  for (const f of active) countByRoute.set(routeKey(f.route), (countByRoute.get(routeKey(f.route)) ?? 0) + 1);
  const coverageTable = `<table class="cov">
    <thead><tr><th>${esc(t.screenCol)}</th><th>${esc(t.reachedCol)}</th><th>${esc(t.findingsCol)}</th></tr></thead>
    <tbody>${pageEntries.map((e) => {
      const reachedCell = exploration ? (isVisited(e) ? esc(t.yes) : esc(t.no)) : esc(t.notExploredCell);
      const cnt = countByRoute.get(routeKey(e.route)) ?? 0;
      return `<tr><td><code>${esc(e.route)}</code></td><td>${reachedCell}</td><td>${cnt}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
  const apiNote = apiEntries.length ? `<p class="hint">${esc(t.apiSummary(apiEntries.length))}</p>` : '';
  const gapsBlock = exploration?.scenarioGaps?.length ? `
  <h3>${esc(t.gaps)}</h3>
  <p class="hint">${esc(t.gapsHint)}</p>
  <ul class="plain">${exploration.scenarioGaps.map((g) => `<li><strong>${esc(g.scenario)}</strong>: ${esc(g.stoppedAt)} (${g.completedSteps})</li>`).join('')}</ul>` : '';
  const divergedBlock = diverged.length ? `
  <h3>${esc(t.diverged)}</h3>
  <p class="hint">${esc(t.divergedHint)}</p>
  ${rows(diverged)}` : '';
  const coverageSection = `
<section>
  <h2>${esc(t.coverage)}</h2>
  ${coverageTable}
  ${apiNote}
  ${gapsBlock}
  ${divergedBlock}
</section>`;

  // ---- how the change reaches each screen (the chains), monospace, muted.
  // Pages are listed directly; API chains are the same information repeated per-endpoint,
  // so they're tucked into one collapsed <details> instead of a long flat list.
  const chainLi = (e) => `<li><code>${esc(e.route)}</code>${exploration ? ` <span class="label">(${isVisited(e) ? esc(t.explored) : esc(t.notExplored)})</span>` : ''}<br><span class="chain">${e.chain.map((c) => esc(c)).join(' → ')}</span></li>`;
  const whySection = `
<section>
  <h2>${esc(t.why)}</h2>
  <ul class="chains">${pageEntries.map(chainLi).join('')}</ul>
  ${apiEntries.length ? `<details class="section-sub"><summary>${esc(t.apiChains(apiEntries.length))}</summary><ul class="chains">${apiEntries.map(chainLi).join('')}</ul></details>` : ''}
</section>`;

  // ---- limits, small print
  const limitsSection = `
<section>
  <h2>${esc(t.limits)}</h2>
  <ul class="limits">${[...impact.limitations, ...(exploration?.limitations ?? [])].map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</section>`;

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forkfall — ${esc(impact.message)}</title>
<style>
:root{
  --fg:#111827; --muted:#6b7280; --bg:#fdfdfd; --border:#e5e7eb; --border-strong:#d1d5db;
  --red:#b42318; --amber:#b54708; --green:#166534;
  --font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark){
  :root{ --fg:#e5e7eb; --muted:#9aa4b2; --bg:#0e1015; --border:#252a33; --border-strong:#333944;
    --red:#f38b7d; --amber:#f0b862; --green:#5fbf85; }
}
*{box-sizing:border-box}
body{font:15px/1.65 var(--font);max-width:60rem;margin:0 auto;padding:2.5rem 1.5rem 4rem;color:var(--fg);background:var(--bg)}
code,.chain,.rowlink,.path,.desc.mono{font-family:var(--mono)}
h1{font-size:1.7rem;line-height:1.3;margin:.15rem 0 0}
h2{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--muted);margin:0;display:inline}
h3{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:var(--muted);margin:1.4rem 0 .3rem}
section{border-top:1px solid var(--border);padding:1.6rem 0}
section:first-of-type{border-top:none;padding-top:1.4rem}
.kicker{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0}
.meta{color:var(--muted);font-size:.88em;margin:.6rem 0 0}
.hint{color:var(--muted);font-size:.9em;margin:.3rem 0 .8rem;max-width:52rem}
p.label{color:var(--muted);font-size:.8em;margin:.9rem 0 .25rem;text-transform:uppercase;letter-spacing:.04em}
a{color:inherit}
a:focus-visible,summary:focus-visible{outline:2px solid var(--fg);outline-offset:2px}

.stat{font-weight:700;font-size:.72em;letter-spacing:.05em;text-transform:uppercase;flex:0 0 auto}
.st-bad{color:var(--red)}.st-warn{color:var(--amber)}.st-ok{color:var(--green)}.st-muted,.st-diverged{color:var(--muted)}

/* dense finding rows */
details.row{border-top:1px solid var(--border);padding:.55rem 0}
details.row:first-of-type{border-top:none}
details.row>summary{display:flex;align-items:baseline;gap:.7rem;cursor:pointer;list-style:none}
details.row>summary::-webkit-details-marker{display:none}
details.row>summary::before{content:"›";color:var(--muted);flex:0 0 auto;width:.7em;transform:rotate(0deg);transition:transform .1s}
details.row[open]>summary::before{transform:rotate(90deg)}
details.row>summary .path{flex:0 0 auto;color:var(--fg);font-size:.92em}
details.row>summary .desc{flex:1 1 auto;color:var(--muted);font-size:.92em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.rowlink{flex:0 0 auto;font-size:.85em;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
details.row .body{margin:.6rem 0 .3rem 1.4rem}
details.row .body ol{margin:.2rem 0;padding-left:1.2rem}
details.row .body li{margin:.15rem 0}
.judge{color:var(--muted);font-size:.88em;margin:.8rem 0 0}

.diffgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem;margin-top:.4rem;font-family:var(--mono);font-size:.85em}
.diffcol{list-style:none;margin:.2rem 0;padding:0}
.diffcol li{padding:.05rem 0;border-bottom:1px dotted var(--border)}
.diffgrid>div:first-child .diffcol li{color:var(--muted);text-decoration:line-through}
.diffcol li.none{color:var(--muted);text-decoration:none}

/* collapsible sections (other differences, pre-existing) */
details.section{border-top:1px solid var(--border);padding:1.6rem 0}
details.section>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:.5rem}
details.section>summary::-webkit-details-marker{display:none}
details.section>summary::before{content:"›";color:var(--muted);transform:rotate(0deg);transition:transform .1s}
details.section[open]>summary::before{transform:rotate(90deg)}
details.section .body{margin-top:.8rem}

details.section-sub{margin-top:.8rem}
details.section-sub>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.78rem;letter-spacing:.05em;text-transform:uppercase}
details.section-sub>summary::-webkit-details-marker{display:none}
details.section-sub>summary::before{content:"›";transform:rotate(0deg);transition:transform .1s}
details.section-sub[open]>summary::before{transform:rotate(90deg)}
details.section-sub ul.chains{margin-top:.4rem}

table.cov{border-collapse:collapse;width:100%;margin-top:.6rem;font-size:.92em}
table.cov th{text-align:left;font-size:.72em;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:.3rem .6rem .3rem 0;border-bottom:1px solid var(--border-strong)}
table.cov td{padding:.35rem .6rem .35rem 0;border-bottom:1px solid var(--border)}
table.cov td:nth-child(2),table.cov td:nth-child(3),table.cov th:nth-child(2),table.cov th:nth-child(3){text-align:right}

ul.plain{margin:.3rem 0;padding-left:1.2rem}
ul.plain li{margin:.15rem 0}

ul.chains{list-style:none;padding:0;margin:.6rem 0 0}
ul.chains li{padding:.5rem 0;border-top:1px solid var(--border);color:var(--muted);font-size:.9em}
ul.chains li:first-child{border-top:none}
ul.chains code{color:var(--fg)}
.chain{display:inline-block;margin-top:.15rem}

ul.limits{color:var(--muted);font-size:.85em;padding-left:1.2rem;margin:.6rem 0 0}
ul.limits li{margin:.3rem 0}
</style></head><body>
<p class="kicker">${esc(t.kicker)}</p>
<h1>${esc(verdictLine)}</h1>
<p class="meta">${metaBits.map(esc).join(' · ')}</p>

${planSection}
${problemsSection}
${otherSection}
${preSection}
${coverageSection}
${whySection}
${limitsSection}
</body></html>
`;
}
