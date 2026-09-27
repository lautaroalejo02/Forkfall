export async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export async function initialize() {
  const session = await request('/api/session');
  if (sessionStorage.getItem('shop-session') !== session.id) {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('shop-')) sessionStorage.removeItem(key);
    sessionStorage.setItem('shop-session', session.id);
  }
}
