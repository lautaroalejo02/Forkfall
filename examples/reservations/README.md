# Reservations example

Fixture B for evaluating Forkfall. Members book spots in a class; when it is full they join a waitlist.
There is no cancellation yet: that is the change under evaluation.

- `src/db.js`: in-memory database; every call is async, like a real round trip.
- `src/reservations.js`: booking, waitlist and eligibility rules.
- `src/notifier.js`: records notifications instead of sending them.
- `src/clock.js`: fake clock.

Run `npm test` with Node.js 22; no dependencies.
