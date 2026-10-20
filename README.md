---
title: Tenis živě predikce
emoji: 🎾
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# TENIS • ŽIVĚ · PREDIKCE (FastAPI + PWA, české rozhraní)

Mobilní webová aplikace: zápasy po dnech, živé skóre s okamžitou aktualizací (Server-Sent Events), predikce
strojového učení natrénovaná na všech zápasech od roku 1968, živá pravděpodobnost výhry (Markovův model bod po bodu) a kurzy.

## Spuštění
    python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
    .venv/bin/python scripts/download_data.py        # stáhne datasety J. Sackmanna (~260 souborů)
    cd backend && ../.venv/bin/python train.py         # příznaky + trénink (~2–3 min, 8 jader)
    ../.venv/bin/python export_matches.py              # tabulka pro výpis H2H
    ../.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765
Otevři http://127.0.0.1:8765 (na mobilu ve stejné síti http://<IP počítače>:8765 → „Přidat na plochu“).

Proměnné: `TENIS_LIVE_POLL` (s, výchozí 3 při živých zápasech), `TENIS_IDLE_POLL` (30), `TENIS_DEMO=1` (vynutí ukázková data, označená DEMO).

Testy: `.venv/bin/python -m pytest tests` · Screenshoty: `.venv/bin/python scripts/screenshot.py` · Měření zpoždění: `.venv/bin/python scripts/measure_latency.py http://127.0.0.1:8765 60`

## Model
- Data: Jeff Sackmann tennis_atp + tennis_wta (hlavní soutěže, kvalifikace + Challenger, Futures/ITF, WTA kvalifikace/ITF), 1968 → 2. 6. 2026,
  1 740 498 dvouher. Původní repozitáře github.com/JeffSackmann vrací 404, skript proto použije veřejný mirror Aneeshers/tennis-sackmann-archive.
- Příznaky (chronologicky, bez úniku – vždy z dat PŘED zápasem): Elo celkové a na povrchu (K = 250/(n+5)^0,4), Elo očekávání, žebříček (log),
  forma (posl. 10), forma vs. očekávání Elo (60 dní), únava (zápasy za 14 dní), neaktivita, H2H, věk, nejistota (počet zápasů), úroveň, kvalifikace, povrch, pohlaví.
- LightGBM = výsledná pravděpodobnost (symetrizovaná), logistická regrese = vysvětlitelné faktory.
- Chronologické rozdělení: trénink 1970–2023, test 2024–2026 (153 987 zápasů). Přesnost / log loss / Brier:
  lightgbm: 70.35 % / 0.5617 / 0.1912 | logreg: 70.16 % / 0.5650 / 0.1924 | elo: 69.26 % / 0.5745 / 0.1964 | rank: 65.92 % / 0.6391 / 0.2235
- Novější kandidáti (směs povrchového Elo s celkovým, forma na povrchu a za 5 zápasů, H2H na povrchu, váha novějších zápasů s poločasem 6 let, hlubší stromy) se vybíraly jen na roce 2023 a jednou změřily na testu 2024+. Nejlepší z nich log loss nezlepšil (0,5606 proti 0,5605 u současných příznaků na stejném mirroru, n = 153 987), takže se nepoužil. Izotonická kalibrace z dřívějšího experimentu log loss zhoršila.
- Živě: z předzápasové pravděpodobnosti se bisekcí najdou pravděpodobnosti bodu na podání a Markovův model počítá gem/tiebreak/set/zápas ze stavu.

## Zdroje živých dat (zdarma, bez klíčů)
| Zdroj | Co | Pokrytí |
|---|---|---|
| ESPN scoreboard JSON (primární) | rozpis, skóre po setech/gemech | ATP + WTA hlavní soutěže i kvalifikace |
| Flashscore veřejný feed | doplněk: rozpis, skóre, povrch | Challenger, WTA 125, ITF muži/ženy (vč. kvalifikací), ATP/WTA zápasy, které ESPN nemá; −7 až +2 dny |
| 365scores veřejný JSON | body v gemu + podávající pro živé zápasy | hlavně ATP/WTA/Challenger; ITF často chybí → tam jen sety/gemy |
| Flashscore odds feed | kurzy na vítěze od sázkových kanceláří (CZ) | jen zápasy, které feed má; jinak „kurzy nedostupné“ |

Chybí-li kurzy, aplikace to napíše. Chybí-li historie hráče, predikce se odhadne ze žebříčku nebo z úrovně turnaje a je označená jako nízká spolehlivost; zápas, kde jsou oba hráči v datech, dál počítá model beze změny. Demo data (jen při výpadku všech zdrojů nebo TENIS_DEMO=1) jsou označena DEMO.

## Omezení
- Historická data končí 2. 6. 2026 (stav mirroru) – Elo/forma nezahrnují posledních ~4,5 měsíce; únava/neaktivita se počítají k tomuto datu.
- Kvalifikace v rozpisu jsou označeny „Q“ a filtrem „Kvalifikace“. Turnaje ITF mají kvalifikace ve feedu jen částečně.
- Chat je lokální asistent bez jazykového modelu („Sinner vs Alcaraz antuka“ → predikce).
- Zpoždění: backend se dotazuje každé 3 s, cyklus (stažení ESPN+Flashscore+365scores, výpočet) ~0,5–0,7 s, SSE push do prohlížeče < 2 ms.
  Celkem tedy 0,5–4 s od změny ve zdroji; samotné zdroje mohou mít vlastní zpoždění (CDN cache).
  Na GitHub Pages bere skóre prohlížeč: počítač Sofascore 1,5 s, 365scores 2,5 s, ESPN 4 s (začátky rozložené), telefon 2,2 / 5 / 8 s a detail jen u zápasů na obrazovce. JSON se čte mimo hlavní vlákno a seznam se překreslí jen když se změní skóre.

## Nasazení (veřejná adresa)
Dockerfile při buildu stáhne data, natrénuje model (~5 min, potřeba ~4 GB RAM) a spustí server na portu `$PORT` (výchozí 7860).

**Hugging Face Spaces (doporučeno, zdarma 24/7, 16 GB RAM):** huggingface.co → New Space → SDK *Docker* →
v Space nastav *Files → Import from GitHub* (nebo `git push` tohoto repa do repozitáře Space). Hlavička README výše už Space konfiguruje.
Adresa pak bude `https://<uživatel>-<space>.hf.space`.

**Render.com:** New → Web Service → toto repo → Runtime *Docker*. Free plán (512 MB) na trénink při buildu nestačí –
zvol placený plán se ≥ 2 GB, nebo natrénuj lokálně a model nahraj (Git LFS). Free plán po 15 min nečinnosti usíná.

**Fly.io:** `fly launch` (Dockerfile se použije automaticky), `fly scale memory 1024`; build probíhá na builderu Fly.

Živé aktualizace běží přes SSE (`/api/stream`); server posílá `Cache-Control: no-cache` a `X-Accel-Buffering: no`, takže
fungují i za reverzní proxy.

Lokálně trvale: `setsid nohup ./run_server.sh &` (automatický restart).

## Veřejná verze na GitHub Pages (bez serveru)
**https://robertzechovsky639-ui.github.io/tenis-predikce-ml/** – na iPhonu Safari → Sdílet → Přidat na plochu.

- **Živé skóre přímo v prohlížeči** (CORS): Sofascore (`api.sofascore1.com`, všechny úrovně vč. ITF, body) každých 1,5 s,
  365scores (body + podávající) 2 s, ESPN (ATP/WTA) 3 s; při chybě/429 se interval zdvojnásobuje až na 30 s. Živá pravděpodobnost
  Markovovým modelem v JS (`web/static.js`), překreslují se jen změněné karty, poslední data se drží v localStorage (okamžité první vykreslení).
  Živé kurzy (Flashscore odds feed) postupně ~1 zápas / 0,7 s a při otevření detailu.
- **Předzápasové predikce, detaily, rozpis** generuje workflow `.github/workflows/pages.yml` (cron každých 10 min (měkký limit Pages ~10 nasazení/h); když GitHub cron nespouští (stává se u nových repozitářů), job `keepalive` spustí export znovu po 8 min. Navíc telefon sám doplňuje rozpis ATP/WTA/Challenger z 365scores s predikcí logistickou regresí –
  čerstvost tedy nezávisí jen na Actions; + ručně a při push). Model se bere z release `model` (`model.tar.gz`). Když denní běh release zrovna maže a nahrává znovu, export sáhne po poslední celé záloze. Stromy se v tomhle běhu nepřetrénovávají.
- Vlastní predikce (Predikce, Chat) v prohlížeči používá logistickou regresi (LightGBM jen pro zápasy z exportu); H2H tam není.
- Flashscore rozpis/skóre (Challenger, ITF) prohlížeč číst nemůže (CORS preflight), takže zápasy, které nemá ani ESPN ani 365scores,
  se aktualizují jen s během workflow.
- Nový model: lokálně `train.py` + `export_matches.py`, pak
  `tar czf model.tar.gz -C data/model gbm.txt logreg.pkl state.pkl matches.pkl && gh release upload model model.tar.gz --clobber`.

## Průběžné učení (i když je aplikace zavřená)
Výsledek zápasu se do predikcí dalších zápasů těch hráčů dostane s dalším během Pages, tedy zhruba do 10–20 minut (cron `*/10`, a když GitHub cron vynechá, job `keepalive` ho po 8 minutách spustí znovu). Samotné Pages nasazení se nepřidává — pořád nejvýš jedno za ~10 minut. Otevřená aplikace si statická data bere při svém obnovení.

- **Každý export:** z vydaného `state.pkl` se znovu spočítá Elo, Elo na povrchu, forma (posledních 10), únava, neaktivita a H2H. Seznam dohraných zápasů je malé `state.json` na Pages (`dist/data/state.json`) plus kopie v cache Actions. K tomu se přidá Flashscore (−3..0 dní) a denní `live_results.csv`. Stejné id se vezme jen jednou (surové id Flashscore, jinak `espn:` + id). Drží se posledních 21 dní, ať se po výpadku denního běhu zápas neztratí a zároveň se znovu neaplikuje něco, co už `known_result` nepozná. Hodnocení samotné se neukládá — každý běh ho spočítá znovu, takže se zápas nezapočte dvakrát. Release `model` export nenahrává.
- **Stromy LightGBM mezi dny zůstávají.** Dotrénování pár stromů po každém zápase se měřilo stejným chronologickým protokolem jako trénink (skóre bloku dřív, než do něj model smí). Na zrcadle dat, 153 987 zápasů 2024+: zmrazený model 70,42 % / log loss 0,5606 / Brier 0,1908. Brána (log loss aspoň o 0,001 lepší a přesnost nesmí klesnout) nepřijala ani jeden ze 77 bloků, čísla stejná. Bez brány, vždy 3 stromy navíc: 70,44 % / 0,5606 / 0,1908. Log loss se nezlepšil, proto se stromy mezi dny nemění.
- **Denně 02:30 UTC (`learn.yml`):** čerstvé TennisMyLife CSV + ingest výsledků, přepočet všech příznaků od 1968, kandidát natrénovaný do začátku holdoutu (posledních 8 týdnů). Brána: kandidát musí porazit Elo na holdoutu o ≥ 0,003 log loss a nesmí být o víc než 0,01 horší než minule publikovaný kandidát. Pak refit na všech datech a nahrání `model.tar.gz`; jinak zůstává starý model (stav Elo/formy se aktualizuje vždy). Publikovaný model na testu 2024–2026 (161 106 zápasů): 70,28 % / log loss 0,5633 / Brier 0,1918, Elo baseline log loss 0,5773. Historie: `retrain_history.json`, záložka Model.
