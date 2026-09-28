import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';

test('revoked permission is denied immediately, even within cache TTL', () => {
  const { store, clock, checker } = createApp();
  store.grant('A', '1', 'read');
  assert.equal(checker.can('A', '1', 'read'), true);

  store.revoke('A', '1', 'read');
  clock.advance(1000);
  assert.equal(checker.can('A', '1', 'read'), false);
});
