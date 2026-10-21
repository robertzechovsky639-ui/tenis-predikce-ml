"""Živá data: ESPN (primární, ATP/WTA vč. kvalifikací) + veřejný feed Flashscore (doplněk: Challenger, WTA 125,
ITF muži/ženy, kvalifikace a zápasy ATP/WTA, které ESPN nemá). Kurzy: veřejný odds feed Flashscore (bez klíče)."""
import datetime, json, re, unicodedata, urllib.request, zoneinfo
import fs
import scoremerge as SM

TZ = zoneinfo.ZoneInfo("Europe/Prague")
UA = {"User-Agent": "Mozilla/5.0"}
ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis/{t}/scoreboard"

def _get(url, headers=UA, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")

def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return "".join(re.findall(r"[a-z]+", s))

_PARTICLE = {"de", "da", "di", "du", "van", "von", "del", "dos", "das", "la", "le", "el", "al", "st"}

def name_tokens(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    return [t for t in re.findall(r"[a-z]+", s) if t not in ("jr", "sr")]

def sig_tokens(name):
    return [t for t in name_tokens(name) if len(t) >= 2 and t not in _PARTICLE]

def _placeholder(name):
    t = name_tokens(name)
    raw = "".join(t)
    return raw in {"tbd", "tba", "bye", "qualifier", "qualifying", "unknown", "player"} or (len(t) == 1 and t[0] in {"tbd", "tba", "bye"})

def _parse_name(name):
    """Rozdělí jméno na příjmení, křestní a iniciály. 'Ficovich J. P.' i 'J. Pablo Ficovich'."""
    s = str(name or "").strip()
    all_t = name_tokens(s)
    has_particle = any(t in _PARTICLE for t in all_t)
    initials, given, surnames = [], [], []
    m = re.match(r"^(.*?)\s+((?:[A-Za-z][\w\-]*\.\s*)+)$", s)
    if m:
        for tok in name_tokens(m.group(1)):
            if tok in _PARTICLE:
                continue
            (initials if len(tok) == 1 else surnames).append(tok)
        for part in m.group(2).split():
            tok = (name_tokens(part) or [""])[0]
            if not tok or tok in _PARTICLE:
                continue
            (initials if len(tok) == 1 else given).append(tok)
        return dict(trailing=True, surnames=surnames, initials=initials, given=given, sig=surnames + given, has_particle=has_particle)
    sig = []
    for tok in all_t:
        if tok in _PARTICLE:
            continue
        if len(tok) == 1:
            initials.append(tok)
        else:
            sig.append(tok)
    if sig:
        surnames.append(sig[-1])
        given.extend(sig[:-1])
    return dict(trailing=False, surnames=surnames, initials=initials, given=given, sig=sig, has_particle=has_particle)

def _assign_initials(initials, pool):
    used = [False] * len(pool)

    def rec(i):
        if i == len(initials):
            return True
        for j, cand in enumerate(pool):
            if used[j] or not cand or cand[0] != initials[i]:
                continue
            used[j] = True
            if rec(i + 1):
                return True
            used[j] = False
        return False

    return rec(0)

def _prefix_given(abbr, fulls):
    used = [False] * len(fulls)

    def rec(i):
        if i == len(abbr):
            return True
        for j, cand in enumerate(fulls):
            if used[j] or not (cand.startswith(abbr[i]) and len(cand) > len(abbr[i])):
                continue
            used[j] = True
            if rec(i + 1):
                return True
            used[j] = False
        return False

    return rec(0)

def same_player(a, b):
    """Stejný hráč přes iniciály, složené příjmení, pořadí jmen a diakritiku. Čtyřhra a TBD ne."""
    if _placeholder(a) or _placeholder(b):
        return False
    if any(ch in str(x or "") for x in (a, b) for ch in "/&"):
        return False
    A, B = _parse_name(a), _parse_name(b)
    if not A["sig"] or not B["sig"]:
        return False
    if A["trailing"] and B["trailing"]:
        sur = lambda xs: "|".join(sorted(xs))
        if sur(A["surnames"]) != sur(B["surnames"]):
            return False
        if "".join(sorted(A["initials"])) != "".join(sorted(B["initials"])):
            return False
        return sur(A["given"]) == sur(B["given"])
    trail = A if A["trailing"] else B if B["trailing"] else None
    full = (B if trail is A else A) if trail else None
    if trail:
        full_sig = set(full["sig"])
        last = trail["surnames"][-1] if trail["surnames"] else ""
        primary = bool(last) and last == (full["surnames"][0] if full["surnames"] else "") and all(t in full_sig for t in trail["surnames"])
        compound = bool(trail["surnames"]) and trail["surnames"][0] == (full["surnames"][0] if full["surnames"] else "")
        asian = (not full["has_particle"] and len(trail["surnames"]) == 1 and not trail["given"]
                 and len(full["given"]) == 1 and len(full["surnames"]) == 1
                 and trail["surnames"][0] == full["given"][0]
                 and trail["initials"] and trail["initials"][0] == full["surnames"][0][0])
        if primary or compound:
            spelled = set(trail["surnames"] + trail["given"])
            need = [g[0] for g in full["given"] if g not in spelled and not any(g.startswith(t) and len(t) >= 3 for t in trail["given"])]
            if not _assign_initials(need, trail["initials"]):
                return False
            if not _assign_initials(trail["initials"], full["given"] + full["initials"]):
                return False
            if trail["given"] and not _prefix_given(trail["given"], full["given"]):
                return False
            return _assign_initials(full["initials"], trail["initials"] + trail["given"] + trail["surnames"])
        if not asian:
            return False
        if not _assign_initials(trail["initials"][1:], [full["surnames"][0], full["given"][0]] + full["initials"]):
            return False
        return _assign_initials(full["initials"], trail["initials"] + trail["surnames"])
    seta, setb = set(A["sig"]), set(B["sig"])
    equal = seta == setb
    same_sur = A["surnames"] and A["surnames"][0] == (B["surnames"][0] if B["surnames"] else "")
    if not (equal or (same_sur and (seta <= setb or setb <= seta))):
        return False
    return _assign_initials(A["initials"], B["sig"] + B["initials"]) and _assign_initials(B["initials"], A["sig"] + A["initials"])

def same_pair(a1, a2, b1, b2):
    return (same_player(a1, b1) and same_player(a2, b2)) or (same_player(a1, b2) and same_player(a2, b1))

def surname_key(name):
    """Rozlišující příjmení: 'Sinner J.' i 'Jannik Sinner' -> sinner, 'Meligeni Alves F.' i 'F. Meligeni Alves' -> alves."""
    long = sig_tokens(name)
    return long[-1] if long else ""

def canon_tournament(name):
    """'Cali (Colombia)' i 'Cali, Colombia' -> 'Cali'. Zbytek názvu nechá."""
    s = str(name or "").strip()
    if not s:
        return ""
    if "," in s:
        s = s.split(",", 1)[0]
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"^(?i:atp|wta|itf|challenger|men|women)\s+", "", s).strip()
    return s

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
    used = set(); out = []
    for m in espn_list:
        f = None
        for cand in fs_list:
            if cand["id"] in used or cand.get("g") != m.get("g"):
                continue
            if same_pair(m["players"][0]["name"], m["players"][1]["name"], cand["players"][0]["name"], cand["players"][1]["name"]):
                f = cand
                break
        if f:
            used.add(f["id"]); m["surface"] = f["surface"]
            same = same_player(m["players"][0]["name"], f["players"][0]["name"])
            m["fs"] = dict(id=f["fs"]["id"], pids=f["fs"]["pids"] if same else f["fs"]["pids"][::-1])
            for p, q in zip(m["players"], f["players"] if same else f["players"][::-1]): p["slug"] = q.get("slug")
            if m["status"] == "live" and f.get("sets"):
                fs_sets = f["sets"] if same else [list(reversed(s)) for s in f["sets"]]
                if SM.cmp_score(m["sets"], None, fs_sets, None) > 0 and SM.norm_sets(fs_sets) != SM.norm_sets(m["sets"]):
                    m["sets"] = [[int(a), int(b)] for a, b in fs_sets]
        m["surface"] = m["surface"] or "Hard"
        label = canon_tournament(m.get("tournament"))
        if label: m["tournament"] = label
        out.append(m)
    for m in fs_list:
        if m["id"] in used: continue
        label = canon_tournament(m.get("tournament"))
        if label: m["tournament"] = label
        out.append(m)
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

def map_point(raw):
    """0/15/30/40/50 jsou body gemu. Ostatní čísla (1, 2, 7, …) jsou body tiebreaku, ne nula."""
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 0
    return PT[n] if n in PT else n

def live365():
    """Doplněk pro živé zápasy: body v gemu a podávající (365scores, veřejný JSON). Párování je podle jmen, ne jen příjmení."""
    d = json.loads(_get(S365)); out = []
    for g in d.get("games", []):
        if g.get("statusGroup") != 3: continue
        h, a = g.get("homeCompetitor", {}), g.get("awayCompetitor", {})
        st = {s.get("name"): s for s in g.get("stages", [])}
        gm = st.get("Game") or {}
        named = []
        for n, s in st.items():
            if not str(n).startswith("Set ") or s.get("homeCompetitorScore", -1) < 0: continue
            try: num = int(str(n).split()[-1])
            except ValueError: num = 0
            named.append((num, [int(s["homeCompetitorScore"]), int(s["awayCompetitorScore"])]))
        sets = [row for _, row in sorted(named)]
        raw_h, raw_a = gm.get("homeCompetitorScore", 0), gm.get("awayCompetitorScore", 0)
        pts = (map_point(raw_h), map_point(raw_a))
        try:
            adv = int(raw_h) == 50 or int(raw_a) == 50
        except (TypeError, ValueError):
            adv = False
        if adv and pts not in ((4, 3), (3, 4)):
            pts = (4, 3) if int(raw_h) == 50 else (3, 4)
        srv = 1 if h.get("inPossession") else 2 if a.get("inPossession") else None
        out.append(dict(pts=pts, server=srv, sets=sets, home=surname_key(h.get("name", "")),
                        home_name=h.get("name") or "", away_name=a.get("name") or "",
                        pts_raw=[gm.get("homeCompetitorScore"), gm.get("awayCompetitorScore")]))
    return out
