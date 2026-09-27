---
name: consequences
description: Analyze the consequences of a code change in a web app. Use when the user asks what a change affects, what it could break, which screens or flows it touches, or asks to "analyze the consequences of this change" / "analizá las consecuencias de este cambio". Produces a navigable map with confirmed problems (with reproduction steps), behavior differences, and unexplored areas.
---

# Forkfall: consequences of a change

The CLI lives at `../../packages/forkfall/bin/forkfall.js` relative to this skill's base directory. Call it `FORKFALL` below and run it with `node`. It needs Node 22+.

First use: if `packages/forkfall/node_modules` is missing, run `npm install --omit=dev` there, then `npx playwright install chromium`. To show the user what the tool does before touching their project, run `node FORKFALL demo` (a bundled shop with a hidden cart bug; opens a side-by-side replay).

Project setup, once per repo: `node FORKFALL init <repo>` writes `forkfall.config.json` (start command, reset endpoint, per-version env files) and warns about real databases and paid APIs. `node FORKFALL doctor <repo>` must pass before exploring; it fails if both copies would share a real database. Help the user fix what it reports; never work around a database warning without asking.

## 0. Starting from a plan (before any code exists)

When the user has a plan or spec for a set of changes, turn it into an expected diff before anything is implemented, and check the implementation against it afterwards (anything that changed outside the plan is a failure):

```json
{ "changes": [ { "id": "shipping", "screens": ["/cart", "/checkout"], "description": "Orders under $50 show a $5.00 Shipping line; $50 or more ship free." } ],
  "unchanged": ["/", "/product"] }
```

Write concrete descriptions with example values, list every screen each change should affect, and list the screens the plan says must not change. After implementation run `explore ... --expect expected.json`: the map opens with "Against the plan" (planned changes seen / not seen, and what changed without being in the plan). Report unexpected changes first.

If the user gives a plan instead of a finished change, predict first and verify later:

1. Read the plan and the code; list the files the plan will most likely touch.
2. `node FORKFALL impact <repo> --files <comma-separated files>` shows the screens and APIs those files reach.
3. Write the risky scenarios now (step 2 below) and save them next to the plan. Optionally run them against the current app (`explore --candidate-url <running app>` without a baseline) to record today's behavior.
4. After the plan is implemented, run step 3 on the resulting commit with the same scenarios. Tell the user which predicted screens were really affected, which were not, and what showed up that the plan did not predict.

## 1. Find what the change can reach (static, safe)

Pick the change: the last commit by default (`--base HEAD~1 --head HEAD`), a branch (`--base main`), or uncommitted work (`--head WORKTREE`).

```sh
node FORKFALL impact <repo> --base <ref> [--head <ref>] --out /tmp/impact.json
```

Read the output: changed files and symbols, and the screens (`page`) and endpoints (`api`) reachable from them, each with the import chain that explains it. Then read the changed code itself.

## 2. Write targeted scenarios

Think like a tester who knows what changed. List 3–10 short user journeys (2–6 steps) that are most likely to expose a regression: sequences that cross the changed code from a *different* screen, reuse state across screens, edge values (0, negative, empty, very long, repeated submits, back-and-forth navigation). Write them to a JSON file, using the labels users see on screen:

```json
[
  { "name": "apply coupon then change quantity", "start": "/cart",
    "steps": [ { "fill": "Coupon code", "value": "SAVE10" }, { "click": "Apply" },
               { "fill": "Quantity", "value": "0" }, { "click": "Checkout" }, { "fillAll": true }, { "click": "Place order" } ] }
]
```

Reach the changed screen first. At least two scenarios must follow the normal, valid path all the way to the screen or state the change touches (valid prices, required fields filled, waiting for replies); only then try edge values or odd navigation *on that screen*. A scenario that starts with an invalid value usually never gets there, and tests nothing about the change.

Step forms: `{ "goto": "/path" }`, `{ "click": "visible label" }`, `{ "fill": "field label", "value": "..." }`, `{ "select": "field label", "value": "option value" }`, `{ "fillAll": true }` (fills every empty field with a valid value). Scenarios are hypotheses: the explorer runs them and reports what really happens.

## 3. Explore both versions

Exploration clicks and submits forms. **Never run it against production data or shared databases.** Before starting, check the app's env files; if they point at a real database or paid API, stop and ask the user for a safe setup (local database, a disposable branch, or a demo mode). Ask for the start command if it isn't obvious from `package.json`.

```sh
node FORKFALL explore <repo> --base <ref> --head <ref> --start "<command that honors $PORT>" \
  --scenarios scenarios.json [--reset-path /api/reset] [--env-file .env.local] \
  [--sequences 40] [--steps 8] [--minutes 5] --lang <user's language: es|en>
```

It checks out both versions into temporary worktrees, starts them, runs your scenarios and then generated sequences (biased toward the affected screens) on the new version, and replays each sequence on the old one. If the user already runs both versions, pass `--candidate-url` and `--baseline-url` instead of `--start`.

Optional: if `TYPESAFE_API_KEY` is set, every difference is judged by TypeSafe's Jev: is it explained by the change's intent (pass `--intent "..."` with the user's own words when you have them), and does the new screen contradict itself? Suspicious differences are listed first. `node FORKFALL judge <run-dir>` re-judges a finished run without exploring again.

Then read `exploration.json` → `scenarioGaps` and `trace`: each scenario that could not finish shows the step it stopped at. Fix those scenarios (a label that differs, a missing prerequisite step, a reply that takes longer) and run again. Don't report a screen as tested if no scenario reached it.

## 4. Report

Open the printed `map.html` path for the user and summarize in their language:

- **Confirmed problems**: only what the explorer saw happen in the new version and not in the old one. Give the reproduction steps exactly as listed.
- **Suspicious differences** (if Jev ran): lead with these; they are judgments, so say how confident and why they look wrong.
- **Behavior differences**: say which ones look intended given the change and which look suspicious, and why. You are judging; say so.
- **Not explored**: affected screens the exploration never reached. Never say "no bugs"; say what was covered.
- Suggest a follow-up scenario for anything suspicious and offer to run it.
