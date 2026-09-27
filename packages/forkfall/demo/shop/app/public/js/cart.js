import { initialize, request } from './lib/api.js';
import { money } from './lib/money.js';
import { configureQuantity } from './lib/quantity.js';
import { escape, totals, status } from './lib/ui.js';
function render(cart) {
  const container = document.querySelector('#cart');
  if (!cart.items.length) { container.innerHTML = '<p>Your cart is empty.</p><a class="button" href="/">Browse products</a>'; return; }
  container.innerHTML = `<div class="panel">${cart.items.map(item => `<div class="row"><div><h2><a href="/product?id=${item.id}">${escape(item.name)}</a></h2><span>${money(item.price)} each</span></div><form data-product="${item.id}"><label for="qty-${item.id}">Quantity for ${escape(item.name)}</label><div class="actions"><input type="number" id="qty-${item.id}" required><button>Update</button><button type="button" class="secondary" data-remove="${item.id}">Remove</button></div></form><strong>${money(item.total)}</strong></div>`).join('')}<form id="coupon"><label for="code">Coupon code</label><div class="actions"><input id="code" placeholder="Try SAVE10" value="${escape(cart.coupon)}"><button>Apply coupon</button></div><p class="muted">SAVE10 takes 10% off. Apply an empty code to remove it.</p></form>${totals(cart)}<a class="button" href="/checkout">Checkout</a></div>`;
  for (const item of cart.items) {
    const input = document.querySelector(`#qty-${item.id}`);
    configureQuantity(input, item.quantity, item);
    input.form.addEventListener('submit', async event => {
      event.preventDefault();
      await mutate('/api/cart/items', 'PATCH', { productId: item.id, quantity: Number(input.value) }, 'Quantity updated.');
    });
  }
  for (const button of container.querySelectorAll('[data-remove]')) button.addEventListener('click', () => mutate(`/api/cart/items/${button.dataset.remove}`, 'DELETE', undefined, 'Item removed.'));
  document.querySelector('#coupon').addEventListener('submit', async event => {
    event.preventDefault();
    await mutate('/api/cart/coupon', 'POST', { code: document.querySelector('#code').value }, 'Coupon updated.');
  });
}
async function mutate(path, method, body, message) {
  try { render(await request(path, method, body)); status(message); } catch (error) { status(error.message, true); }
}
try { await initialize(); render(await request('/api/cart')); } catch (error) { status(error.message, true); }
