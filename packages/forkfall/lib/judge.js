// Optional judgment of exploration findings with TypeSafe's Jev (a System One model).
// The explorer observes; Jev judges whether a difference is explained by the change's intent
// and whether the new screen contradicts itself. Judgments are shown as judgments, never as facts.
const API = 'https://api.typesafe.ai/v1/systemone';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUESTIONS = {
  explained: {
    type: 'noul',
    instructions: 'The same user steps were run on the previous and the new version of a web app. Is the difference between what the two versions show (`new_version_only` versus `previous_version_only`) a direct, expected result of what the change is meant to do, as described in `change.intent`?',
    criteria: {
      true: 'A user who asked for this change would expect exactly this difference after these steps.',
      false: 'The difference goes beyond or against the stated intent, affects something the intent does not mention, or would surprise the person who asked for the change.',
    },
  },
  inconsistent: {
    type: 'noul',
    instructions: 'Look only at `new_version_screen`, the full text and form-field values the new version shows after the last step. Does this screen contradict itself? Form fields appear as lines like "[field] Label: value".',
    criteria: {
      true: 'Two things on the same screen disagree, e.g. a quantity field that does not match the line total or subtotal for the listed price, a count that does not match the items shown, or a status that contradicts another value.',
      false: 'Everything on the screen is mutually consistent, even if it differs from the previous version.',
    },
  },
};

async function ask(apiKey, state, questions) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
    });
    if (res.status === 429 || res.status === 529) { await sleep(500 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`TypeSafe API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error('TypeSafe API: still rate limited after retries');
}

// Annotates findings in place with `judgment` and returns token usage.
export async function judgeFindings({ exploration, impact, intent, apiKey, log = () => {} }) {
  const usage = { requests: 0, input_tokens: 0, output_tokens: 0 };
  const change = {
    intent: intent ?? impact.message,
    changed_files: impact.changed.map((c) => `${c.file}${c.symbols.length ? ` (${c.symbols.join(', ')})` : ''}`),
  };
  const targets = exploration.findings.filter((f) => !f.preexisting && f.severity >= 1);
  await Promise.all(targets.map(async (f) => {
    const state = {
      change,
      screen: f.route,
      steps: f.repro.map((s) => s.text),
      problem_seen: f.type === 'output-differs' || f.type === 'navigation-differs' ? null : f.detail,
      new_version_only: f.added ?? [],
      previous_version_only: f.removed ?? [],
      new_version_screen: (f.screen ?? []).slice(0, 120),
    };
    try {
      const r = await ask(apiKey, state, QUESTIONS);
      usage.requests++;
      usage.input_tokens += r.usage?.input_tokens ?? 0;
      usage.output_tokens += r.usage?.output_tokens ?? 0;
      const explained = r.answers.explained.noul;
      const inconsistent = r.answers.inconsistent.noul;
      f.judgment = {
        model: r.model,
        explainedByIntent: explained,
        screenInconsistent: inconsistent,
        verdict: inconsistent >= 0.5 || explained < 0.5 ? 'suspicious' : 'likely-intended',
      };
    } catch (e) {
      f.judgment = { error: e.message };
      log(`judge failed for ${f.id}: ${e.message}`);
    }
  }));
  return usage;
}
