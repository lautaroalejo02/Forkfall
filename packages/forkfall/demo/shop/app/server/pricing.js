import { products } from './store.js';

export function cartSummary(state) {
  const items = state.cart.map(line => {
    const product = products.find(product => product.id === line.productId);
    return { ...product, quantity: line.quantity, total: product.price * line.quantity };
  });
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = state.coupon === 'SAVE10' ? Math.round(subtotal * 0.1) : 0;
  return { items, coupon: state.coupon, subtotal, discount, total: subtotal - discount };
}
