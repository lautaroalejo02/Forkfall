import { FakeClock } from './clock.js';
import { Db } from './db.js';
import { Notifier } from './notifier.js';
import { createReservations } from './reservations.js';

export function createApp({ clock = new FakeClock(0) } = {}) {
  const db = new Db();
  const notifier = new Notifier();
  return { clock, db, notifier, reservations: createReservations({ db, clock, notifier }) };
}
