# Forkfall

**See what your change breaks two screens away.**

![Side by side: the previous version shows quantity 2 and $48; the new version shows quantity 8 and $24](https://raw.githubusercontent.com/lautaroalejo02/Forkfall/main/docs/replay.gif)

Forkfall runs the old and the new version of your web app side by side, clicks through both the same way, and shows what changed: errors, failed requests, screens that now show something different, and, when you started from a plan, everything that changed **without being in the plan**. Every finding comes with the steps to reproduce it and a side-by-side replay.

```sh
npx forkfall demo
```

- **[`packages/forkfall`](packages/forkfall/README.md)**: the CLI (`demo`, `init`, `doctor`, `impact`, `explore`, `judge`) and how to use it on your project.
- **[`skills/consequences`](skills/consequences/SKILL.md)**: the Claude Code plugin skill that drives the whole loop from a prompt like *"analyze the consequences of this change"*.
- **[`archive/`](archive/README.md)**: the first prototype (approve changes without reading code) and what it taught us.

Status: early. Tested on a bundled shop with a planted bug, on a real Next.js app with Neon database branches, and on a four-change plan with a hidden out-of-plan regression. MIT licensed.
