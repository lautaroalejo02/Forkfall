import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';

test('permissions are isolated by organization, user, and permission', () => {
  const { store, checker } = createApp();
  store.grant('A', '1', 'read');

  assert.equal(checker.can('A', '1', 'read'), true);
  assert.equal(checker.can('B', '1', 'read'), false);
  assert.equal(checker.can('A', '2', 'read'), false);
  assert.equal(checker.can('A', '1', 'write'), false);
  assert.equal(store.queryCount, 4);
});

test('tuple keys avoid delimiter collisions', () => {
  const { store, checker } = createApp();
  store.grant('a:b', 'c', 'read');

  assert.equal(checker.can('a:b', 'c', 'read'), true);
  assert.equal(checker.can('a', 'b:c', 'read'), false);
  assert.equal(checker.can('a:b', 'c', 'read'), true);
  assert.equal(store.queryCount, 2);
});
