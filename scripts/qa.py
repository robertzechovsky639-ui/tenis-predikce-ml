"""QA průchod veřejnou aplikací v mobilním rozlišení: všechny obrazovky, filtry, oblíbené, detail (5 záložek), Chat, Predikce, Hráči, Model."""
import sys, pathlib
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; P = sys.argv[2] if len(sys.argv) > 2 else "pages_v3"; OUT = pathlib.Path(__file__).resolve().parents[1] / "screenshots"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
issues = []
def chk(c, msg):
    if not c: issues.append(msg); print("CHYBA:", msg)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); pg = b.new_page(viewport=dict(width=390, height=844), device_scale_factor=2, is_mobile=True, user_agent=UA)
    errs = []; pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None); pg.on("pageerror", lambda e: errs.append("JS: " + str(e)))
    shot = lambda n: pg.screenshot(path=str(OUT / f"{P}_{n}.png"))
    pg.goto(URL); pg.wait_for_selector(".m[data-id]", timeout=60000); pg.wait_for_timeout(8000); shot("01_zapasy")
    n_all = pg.locator(".m[data-id]").count()
    for v, t in [("ATP", "atp"), ("WTA", "wta"), ("CH", "ch"), ("ITF muži", "itfm"), ("ITF ženy", "itfz")]:
        pg.select_option("#circ", v); pg.wait_for_timeout(300); n = pg.locator(".m[data-id]").count(); print("okruh", v, n)
        chk(n > 0 or pg.locator(".empty").count() == 1, f"okruh {v}: ani karty ani prázdný stav")
    pg.select_option("#circ", "ITF muži"); shot("02_itf_muzi"); pg.select_option("#circ", "all")
    for v in ["live", "up", "fin", "value", "qual", "main"]:
        pg.select_option("#filt", v); pg.wait_for_timeout(300); n = pg.locator(".m[data-id]").count(); print("filtr", v, n)
        chk(n > 0 or pg.locator(".empty").count() == 1, f"filtr {v}: prázdná obrazovka bez hlášky")
    pg.select_option("#filt", "live"); shot("03_zive"); pg.select_option("#filt", "all")
    for d in ["-1", "1", "2", "-2"]:
        pg.click(f'.days button[data-day="{d}"]'); pg.wait_for_timeout(800); print("den", d, pg.locator(".m[data-id]").count())
    pg.click('.days button[data-day="1"]'); pg.wait_for_timeout(500); shot("04_zitra"); pg.click('.days button[data-day="0"]'); pg.wait_for_timeout(500)
    pg.select_option("#filt", "live"); pg.wait_for_timeout(300)
    pg.locator(".m[data-id]").first.click(); pg.wait_for_selector(".tabs"); pg.wait_for_timeout(2500); shot("05_detail_prehled")
    for t in ["predikce", "kurzy", "h2h", "stat"]:
        pg.click(f'.tabs button[data-t="{t}"]'); pg.wait_for_timeout(700); txt = pg.inner_text("#detail")
        chk("undefined" not in txt and "NaN" not in txt, f"detail/{t}: undefined/NaN v textu"); shot(f"06_detail_{t}")
    pg.click("#fv"); pg.wait_for_timeout(300); pg.click("#bk"); pg.click('nav.bottom button[data-v="oblibene"]'); pg.wait_for_timeout(500)
    chk(pg.locator(".m[data-id]").count() >= 1, "oblíbené: přidaný zápas chybí"); shot("07_oblibene")
    pg.click('nav.bottom button[data-v="predikce"]'); pg.fill("#pa", "Lehecka"); pg.wait_for_timeout(1500); pg.click("#pal [data-id]")
    pg.fill("#pb", "Draper"); pg.wait_for_timeout(1200); pg.click("#pbl [data-id]"); pg.wait_for_timeout(800); pg.click('#psurf button[data-s="Clay"]'); pg.wait_for_timeout(500)
    chk("%" in pg.inner_text("#pres"), "predikce: bez výsledku"); shot("08_predikce")
    pg.click('nav.bottom button[data-v="hraci"]'); pg.fill("#ps", "Muchova"); pg.wait_for_timeout(1500); chk(pg.locator("#plist .fac").count() > 0, "hráči: nic"); shot("09_hraci")
    pg.click('nav.bottom button[data-v="chat"]'); pg.fill("#cq", "Sinner vs Alcaraz antuka"); pg.click("#cs"); pg.wait_for_timeout(1500)
    chk("%" in pg.inner_text("#msgs"), "chat: bez odpovědi"); shot("10_chat")
    pg.click('nav.bottom button[data-v="model"]'); pg.wait_for_timeout(1500); shot("11_model")
    body = pg.inner_text("body"); chk("undefined" not in body and "NaN" not in body, "model: undefined/NaN")
    print("počet karet celkem dnes:", n_all); print("console errors:", errs[:8]); print("PROBLÉMY:", issues or "žádné")
    b.close()
