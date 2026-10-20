"""Markovův model tenisu: z pravděpodobností vyhraného bodu na podání (pa, pb) spočítá šanci na gem,
tiebreak, set a zápas z libovolného stavu (sety, gemy, body, podávající)."""
from functools import lru_cache

def game(p, a=0, b=0):
    """P(podávající vyhraje gem) ze stavu bodů a:b."""
    @lru_cache(None)
    def g(x, y):
        if x >= 4 and x - y >= 2: return 1.0
        if y >= 4 and y - x >= 2: return 0.0
        if x >= 3 and y >= 3 and x == y:
            return p * p / (p * p + (1 - p) * (1 - p))
        return p * g(x + 1, y) + (1 - p) * g(x, y + 1)
    return g(a, b)

def _tb_on_first(pts):
    """True, když aktuální bod tiebreaku podává hráč, který podával první bod."""
    n = int(pts[0]) + int(pts[1])
    return ((n + 1) // 2) % 2 == 0

def tb_server(first, pts):
    """Aktuální podávající v tiebreaku. První bod podává `first` (1 nebo 2), dál se střídá po dvou bodech."""
    if first not in (1, 2):
        return None
    return first if _tb_on_first(pts) else (1 if first == 2 else 2)

def _a_served_first(a_serving_now, pts):
    """a_serving_now = A podává tento bod. Vrátí, jestli A podával první bod tiebreaku."""
    return a_serving_now if _tb_on_first(pts) else not a_serving_now

def tiebreak(pa, pb, a=0, b=0, a_serves_first=True, target=7):
    @lru_cache(None)
    def t(x, y):
        if x >= target and x - y >= 2: return 1.0
        if y >= target and y - x >= 2: return 0.0
        if x >= target - 1 and y >= target - 1 and x == y:
            # od vyrovnaného stavu: dva body, každý hráč jeden podává
            w = pa * (1 - pb); l = (1 - pa) * pb
            return w / (w + l) if w + l > 0 else 0.5
        n = x + y; a_srv = ((n + 1) // 2) % 2 == 0
        if not a_serves_first: a_srv = not a_srv
        q = pa if a_srv else 1 - pb
        return q * t(x + 1, y) + (1 - q) * t(x, y + 1)
    return t(a, b)

def set_prob(pa, pb, ga=0, gb=0, a_serving=True, pts=(0, 0), tb_to=7):
    """P(A vyhraje set). a_serving = A podává aktuální gem, v tiebreaku aktuální bod.
    tb_to = 7 běžný tiebreak, 10 supertiebreak."""
    ha, hb = game(pa), game(pb)
    @lru_cache(None)
    def s(x, y, a_srv):
        if x >= 6 and x - y >= 2 or x == 7: return 1.0
        if y >= 6 and y - x >= 2 or y == 7: return 0.0
        if x == 6 and y == 6: return tiebreak(pa, pb, a_serves_first=a_srv, target=tb_to)
        q = ha if a_srv else 1 - hb
        return q * s(x + 1, y, not a_srv) + (1 - q) * s(x, y + 1, not a_srv)
    if pts != (0, 0) and not (ga == 6 and gb == 6):
        q = game(pa, pts[0], pts[1]) if a_serving else 1 - game(pb, pts[1], pts[0])
        return q * s(ga + 1, gb, not a_serving) + (1 - q) * s(ga, gb + 1, not a_serving)
    if ga == 6 and gb == 6:
        # a_serving je podávající tohoto bodu, ne nutně prvního
        return tiebreak(pa, pb, pts[0], pts[1], a_serves_first=_a_served_first(a_serving, pts), target=tb_to)
    return s(ga, gb, a_serving)

def match_prob(pa, pb, sa=0, sb=0, ga=0, gb=0, a_serving=True, pts=(0, 0), best_of=3, tb_to=7, match_tb=False):
    need = best_of // 2 + 1
    ps = (set_prob(pa, pb, a_serving=True) + set_prob(pa, pb, a_serving=False)) / 2
    @lru_cache(None)
    def m(x, y):
        if x >= need: return 1.0
        if y >= need: return 0.0
        return ps * m(x + 1, y) + (1 - ps) * m(x, y + 1)
    if sa >= need: return 1.0
    if sb >= need: return 0.0
    in_tb = bool(match_tb or (ga == 6 and gb == 6))
    def cur_of(a_srv):
        if match_tb:
            return tiebreak(pa, pb, pts[0], pts[1], a_serves_first=_a_served_first(a_srv, pts), target=tb_to)
        return set_prob(pa, pb, ga, gb, a_srv, pts, tb_to)
    if not in_tb:
        cur = cur_of(a_serving)
        return cur * m(sa + 1, sb) + (1 - cur) * m(sa, sb + 1)
    # Po tiebreaku podává příjemce prvního bodu. Další sety zůstávají průměrem obou podání.
    a_first = _a_served_first(a_serving, pts)
    next_is_decider = sa + sb + 1 >= best_of - 1
    ps_next = set_prob(pa, pb, 0, 0, not a_first, tb_to=10 if next_is_decider else 7)
    @lru_cache(None)
    def m2(x, y, use_next):
        if x >= need: return 1.0
        if y >= need: return 0.0
        pset = ps_next if use_next else ps
        return pset * m2(x + 1, y, False) + (1 - pset) * m2(x, y + 1, False)
    cur = cur_of(a_serving)
    return cur * m2(sa + 1, sb, True) + (1 - cur) * m2(sa, sb + 1, True)

def serve_probs(p_match, female=False, best_of=3):
    """Najde pa = base+d, pb = base-d tak, aby předzápasová šance Markova = p_match (bisekce)."""
    base = 0.56 if female else 0.64
    lo, hi = -0.25, 0.25
    for _ in range(40):
        d = (lo + hi) / 2
        if match_prob(base + d, base - d, best_of=best_of) < p_match: lo = d
        else: hi = d
    d = (lo + hi) / 2
    return base + d, base - d

def _tb_target(sets_done, best_of, tb_to):
    """7 v běžném setu, 10 v rozhodujícím."""
    if tb_to is not None:
        return tb_to
    if len(sets_done) >= best_of - 1:
        return 10
    return 7

def live(p_pre, sets_done, cur_games, pts=(0, 0), server=None, female=False, best_of=3, tb_to=None, match_tb=False):
    """sets_done = dokončené sety, cur_games = gemy aktuálního setu.
    server 1/2/None je podávající aktuálního bodu (v tiebreaku ne ten z prvního bodu). Neznámý = průměr.
    V rozhodujícím setu je tiebreak na 10 bodů."""
    pa, pb = serve_probs(p_pre, female, best_of)
    sa = sum(1 for a, b in sets_done if a > b); sb = len(sets_done) - sa
    ga, gb = cur_games
    pts = (int(pts[0]), int(pts[1]))
    target = 10 if match_tb and tb_to is None else _tb_target(sets_done, best_of, tb_to)
    in_tb = bool(match_tb or (ga == 6 and gb == 6))
    srv = [True, False] if server is None else [server == 1]
    kw = dict(pts=pts, best_of=best_of, tb_to=target, match_tb=match_tb)
    pm = sum(match_prob(pa, pb, sa, sb, ga, gb, s, **kw) for s in srv) / len(srv)
    if match_tb:
        pset = sum(tiebreak(pa, pb, pts[0], pts[1], _a_served_first(s, pts), target) for s in srv) / len(srv)
    else:
        pset = sum(set_prob(pa, pb, ga, gb, s, pts, target) for s in srv) / len(srv)
    pgame = None
    if server is not None and not in_tb:
        pgame = game(pa, *pts) if server == 1 else 1 - game(pb, pts[1], pts[0])
    return dict(match=pm, set=pset, game=pgame, pa=pa, pb=pb, hold_a=game(pa), hold_b=game(pb))
