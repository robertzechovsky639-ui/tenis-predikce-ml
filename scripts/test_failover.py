"""Failover: zablokuje Sofascore v prohlížeči a ověří, že skóre dál tečou z 365scores/ESPN a indikátor ukáže chybu; ověří záložní rozpis."""
import sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); pg = b.new_page(viewport=dict(width=390, height=844), device_scale_factor=2, user_agent=UA, is_mobile=True)
    pg.route("**/api.sofascore1.com/**", lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector(".m[data-id]"); pg.wait_for_timeout(15000)
    r = pg.evaluate("()=>({health:health(),live:ST.all.filter(m=>m.status==='live').length,pts_365:ST.all.filter(m=>m.src_pts==='365scores').length,sofa_iv:SOURCES.sofascore.iv})")
    print(json.dumps(r, ensure_ascii=False)); pg.screenshot(path="screenshots/pages_v3_12_failover.png")
    n0 = pg.evaluate("ST.all.length"); pg.evaluate("ST.generated=0; scheduleFallback(()=>{})"); pg.wait_for_timeout(6000)
    print("záložní rozpis 365scores přidal:", pg.evaluate("ST.all.filter(m=>m.id.startsWith('s365-')).length"), "zápasů (s predikcí:", pg.evaluate("ST.all.filter(m=>m.id.startsWith('s365-')&&m.pred!=null).length"), ")")
    b.close()
