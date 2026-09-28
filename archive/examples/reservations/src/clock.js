export class FakeClock {
  #now;

  constructor(startMs = 0) {
    this.#now = startMs;
  }

  now() {
    return this.#now;
  }

  advance(ms) {
    this.#now += ms;
  }
}
