import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { cacheConfig } from '../src/config.js';

test('repeated checks use the cache until the TTL expires', () => {
  const { store, clock, checker } = createApp();
  store.grant('A', '1', 'read');

  assert.equal(checker.can('A', '1', 'read'), true);
  assert.equal(checker.can('A', '1', 'read'), true);
  clock.advance(cacheConfig.ttlMs - 1);
  assert.equal(checker.can('A', '1', 'read'), true);
  assert.equal(store.queryCount, 1);

  clock.advance(1);
  assert.equal(checker.can('A', '1', 'read'), true);
  assert.equal(store.queryCount, 2);
});

test('denied results are also cached until the TTL expires', () => {
  const { store, clock, checker } = createApp();
  assert.equal(checker.can('A', '1', 'read'), false);
  assert.equal(checker.can('A', '1', 'read'), false);
  assert.equal(store.queryCount, 1);

  clock.advance(cacheConfig.ttlMs);
  assert.equal(checker.can('A', '1', 'read'), false);
  assert.equal(store.queryCount, 2);
});
