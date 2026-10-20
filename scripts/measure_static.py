"""Měří v (headless) prohlížeči: pokrytí živých zápasů, odezvu zdrojů, první vykreslení z cache."""
import sys, json, time
from playwright.sync_api import sync_playwright
URL = sys.argv[1]
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx = b.new_context(viewport=dict(width=390, height=844), user_agent=UA, is_mobile=True)
    pg = ctx.new_page(); t = time.time(); pg.goto(URL, wait_until="domcontentloaded"); pg.wait_for_selector(".m[data-id]", timeout=60000)
    first = round((time.time() - t) * 1000); pg.wait_for_timeout(20000)
    r = pg.evaluate("""()=>{const L=ST.all.filter(m=>m.status==='live');const by={};for(const m of L){const k=m.circuit;by[k]=by[k]||{live:0,fresh:0,server:0};by[k].live++;if(m.src_pts)by[k].fresh++;if(m.server)by[k].server++}
      const med=a=>a&&a.length?Math.round([...a].sort((x,y)=>x-y)[a.length>>1]):null;
      return {live:L.length,live_fast_points:L.filter(m=>m.src_pts).length,with_server:L.filter(m=>m.server).length,with_pred:L.filter(m=>m.pred!=null).length,added_by_sofascore:ST.all.filter(m=>m.id.startsWith('ss-')).length,
        by_circuit:by,sources:Object.fromEntries(Object.entries(SOURCES).map(([k,s])=>[k,{median_ms:med(s.lat),interval_ms:s.iv,polls:s.lat.length}])),errors:Object.keys(ST.srcOk).filter(k=>k.endsWith('Err'))}}""")
    print("první vykreslení (bez cache):", first, "ms"); print(json.dumps(r, ensure_ascii=False))
    pg2 = ctx.new_page(); t = time.time(); pg2.goto(URL, wait_until="domcontentloaded"); pg2.wait_for_selector(".m[data-id]", timeout=30000)
    print("první vykreslení 2. návštěva (localStorage cache):", round((time.time() - t) * 1000), "ms; z cache:", pg2.evaluate("!!ST.cacheHit"))
    b.close()
