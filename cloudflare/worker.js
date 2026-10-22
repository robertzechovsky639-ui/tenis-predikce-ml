// Cloudflare Worker: proxy pro Flashscore live feed (ITF body + podávající).
// Prohlížeč na github.io nemůže Flashscore volat přímo (CORS + hlavička x-fsign).
const ORIGIN = 'https://robertzechovsky639-ui.github.io';
const PATH = '/feed/f_2_0_2_en_1';
const UPSTREAM = 'https://global.flashscore.ninja/2/x/feed/f_2_0_2_en_1';
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== PATH || url.search || !['GET', 'OPTIONS'].includes(request.method)) return new Response('Not found', { status: 404 });
    const origin = request.headers.get('Origin');
    if (origin !== ORIGIN) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const r = await fetch(UPSTREAM, { headers: { 'x-fsign': 'SW9D1eZo' }, cf: { cacheTtl: 4, cacheEverything: true } });
      if (!r.ok) return new Response('Upstream error', { status: 502, headers: CORS });
      return new Response(await r.text(), { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=4' } });
    } catch (e) {
      return new Response('Upstream error', { status: 502, headers: CORS });
    }
  },
};
