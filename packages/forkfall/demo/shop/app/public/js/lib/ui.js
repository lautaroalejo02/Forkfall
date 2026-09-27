import { money } from './money.js';
export const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function status(message = '', error = false) {
  const element = document.querySelector('#status');
  element.textContent = message;
  element.className = error ? 'error' : '';
}
export function totals(summary) {
  return `<div class="totals"><div><span>Subtotal</span><span>${money(summary.subtotal)}</span></div><div><span>Discount${summary.coupon ? ` (${escape(summary.coupon)})` : ''}</span><span>−${money(summary.discount)}</span></div><div class="grand"><span>Total</span><span>${money(summary.total)}</span></div></div>`;
}
export function orderCard(order) {
  return `<article class="panel order"><h2>Order #${escape(order.id)}</h2><p class="muted">${escape(new Date(order.createdAt).toLocaleString())}</p><p>${escape(order.customer.name)} · ${escape(order.customer.email)}</p><p>Ship to: ${escape(order.customer.address)}</p>${order.items.map(item => `<div class="row"><span>${escape(item.name)} × ${item.quantity}</span><span>${money(item.total)}</span></div>`).join('')}${totals(order)}</article>`;
}
