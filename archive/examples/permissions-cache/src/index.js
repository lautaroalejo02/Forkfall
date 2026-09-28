import { FakeClock } from './clock.js';
import { PermissionStore } from './store.js';
import { cacheConfig } from './config.js';
import { createPermissionChecker } from './checker.js';

export function createApp({ clock = new FakeClock() } = {}) {
  const store = new PermissionStore();
  const checker = createPermissionChecker({ store, clock, ...cacheConfig });
  return { store, clock, checker };
}
