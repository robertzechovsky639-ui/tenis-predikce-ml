"""v4 kontroly: rozpis ITF ze Sofascore, záložní predikce ze žebříčku, nový Přehled/Kurzy, animace skóre, pull-to-refresh, upozornění."""
import sys, json, pathlib
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; P = sys.argv[2] if len(sys.argv) > 2 else "pages_v4"; OUT = pathlib.Path(__file__).resolve().parents[1] / "screenshots"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
issues = []
def chk(c, msg):
    if not c: issues.append(msg); print("CHYBA:", msg)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx = b.new_context(viewport=dict(width=390, height=844), device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append("JS: " + str(e)))
    pg.add_init_script("window.__fl=0;new MutationObserver(r=>{for(const x of r)for(const n of x.addedNodes)if(n.querySelectorAll&&(n.classList?.contains('flash')||n.querySelector('.flash')))window.__fl++}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});")
    pg.goto(URL); pg.wait_for_selector(".m[data-id]", timeout=60000); pg.wait_for_timeout(20000)
    s = pg.evaluate("""()=>{const A=ST.all,L=A.filter(m=>m.status==='live');return {all:A.length,itf_up:A.filter(m=>m.status==='upcoming'&&/ITF/.test(m.circuit)).length,
      ss_added:ST.ssSchedAdded||0,low:A.filter(m=>m.pred_low).length,nopred:A.filter(m=>m.pred==null&&m.status!=='finished').length,
      live:L.length,srv:L.filter(m=>m.server!=null).length,pts:L.filter(m=>m.pts||m.pts_raw).length,odds:L.filter(m=>m.odds).length,srcOk:Object.keys(ST.srcOk)}}""")
    print("STAV", json.dumps(s, ensure_ascii=False))
    chk(s["itf_up"] > 0, "žádné nadcházející ITF zápasy"); chk("schedule" in s["srcOk"], "Sofascore rozpis neodpověděl")
    pg.select_option("#circ", "ITF ženy"); pg.select_option("#filt", "up"); pg.wait_for_timeout(500); pg.screenshot(path=str(OUT / f"{P}_01_itf_rozpis.png"))
    lowc = pg.locator(".m[data-id] .low").count(); print("karty s nízkou spolehlivostí (ITF ž. nadch.)", lowc)
    pg.select_option("#circ", "all"); pg.select_option("#filt", "live"); pg.wait_for_timeout(500)
    if pg.locator(".m[data-id]").count():
        pg.locator(".m[data-id]").first.click(); pg.wait_for_selector(".tabs"); pg.wait_for_timeout(3000); t = pg.inner_text("#detail")
        chk("PREDIKCE TEĎ" in t, "Přehled: chybí PREDIKCE TEĎ"); chk("undefined" not in t and "NaN" not in t, "Přehled: undefined/NaN"); pg.screenshot(path=str(OUT / f"{P}_02_prehled.png"))
        pg.click('.tabs button[data-t="kurzy"]'); pg.wait_for_timeout(1500); t = pg.inner_text("#detail"); chk("undefined" not in t and "NaN" not in t, "Kurzy: undefined/NaN")
        print("Kurzy MODEL VS. TRH:", "MODEL VS. TRH" in t); pg.screenshot(path=str(OUT / f"{P}_03_kurzy.png")); pg.click("#bk")
    else: print("žádný živý zápas")
    pg.select_option("#filt", "all"); pg.wait_for_timeout(45000); fl = pg.evaluate("window.__fl"); print("animací skóre za 45 s:", fl); chk(fl > 0 or s["live"] == 0, "žádná animace změny skóre")
    pg.evaluate("window.scrollTo(0,0)"); pg.mouse.move(195, 200)
    ok = pg.evaluate("()=>!!document.querySelector('.ptr')"); chk(ok, "chybí pull-to-refresh prvek")
    pg.evaluate("""()=>{const t=e=>new TouchEvent(e,{touches:e==='touchend'?[]:[new Touch({identifier:1,target:document.body,clientY:e==='touchstart'?100:300})]});
      dispatchEvent(t('touchstart'));dispatchEvent(t('touchmove'))}"""); pg.wait_for_timeout(200)
    chk(pg.evaluate("document.querySelector('.ptr').classList.contains('on')"), "pull-to-refresh nereaguje na tah"); pg.screenshot(path=str(OUT / f"{P}_04_ptr.png"))
    pg.evaluate("dispatchEvent(new TouchEvent('touchend',{touches:[]}))"); pg.wait_for_timeout(4000); chk(pg.locator(".m[data-id]").count() > 0, "po obnovení prázdný seznam")
    pg.click('nav.bottom button[data-v="oblibene"]'); pg.wait_for_timeout(500); chk("Upozornění" in pg.inner_text("body"), "chybí tlačítko upozornění")
    pg.evaluate("notify('Test upozornění: začal zápas')"); pg.wait_for_timeout(300); chk(pg.locator(".toast").count() > 0, "toast se neukázal"); pg.screenshot(path=str(OUT / f"{P}_05_upozorneni.png"))
    chk(not errs, f"JS chyby: {errs[:3]}")
print("V4 VÝSLEDEK:", "OK" if not issues else issues)
