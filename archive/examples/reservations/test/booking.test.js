import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { HOUR } from '../src/reservations.js';

async function setup(capacity = 1) {
  const app = createApp();
  const r = app.reservations;
  for (const id of ['ana', 'ben', 'cam']) await r.addMember(id, { membershipExpiresAt: 100 * HOUR });
  await r.addSession('yoga', { startsAt: 24 * HOUR, capacity });
  return { app, r };
}

test('books until full, then waitlists in order', async () => {
  const { r } = await setup(1);
  assert.equal((await r.book('yoga', 'ana')).status, 'booked');
  assert.equal((await r.book('yoga', 'ben')).status, 'waitlisted');
  assert.equal((await r.book('yoga', 'cam')).status, 'waitlisted');
  assert.deepEqual(await r.activeMembers('yoga'), ['ana']);
  assert.deepEqual(await r.waitlist('yoga'), ['ben', 'cam']);
});

test('rejects expired members, duplicates and started sessions', async () => {
  const { app, r } = await setup(2);
  await r.addMember('old', { membershipExpiresAt: 1 });
  app.clock.advance(2);
  assert.equal((await r.book('yoga', 'old')).status, 'rejected');
  await r.book('yoga', 'ana');
  assert.equal((await r.book('yoga', 'ana')).status, 'rejected');
  app.clock.advance(24 * HOUR);
  assert.equal((await r.book('yoga', 'ben')).status, 'rejected');
});
