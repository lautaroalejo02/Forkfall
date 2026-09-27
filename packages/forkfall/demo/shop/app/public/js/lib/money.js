const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function money(cents) { return formatter.format(cents / 100); }
