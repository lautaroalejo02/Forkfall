import { initialize, request } from './lib/api.js';
import { totals, status } from './lib/ui.js';
try {
  await initialize();
  const cart = await request('/api/cart');
  document.querySelector('#summary').innerHTML = totals(cart);
  if (!cart.items.length) { status('Your cart is empty. Add a product before checking out.', true); document.querySelector('#place').disabled = true; }
  document.querySelector('#checkout').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#place');
    const body = Object.fromEntries(new FormData(event.target));
    if (Object.values(body).some(value => !value.trim())) return status('Please complete every field.', true);
    button.disabled = true;
    try {
      const order = await request('/api/orders', 'POST', body);
      location.href = `/confirmation?id=${encodeURIComponent(order.id)}`;
    } catch (error) { status(error.message, true); button.disabled = false; }
  });
} catch (error) { status(error.message, true); }
