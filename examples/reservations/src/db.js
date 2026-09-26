// In-memory stand-in for a database. Every call is async and yields to the event loop,
// like a real database round trip, so concurrent requests can interleave.
const roundTrip = () => new Promise((resolve) => setImmediate(resolve));

export class Db {
  #members = new Map();
  #sessions = new Map();
  #bookings = [];
  #waitlists = new Map();
  #nextId = 1;

  async insertMember(member) { await roundTrip(); this.#members.set(member.id, { ...member }); }
  async getMember(id) { await roundTrip(); const m = this.#members.get(id); return m && { ...m }; }

  async insertSession(session) { await roundTrip(); this.#sessions.set(session.id, { ...session }); this.#waitlists.set(session.id, []); }
  async getSession(id) { await roundTrip(); const s = this.#sessions.get(id); return s && { ...s }; }

  async insertBooking(sessionId, memberId) {
    await roundTrip();
    const booking = { id: `b${this.#nextId++}`, sessionId, memberId, status: 'active' };
    this.#bookings.push(booking);
    return { ...booking };
  }
  async findBookings(where) {
    await roundTrip();
    return this.#bookings.filter((b) => Object.entries(where).every(([k, v]) => b[k] === v)).map((b) => ({ ...b }));
  }
  async updateBooking(id, fields) {
    await roundTrip();
    const b = this.#bookings.find((x) => x.id === id);
    if (b) Object.assign(b, fields);
  }

  async getWaitlist(sessionId) { await roundTrip(); return [...(this.#waitlists.get(sessionId) ?? [])]; }
  async setWaitlist(sessionId, memberIds) { await roundTrip(); this.#waitlists.set(sessionId, [...memberIds]); }
}
