import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { HOUR } from '../src/reservations.js';

async function setup(capacity = 1) {
  const app = createApp();
  const r = app.reservations;
  for (const id of ['ana', 'ben', 'cam', 'dan']) {
    await r.addMember(id, { membershipExpiresAt: 100 * HOUR });
  }
  await r.addSession('yoga', { startsAt: 24 * HOUR, capacity });
  await r.book('yoga', 'ana');
  return { ...app, r };
}

test('cancels a booking, promotes the first eligible member and notifies once', async () => {
  const { r, db, notifier } = await setup();
  await r.book('yoga', 'ben');
  await r.book('yoga', 'cam');
  assert.deepEqual(await r.cancel('yoga', 'ana'), { ok: true, promoted: 'ben' });
  assert.deepEqual(await r.activeMembers('yoga'), ['ben']);
  assert.deepEqual(await r.waitlist('yoga'), ['cam']);
  const [booking] = await db.findBookings({ sessionId: 'yoga', memberId: 'ana' });
  assert.equal(booking.status, 'cancelled');
  assert.equal(notifier.sent.length, 1);
  assert.equal(notifier.sent[0].memberId, 'ben');
  assert.match(notifier.sent[0].message, /yoga/);
  assert.equal((await r.cancel('yoga', 'ana')).ok, false);
  assert.equal(notifier.sent.length, 1);
});

for (const elapsed of [22 * HOUR - 1, 22 * HOUR]) {
  test(`allows cancellation at ${elapsed}ms, including the exact deadline`, async () => {
    const { r, clock, notifier } = await setup();
    clock.advance(elapsed);
    assert.deepEqual(await r.cancel('yoga', 'ana'), { ok: true, promoted: null });
    assert.deepEqual(await r.activeMembers('yoga'), []);
    assert.deepEqual(notifier.sent, []);
    assert.equal((await r.book('yoga', 'ana')).status, 'booked');
  });
}

for (const elapsed of [22 * HOUR + 1, 24 * HOUR, 25 * HOUR]) {
  test(`rejects cancellation after the deadline at ${elapsed}ms without changes`, async () => {
    const { r, clock, notifier } = await setup();
    await r.book('yoga', 'ben');
    clock.advance(elapsed);
    assert.deepEqual(await r.cancel('yoga', 'ana'), {
      ok: false, reason: 'cancellation deadline passed',
    });
    assert.deepEqual(await r.activeMembers('yoga'), ['ana']);
    assert.deepEqual(await r.waitlist('yoga'), ['ben']);
    assert.deepEqual(notifier.sent, []);
  });
}

test('rejects unknown sessions and members without reservations', async () => {
  const { r, notifier } = await setup();
  assert.deepEqual(await r.cancel('missing', 'ana'), { ok: false, reason: 'no such session' });
  for (const memberId of ['ben', 'missing']) {
    assert.deepEqual(await r.cancel('yoga', memberId), { ok: false, reason: 'no reservation' });
  }
  assert.deepEqual(await r.activeMembers('yoga'), ['ana']);
  assert.deepEqual(notifier.sent, []);
});

test('cancels waitlist membership without freeing a spot or notifying', async () => {
  const { r, notifier } = await setup();
  await r.book('yoga', 'ben');
  await r.book('yoga', 'cam');
  assert.deepEqual(await r.cancel('yoga', 'ben'), { ok: true, promoted: null });
  assert.deepEqual(await r.activeMembers('yoga'), ['ana']);
  assert.deepEqual(await r.waitlist('yoga'), ['cam']);
  assert.deepEqual(notifier.sent, []);
});

test('rechecks eligibility and skips missing, expired and already booked members', async () => {
  const { r, db, clock, notifier } = await setup(2);
  await r.book('yoga', 'dan');
  await r.addMember('ben', { membershipExpiresAt: HOUR });
  await db.setWaitlist('yoga', ['missing', 'ben', 'dan', 'cam']);
  clock.advance(HOUR);
  assert.deepEqual(await r.cancel('yoga', 'ana'), { ok: true, promoted: 'cam' });
  assert.deepEqual(await r.activeMembers('yoga'), ['dan', 'cam']);
  assert.deepEqual(await r.waitlist('yoga'), ['missing', 'ben', 'dan']);
  assert.deepEqual(notifier.sent.map((n) => n.memberId), ['cam']);
});

test('allows an expired member to cancel and leaves a vacancy if no one is eligible', async () => {
  const { r, notifier } = await setup();
  await r.book('yoga', 'ben');
  for (const id of ['ana', 'ben']) await r.addMember(id, { membershipExpiresAt: 0 });
  assert.deepEqual(await r.cancel('yoga', 'ana'), { ok: true, promoted: null });
  assert.deepEqual(await r.activeMembers('yoga'), []);
  assert.deepEqual(notifier.sent, []);
});

test('concurrent duplicate cancellations promote and notify only once', async () => {
  const { r, notifier } = await setup();
  await r.book('yoga', 'ben');
  await r.book('yoga', 'cam');
  const results = await Promise.all([r.cancel('yoga', 'ana'), r.cancel('yoga', 'ana')]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(await r.activeMembers('yoga'), ['ben']);
  assert.deepEqual(await r.waitlist('yoga'), ['cam']);
  assert.deepEqual(notifier.sent.map((n) => n.memberId), ['ben']);
});

test('concurrent cancellations promote different members in waitlist order', async () => {
  const { r, notifier } = await setup(2);
  await r.book('yoga', 'ben');
  await r.book('yoga', 'cam');
  await r.book('yoga', 'dan');
  assert.deepEqual(await Promise.all([r.cancel('yoga', 'ana'), r.cancel('yoga', 'ben')]), [
    { ok: true, promoted: 'cam' }, { ok: true, promoted: 'dan' },
  ]);
  assert.deepEqual(await r.activeMembers('yoga'), ['cam', 'dan']);
  assert.deepEqual(await r.waitlist('yoga'), []);
  assert.deepEqual(notifier.sent.map((n) => n.memberId), ['cam', 'dan']);
});

test('a concurrent new booking cannot take the spot freed for the waitlist', async () => {
  const { r, notifier } = await setup();
  await r.book('yoga', 'ben');
  assert.deepEqual(await Promise.all([r.cancel('yoga', 'ana'), r.book('yoga', 'cam')]), [
    { ok: true, promoted: 'ben' }, { status: 'waitlisted' },
  ]);
  assert.deepEqual(await r.activeMembers('yoga'), ['ben']);
  assert.deepEqual(await r.waitlist('yoga'), ['cam']);
  assert.deepEqual(notifier.sent.map((n) => n.memberId), ['ben']);
});
