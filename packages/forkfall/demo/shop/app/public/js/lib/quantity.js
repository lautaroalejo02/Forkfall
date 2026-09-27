export function configureQuantity(input, quantity, product) {
  input.min = '1';
  input.max = String(product.stock);
  input.step = '1';
  input.value = String(quantity);
}
