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

def set_prob(pa, pb, ga=0, gb=0, a_serving=True, pts=(0, 0)):
    """P(A vyhraje set) ze stavu gemů ga:gb; a_serving = A podává aktuální gem; pts = body v aktuálním gemu (A, B)."""
    ha, hb = game(pa), game(pb)
    @lru_cache(None)
    def s(x, y, a_srv):
        if x >= 6 and x - y >= 2 or x == 7: return 1.0
        if y >= 6 and y - x >= 2 or y == 7: return 0.0
        if x == 6 and y == 6: return tiebreak(pa, pb, a_serves_first=a_srv)
        q = ha if a_srv else 1 - hb
        return q * s(x + 1, y, not a_srv) + (1 - q) * s(x, y + 1, not a_srv)
    if pts != (0, 0) and not (ga == 6 and gb == 6):
        q = game(pa, pts[0], pts[1]) if a_serving else 1 - game(pb, pts[1], pts[0])
        return q * s(ga + 1, gb, not a_serving) + (1 - q) * s(ga, gb + 1, not a_serving)
    if ga == 6 and gb == 6: return tiebreak(pa, pb, pts[0], pts[1], a_serves_first=a_serving)
    return s(ga, gb, a_serving)

def match_prob(pa, pb, sa=0, sb=0, ga=0, gb=0, a_serving=True, pts=(0, 0), best_of=3):
    need = best_of // 2 + 1
    ps = set_prob(pa, pb)  # nový set (podání ~ symetrické průměrem)
    ps = (set_prob(pa, pb, a_serving=True) + set_prob(pa, pb, a_serving=False)) / 2
    @lru_cache(None)
    def m(x, y):
        if x >= need: return 1.0
        if y >= need: return 0.0
        return ps * m(x + 1, y) + (1 - ps) * m(x, y + 1)
    if sa >= need: return 1.0
    if sb >= need: return 0.0
    cur = set_prob(pa, pb, ga, gb, a_serving, pts)
    return cur * m(sa + 1, sb) + (1 - cur) * m(sa, sb + 1)

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

def live(p_pre, sets_done, cur_games, pts=(0, 0), server=None, female=False, best_of=3):
    """sets_done = [(a,b),...] dokončené sety, cur_games = (a,b) v aktuálním setu, server 1/2/None (neznámý -> průměr)."""
    pa, pb = serve_probs(p_pre, female, best_of)
    sa = sum(1 for a, b in sets_done if a > b); sb = len(sets_done) - sa
    ga, gb = cur_games
    srv = [True, False] if server is None else [server == 1]
    pm = sum(match_prob(pa, pb, sa, sb, ga, gb, s, pts, best_of) for s in srv) / len(srv)
    pset = sum(set_prob(pa, pb, ga, gb, s, pts) for s in srv) / len(srv)
    pgame = None
    if server is not None and not (ga == 6 and gb == 6):
        pgame = game(pa, *pts) if server == 1 else 1 - game(pb, pts[1], pts[0])
    return dict(match=pm, set=pset, game=pgame, pa=pa, pb=pb, hold_a=game(pa), hold_b=game(pb))
