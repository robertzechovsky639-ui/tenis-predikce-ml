"""Elo, forma a H2H mezi denními běhy.

Export (≈ 10 min) znovu spočítá hodnocení z vydaného state.pkl a z malého seznamu dohraných
zápasů (state.json). Seznam se deduplikuje podle id Flashscore, případně ESPN, a drží se
jen posledních KEEP_DAYS dní. Do release `model` se odsud nic nenahrává.

Stromy LightGBM se tady nemění. maybe_boost a boost_from jsou jen pro dopředný test
(online_eval.py): na 2024–2026 brána nepřijala ani jeden blok a log loss se nezlepšil.
"""
import json, os, pathlib, zlib
import lightgbm as lgb
import features as F
from train import metrics

HOLDOUT = 500
MIN_TRAIN = 500
ROUNDS = 3
LR = 0.02
MIN_GAIN = 0.001
KEEP_DAYS = 21
SLAMS = ("australian open", "roland garros", "french open", "wimbledon", "us open")
MATCH_FIELDS = ("date", "g", "circuit", "is_qual", "surface", "tourney_name", "winner_name", "loser_name",
                "winner_slug", "loser_slug", "score")


def best_of_for(g, circuit, tourney, qual):
    name = str(tourney or "").lower()
    if g == "M" and circuit == "ATP" and not qual and any(s in name for s in SLAMS):
        return 5
    return 3


def _orient(fs_id, w, l):
    if zlib.crc32(str(fs_id).encode()) & 1:
        return l, w, 0
    return w, l, 1


def _text(value):
    if value is None:
        return ""
    try:
        if value != value:
            return ""
    except Exception:
        pass
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _qual(value):
    text = _text(value)
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def _touch_ref(P, day):
    import datetime
    today = datetime.date.today().toordinal()
    last = max(P.s["last"].values()) if P.s.get("last") else day
    P.ref_day = min(today, max(last, day) + 1)


def _snapshot(P, w, l, surf, circuit, qual, g, best_of, fs_id, day):
    a, b, y = _orient(fs_id, w, l)
    lvl = F.level_code(circuit or "ATP", "G" if best_of == 5 else "A")
    _touch_ref(P, day)
    raw = P.feats(a, b, surf, lvl, best_of, _qual(qual), int(g == "W"))
    row = {k: raw[k] for k in F.FEATURES}
    row["y"] = y
    row["id"] = str(fs_id)
    row["date"] = int(day)
    return row


def _day(value):
    import datetime
    if hasattr(value, "toordinal") and not isinstance(value, int):
        return value.toordinal()
    text = str(value)[:10]
    return datetime.date.fromisoformat(text).toordinal()


def _surf(value):
    s = str(value or "Hard")
    return s if s in ("Hard", "Clay", "Grass", "Carpet") else "Hard"


def apply_new(P, rows):
    """Započte zápasy, které ve stavu ještě nejsou. Vrací (počet, vzorky příznaků z doby PŘED zápasem)."""
    if rows is None or len(rows) == 0:
        return 0, []
    rows = rows.copy()
    rows["fs_id"] = ["" if (x is None or x != x) else str(x) for x in rows["fs_id"]]
    rows["day_ord"] = rows["date"].map(_day)
    rows = rows.sort_values(["day_ord", "fs_id"])
    seen = set(P.s.setdefault("fs_seen", set()))
    P.s["fs_seen"] = seen
    n = 0
    samples = []
    for r in rows.itertuples(index=False):
        if r.fs_id in seen:
            continue
        wslug = _text(getattr(r, "winner_slug", "")).replace("-", " ")
        lslug = _text(getattr(r, "loser_slug", "")).replace("-", " ")
        w = P.find(r.g, wslug or r.winner_name, r.winner_name)
        l = P.find(r.g, lslug or r.loser_name, r.loser_name)
        if not w or not l or w == l:
            continue
        day = int(r.day_ord)
        if P.known_result(w, l, day):
            seen.add(r.fs_id)
            continue
        last_w, last_l = P.s["last"].get(w, 0), P.s["last"].get(l, 0)
        if last_w and last_l and day < last_w and day < last_l:
            seen.add(r.fs_id)
            continue
        surf = _surf(r.surface)
        bo = best_of_for(r.g, r.circuit, r.tourney_name, r.is_qual)
        samples.append(_snapshot(P, w, l, surf, r.circuit, r.is_qual, r.g, bo, r.fs_id, day))
        P.apply_result(w, l, surf, day)
        seen.add(r.fs_id)
        n += 1
        if hasattr(P, "_recent_pairs"):
            P._recent_pairs.setdefault(frozenset((w, l)), []).append(day)
    if P.s.get("last"):
        _touch_ref(P, max(P.s["last"].values()))
    return n, samples


def gate_ok(base_m, cand_m, min_gain=MIN_GAIN):
    return cand_m["log_loss"] <= base_m["log_loss"] - min_gain and cand_m["accuracy"] >= base_m["accuracy"]


def _xy(samples):
    import pandas as pd
    if isinstance(samples, pd.DataFrame):
        return samples.loc[:, list(F.FEATURES)], samples["y"].to_numpy()
    frame = pd.DataFrame(samples)
    return frame.loc[:, list(F.FEATURES)], frame["y"].to_numpy()


def _params():
    return dict(objective="binary", learning_rate=LR, num_leaves=15, min_data_in_leaf=200, feature_fraction=1.0,
                bagging_fraction=1.0, lambda_l2=1.0, verbose=-1, num_threads=4, seed=7, deterministic=True)


def boost_from(base, samples, rounds=ROUNDS):
    X, y = _xy(samples)
    booster = lgb.train(_params(), lgb.Dataset(X, y, feature_name=list(F.FEATURES)), rounds, init_model=base)
    return booster


def maybe_boost(origin, samples, current=None, min_gain=MIN_GAIN):
    """Dotrénuje kopii původního modelu. Publikuje ji jen když porazí model, který se právě používá."""
    current = origin if current is None else current
    need = MIN_TRAIN + HOLDOUT
    report = dict(n=len(samples), published=False, reason=f"zatím {len(samples)} nových zápasů, LightGBM se dotrénuje až od {need}")
    if not samples:
        report["reason"] = "žádný nový zápas mimo historii, stromy beze změny"
    if len(samples) < need:
        return None, report
    train, hold = samples[:-HOLDOUT], samples[-HOLDOUT:]
    Xh, yh = _xy(hold)
    p0 = current.predict(Xh)
    cand = boost_from(origin, train)
    p1 = cand.predict(Xh)
    m0, m1 = metrics(yh, p0), metrics(yh, p1)
    report.update(holdout_base=m0, holdout_candidate=m1)
    if gate_ok(m0, m1, min_gain):
        report.update(published=True, reason="holdout log loss lepší, přesnost neklesla")
        return cand, report
    report["reason"] = "brána dotrénování nepustila (holdout se nezlepšil)"
    return None, report


def apply_safe(P, rows):
    """Jako apply_new. Při výjimce vrátí Elo, formu i fs_seen do stavu před voláním."""
    import copy
    snap_s, snap_ref = copy.deepcopy(P.s), P.ref_day
    had = hasattr(P, "_recent_pairs")
    snap_pairs = copy.deepcopy(P._recent_pairs) if had else None
    try:
        return apply_new(P, rows)
    except Exception:
        P.s, P.ref_day = snap_s, snap_ref
        if had:
            P._recent_pairs = snap_pairs
        elif hasattr(P, "_recent_pairs"):
            del P._recent_pairs
        raise


def _id_text(value):
    text = _text(value)
    if len(text) > 2 and text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def split_ids(fs_id="", espn_id="", id=""):
    """Surové Flashscore id má přednost, ať sedí na fs_seen z denního retrénování. Jinak `espn:` + id."""
    fs, espn, given = _id_text(fs_id), _id_text(espn_id), _id_text(id)
    if fs.startswith("espn:"):
        espn = espn or fs[5:]
        fs = ""
    if not fs and not espn and given.startswith("espn:"):
        espn = given[5:]
    if not fs and given and not given.startswith("espn:"):
        fs = given
    sid = fs or (f"espn:{espn}" if espn else "")
    return sid, fs, espn


def stable_id(fs_id="", espn_id="", id=""):
    return split_ids(fs_id, espn_id, id)[0]


def _as_date(today):
    import datetime
    if today is None:
        return datetime.date.today()
    if isinstance(today, datetime.datetime):
        return today.date()
    if isinstance(today, datetime.date):
        return today
    return datetime.date.fromisoformat(str(today)[:10])


def _record(rec):
    import datetime
    sid, fs, espn = split_ids(rec.get("fs_id"), rec.get("espn_id"), rec.get("id"))
    if not sid:
        return None
    try:
        day = _day(rec.get("date"))
    except Exception:
        return None
    return dict(id=sid, fs_id=fs, espn_id=espn, date=datetime.date.fromordinal(day).isoformat(),
                g=_text(rec.get("g")), circuit=_text(rec.get("circuit")), is_qual=_qual(rec.get("is_qual")),
                surface=_surf(rec.get("surface")), tourney_name=_text(rec.get("tourney_name")),
                winner_name=_text(rec.get("winner_name")), loser_name=_text(rec.get("loser_name")),
                winner_slug=_text(rec.get("winner_slug")), loser_slug=_text(rec.get("loser_slug")),
                score=_text(rec.get("score")))


def _iter_records(src):
    if src is None:
        return
    if isinstance(src, dict):
        matches = src.get("matches")
        if isinstance(matches, list):
            for item in matches:
                if isinstance(item, dict):
                    yield item
            return
        yield src
        return
    if isinstance(src, list):
        for item in src:
            if isinstance(item, dict):
                yield item
        return
    import pandas as pd
    if isinstance(src, pd.DataFrame):
        for item in src.to_dict(orient="records"):
            yield item


def collect_matches(sources, today=None, keep_days=KEEP_DAYS):
    """Sjednotí zdroje, nechá poslední výskyt každého id a zahodí zápasy starší než keep_days."""
    import pandas as pd
    today = _as_date(today)
    cut, horizon = today.toordinal() - int(keep_days), today.toordinal() + 1
    by_id = {}
    for src in sources:
        for rec in _iter_records(src):
            item = _record(rec)
            if not item:
                continue
            day = _day(item["date"])
            if day < cut or day > horizon:
                continue
            prev = by_id.get(item["id"])
            if prev:
                merged = dict(prev)
                for k, v in item.items():
                    if _text(v) == "" and _text(prev.get(k)) != "":
                        continue
                    merged[k] = v
                item = merged
            by_id[item["id"]] = item
    cols = ["id", "fs_id", "espn_id", *MATCH_FIELDS]
    matches = [by_id[k] for k in sorted(by_id, key=lambda i: (by_id[i]["date"], i))]
    frame = pd.DataFrame(matches, columns=cols)
    if len(frame):
        frame = frame.copy()
        frame["fs_id"] = frame["id"]
    return frame


def read_state(path):
    path = pathlib.Path(path)
    try:
        obj = json.loads(path.read_text())
    except (OSError, ValueError, UnicodeError):
        return []
    if not isinstance(obj, dict) or not isinstance(obj.get("matches"), list):
        return []
    return [m for m in obj["matches"] if isinstance(m, dict)]


def state_ok(obj):
    return isinstance(obj, dict) and isinstance(obj.get("matches"), list) and isinstance(obj.get("ids"), list)


def write_state(path, rows):
    """Zapíše seznam zápasů (ne Elo). fs_id zůstane surové id Flashscore, u ESPN-only zápasu prázdné."""
    path = pathlib.Path(path)
    recs = rows.to_dict(orient="records") if hasattr(rows, "to_dict") else list(rows or [])
    by_id = {}
    for rec in recs:
        item = _record(rec)
        if item:
            by_id[item["id"]] = item
    matches = [by_id[k] for k in sorted(by_id, key=lambda i: (by_id[i]["date"], i))]
    doc = dict(matches=matches, ids=[m["id"] for m in matches])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    os.replace(tmp, path)
