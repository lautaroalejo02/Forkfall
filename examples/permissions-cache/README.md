# Permissions cache example
Run `npm test` here with Node.js 22; no dependencies are required.
`package.json` enables ESM; `npm test` runs every `*.test.js` file.
`src/clock.js` provides a fake clock with explicit time advancement.
`src/store.js` stores grants, counts queries, and notifies revoke listeners.
`src/config.js` sets a five-minute TTL and disables revoke invalidation.
`src/checker.js` caches tuple-keyed decisions and optionally invalidates revokes.
`src/index.js` wires the real configuration into `createApp()`.
`test/cache.test.js` checks TTL behavior; `test/isolation.test.js` checks isolation.
`test/revocation.test.js` intentionally fails with the baseline; enabling invalidation makes it pass.
