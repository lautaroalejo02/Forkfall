import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';

const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const timeout = setTimeout(() => { child.kill(); throw new Error('Smoke test timed out: ' + stderr); }, 15000);
try {
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/port (\d+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Server exited ${code}: ${stderr}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  async function api(path, method = 'GET', body, expected = 200) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, expected, `${method} ${path}`);
    return response.json();
  }
  for (const page of ['/', '/product?id=mug', '/cart', '/checkout', '/confirmation?id=1', '/orders']) {
    const response = await fetch(base + page);
    assert.equal(response.status, 200, page);
    assert.match(await response.text(), /<script type="module"/);
  }
  for (const file of await readdir('public', { recursive: true })) {
    if (!/\.(css|js)$/.test(file)) continue;
    assert.equal((await fetch(base + '/' + file.replaceAll('\\', '/'))).status, 200, file);
  }
  const initial = await api('/api/session');
  assert.equal((await api('/api/products')).length, 3);
  assert.equal((await api('/api/products/mug')).price, 1800);
  await api('/api/products/missing', 'GET', undefined, 404);
  await api('/api/cart/items', 'POST', { productId: 'mug', quantity: 0 }, 400);
  await api('/api/cart/items', 'POST', { productId: 'mug', quantity: 99 }, 400);
  await api('/api/cart/items', 'POST', { productId: 'mug', quantity: 2 });
  await api('/api/cart/items', 'POST', { productId: 'notebook', quantity: 1 });
  await api('/api/cart/items', 'PATCH', { productId: 'mug', quantity: 3 });
  await api('/api/cart/items/notebook', 'DELETE');
  await api('/api/cart/coupon', 'POST', { code: 'invalid' }, 400);
  const cart = await api('/api/cart/coupon', 'POST', { code: ' save10 ' });
  assert.equal(cart.items[0].quantity, 3);
  assert.equal(cart.subtotal, 5400);
  assert.equal(cart.discount, 540);
  assert.equal(cart.total, 4860);
  await api('/api/orders', 'POST', { name: '', email: 'bad', address: '' }, 400);
  await api('/api/orders', 'POST', { name: 'Test Buyer', email: 'bad', address: '10 Main Street' }, 400);
  const order = await api('/api/orders', 'POST', { name: 'Test Buyer', email: 'buyer@example.test', address: '10 Main Street' }, 201);
  assert.equal(order.total, 4860);
  assert.equal((await api('/api/cart')).items.length, 0);
  assert.equal((await api('/api/orders')).length, 1);
  assert.deepEqual(await api(`/api/orders/${order.id}`), order);
  await api('/api/orders', 'POST', { name: 'Test Buyer', email: 'buyer@example.test', address: '10 Main Street' }, 400);
  await api('/__reset', 'POST');
  assert.equal((await api('/api/orders')).length, 0);
  assert.equal((await api('/api/cart')).total, 0);
  assert.notEqual((await api('/api/session')).id, initial.id);
  console.log('Smoke passed: six pages, static modules, catalog, cart, coupon, validation, checkout, history, reset.');
} finally {
  clearTimeout(timeout);
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
