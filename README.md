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
- Živě: z předzápasové pravděpodobnosti se bisekcí najdou pravděpodobnosti bodu na podání a Markovův model počítá gem/tiebreak/set/zápas ze stavu.

## Zdroje živých dat (zdarma, bez klíčů)
| Zdroj | Co | Pokrytí |
|---|---|---|
| ESPN scoreboard JSON (primární) | rozpis, skóre po setech/gemech | ATP + WTA hlavní soutěže i kvalifikace |
| Flashscore veřejný feed | doplněk: rozpis, skóre, povrch | Challenger, WTA 125, ITF muži/ženy (vč. kvalifikací), ATP/WTA zápasy, které ESPN nemá; −7 až +2 dny |
| 365scores veřejný JSON | body v gemu + podávající pro živé zápasy | hlavně ATP/WTA/Challenger; ITF často chybí → tam jen sety/gemy |
| Flashscore odds feed | kurzy na vítěze od sázkových kanceláří (CZ) | jen zápasy, které feed má; jinak „kurzy nedostupné“ |

Nic se nevymýšlí: chybí-li kurzy nebo historie hráče, aplikace to napíše. Demo data (jen při výpadku všech zdrojů nebo TENIS_DEMO=1) jsou označena DEMO.

## Omezení
- Historická data končí 2. 6. 2026 (stav mirroru) – Elo/forma nezahrnují posledních ~4,5 měsíce; únava/neaktivita se počítají k tomuto datu.
- Kvalifikace v rozpisu jsou označeny „Q“ a filtrem „Kvalifikace“. Turnaje ITF mají kvalifikace ve feedu jen částečně.
- Chat je lokální asistent bez jazykového modelu („Sinner vs Alcaraz antuka“ → predikce).
- Zpoždění: backend se dotazuje každé 3 s, cyklus (stažení ESPN+Flashscore+365scores, výpočet) ~0,5–0,7 s, SSE push do prohlížeče < 2 ms.
  Celkem tedy 0,5–4 s od změny ve zdroji; samotné zdroje mohou mít vlastní zpoždění (CDN cache).

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

- **Živé skóre přímo v prohlížeči každé 4 s** (ESPN scoreboard + 365scores, obojí povoluje CORS); živá pravděpodobnost
  se počítá Markovovým modelem v JS (`web/static.js`). Živé kurzy (Flashscore odds feed) každých 30 s a při otevření detailu.
- **Předzápasové predikce, detaily, rozpis** generuje workflow `.github/workflows/pages.yml` (cron každých 5 min – GitHub
  ho v praxi spouští se zpožděním 5–20 min; + ručně a při push). Model se bere z release `model` (`model.tar.gz`), nepřetrénovává se.
- Vlastní predikce (Predikce, Chat) v prohlížeči používá logistickou regresi (LightGBM jen pro zápasy z exportu); H2H tam není.
- Flashscore rozpis/skóre (Challenger, ITF) prohlížeč číst nemůže (CORS preflight), takže zápasy, které nemá ani ESPN ani 365scores,
  se aktualizují jen s během workflow.
- Nový model: lokálně `train.py` + `export_matches.py`, pak
  `tar czf model.tar.gz -C data/model gbm.txt logreg.pkl state.pkl matches.pkl && gh release upload model model.tar.gz --clobber`.
