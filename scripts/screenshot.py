"""Mobilní screenshoty (390×844): hlavní obrazovka + detail zápasu (všechny záložky)."""
import sys, pathlib
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
OUT = pathlib.Path(__file__).resolve().parents[1] / "screenshots"; OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome" if pathlib.Path("/usr/bin/google-chrome").exists() else None)
    pg = b.new_page(viewport=dict(width=390, height=844), device_scale_factor=2, is_mobile=True)
    pg.goto(URL); pg.wait_for_selector(".m[data-id]", timeout=60000); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(OUT / "01_zapasy.png"))
    sel = ".m[data-id]"
    live = pg.query_selector(".m:has(.livebadge)")
    (live or pg.query_selector(sel)).click(); pg.wait_for_selector(".tabs"); pg.wait_for_timeout(800)
    pg.screenshot(path=str(OUT / "02_detail_prehled.png"))
    for i, t in enumerate(["predikce", "kurzy", "h2h", "stat"], 3):
        pg.click(f'.tabs button[data-t="{t}"]'); pg.wait_for_timeout(500); pg.screenshot(path=str(OUT / f"0{i}_detail_{t}.png"))
    pg.click("#bk"); pg.click('nav.bottom button[data-v="model"]'); pg.wait_for_timeout(1200); pg.screenshot(path=str(OUT / "07_model.png"))
    b.close()
print("ok", sorted(x.name for x in OUT.iterdir()))
