"""Monotónní skóre: novější stav (víc gemů / bodů) smí přepsat starší, starší odpověď zdroje ne.

Stejná pravidla jsou v web/live.js (prohlížeč). Shoda se ověřuje testem na obou stranách.
"""


def finished_set(s):
    if not s or len(s) < 2:
        return False
    try:
        a, b = int(s[0]), int(s[1])
    except (TypeError, ValueError):
        return False
    hi, lo = max(a, b), min(a, b)
    return (hi >= 6 and hi - lo >= 2) or (hi == 7 and lo == 6)


def norm_sets(sets):
    out = []
    for s in sets or []:
        try:
            a, b = int(s[0]), int(s[1])
        except (TypeError, ValueError, IndexError):
            continue
        if a < 0 or b < 0:
            continue
        out.append([a, b])
    # 0:0 po dohraném setu je nový set (i po 7:6). 0:0 po nedohraném setu je jen výplň.
    while len(out) >= 2 and out[-1] == [0, 0] and not finished_set(out[-2]):
        out.pop()
    while len(out) == 1 and out[0] == [0, 0]:
        out.pop()
    while len(out) >= 2 and out[-1] == [0, 0] and out[-2] == [0, 0]:
        out.pop()
    return out


def drop_open(sets):
    s = [list(x) for x in norm_sets(sets)]
    if s and s[-1] == [0, 0]:
        s.pop()
    return s


def split_live(sets, status="live"):
    """Dokončené sety a aktuální gemy. 7:6 i 6:7 jsou dohrané; další set začíná 0:0."""
    s = [list(x) for x in norm_sets(sets)]
    if status == "live":
        if not s:
            return {"done": [], "cur": [0, 0], "n": 1}
        if finished_set(s[-1]):
            return {"done": s, "cur": [0, 0], "n": len(s) + 1}
        return {"done": s[:-1], "cur": s[-1], "n": len(s)}
    return {"done": [x for x in s if finished_set(x)], "cur": None, "n": len(s)}


def point_rank(pts):
    if not pts:
        return -1
    try:
        a, b = int(pts[0]), int(pts[1])
    except (TypeError, ValueError, IndexError):
        return -1
    return (a + b) * 100 + max(a, b)


def cmp_score(a_sets, a_pts, b_sets, b_pts):
    """1 = b je před a, -1 = b je za a, 0 = stejný stav gemů a bodů.

    Delší seznam po dohraném setu (i když nový set je 0:0) je dopředu.
    Kratší seznam je pozadu. Nižší body samy o sobě nový set nezablokují.
    """
    A, B = norm_sets(a_sets), norm_sets(b_sets)
    for i in range(max(len(A), len(B))):
        x = A[i] if i < len(A) else None
        y = B[i] if i < len(B) else None
        if x is None or y is None:
            longer = y if y is not None else x
            prev = (B if y is not None else A)[i - 1] if i else None
            open_set = longer == [0, 0] and prev is not None and finished_set(prev)
            if open_set:
                # Nový set 0:0 je dopředu hned. Kratší seznam je pozadu.
                if x is None and y is not None:
                    return 1
                return -1
            xx = x if x is not None else [0, 0]
            yy = y if y is not None else [0, 0]
            if xx == yy:
                continue
            if yy[0] >= xx[0] and yy[1] >= xx[1]:
                return 1
            if xx[0] >= yy[0] and xx[1] >= yy[1]:
                return -1
            return -1
        if x == y:
            continue
        if y[0] >= x[0] and y[1] >= x[1]:
            return 1
        if x[0] >= y[0] and x[1] >= y[1]:
            return -1
        return -1
    bp, ap = point_rank(b_pts), point_rank(a_pts)
    if bp > ap:
        return 1
    if bp < ap:
        return -1
    return 0


def close_finished_tb(sets, pts, best_of=3):
    """Tiebreak dohraný v bodech je set 7:6, i když zdroj ještě hlásí gemy 6:6."""
    s = []
    for row in sets or []:
        try:
            s.append([int(row[0]), int(row[1])])
        except (TypeError, ValueError, IndexError):
            continue
    if not s or not pts or s[-1] != [6, 6]:
        return s, list(pts) if pts else pts, False
    try:
        x, y = int(pts[0]), int(pts[1])
    except (TypeError, ValueError, IndexError):
        return s, pts, False
    target = 10 if len(s) >= (best_of or 3) else 7
    hi, lo = max(x, y), min(x, y)
    if hi >= target and hi - lo >= 2:
        s[-1] = [7, 6] if x > y else [6, 7]
        return s, [0, 0], True
    return s, [x, y], False


def is_match_tb(sets, pts, best_of=3):
    """Rozhodující tiebreak místo setu: sety rozdělené a body už nejsou gem (víc než 4)."""
    s = [list(x) for x in norm_sets(sets)]
    if not pts:
        return False
    try:
        x, y = int(pts[0]), int(pts[1])
    except (TypeError, ValueError, IndexError):
        return False
    played = s[:-1] if s and s[-1] == [0, 0] else s
    if not played or any(not finished_set(g) for g in played):
        return False
    a = sum(g[0] > g[1] for g in played)
    b = sum(g[1] > g[0] for g in played)
    return a == b and a > 0 and a * 2 + 1 == (best_of or 3) and max(x, y) > 4


def is_deuce_reset(old_pts, new_pts):
    if not old_pts or not new_pts:
        return False
    try:
        a, b, c, d = int(old_pts[0]), int(old_pts[1]), int(new_pts[0]), int(new_pts[1])
    except (TypeError, ValueError, IndexError):
        return False
    adv = min(a, b) >= 3 and max(a, b) >= 4 and abs(a - b) == 1
    return adv and c == 3 and d == 3


def only_opened_set(prev, nxt):
    """Jediná změna je přidané 0:0 po dohraném setu."""
    A, B = norm_sets(prev), norm_sets(nxt)
    if not A or len(B) != len(A) + 1:
        return False
    if B[-1] != [0, 0] or not finished_set(B[-2]):
        return False
    return A == B[:-1]


def match_winner(sets, best_of=3):
    """Na dva (u pěti setů tři) dohrané sety je zápas rozhodnutý, i když zdroj ještě hlásí live."""
    s = [list(x) for x in norm_sets(sets)]
    played = s[:-1] if s and s[-1] == [0, 0] else s
    if not played or any(not finished_set(g) for g in played):
        return 0
    a = sum(g[0] > g[1] for g in played)
    b = sum(g[1] > g[0] for g in played)
    need = ((best_of or 3) + 1) // 2
    if a >= need:
        return 1
    if b >= need:
        return 2
    return 0


def seal_match(row, best_of=3):
    if not row or row.get("status") == "finished":
        return row
    w = match_winner(row.get("sets"), best_of or row.get("best_of") or 3)
    if not w:
        return row
    row["status"] = "finished"
    row["winner"] = row.get("winner") or w
    row["sets"] = drop_open(row.get("sets"))
    row["pts"] = None
    row["pts_raw"] = None
    row["server"] = None
    row["srv_trust"] = 0
    return row


def keep_score(prev, new):
    bo = (new or {}).get("best_of") or (prev or {}).get("best_of") or 3
    return seal_match(_keep_score(prev, new), bo)


def _keep_score(prev, new):
    """Nový snímek (pozdější dotaz) nesmí vrátit skóre ani znovu otevřít dohraný zápas.
    Návrat z výhody na shodu (40:40) je platný nový stav. Predikci nemění. Vrací new."""
    if new.get("status") != "finished":
        bo = new.get("best_of") or (prev or {}).get("best_of") or 3
        sets, pts, closed = close_finished_tb(new.get("sets"), new.get("pts"), bo)
        if closed:
            new["sets"] = sets
            new["pts"] = pts
            new["pts_raw"] = [0, 0]
    if not prev:
        return new
    if prev.get("status") == "finished" and new.get("status") != "finished":
        for k in ("status", "sets", "pts", "pts_raw", "server", "winner"):
            if k in prev:
                new[k] = prev[k]
        return new
    if new.get("status") == "finished" and prev.get("status") != "finished":
        rel_fin = cmp_score(drop_open(prev.get("sets")), None, drop_open(new.get("sets")), None)
        if rel_fin < 0:
            new["sets"] = prev.get("sets")
            new["pts"] = prev.get("pts")
            new["pts_raw"] = prev.get("pts_raw")
            new["server"] = prev.get("server")
            new["srv_trust"] = prev.get("srv_trust")
            new["winner"] = prev.get("winner") or 0
            new["status"] = "live"
            return new
        new["sets"] = drop_open(new.get("sets") if rel_fin > 0 else prev.get("sets"))
        new["pts"] = None
        new["pts_raw"] = None
        new["server"] = None
        new["srv_trust"] = 0
        return new
    rel = cmp_score(prev.get("sets"), prev.get("pts"), new.get("sets"), new.get("pts"))
    if rel > 0:
        # Nový set 0:0 jde hned. Body už rozehraného gemu a podávající se tím nesmažou.
        if only_opened_set(prev.get("sets"), new.get("sets")) and point_rank(new.get("pts")) < point_rank(prev.get("pts")):
            new["pts"] = prev.get("pts")
            new["pts_raw"] = prev.get("pts_raw")
            new["server"] = prev.get("server")
            new["srv_trust"] = prev.get("srv_trust")
        return new
    same_src = not prev.get("src_pts") or not new.get("src_pts") or prev.get("src_pts") == new.get("src_pts")
    if rel < 0 and is_deuce_reset(prev.get("pts"), new.get("pts")) and same_src:
        return new
    if rel < 0:
        new["sets"] = prev.get("sets")
        new["pts"] = prev.get("pts")
        new["pts_raw"] = prev.get("pts_raw")
        new["server"] = prev.get("server")
        new["srv_trust"] = prev.get("srv_trust")
        if prev.get("status") == "live":
            new["status"] = "live"
        return new
    if list(new.get("pts") or []) != list(prev.get("pts") or []):
        # Stejný postup bodů (40:A i A:40) nesmí otočit stranu. Prohlížeč body při rel == 0 taky nechá.
        new["pts"] = prev.get("pts")
        new["pts_raw"] = prev.get("pts_raw")
    if new.get("status") == "finished":
        return new
    if prev.get("status") == "live" and new.get("status") == "upcoming":
        new["status"] = "live"
    if (prev.get("srv_trust") or 0) > (new.get("srv_trust") or 0):
        new["server"] = prev.get("server")
        new["srv_trust"] = prev.get("srv_trust")
    return new
