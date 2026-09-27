import { initialize, request } from './lib/api.js';
import { money } from './lib/money.js';
import { escape, status } from './lib/ui.js';
try {
  await initialize();
  const products = await request('/api/products');
  const render = () => {
    const sorted = [...products];
    if (document.querySelector('#sort').value === 'price') sorted.sort((a, b) => a.price - b.price);
    document.querySelector('#products').innerHTML = sorted.map(product => `<article class="card"><div class="art" aria-hidden="true">${product.icon}</div><h2>${escape(product.name)}</h2><p>${escape(product.description)}</p><p><strong>${money(product.price)}</strong></p><a class="button" href="/product?id=${product.id}">View ${escape(product.name)}</a></article>`).join('');
  };
  document.querySelector('#sort').addEventListener('change', render);
  render();
} catch (error) { status(error.message, true); }
