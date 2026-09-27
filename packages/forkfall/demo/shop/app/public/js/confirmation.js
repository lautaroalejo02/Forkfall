import { initialize, request } from './lib/api.js';
import { orderCard, status } from './lib/ui.js';
try {
  await initialize();
  const id = new URLSearchParams(location.search).get('id');
  document.querySelector('#order').innerHTML = orderCard(await request(`/api/orders/${encodeURIComponent(id)}`));
} catch (error) { status(error.message, true); }
