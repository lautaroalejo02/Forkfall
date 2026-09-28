// Records notifications instead of sending them.
export class Notifier {
  sent = [];

  async notify(memberId, message) {
    this.sent.push({ memberId, message });
  }
}
