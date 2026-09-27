// Checks exploration findings against a plan's expected changes (Agent-Diff style):
// every difference must be explained by a planned change, and every planned change should be seen.
//
// expected.json: { "changes": [{ "id", "screens": ["/cart"], "description" }], "unchanged": ["/"] }
import { matchesRoute } from './explore.js';

const API = 'https://api.typesafe.ai/v1/systemone';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NONE = 'none_of_the_planned_changes';

export function validateExpected(e) {
  const errs = [];
  if (!e || !Array.isArray(e.changes) || !e.changes.length) errs.push('expected.changes must be a non-empty array');
  for (const [i, c] of (e?.changes ?? []).entries()) {
    if (typeof c.id !== 'string' || !/^[\w.-]{1,64}$/.test(c.id)) errs.push(`changes[${i}].id must be a short identifier`);
    if (!Array.isArray(c.screens) || !c.screens.length) errs.push(`changes[${i}].screens must list at least one route`);
    if (typeof c.description !== 'string' || !c.description.trim()) errs.push(`changes[${i}].description is required`);
  }
  if (e?.unchanged !== undefined && !Array.isArray(e.unchanged)) errs.push('expected.unchanged must be an array of routes');
  return errs;
}

async function choose(apiKey, state, options) {
  const question = {
    type: 'choice',
    instructions: 'The same user steps were run on the version before and after a planned set of changes. Which planned change, if any, explains the difference between `new_version_only` and `previous_version_only` (or the problem seen) on this screen? Pick a planned change only if the difference is what that change describes.',
    criteria: { ...options, [NONE]: 'None of the planned changes explains this difference: it is something the plan did not ask for, or it contradicts what the plan says.' },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions: { which: question } }),
    });
    if (res.status === 429 || res.status === 529) { await sleep(500 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`TypeSafe API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const r = await res.json();
    return { choice: r.answers.which.choice, probabilities: r.answers.which.probabilities, confidence: r.answers.which.confidence, usage: r.usage };
  }
  throw new Error('TypeSafe API: still rate limited after retries');
}

// Annotates findings with `plan` and returns a summary stored as exploration.plan.
export async function checkAgainstPlan({ exploration, expected, apiKey, log = () => {} }) {
  const onScreen = (route) => expected.changes.filter((c) => c.screens.some((s) => matchesRoute(s, route)));
  const mustStay = (route) => (expected.unchanged ?? []).some((s) => matchesRoute(s, route));
  const usage = { requests: 0, input_tokens: 0, output_tokens: 0 };
  const relevant = exploration.findings.filter((f) => !f.preexisting && f.severity >= 1);

  await Promise.all(relevant.map(async (f) => {
    // A screen can be partly in the plan (e.g. "the product page, except the quantity limit, must not
    // change"): when any planned change touches it, let the judge decide; "unchanged" only settles
    // screens no planned change touches.
    const candidates = onScreen(f.route);
    if (!candidates.length) {
      f.plan = { status: 'unexpected', reason: mustStay(f.route) ? 'screen the plan says must not change' : 'screen not touched by any planned change' };
      return;
    }
    if (!apiKey) {
      f.plan = { status: 'planned-screen', changes: candidates.map((c) => c.id), reason: 'on a screen the plan changes; not judged (no TYPESAFE_API_KEY)' };
      return;
    }
    try {
      const r = await choose(apiKey, {
        screen: f.route,
        steps: f.repro.map((s) => s.text),
        problem_seen: ['output-differs', 'navigation-differs'].includes(f.type) ? null : f.detail,
        new_version_screen: (f.screen ?? []).slice(0, 120),
        new_version_only: f.added ?? [],
        previous_version_only: f.removed ?? [],
      }, Object.fromEntries(candidates.map((c) => [c.id, c.description])));
      usage.requests++;
      usage.input_tokens += r.usage?.input_tokens ?? 0;
      usage.output_tokens += r.usage?.output_tokens ?? 0;
      f.plan = r.choice === NONE
        ? { status: 'unexpected', reason: 'on a planned screen, but no planned change explains it', probabilities: r.probabilities }
        : { status: 'expected', change: r.choice, confidence: r.confidence, probabilities: r.probabilities };
    } catch (e) {
      f.plan = { status: 'planned-screen', changes: candidates.map((c) => c.id), reason: `not judged: ${e.message}` };
      log(`plan check failed for ${f.id}: ${e.message}`);
    }
  }));

  const changes = expected.changes.map((c) => {
    const seen = relevant.filter((f) => f.plan?.status === 'expected' && f.plan.change === c.id);
    const onlyScreen = relevant.filter((f) => f.plan?.status === 'planned-screen' && f.plan.changes.includes(c.id));
    return { id: c.id, description: c.description, screens: c.screens, seen: seen.map((f) => f.id), status: seen.length ? 'seen' : onlyScreen.length ? 'maybe' : 'not-seen' };
  });
  return {
    changes,
    unexpected: relevant.filter((f) => f.plan?.status === 'unexpected').map((f) => f.id),
    usage,
  };
}
