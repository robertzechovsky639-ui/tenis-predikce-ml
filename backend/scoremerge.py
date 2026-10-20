"""Monotónní skóre: novější stav (víc gemů / bodů) smí přepsat starší, starší odpověď zdroje ne.

Stejná pravidla jsou v web/live.js (prohlížeč). Shoda se ověřuje testem na obou stranách.
"""


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
    while out and out[-1] == [0, 0]:
        out.pop()
    return out


def point_rank(pts):
    if not pts:
        return -1
    try:
        a, b = int(pts[0]), int(pts[1])
    except (TypeError, ValueError, IndexError):
        return -1
    return (a + b) * 100 + max(a, b)


def cmp_score(a_sets, a_pts, b_sets, b_pts):
    """1 = b je před a, -1 = b je za a, 0 = stejný stav gemů a bodů."""
    A, B = norm_sets(a_sets), norm_sets(b_sets)
    for i in range(max(len(A), len(B))):
        x = A[i] if i < len(A) else [0, 0]
        y = B[i] if i < len(B) else [0, 0]
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


def is_deuce_reset(old_pts, new_pts):
    if not old_pts or not new_pts:
        return False
    try:
        a, b, c, d = int(old_pts[0]), int(old_pts[1]), int(new_pts[0]), int(new_pts[1])
    except (TypeError, ValueError, IndexError):
        return False
    adv = min(a, b) >= 3 and max(a, b) >= 4 and abs(a - b) == 1
    return adv and c == 3 and d == 3


def keep_score(prev, new):
    """Nový snímek (pozdější dotaz) nesmí vrátit skóre ani znovu otevřít dohraný zápas.
    Návrat z výhody na shodu (40:40) je platný nový stav. Predikci nemění. Vrací new."""
    if not prev:
        return new
    if prev.get("status") == "finished" and new.get("status") != "finished":
        for k in ("status", "sets", "pts", "pts_raw", "server", "winner"):
            if k in prev:
                new[k] = prev[k]
        return new
    rel = cmp_score(prev.get("sets"), prev.get("pts"), new.get("sets"), new.get("pts"))
    if rel > 0:
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
    if new.get("status") == "finished":
        return new
    if prev.get("status") == "live" and new.get("status") == "upcoming":
        new["status"] = "live"
    if (prev.get("srv_trust") or 0) > (new.get("srv_trust") or 0):
        new["server"] = prev.get("server")
        new["srv_trust"] = prev.get("srv_trust")
    return new
