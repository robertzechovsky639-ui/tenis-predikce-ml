import datetime, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import pandas as pd
import features as F
import online
from predictor import Predictor

DAY = datetime.date(2024, 6, 1).toordinal()


def make_p():
    P = Predictor.__new__(Predictor)
    P.s = {"elo": {"M1": 1500.0, "M2": 1400.0}, "n": {}, "sn": {}, "selo": {}, "recent": {}, "dates": {},
           "resid": {}, "h2h": {}, "last": {}, "rank": {}, "age": {}, "srv": {}, "fs_seen": set()}
    P.ref_day = DAY
    P.known_result = lambda a, b, day, window=10: False
    names = {"Sinner J.": "M1", "Alcaraz C.": "M2"}

    def find(g, full=None, short=None):
        for cand in (full, short):
            if cand in names:
                return names[cand]
        return None

    P.find = find
    return P


def rows(extra=None):
    base = [
        dict(fs_id="a", date="2024-06-01", g="M", circuit="ATP", is_qual=0, surface="Hard", tourney_name="Halle",
             winner_name="Sinner J.", loser_name="Alcaraz C.", winner_slug="", loser_slug="", score="6-4"),
        dict(fs_id="b", date="2024-06-02", g="M", circuit="ATP", is_qual=0, surface="Hard", tourney_name="Halle",
             winner_name="Alcaraz C.", loser_name="Sinner J.", winner_slug="", loser_slug="", score="7-5"),
    ]
    if extra:
        base.append(extra)
    return pd.DataFrame(base)


def test_result_updates_next_sample_and_not_twice():
    P = make_p()
    n, samples = online.apply_new(P, rows())
    assert n == 2 and len(samples) == 2
    assert abs(abs(samples[0]["elo_d"]) - 100) < 1e-6
    assert samples[1]["elo_d"] != samples[0]["elo_d"]
    elo = P.s["elo"]["M1"]
    n2, again = online.apply_new(P, rows())
    assert n2 == 0 and again == [] and P.s["elo"]["M1"] == elo


def test_unknown_player_is_retried_later():
    P = make_p()
    one = rows().iloc[[0]].copy()
    one["fs_id"] = "c"
    one["winner_name"] = "Nobody X."
    n, _ = online.apply_new(P, one)
    assert n == 0 and "c" not in P.s["fs_seen"]


def test_known_history_is_not_applied_again():
    P = make_p()
    P.known_result = lambda a, b, day, window=10: True
    n, samples = online.apply_new(P, rows().iloc[[0]])
    assert n == 0 and samples == [] and "a" in P.s["fs_seen"]
    assert P.s["elo"]["M1"] == 1500


def test_older_than_both_careers_is_skipped():
    P = make_p()
    later = DAY + 30
    P.s["last"] = {"M1": later, "M2": later}
    n, _ = online.apply_new(P, rows().iloc[[0]])
    assert n == 0 and "a" in P.s["fs_seen"] and P.s["elo"]["M1"] == 1500


def test_apply_result_matches_feature_state():
    day = DAY
    st = F.State()
    st.elo["M1"] = 1600.0
    st.elo["M2"] = 1500.0
    st.update("M1", "M2", "Clay", day)
    P = make_p()
    P.s["elo"] = {"M1": 1600.0, "M2": 1500.0}
    P.apply_result("M1", "M2", "Clay", day)
    assert abs(P.s["elo"]["M1"] - st.elo["M1"]) < 1e-9
    assert abs(P.s["elo"]["M2"] - st.elo["M2"]) < 1e-9
    assert abs(P.s["selo"][("M1", "Clay")] - st.selo[("M1", "Clay")]) < 1e-9
    assert P.s["h2h"][("M1", "M2")] == st.h2h[("M1", "M2")] == 1
    assert P.s["recent"]["M1"] == list(st.recent["M1"]) == [1]
    assert P.s["recent"]["M2"] == [0]


def test_gate_requires_better_log_loss_and_stable_accuracy():
    assert online.gate_ok({"log_loss": 0.56, "accuracy": 0.70}, {"log_loss": 0.558, "accuracy": 0.70})
    assert not online.gate_ok({"log_loss": 0.56, "accuracy": 0.70}, {"log_loss": 0.5595, "accuracy": 0.70})
    assert not online.gate_ok({"log_loss": 0.56, "accuracy": 0.70}, {"log_loss": 0.55, "accuracy": 0.69})


def test_too_few_matches_do_not_touch_trees():
    booster, report = online.maybe_boost(None, [{"id": "1", "y": 1}])
    assert booster is None and report["published"] is False


def test_best_of_slam():
    assert online.best_of_for("M", "ATP", "Wimbledon", 0) == 5
    assert online.best_of_for("M", "ATP", "Wimbledon", 1) == 3
    assert online.best_of_for("W", "WTA", "Wimbledon", 0) == 3


def test_merge_rows_keeps_new_ids(tmp_path, monkeypatch):
    import ingest
    monkeypatch.setattr(ingest, "CSV", tmp_path / "live_results.csv")
    cols = dict(g="M", circuit="ATP", is_qual=0, surface="Hard", tourney_name="t", winner_name="A", loser_name="B",
                winner_slug="", loser_slug="", score="6-0", date="2024-01-01")
    ingest.merge_rows(pd.DataFrame([dict(fs_id=1, **cols)]))
    out = ingest.merge_rows(pd.DataFrame([dict(fs_id=1, **cols), dict(fs_id=2, **cols)]))
    assert list(out.fs_id) == ["1", "2"]


def _match(**kw):
    base = dict(g="M", circuit="ATP", is_qual=0, surface="Hard", tourney_name="Halle", winner_name="Sinner J.",
                loser_name="Alcaraz C.", winner_slug="", loser_slug="", score="6-4")
    base.update(kw)
    return base


def test_stable_id_prefers_flashscore():
    assert online.stable_id("hK1", "999") == "hK1"
    assert online.stable_id("", "999") == "espn:999"
    assert online.stable_id(float("nan"), 5) == "espn:5"
    assert online.stable_id(12.0, "") == "12"
    assert online.stable_id("", "", "espn:7") == "espn:7"
    assert online.state_ok({"matches": [], "ids": []})
    assert not online.state_ok({"matches": []})


def test_collect_dedupes_id_and_keeps_rematch():
    today = datetime.date(2024, 6, 20)
    first = [_match(fs_id="a", espn_id="9", date="2024-06-01", score="6-4"),
             _match(fs_id="b", date="2024-06-02"),
             _match(fs_id="old", date="2024-05-29")]
    later = [_match(fs_id="a", date="2024-06-01", score="6-4 6-2"),
             dict(espn_id="55", date="2024-06-21", g="W", circuit="WTA", winner_name="Swiatek I.", loser_name="Sabalenka A.")]
    df = online.collect_matches([first, later], today=today)
    assert list(df.id) == ["a", "b", "espn:55"]
    assert df.loc[df.id == "a", "score"].item() == "6-4 6-2"
    assert df.loc[df.id == "a", "espn_id"].item() == "9"
    assert "old" not in set(df.id)
    assert list(df.fs_id) == ["a", "b", "espn:55"]


def test_collect_unions_sources_and_drops_outside_window():
    today = datetime.date.today()
    old = (today - datetime.timedelta(days=online.KEEP_DAYS + 1)).isoformat()
    edge = (today - datetime.timedelta(days=online.KEEP_DAYS)).isoformat()
    nxt = (today + datetime.timedelta(days=1)).isoformat()
    far = (today + datetime.timedelta(days=2)).isoformat()
    published = {"matches": [_match(fs_id="kept", date=edge), _match(fs_id="gone", date=old)], "ids": ["kept", "gone"]}
    fresh = pd.DataFrame([_match(fs_id="fresh", date=nxt), _match(fs_id="far", date=far)])
    df = online.collect_matches([published, fresh])
    assert list(df.id) == ["kept", "fresh"]


def test_state_roundtrip_keeps_raw_ids(tmp_path):
    today = datetime.date(2024, 6, 10)
    frame = online.collect_matches([
        [_match(fs_id="hK1", espn_id="9", date="2024-06-01"),
         dict(espn_id="55", date="2024-06-02", g="M", winner_name="A", loser_name="B")],
    ], today=today)
    path = tmp_path / "state.json"
    online.write_state(path, frame)
    doc = json.loads(path.read_text())
    assert online.state_ok(doc)
    stored = {m["id"]: m for m in doc["matches"]}
    assert stored["hK1"]["fs_id"] == "hK1" and stored["hK1"]["espn_id"] == "9"
    assert stored["espn:55"]["fs_id"] == "" and stored["espn:55"]["espn_id"] == "55"
    again = online.collect_matches([online.read_state(path)], today=today)
    assert list(again.id) == ["hK1", "espn:55"]
    missing = tmp_path / "nope.json"
    assert online.read_state(missing) == []
    for text in ("{", "[]", '{"matches": {}, "ids": []}'):
        missing.write_text(text)
        assert online.read_state(missing) == []


def test_apply_safe_restores_elo():
    P = make_p()

    def boom(*_a, **_k):
        P.s["elo"]["M1"] = 1.0
        P.s["fs_seen"].add("a")
        raise RuntimeError("boom")

    P.apply_result = boom
    try:
        online.apply_safe(P, rows().iloc[[0]])
        raise AssertionError("měla vyletět výjimka")
    except RuntimeError:
        pass
    assert P.s["elo"]["M1"] == 1500 and "a" not in P.s["fs_seen"]


def test_collected_match_applies_once():
    today = datetime.date(2024, 6, 10)
    src = [_match(fs_id="a", date="2024-06-01")]
    P = make_p()
    n, _ = online.apply_new(P, online.collect_matches([src], today=today))
    assert n == 1 and "a" in P.s["fs_seen"]
    n2, _ = online.apply_new(P, online.collect_matches([src], today=today))
    assert n2 == 0


def _tar(path, names):
    import tarfile
    with tarfile.open(path, "w:gz") as tar:
        for name in names:
            payload = path.parent / pathlib.Path(name).name
            payload.write_bytes(b"x" * 8)
            tar.add(payload, arcname=name)


def test_archive_and_choose(tmp_path):
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
    import fetch_release
    good = tmp_path / "good.tar.gz"
    _tar(good, [f"model/{name}" for name in ("gbm.txt", "state.pkl", "logreg.pkl", "matches.pkl")])
    short = tmp_path / "short.tar.gz"
    _tar(short, ["model/gbm.txt"])
    trunc = tmp_path / "trunc.tar.gz"
    trunc.write_bytes(good.read_bytes()[:24])
    assert fetch_release.archive_ok(good)
    assert not fetch_release.archive_ok(short)
    assert not fetch_release.archive_ok(trunc)
    assert not fetch_release.archive_ok(tmp_path / "missing.tar.gz")
    assert fetch_release.choose(trunc, good, fetch_release.archive_ok) == good
    assert fetch_release.choose(good, short, fetch_release.archive_ok) == good
    assert fetch_release.choose(trunc, short, fetch_release.archive_ok) is None
    csv = tmp_path / "live.csv"
    csv.write_text("fs_id,date\n1,2024-01-01\n")
    assert fetch_release.csv_ok(csv)
    csv.write_text("date\n")
    assert not fetch_release.csv_ok(csv)
    assert fetch_release.published_state_ok({"matches": [], "ids": []})
    assert not fetch_release.published_state_ok({"matches": [], "ids": "x"})
