"""Záložní predikce a volnější párování jmen.

Přísná shoda (Predictor.find) se nemění. find_any ji jen doplní, když přísná shoda nic nenašla,
a jen při jednoznačném příjmení + iniciále. Zápas, který už má oba hráče v historii, dál dostane
stejný výstup modelu. Chybějící hráč dostane Elo ze žebříčku, jinak prior podle úrovně turnaje,
a predikce je označená jako nízká spolehlivost.
"""
import math, re, unicodedata

RANK_ELO = {"M": (3050.7, -198.2), "W": (2883.6, -140.7)}
# Startovní Elo modelu je 1500. Prior je od toho posunutý podle úrovně (ne extrapolace žebříčku,
# která by nováčka bez zápasů přecenila). Kvalifikace je o stupeň níž.
TOUR_PRIOR = {"ATP": 1560.0, "WTA": 1560.0, "Challenger": 1500.0, "WTA 125": 1500.0, "ITF muži": 1440.0, "ITF ženy": 1440.0}
QUAL_DROP = 25.0
MIN_HISTORY = 5
_STOP = {"jr", "sr"}


def toks(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return [t for t in re.findall(r"[a-z]+", s) if t not in _STOP]


def is_placeholder(name):
    t = toks(name)
    if not t:
        return True
    if t in (["tbd"], ["tba"], ["bye"], ["qualifier"], ["qualifying"], ["unknown"]):
        return True
    raw = re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower())
    return raw in {"tbd", "tba", "bye", "qualifier", "qualifying", "unknown", "player"}


def relax_keys(name):
    """Klíče (příjmení, iniciála) pro volnou shodu. Krátká příjmení (< 4) vynecháme – snadno se spletou."""
    name = str(name or "").strip()
    m = re.match(r"^(.*?)\s+((?:[A-Za-z][\w\-]*\.\s*)+)$", name)
    if m:
        sur = "".join(toks(m.group(1)))
        parts = [toks(x)[0] for x in m.group(2).split() if toks(x)]
        if len(sur) >= 4 and parts:
            return [(sur, parts[0][0])]
        return []
    t = toks(name)
    if len(t) < 2:
        return []
    keys = []
    sur = "".join(t[1:])
    if len(sur) >= 4:
        keys.append((sur, t[0][0]))
    if len(t) == 2 and len(t[0]) >= 4:
        rev = (t[0], t[-1][0])
        if rev not in keys:
            keys.append(rev)
    return keys


def build_relax(names):
    """names: pid -> jméno. Hodnota None = klíč není jednoznačný."""
    rx = {}
    for pid, nm in names.items():
        g = pid[0] if isinstance(pid, str) and pid else ""
        for sur, ini in relax_keys(nm):
            k = (g, sur, ini)
            cur = rx.get(k, None)
            if k not in rx:
                rx[k] = pid
            elif cur != pid:
                rx[k] = None
    return rx


def match_relax(rx, g, name):
    if not name or is_placeholder(name):
        return None
    for sur, ini in relax_keys(name):
        hit = rx.get((g, sur, ini), None)
        if hit:
            return hit
    return None


def elo_from_rank(g, rank):
    a, b = RANK_ELO.get(g, RANK_ELO["M"])
    return a + b * math.log(max(1.0, float(rank)))


def tour_elo(m):
    base = TOUR_PRIOR.get(m.get("circuit") or "", 1500.0)
    if m.get("qual"):
        base -= QUAL_DROP
    return base


def _note(kinds):
    if any(k == "tbd" for k in kinds):
        return "Soupeř není určen – nízká spolehlivost."
    if any(k == "rank" for k in kinds) and all(k in ("hist", "rank") for k in kinds):
        return "Odhad ze žebříčku – nízká spolehlivost."
    if any(k == "rank" for k in kinds):
        return "Odhad ze žebříčku a úrovně turnaje – nízká spolehlivost."
    return "Odhad podle úrovně turnaje – hráč bez historie, nízká spolehlivost."


def fallback_prob(m, elos, kinds):
    """elos: dvě čísla (prior už dosazený i za TBD). kinds: hist|rank|tour|tbd. Vrací (p, poznámka)."""
    pe = 1.0 / (1.0 + 10 ** ((elos[1] - elos[0]) / 400.0))
    unknown = sum(k != "hist" for k in kinds)
    shrink = 0.6 if unknown >= 2 else 0.75 if unknown == 1 else 1.0
    if any(k == "tbd" for k in kinds):
        shrink = min(shrink, 0.35)
    p = 0.5 + (pe - 0.5) * shrink
    return min(0.98, max(0.02, p)), _note(kinds)


def side_elo(m, player, known_elo):
    """(elo, kind) pro jednu stranu. known_elo je None, když hráče nemáme v historii."""
    if known_elo is not None and not is_placeholder(player.get("name")):
        return float(known_elo), "hist"
    if is_placeholder(player.get("name")):
        return tour_elo(m), "tbd"
    rk = player.get("ranking")
    if rk:
        try:
            return elo_from_rank(m.get("g") or "M", rk), "rank"
        except (TypeError, ValueError):
            pass
    return tour_elo(m), "tour"


def prediction_for(m, strict_ids, any_ids, elo_of, n_of, predict):
    """Doplní predikci. strict_ids oba nastavené = původní model beze změny příznaku nízké spolehlivosti.
    predict(a, b) -> dict s p a p_lr. Vrací dict polí, která se mají zapsat do zápasu."""
    if all(strict_ids):
        pr = predict(strict_ids[0], strict_ids[1])
        return dict(pids=list(strict_ids), pred=round(float(pr["p"]), 4), pred_lr=round(float(pr["p_lr"]), 4),
                    pred_low=False, pred_note=None, _model=True)
    ids = list(any_ids)
    if all(ids):
        pr = predict(ids[0], ids[1])
        thin = min(n_of(ids[0]), n_of(ids[1])) < MIN_HISTORY
        return dict(pids=ids, pred=round(float(pr["p"]), 4), pred_lr=round(float(pr["p_lr"]), 4),
                    pred_low=bool(thin), pred_note=("Málo odehraných zápasů v datech – nízká spolehlivost." if thin else None),
                    _model=True)
    elos, kinds = [], []
    for i, p in enumerate(m["players"]):
        known = elo_of(ids[i]) if ids[i] else None
        e, k = side_elo(m, p, known)
        elos.append(e); kinds.append(k)
    p, note = fallback_prob(m, elos, kinds)
    return dict(pids=ids, pred=round(p, 4), pred_lr=None, pred_low=True, pred_note=note, _model=False)
