import { randomUUID } from 'node:crypto';

export const products = [
  { id: 'mug', name: 'Everyday Mug', price: 1800, stock: 12, icon: '☕', description: 'A generous ceramic mug with a comfortable handle. Dishwasher safe.' },
  { id: 'notebook', name: 'Pocket Notebook', price: 950, stock: 20, icon: '📓', description: 'A stitched notebook with 80 dotted pages for ideas on the move.' },
  { id: 'tote', name: 'Market Tote', price: 2400, stock: 8, icon: '👜', description: 'A durable cotton tote with long handles and an inside pocket.' }
];
export const state = {};
export function reset() {
  state.session = randomUUID();
  state.cart = [];
  state.coupon = '';
  state.orders = [];
}
reset();
