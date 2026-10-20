"""Živá data: ESPN (primární, ATP/WTA vč. kvalifikací) + veřejný feed Flashscore (doplněk: Challenger, WTA 125,
ITF muži/ženy, kvalifikace a zápasy ATP/WTA, které ESPN nemá). Kurzy: veřejný odds feed Flashscore (bez klíče)."""
import datetime, json, re, unicodedata, urllib.request, zoneinfo
import fs

TZ = zoneinfo.ZoneInfo("Europe/Prague")
UA = {"User-Agent": "Mozilla/5.0"}
ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis/{t}/scoreboard"

def _get(url, headers=UA, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")

def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return "".join(re.findall(r"[a-z]+", s))

def surname_key(name):
    """'Jannik Sinner' / 'Sinner J.' / 'sinner-jannik' -> 'sinner' (pro párování mezi zdroji)."""
    n = name.strip()
    m = re.match(r"^(.*?)\s+[A-Z][\w\-]*\.$", n)
    if m: return norm(m.group(1))
    return norm(n.split()[-1]) if n else ""

def espn(tour):
    d = json.loads(_get(ESPN.format(t=tour)))
    out = []
    for ev in d.get("events", []):
        for gr in ev.get("groupings", []):
            if gr.get("grouping", {}).get("slug") not in ("mens-singles", "womens-singles"): continue
            for c in gr.get("competitions", []):
                st = c["status"]["type"]; cs = sorted(c["competitors"], key=lambda x: x.get("order", 0))
                if len(cs) != 2 or not all("athlete" in x for x in cs): continue
                status = "live" if st["state"] == "in" else "finished" if st["state"] == "post" else "upcoming"
                if st.get("name") in ("STATUS_CANCELED", "STATUS_POSTPONED"): status = "finished"
                ls = [x.get("linescores", []) for x in cs]
                sets = [[int(a.get("value", 0)), int(b.get("value", 0))] for a, b in zip(*ls)]
                rnd = c.get("round", {}).get("displayName", "")
                ts = datetime.datetime.fromisoformat(c["date"].replace("Z", "+00:00")).timestamp()
                win = 1 if cs[0].get("winner") else 2 if cs[1].get("winner") else 0
                out.append(dict(id="espn-" + c["id"], src="ESPN", circuit=tour.upper(), g="M" if tour == "atp" else "W",
                                tournament=ev.get("name", ""), venue=c.get("venue", {}).get("fullName", ""), surface=None,
                                round=rnd, qual=int("Qualifying" in rnd), ts=ts, status=status, detail=st.get("shortDetail", ""),
                                sets=sets, winner=win, best_of=5 if c.get("format", {}).get("regulation", {}).get("periods") == 5 and tour == "atp" and "Qualifying" not in rnd and ev.get("major") else 3,
                                players=[dict(name=x["athlete"]["displayName"], short=x["athlete"].get("shortName"),
                                              country=x["athlete"].get("flag", {}).get("alt", "")) for x in cs], fs=None))
    return out

FS_CIRC = {"ATP": "ATP", "WTA": "WTA", "CHALLENGER MEN": "Challenger", "CHALLENGER WOMEN": "WTA 125", "ITF MEN": "ITF muži", "ITF WOMEN": "ITF ženy",
           "DAVIS CUP": "ATP", "BILLIE JEAN KING CUP": "WTA"}

def flashscore(day_offset):
    out = []
    for e in fs.parse(fs.fetch_day(day_offset)):
        status = {1: "upcoming", 2: "live", 3: "finished"}.get(e["st"], "finished" if e["st"] > 3 else "upcoming")
        if e["det"] in (5, 8, 9, 54): status = "finished"  # zrušeno / skreč / w.o.
        out.append(dict(id="fs-" + e["id"], src="Flashscore", circuit=FS_CIRC.get(e["cat"], e["cat"]), g=e["g"], tournament=e["tname"],
                        venue="", surface=e["surface"], round="Kvalifikace" if e["q"] else "", qual=e["q"], ts=e["ts"], status=status,
                        detail="", sets=e["sets"], winner=e["win"], best_of=5 if e["lvl"] == "G" and e["g"] == "M" and not e["q"] else 3,
                        players=[dict(name=e["h"]["name"], short=e["h"]["name"], slug=e["h"]["slug"], country=e["h"]["c"]),
                                 dict(name=e["a"]["name"], short=e["a"]["name"], slug=e["a"]["slug"], country=e["a"]["c"])],
                        fs=dict(id=e["id"], pids=[e["h"]["pid"], e["a"]["pid"]])))
    return out

def merge(espn_list, fs_list):
    """ESPN je primární. Flashscore zápas stejné dvojice jen doplní povrch + id pro kurzy; ostatní FS zápasy se přidají."""
    key = lambda m: (m["g"], frozenset(surname_key(p["name"]) for p in m["players"]))
    idx = {}
    for m in fs_list: idx.setdefault(key(m), m)
    used = set(); out = []
    for m in espn_list:
        f = idx.get(key(m))
        if f:
            used.add(f["id"]); m["surface"] = f["surface"]
            same = surname_key(f["players"][0]["name"]) == surname_key(m["players"][0]["name"])
            m["fs"] = dict(id=f["fs"]["id"], pids=f["fs"]["pids"] if same else f["fs"]["pids"][::-1])
            for p, q in zip(m["players"], f["players"] if same else f["players"][::-1]): p["slug"] = q.get("slug")
            if m["status"] == "live" and len(f["sets"]) > len(m["sets"]): pass
        m["surface"] = m["surface"] or "Hard"; out.append(m)
    out += [m for m in fs_list if m["id"] not in used]
    return out

ODDS = "https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId={id}&projectId=2&geoIpCode=CZ&geoIpSubdivisionCode=CZ10"

def odds(fsinfo):
    """Kurzy na vítěze zápasu od jednotlivých sázkových kanceláří -> [{bookmaker, a, b, open_a, open_b}]"""
    d = json.loads(_get(ODDS.format(id=fsinfo["id"])))["data"]["findOddsByEventId"] or {}
    names = {}
    for grp in (d.get("settings") or {}).get("bookmakers", []) or []:
        bk = grp.get("bookmaker") or {}; names[bk.get("id")] = bk.get("name")
    res = []; ha, aw = fsinfo["pids"]
    for b in d.get("odds") or []:
        if b.get("bettingType") != "HOME_AWAY" or b.get("bettingScope") != "FULL_TIME": continue
        m = {x.get("eventParticipantId"): x for x in b.get("odds", [])}
        try:
            a, bb = float(m[ha]["value"]), float(m[aw]["value"])
        except (KeyError, TypeError, ValueError): continue
        if a > 1 and bb > 1:
            res.append(dict(bookmaker=names.get(b.get("bookmakerId"), f"#{b.get('bookmakerId')}"), a=a, b=bb,
                            open_a=float(m[ha].get("opening") or 0) or None, open_b=float(m[aw].get("opening") or 0) or None))
    return res

S365 = "https://webws.365scores.com/web/games/current/?appTypeId=5&langId=1&timezoneName=Europe%2FPrague&userCountryId=1&sports=3"
PT = {0: 0, 15: 1, 30: 2, 40: 3, 50: 4}

def live365():
    """Doplněk pro živé zápasy: body v gemu a podávající (365scores, veřejný JSON). Klíč = dvojice příjmení."""
    d = json.loads(_get(S365)); out = {}
    for g in d.get("games", []):
        if g.get("statusGroup") != 3: continue
        h, a = g.get("homeCompetitor", {}), g.get("awayCompetitor", {})
        st = {s.get("name"): s for s in g.get("stages", [])}
        gm = st.get("Game") or {}
        sets = [[int(s["homeCompetitorScore"]), int(s["awayCompetitorScore"])] for n, s in st.items()
                if n.startswith("Set ") and s.get("homeCompetitorScore", -1) >= 0]
        try:
            pts = (PT.get(int(gm.get("homeCompetitorScore", 0)), 0), PT.get(int(gm.get("awayCompetitorScore", 0)), 0))
        except (TypeError, ValueError):
            pts = (0, 0)
        if pts == (4, 3) or pts == (3, 4): pass
        elif 4 in pts: pts = (4, 3) if pts[0] == 4 else (3, 4)
        srv = 1 if h.get("inPossession") else 2 if a.get("inPossession") else None
        key = frozenset((surname_key(h.get("name", "")), surname_key(a.get("name", ""))))
        out[key] = dict(pts=pts, server=srv, sets=sets, home=surname_key(h.get("name", "")), pts_raw=[gm.get("homeCompetitorScore"), gm.get("awayCompetitorScore")])
    return out
