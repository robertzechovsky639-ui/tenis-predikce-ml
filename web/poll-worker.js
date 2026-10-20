/* Stahování a JSON.parse mimo hlavní vlákno, ať živé odpovědi nesejkají stránku. */
const jobs = new Map();
self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.abort) { const c = jobs.get(d.id); if (c) c.abort(); return; }
  const ctrl = new AbortController();
  jobs.set(d.id, ctrl);
  try {
    const r = await fetch(d.url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    self.postMessage({ id: d.id, data });
  } catch (err) {
    self.postMessage({ id: d.id, error: err && err.name === 'AbortError' ? 'AbortError' : String(err && err.message || err) });
  } finally { jobs.delete(d.id); }
};
