// Self-contained, offline HTML report. No scripts: the CSP forbids them, and every
// piece of analysis text is escaped because it is untrusted agent output.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BADGES = {
  verified: ['ok', '✔', 'Verified by captured test'],
  failed: ['bad', '✖', 'Failed a captured test'],
  not_verified: ['unk', '?', 'Not verified'],
  pass: ['ok', '✔', 'Passed'],
  fail: ['bad', '✖', 'Failed'],
  outdated: ['warn', '⟲', 'Evidence is from a different version of the code'],
  never_run: ['unk', '?', 'Never run'],
  supported: ['ok', '✔', 'Supported by captured test'],
  contradicted: ['bad', '✖', 'Contradicted by captured test'],
  unexamined: ['unk', '?', 'Unexamined'],
  pending: ['warn', '●', 'Needs your decision'],
  current: ['ok', '✔', 'Decided, still valid'],
  stale: ['bad', '⟲', 'Decision is stale: something you reviewed has changed'],
  revoked: ['unk', '⊘', 'Revoked'],
  inferred: ['unk', '~', 'Inferred by agent'],
  hypothesized: ['unk', '?', 'Hypothesis'],
  unknown: ['unk', '?', 'Unknown'],
};
const badge = (s) => {
  const [cls, icon, label] = BADGES[s] ?? ['unk', '?', s];
  return `<span class="badge ${cls}"><span aria-hidden="true">${icon}</span> ${esc(label)}</span>`;
};

export function renderReport(ctx, state) {
  const a = ctx.data;
  const byId = Object.fromEntries(a.nodes.map((n) => [n.id, n]));
  const nodes = (t) => a.nodes.filter((n) => n.type === t);
  const title = (id) => esc(byId[id]?.title ?? id);
  const edgesOf = (id) => a.edges.filter((e) => e.from === id || e.to === id);
  const claimsAbout = (id) => (a.claims ?? []).filter((c) => c.about.includes(id));

  const pendingDecisions = a.decisions.filter((d) => state.decisions[d.id].status !== 'current');
  const contradicted = nodes('assumption').filter((n) => state.assumptions[n.id].status === 'contradicted');
  const counts = (st) => nodes('behavior').filter((n) => state.behaviors[n.id].status === st).length;

  const evidenceBlock = (c) => {
    const s = state.checks[c.id];
    const e = s.current ?? s.latest;
    return `<div class="evidence">
      <p>${badge(s.status)} <strong>Check:</strong> ${esc(c.description)}</p>
      ${e ? `<p class="meta">Captured by Forkfall at ${esc(e.capturedAt)} · exit code ${esc(e.exitCode)} · commit ${esc((e.commit ?? 'none').slice(0, 10))}${e.dirty ? ' (with uncommitted changes)' : ''} · code digest ${esc(e.subjectDigest.slice(0, 12))}</p>
      <details><summary>Command output (last lines)</summary><pre>${esc(e.outputTail)}</pre></details>` : '<p class="meta">No captured evidence yet.</p>'}
    </div>`;
  };

  const claimBlock = (id) => claimsAbout(id).map((c) =>
    `<p class="claim"><span class="badge unk">Agent statement — not evidence</span> ${esc(c.statement)}</p>`).join('');

  const relations = (id) => {
    const es = edgesOf(id);
    if (!es.length) return '';
    return `<details><summary>Why this is connected (${es.length})</summary><ul>${es.map((e) =>
      `<li>${title(e.from)} <em>${esc(e.relation.replace('_', ' '))}</em> ${title(e.to)} — ${esc(e.rationale)} ${badge(e.epistemic)}</li>`).join('')}</ul></details>`;
  };

  const decisionCard = (d) => {
    const st = state.decisions[d.id];
    const hist = st.history.map((h) =>
      `<li>${esc(h.at)} — <strong>${esc(h.action)}</strong>${h.option ? ` “${esc(d.options.find((o) => o.id === h.option)?.label ?? h.option)}”` : ''} by ${esc(h.by)} (${esc(h.attribution)})${h.note ? `: ${esc(h.note)}` : ''}${h.reviewBasisDigest === st.basis ? '' : ' <em>[made on a different basis]</em>'}</li>`).join('');
    return `<article class="card decision" id="${esc(d.id)}">
      <h3>${esc(d.question)} ${badge(st.status)}</h3>
      <ul class="options">${d.options.map((o) => `<li><strong>${esc(o.label)}</strong> <code>${esc(o.id)}</code><br>${esc(o.consequence)}</li>`).join('')}</ul>
      <p class="meta">${d.basis === 'analysis' ? 'Policy decision: stays valid while this analysis is unchanged.' : 'Covers the exact code, analysis and check results in this report. Any change makes it stale.'}</p>
      ${d.related?.length ? `<p class="meta">Related: ${d.related.map(title).join(', ')}</p>` : ''}
      <p class="meta">To decide: <code>forkfall decide ${esc(ctx.relFile)} ${esc(d.id)} &lt;option&gt; --by "your name"</code></p>
      ${hist ? `<details ${st.status === 'stale' ? 'open' : ''}><summary>History</summary><ul>${hist}</ul></details>` : ''}
    </article>`;
  };

  const behaviorCard = (n) => {
    const st = state.behaviors[n.id];
    const cs = a.checks.filter((c) => c.verifies.includes(n.id));
    return `<article class="card" id="${esc(n.id)}">
      <h3>${esc(n.title)} ${badge(st.status)}</h3>
      <p><strong>When</strong> ${esc(n.trigger)}, <strong>${esc(n.actor)}</strong> sees: ${esc(n.outcome)}</p>
      <p class="meta">Acceptance criteria:</p><ul>${n.acceptance.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${st.contradictedAssumptions.length ? `<p class="alert">${badge('contradicted')} Depends on a contradicted assumption: ${st.contradictedAssumptions.map(title).join(', ')}</p>` : ''}
      ${cs.length ? cs.map(evidenceBlock).join('') : `<p class="alert">${badge('not_verified')} No check exercises this behavior. Missing evidence.</p>`}
      ${claimBlock(n.id)}${relations(n.id)}
    </article>`;
  };

  const simpleCard = (n, extra) => `<article class="card" id="${esc(n.id)}">
      <h3>${esc(n.title)} ${extra}</h3>${n.description ? `<p>${esc(n.description)}</p>` : ''}
      ${n.type === 'consequence' ? `<p><strong>Who is affected:</strong> ${esc(n.affected)} · <strong>Severity:</strong> ${esc(n.severity)} · <strong>Reversibility:</strong> ${esc(n.reversibility)}</p>` : ''}
      ${n.type === 'assumption' ? `<p><strong>How it could be proven wrong:</strong> ${esc(n.refutation)}</p>${n.check ? evidenceBlock(a.checks.find((c) => c.id === n.check.id)) : ''}` : ''}
      ${n.type === 'question' ? `<p><strong>Who answers:</strong> ${esc(n.owner)}</p>` : ''}
      ${claimBlock(n.id)}${relations(n.id)}
    </article>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forkfall — ${esc(a.subject.title)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem 1.5rem;color:#1b1b1b;background:#fafafa}
h1{margin-bottom:.2rem}h2{margin-top:2rem;border-bottom:2px solid #ddd}
.card{background:#fff;border:1px solid #ccc;border-left:6px solid #888;border-radius:6px;padding:.6rem 1rem;margin:.8rem 0}
.decision{border-left-color:#b36b00}.meta{color:#555;font-size:.9em}
.badge{display:inline-block;font-size:.8em;font-weight:600;padding:.05rem .5rem;border-radius:1rem;border:2px solid;white-space:nowrap}
.ok{color:#0b6b2e;border-color:#0b6b2e}.bad{color:#a4161a;border-color:#a4161a;border-style:double;border-width:3px}
.warn{color:#8a5300;border-color:#8a5300}.unk{color:#444;border-color:#777;border-style:dashed}
.alert{background:#fff4f4;padding:.3rem .6rem;border-radius:4px}.claim{background:#f3f3f3;padding:.3rem .6rem;border-radius:4px}
.evidence{border-top:1px dashed #ccc;margin-top:.5rem}pre{white-space:pre-wrap;max-height:20rem;overflow:auto;background:#222;color:#eee;padding:.5rem}
.summary{display:flex;gap:1rem;flex-wrap:wrap}.summary div{background:#fff;border:1px solid #ccc;border-radius:6px;padding:.5rem 1rem}
a:focus,summary:focus{outline:3px solid #1a5fb4}
</style></head><body>
<header>
<h1>${esc(a.subject.title)}</h1>
<p><strong>Goal:</strong> ${esc(a.subject.objective)}</p>
<p class="meta">Analysis by ${esc(a.producer.agent)}${a.producer.model ? ` (${esc(a.producer.model)})` : ''} via ${esc(a.producer.adapter)} · code digest ${esc(state.subject.digest.slice(0, 12))} over ${state.subject.fileCount} files in ${a.scope.includedPaths.map(esc).join(', ')} · commit ${esc((state.commit ?? 'none').slice(0, 10))} · review basis ${esc(state.reviewBasisDigest.slice(0, 12))}</p>
</header>
<nav aria-label="Sections"><a href="#decide">Decisions</a> · <a href="#behaviors">Behaviors</a> · <a href="#consequences">Consequences</a> · <a href="#assumptions">Assumptions</a> · <a href="#questions">Questions</a> · <a href="#limits">Limits</a></nav>
<main>
<section aria-label="Summary" class="summary">
  <div><strong>${pendingDecisions.length}</strong> decision(s) need you</div>
  <div><strong>${counts('verified')}</strong> behavior(s) verified</div>
  <div><strong>${counts('failed')}</strong> failed</div>
  <div><strong>${counts('not_verified')}</strong> without evidence</div>
  <div><strong>${contradicted.length}</strong> contradicted assumption(s)</div>
</section>
${contradicted.length ? `<p class="alert">${badge('contradicted')} ${contradicted.map((n) => `<a href="#${esc(n.id)}">${esc(n.title)}</a>`).join(', ')}</p>` : ''}
<h2 id="decide">Decisions</h2>
${[...pendingDecisions, ...a.decisions.filter((d) => !pendingDecisions.includes(d))].map(decisionCard).join('')}
<h2 id="behaviors">Expected behaviors</h2>
${nodes('behavior').map(behaviorCard).join('')}
<h2 id="consequences">Possible consequences</h2>
<p class="meta">Possibilities, not facts, unless a captured check says otherwise.</p>
${nodes('consequence').map((n) => simpleCard(n, badge(n.epistemic))).join('')}
<h2 id="assumptions">Assumptions</h2>
${nodes('assumption').map((n) => simpleCard(n, badge(state.assumptions[n.id].status))).join('')}
<h2 id="questions">Open questions</h2>
${nodes('question').map((n) => simpleCard(n, badge(n.epistemic))).join('') || '<p>None.</p>'}
<h2 id="limits">Scope and limits</h2>
<ul>${a.scope.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}
<li>A passing check supports only the criteria it exercises, for the exact code digest shown.</li>
<li>Decisions are recorded locally without authentication.</li></ul>
</main></body></html>
`;
}
