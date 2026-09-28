export class PermissionStore {
  #permissions = new Set();
  #listeners = new Set();
  #queryCount = 0;

  grant(orgId, userId, perm) {
    this.#permissions.add(JSON.stringify([orgId, userId, perm]));
  }

  revoke(orgId, userId, perm) {
    this.#permissions.delete(JSON.stringify([orgId, userId, perm]));
    for (const listener of this.#listeners) {
      listener({ orgId, userId, perm });
    }
  }

  has(orgId, userId, perm) {
    this.#queryCount += 1;
    return this.#permissions.has(JSON.stringify([orgId, userId, perm]));
  }

  get queryCount() {
    return this.#queryCount;
  }

  subscribe(fn) {
    this.#listeners.add(fn);
  }
}
