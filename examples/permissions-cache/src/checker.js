export function createPermissionChecker({ store, clock, ttlMs, invalidateOnRevoke }) {
  const cache = new Map();
  const keyFor = (orgId, userId, perm) => JSON.stringify([orgId, userId, perm]);

  if (invalidateOnRevoke) {
    store.subscribe(({ orgId, userId, perm }) => {
      cache.delete(keyFor(orgId, userId, perm));
    });
  }

  return {
    can(orgId, userId, perm) {
      const key = keyFor(orgId, userId, perm);
      const now = clock.now();
      const entry = cache.get(key);
      if (entry && now < entry.expiresAt) {
        return entry.allowed;
      }

      const allowed = store.has(orgId, userId, perm);
      cache.set(key, { allowed, expiresAt: now + ttlMs });
      return allowed;
    },
  };
}
