# Reservations example

Fixture B for evaluating Forkfall. Members book spots in a class; when it is full they join a waitlist.
Members can cancel bookings or waitlist entries until exactly two hours before a session starts.
`cancel(sessionId, memberId)` resolves to `{ ok, reason?, promoted? }`. Successful cancellations
return the promoted member ID, or `null` if nobody was promoted. A freed spot goes to the first
currently eligible waitlisted member, who receives one notification. Other waitlist entries
retain their order. Booking and cancellation changes are serialized per session within each
reservations instance.

- `src/db.js`: in-memory database; every call is async, like a real round trip.
- `src/reservations.js`: booking, waitlist and eligibility rules.
- `src/notifier.js`: records notifications instead of sending them.
- `src/clock.js`: fake clock.

Run `npm test` with Node.js 22; no dependencies.
