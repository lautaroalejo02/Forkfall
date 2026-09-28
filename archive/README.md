# Archive: the first Forkfall prototype

Before Forkfall became a change explorer, it was a tool for approving a change **without reading code**: an agent wrote an `analysis.json` describing behaviors, assumptions and consequences; Forkfall captured real test evidence, rendered a report, recorded human decisions and made approvals go stale when anything they covered changed.

It still works (`forkfall validate | verify | report | decide | revoke | status`) and this folder keeps its two fixtures:

- `demo/permissions-cache`: a permission cache that keeps revoked users in for 5 minutes. Run `node archive/demo/permissions-cache/run-demo.mjs`.
- `demo/reservations` + `examples/reservations`: a waitlist feature used to evaluate whether the report helped a person decide.

What we learned: a strong coding agent got the code right without it, but it silently made product decisions nobody asked it about. The current tool keeps the best part of that prototype, the strict line between what was observed and what was only claimed, and points it at the question people actually have: *what did this change break?*
