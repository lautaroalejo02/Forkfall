// Class reservations: members book a spot; when a session is full they join its waitlist.
export const HOUR = 60 * 60 * 1000;

export function createReservations({ db, clock, notifier }) {
  // A member may take a spot if their membership is valid now and they don't already
  // hold an active booking for the session.
  async function isEligible(sessionId, memberId) {
    const member = await db.getMember(memberId);
    if (!member || member.membershipExpiresAt <= clock.now()) return false;
    const existing = await db.findBookings({ sessionId, memberId, status: 'active' });
    return existing.length === 0;
  }

  return {
    isEligible,

    async addMember(id, { membershipExpiresAt }) {
      await db.insertMember({ id, membershipExpiresAt });
    },

    async addSession(id, { startsAt, capacity }) {
      await db.insertSession({ id, startsAt, capacity });
    },

    // Resolves to { status: 'booked' | 'waitlisted' | 'rejected', reason? }.
    async book(sessionId, memberId) {
      const session = await db.getSession(sessionId);
      if (!session) return { status: 'rejected', reason: 'no such session' };
      if (session.startsAt <= clock.now()) return { status: 'rejected', reason: 'session already started' };
      if (!(await isEligible(sessionId, memberId))) return { status: 'rejected', reason: 'not eligible' };
      const waitlist = await db.getWaitlist(sessionId);
      if (waitlist.includes(memberId)) return { status: 'rejected', reason: 'already waitlisted' };

      const active = await db.findBookings({ sessionId, status: 'active' });
      if (active.length < session.capacity) {
        await db.insertBooking(sessionId, memberId);
        return { status: 'booked' };
      }
      await db.setWaitlist(sessionId, [...waitlist, memberId]);
      return { status: 'waitlisted' };
    },

    async activeMembers(sessionId) {
      return (await db.findBookings({ sessionId, status: 'active' })).map((b) => b.memberId);
    },

    async waitlist(sessionId) {
      return db.getWaitlist(sessionId);
    },
  };
}
