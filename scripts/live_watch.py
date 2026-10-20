"""Sledování živých aktualizací na veřejné URL po dobu ~3 min: kolik zápasů změnilo skóre v každém 20s okně, stáří posledního živého načtení."""
import sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; DUR = int(sys.argv[2]) if len(sys.argv) > 2 else 180
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); pg = b.new_page(user_agent=UA, viewport=dict(width=390, height=844)); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.goto(URL); pg.wait_for_selector(".m[data-id]", timeout=60000); pg.wait_for_timeout(5000)
    snap = "()=>Object.fromEntries(ST.all.filter(m=>m.status==='live').map(m=>[m.id,JSON.stringify([m.sets,m.pts||m.pts_raw])]))"
    prev = pg.evaluate(snap); tot = 0; rows = []
    for i in range(DUR // 20):
        pg.wait_for_timeout(20000); cur = pg.evaluate(snap); ch = sum(1 for k, v in cur.items() if k in prev and prev[k] != v); tot += ch
        age = pg.evaluate("Date.now()-ST.lastLive.getTime()"); dom = pg.locator(".m[data-id]").count(); rows.append((len(cur), ch, age)); prev = cur
        print(f"okno {i+1}: živých {len(cur)}, změněných {ch}, stáří živých dat {age} ms, karet {dom}")
    print("LIVE_WATCH", json.dumps({"windows": len(rows), "changes_total": tot, "windows_without_change": sum(1 for r in rows if r[1] == 0), "max_age_ms": max(r[2] for r in rows), "js_errors": errs[:3]}))
