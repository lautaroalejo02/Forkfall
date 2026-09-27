import { products, state, reset } from './store.js';
import { cartSummary } from './pricing.js';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16000) fail('Request too large.', 413);
  }
  try { return JSON.parse(body || '{}'); } catch { fail('Invalid JSON.'); }
}
export async function api(req, res, path) {
  const send = (value, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.method === 'POST' && path === '/__reset') { reset(); return send({ ok: true }); }
    if (req.method === 'GET' && path === '/api/session') return send({ id: state.session });
    if (req.method === 'GET' && path === '/api/products') return send(products);
    if (req.method === 'GET' && path.startsWith('/api/products/')) {
      const product = products.find(item => item.id === path.split('/').pop());
      if (!product) fail('Product not found.', 404);
      return send(product);
    }
    if (req.method === 'GET' && path === '/api/cart') return send(cartSummary(state));
    if (['POST', 'PATCH'].includes(req.method) && path === '/api/cart/items') {
      const body = await readBody(req);
      const product = products.find(item => item.id === body.productId);
      if (!product) fail('Product not found.', 404);
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) fail('Quantity must be a positive whole number.');
      const line = state.cart.find(item => item.productId === product.id);
      const next = req.method === 'POST' ? (line?.quantity || 0) + quantity : quantity;
      if (next > product.stock) fail(`Only ${product.stock} available.`);
      if (line) line.quantity = next;
      else state.cart.push({ productId: product.id, quantity: next });
      return send(cartSummary(state));
    }
    if (req.method === 'DELETE' && path.startsWith('/api/cart/items/')) {
      state.cart = state.cart.filter(item => item.productId !== path.split('/').pop());
      if (!state.cart.length) state.coupon = '';
      return send(cartSummary(state));
    }
    if (req.method === 'POST' && path === '/api/cart/coupon') {
      const { code } = await readBody(req);
      if (typeof code !== 'string') fail('Enter a coupon code.');
      const normalized = code.trim().toUpperCase();
      if (normalized && normalized !== 'SAVE10') fail('Coupon not recognized. Try SAVE10.');
      state.coupon = normalized;
      return send(cartSummary(state));
    }
    if (req.method === 'POST' && path === '/api/orders') {
      const body = await readBody(req);
      const customer = {};
      for (const key of ['name', 'email', 'address']) {
        if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 300) fail(`Enter a valid ${key}.`);
        customer[key] = body[key].trim();
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) fail('Enter a valid email address.');
      const summary = cartSummary(state);
      if (!summary.items.length) fail('Your cart is empty.');
      const order = { ...summary, id: String(state.orders.length + 1), createdAt: new Date().toISOString(), customer };
      state.orders.push(order);
      state.cart = [];
      state.coupon = '';
      return send(order, 201);
    }
    if (req.method === 'GET' && path === '/api/orders') return send([...state.orders].reverse());
    if (req.method === 'GET' && path.startsWith('/api/orders/')) {
      const order = state.orders.find(item => item.id === path.split('/').pop());
      if (!order) fail('Order not found.', 404);
      return send(order);
    }
    fail('Route not found.', 404);
  } catch (error) { send({ error: error.status ? error.message : 'Something went wrong.' }, error.status || 500); }
}
