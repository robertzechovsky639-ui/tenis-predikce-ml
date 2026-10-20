"""Headless test statické verze (GitHub Pages): načtení, živé aktualizace z prohlížeče, detail, screenshoty."""
import sys, pathlib, time
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; PFX = sys.argv[2] if len(sys.argv) > 2 else "static"
OUT = pathlib.Path(__file__).resolve().parents[1] / "screenshots"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport=dict(width=390, height=844), device_scale_factor=2, is_mobile=True, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    errs = []; pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    reqs = []; pg.on("requestfinished", lambda r: reqs.append(r.url.split("/")[2]) if "github" not in r.url and "127.0.0.1" not in r.url else None)
    fails = []; pg.on("requestfailed", lambda r: fails.append(r.url[:90] + " " + str(r.failure)))
    pg.goto(URL); pg.wait_for_selector(".m[data-id]", timeout=60000); pg.wait_for_timeout(12000)
    print("upd:", pg.inner_text("#upd")); print("srcOk:", pg.evaluate("JSON.stringify(ST.srcOk)"))
    print("live:", pg.evaluate("ST.all.filter(m=>m.status==='live').length"), "with pts:", pg.evaluate("ST.all.filter(m=>m.status==='live'&&m.server).length"))
    pg.screenshot(path=str(OUT / f"{PFX}_zapasy.png"))
    (pg.query_selector(".m:has(.livebadge)") or pg.query_selector(".m[data-id]")).click(); pg.wait_for_selector(".tabs"); pg.wait_for_timeout(2500)
    pg.screenshot(path=str(OUT / f"{PFX}_detail.png"))
    pg.click('.tabs button[data-t="kurzy"]'); pg.wait_for_timeout(500); pg.screenshot(path=str(OUT / f"{PFX}_kurzy.png"))
    pg.click("#bk"); pg.click('nav.bottom button[data-v="predikce"]'); pg.fill("#pa", "Sinner"); pg.wait_for_timeout(1500)
    pg.click("#pal [data-id]"); pg.fill("#pb", "Alcaraz"); pg.wait_for_timeout(1000); pg.click("#pbl [data-id]"); pg.wait_for_timeout(800)
    print("predikce:", pg.inner_text("#pres")[:80].replace("\n", " "))
    pg.click('nav.bottom button[data-v="model"]'); pg.wait_for_timeout(1500); pg.screenshot(path=str(OUT / f"{PFX}_model.png"))
    print("hosts:", sorted(set(reqs))); print("fails:", fails[:5]); print("errors:", errs[:5])
    b.close()
