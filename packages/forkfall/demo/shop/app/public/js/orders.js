import { initialize, request } from './lib/api.js';
import { escape, orderCard, status } from './lib/ui.js';
try {
  await initialize();
  const orders = await request('/api/orders');
  document.querySelector('#orders').innerHTML = orders.length ? orders.map(order => `${orderCard(order)}<a href="/confirmation?id=${escape(order.id)}">View confirmation #${escape(order.id)}</a>`).join('') : '<p>No orders yet.</p><a href="/">Explore the shop</a>';
} catch (error) { status(error.message, true); }
