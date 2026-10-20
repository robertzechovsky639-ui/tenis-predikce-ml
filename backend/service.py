"""Smyčka dotazování živých zdrojů + obohacení zápasů o predikce, živou pravděpodobnost a kurzy."""
import asyncio, concurrent.futures as cf, datetime, json, os, time, random
import sources as S, markov
from predictor import Predictor, F
import fallback as FB, scoremerge as SM

LIVE_POLL = float(os.environ.get("TENIS_LIVE_POLL", 3))      # s, když běží živé zápasy
IDLE_POLL = float(os.environ.get("TENIS_IDLE_POLL", 30))
DAYS = range(-2, 3)
LVL = {"ITF muži": 0, "ITF ženy": 0, "Challenger": 1, "WTA 125": 1, "ATP": 2, "WTA": 2}
VALUE_EDGE = 0.05

class Service:
    def __init__(self, demo=False):
        self.P = Predictor(); self.demo = demo
        self.days = {d: [] for d in DAYS}; self.by_id = {}; self.odds = {}; self.odds_t = {}
        self.subs = set(); self.status = dict(sources={}, last_poll=None, poll_ms=None, errors={})
        self.pool = cf.ThreadPoolExecutor(8); self.opool = cf.ThreadPoolExecutor(6); self.inflight = set(); self.cycles = []; self.fs_days = {}; self.fs_t = {}; self.espn_cache = []
        self.pred_cache = {}; self.l365 = {}

    # ---------- obohacení ----------
    def _resolve(self, m, fn):
        g = m["g"]; out = []
        for p in m["players"]:
            slug = (p.get("slug") or "").replace("-", " ")
            out.append((slug and fn(g, slug, p.get("short"))) or fn(g, p["name"], p.get("short")))
        return out

    def enrich(self, m):
        g = m["g"]
        strict = self._resolve(m, self.P.find)
        ids = strict if all(strict) else self._resolve(m, self.P.find_any)
        lvl = 3 if any(s in m["tournament"].lower() for s in ("australian open", "roland", "french open", "wimbledon", "us open")) else LVL.get(m["circuit"], 2)

        def predict(a, b):
            k = (a, b, m["surface"], lvl, m["best_of"], m["qual"])
            if k not in self.pred_cache:
                self.pred_cache[k] = self.P.predict(a, b, m["surface"], lvl, m["best_of"], m["qual"], int(g == "W"))
            return self.pred_cache[k]

        info = FB.prediction_for(m, strict, ids, lambda pid: self.P.s["elo"].get(pid, 1500.0),
                                  lambda pid: self.P.s["n"].get(pid, 0), predict)
        m["pids"] = info["pids"]; m["pred"] = info["pred"]; m["pred_lr"] = info["pred_lr"]
        if info["pred_low"]:
            m["pred_low"] = True; m["pred_note"] = info["pred_note"]
        else:
            m.pop("pred_low", None); m.pop("pred_note", None)
        m["live"] = None
        if m["status"] == "live" and m["pred"] is not None:
            sp = SM.split_live(m["sets"], "live")
            done, cur = sp["done"], sp["cur"]
            pts = tuple(m.get("pts") or (0, 0)) if cur != [0, 0] or m.get("pts") else (0, 0)
            mtb = SM.is_match_tb(m["sets"], pts, m.get("best_of") or 3)
            lv = markov.live(m["pred"], [tuple(s) for s in done], tuple(cur), pts, m.get("server"), g == "W", m["best_of"], match_tb=mtb)
            m["live"] = dict(match=round(lv["match"], 4), set=round(lv["set"], 4), hold_a=round(lv["hold_a"], 3),
                             hold_b=round(lv["hold_b"], 3), serve_a=round(lv["pa"], 3), serve_b=round(lv["pb"], 3),
                             game=None if lv["game"] is None else round(lv["game"], 4),
                             note=("stav bod po bodu (365scores): sety, gemy, body a podávající" if m.get("server") else
                                   "body/podání pro tento zápas nejsou ve veřejném feedu – stav = sety a gemy, podávající neznámý (průměr)"))
        o = self.odds.get(m["id"])
        m["odds"] = None
        if o:
            ba, bb = max(x["a"] for x in o), max(x["b"] for x in o)
            ia, ib = 1 / ba, 1 / bb; fair_a = ia / (ia + ib)
            m["odds"] = dict(best_a=ba, best_b=bb, n=len(o), fair_a=round(fair_a, 4))
            p = m["live"]["match"] if m["live"] else m["pred"]
            m["value"] = None
            if p is not None and m["status"] != "finished":
                if p * ba - 1 > VALUE_EDGE: m["value"] = "A"
                elif (1 - p) * bb - 1 > VALUE_EDGE: m["value"] = "B"
        else:
            m["value"] = None
        return m

    # ---------- dotazování ----------
    def _fetch_fs(self, d):
        try:
            self.fs_days[d] = S.flashscore(d); self.fs_t[d] = time.time(); self.status["errors"].pop(f"fs{d}", None)
        except Exception as e:
            self.status["errors"][f"fs{d}"] = str(e)[:200]

    def _fetch_espn(self):
        out = []
        for t in ("atp", "wta"):
            try: out += S.espn(t); self.status["errors"].pop("espn_" + t, None)
            except Exception as e: self.status["errors"]["espn_" + t] = str(e)[:200]
        if out: self.espn_cache = out

    def _fetch_365(self):
        try: self.l365 = S.live365(); self.status["errors"].pop("365", None)
        except Exception as e: self.status["errors"]["365"] = str(e)[:200]

    def _fetch_odds(self, m):
        try:
            self.odds[m["id"]] = S.odds(m["fs"]); self.odds_t[m["id"]] = time.time()
        except Exception:
            self.odds_t[m["id"]] = time.time()

    def poll_once(self, full=False):
        t0 = time.time(); today = datetime.datetime.now(S.TZ).date()
        jobs = [self.pool.submit(self._fetch_espn), self.pool.submit(self._fetch_fs, 0), self.pool.submit(self._fetch_365)]
        for d in DAYS:
            if d != 0 and (full or time.time() - self.fs_t.get(d, 0) > 600): jobs.append(self.pool.submit(self._fetch_fs, d))
        for j in jobs: j.result()
        t_src = time.time()
        allfs = [m for d in DAYS for m in self.fs_days.get(d, [])]
        merged = S.merge([dict(m, players=[dict(p) for p in m["players"]]) for m in self.espn_cache], allfs)
        days = {d: [] for d in DAYS}; seen = set()
        for m in merged:
            if m["id"] in seen: continue
            seen.add(m["id"])
            dd = (datetime.datetime.fromtimestamp(m["ts"], S.TZ).date() - today).days
            if m["status"] == "live": dd = 0
            m["pts"] = None; m["server"] = None; m["srv_trust"] = 0
            if m["status"] == "live":
                x = self.l365.get(frozenset(S.surname_key(p["name"]) for p in m["players"]))
                if x:
                    same = x["home"] == S.surname_key(m["players"][0]["name"])
                    pts = list(x["pts"] if same else x["pts"][::-1])
                    sets = x["sets"] if same else [s[::-1] for s in x["sets"]]
                    sets, pts, closed = SM.close_finished_tb(sets, pts, m.get("best_of") or 3)
                    rel = SM.cmp_score(m["sets"], None, sets, pts)
                    if rel > 0 or rel == 0:
                        m["pts"] = pts
                        raw = x["pts_raw"] if same else list(reversed(x["pts_raw"] or []))
                        m["pts_raw"] = [0, 0] if closed else raw
                        m["server"] = x["server"] if same or x["server"] is None else 3 - x["server"]
                        m["srv_trust"] = 2
                        if rel > 0 and SM.norm_sets(sets) != SM.norm_sets(m["sets"]):
                            m["sets"] = [[int(a), int(b)] for a, b in sets if a is not None and b is not None and int(a) >= 0 and int(b) >= 0]
                        m["src_live"] = "365scores"
            prev = self.by_id.get(m["id"])
            if prev: SM.keep_score(prev, m)
            if dd in days: days[dd].append(m)
        if not any(days.values()) or self.demo:
            days = self.demo_days(); self.status["demo"] = True
        else:
            self.status["demo"] = False
        # kurzy: živé každých 20 s, nadcházející každých 15 min
        now = time.time(); need = []
        for d in (0, 1):
            for m in days[d]:
                if m.get("fs") and m["status"] != "finished":
                    age = now - self.odds_t.get(m["id"], 0)
                    if age > (20 if m["status"] == "live" else 900): need.append(m)
        # kurzy se stahují na pozadí (neblokují cyklus skóre); změna se projeví v dalším cyklu
        for m in need[:120]:
            if m["id"] not in self.inflight:
                self.inflight.add(m["id"]); self.odds_t[m["id"]] = now
                self.opool.submit(self._fetch_odds, m).add_done_callback(lambda _f, i=m["id"]: self.inflight.discard(i))
        changed = []
        for d in DAYS:
            for m in days[d]:
                self.enrich(m); m["day"] = d
                old = self.by_id.get(m["id"])
                sig = json.dumps([m["status"], m["sets"], m.get("pts"), m.get("server"), m["live"], m["odds"], m["winner"]])
                m["_sig"] = sig
                if old is None or old.get("_sig") != sig: changed.append(m)
                self.by_id[m["id"]] = m
            days[d].sort(key=lambda m: ({"live": 0, "upcoming": 1, "finished": 2}[m["status"]], m["ts"]))
        self.days = days
        self.status.update(last_poll=datetime.datetime.now(S.TZ).isoformat(timespec="seconds"),
                           source_ms=round((t_src - t0) * 1000), poll_ms=round((time.time() - t0) * 1000),
                           cycle_median_ms=self._cyc(round((time.time() - t0) * 1000)),
                           live=sum(1 for m in days[0] if m["status"] == "live"),
                           counts={d: len(v) for d, v in days.items()})
        return changed, t0

    def _cyc(self, ms):
        self.cycles = (self.cycles + [ms])[-50:]; return sorted(self.cycles)[len(self.cycles) // 2]

    def demo_days(self):
        """Ukázková data jen pro případ, že živé zdroje nejsou dostupné. Jasně označeno demo=True."""
        rng = random.Random(1); top = sorted(self.P.s["elo"].items(), key=lambda x: -x[1])[:60]
        out = {d: [] for d in DAYS}
        for i in range(0, 40, 2):
            a, b = top[i][0], top[i + 1][0]
            if a[0] != b[0]: continue
            st = ["live", "upcoming", "finished"][i % 3]
            out[0].append(dict(id=f"demo-{i}", src="DEMO", demo=True, circuit="ATP" if a[0] == "M" else "WTA", g=a[0],
                               tournament="DEMO turnaj", venue="", surface="Hard", round="", qual=0, ts=time.time() + 3600 * (i % 5),
                               status=st, detail="DEMO", sets=[[6, 4], [2, 3]] if st == "live" else [[6, 3], [6, 4]] if st == "finished" else [],
                               winner=1 if st == "finished" else 0, best_of=3, fs=None,
                               players=[dict(name=self.P.s["name"][a], short=None, country=""), dict(name=self.P.s["name"][b], short=None, country="")]))
        return out

    # ---------- detail ----------
    def detail(self, mid):
        m = self.by_id.get(mid)
        if not m: return None
        d = dict(m); a, b = m["pids"]
        d["cards"] = [self.P.card(p, m["surface"]) if p else None for p in (a, b)]
        if a and b:
            lvl = LVL.get(m["circuit"], 2)
            pr = self.P.predict(a, b, m["surface"], lvl, m["best_of"], m["qual"], int(m["g"] == "W"))
            d["factors"] = pr["factors"]; d["h2h"] = pr["h2h"]; d["h2h_list"] = self.P.h2h_list(a, b); d["elo_p"] = pr["elo_p"]
            pa, pb = markov.serve_probs(pr["p"], m["g"] == "W", m["best_of"])
            d["markov"] = dict(serve_a=round(pa, 3), serve_b=round(pb, 3), hold_a=round(markov.game(pa), 3), hold_b=round(markov.game(pb), 3),
                               set1=round((markov.set_prob(pa, pb, a_serving=True) + markov.set_prob(pa, pb, a_serving=False)) / 2, 3))
        d["odds_table"] = self.odds.get(mid) or []
        d["odds_status"] = "ok" if d["odds_table"] else ("bez kurzů ve veřejném feedu" if m.get("fs") else "zápas není ve Flashscore feedu – kurzy nedostupné")
        d.pop("_sig", None)
        return d

    def snapshot(self, day):
        return [{k: v for k, v in m.items() if k != "_sig"} for m in self.days.get(day, [])]

    async def run(self):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self.poll_once(True))
        while True:
            await asyncio.sleep(LIVE_POLL if self.status.get("live") else IDLE_POLL)
            try:
                changed, t0 = await loop.run_in_executor(None, self.poll_once)
            except Exception as e:
                self.status["errors"]["poll"] = str(e)[:200]; continue
            if changed:
                msg = json.dumps(dict(type="update", t_poll_start=t0, t_push=time.time(),
                                      matches=[{k: v for k, v in m.items() if k != "_sig"} for m in changed]), ensure_ascii=False)
                for q in list(self.subs): q.put_nowait(msg)
