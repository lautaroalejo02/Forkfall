import { initialize, request } from './lib/api.js';
import { money } from './lib/money.js';
import { configureQuantity } from './lib/quantity.js';
import { escape, status } from './lib/ui.js';
try {
  await initialize();
  const id = new URLSearchParams(location.search).get('id');
  const product = await request(`/api/products/${encodeURIComponent(id)}`);
  document.querySelector('#product').innerHTML = `<div class="art" aria-hidden="true">${product.icon}</div><h1>${escape(product.name)}</h1><p>${escape(product.description)}</p><p><strong>${money(product.price)}</strong> · ${product.stock} available per order</p><form id="add"><label for="quantity">Quantity</label><input id="quantity" name="quantity" type="number" required><div class="actions"><button>Add to cart</button><a href="/cart">View cart</a></div></form>`;
  const quantity = document.querySelector('#quantity');
  configureQuantity(quantity, 1, product);
  document.querySelector('#add').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try { await request('/api/cart/items', 'POST', { productId: product.id, quantity: Number(quantity.value) }); status('Added to your cart.'); }
    catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  });
} catch (error) { status(error.message, true); }
