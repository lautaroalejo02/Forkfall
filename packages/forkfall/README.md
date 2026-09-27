# Forkfall

**See what your change breaks two screens away.**

Forkfall runs the old and the new version of your web app side by side, clicks through both the same way, and shows you what changed: errors, failed requests, and screens that now show something different. Each finding comes with the exact steps to reproduce it and a side-by-side replay.

It is built for changes written by coding agents: the agent says what it changed, Forkfall checks what actually changed.

## Try it (30 seconds, nothing to configure)

```sh
npx forkfall demo
```

A small shop ships a harmless-looking change ("remember product quantity selections"). Its tests pass. Forkfall finds the cart that shows 8 items and charges for 1, and opens the replay.

## Use it on your project

```sh
cd your-app
npx forkfall init       # detects how to start the app, writes forkfall.config.json
npx forkfall doctor     # checks Node, git, Chromium, ports, and that your database is safe
npx forkfall explore    # last commit vs the one before; opens a map of what changed
```

Compare anything git can name: `--base main --head my-branch`, or `--head WORKTREE` for uncommitted work.

**Your database.** Exploration clicks buttons and submits forms, so the app writes data. Forkfall starts each version in its own copy of the repo; give each copy its own disposable database (a local DB, database branches such as Neon's, or a demo mode) with `baselineEnv` / `candidateEnv` in `forkfall.config.json`. `doctor` and `explore` refuse to run two copies against a real remote database.

## From a plan

Write down what a set of changes should do before anyone implements it, then check the result against it:

```json
{ "changes": [ { "id": "shipping", "screens": ["/cart", "/checkout"], "description": "Orders under $50 show a $5.00 Shipping line." } ],
  "unchanged": ["/"] }
```

```sh
npx forkfall explore --base plan-base --head plan-impl --expect expected.json
```

The map opens with **Against the plan**: planned changes that were seen, planned changes nobody saw, and everything that changed **without being in the plan**.

## What you get

- **Impact**: the screens and API endpoints the change can reach, and the import chain that explains each one.
- **Exploration**: scenarios (written by you or your agent) plus guided random clicking, run on both versions and compared step by step. Noise such as clocks and live feeds is calibrated out.
- **Checks**: new JavaScript errors, failed requests, screens that differ, and rows whose numbers don't add up (quantity × unit price).
- **Judgment (optional)**: with a `TYPESAFE_API_KEY`, [Jev](https://typesafe.ai) ranks each difference: does the new screen contradict itself, is it explained by the change?
- **Replay**: `replay-*.html` plays both versions in lockstep and outlines what differs.

## With a coding agent

Forkfall ships a Claude Code plugin with a skill that drives the whole loop: read the change, write risky scenarios, explore, fix scenarios that got stuck, and report only what was seen.

```
/plugin marketplace add <this repo>
/plugin install forkfall@forkfall
```

Then ask: *"analyze the consequences of this change"*.

## Limits

- Web apps only, and the app must start from a command and listen on `PORT` (or `{port}` in the start command).
- It finds what exploration reaches. The map lists the affected screens that were never reached; it never claims "no bugs".
- Login flows need test users; there is no built-in support yet.
