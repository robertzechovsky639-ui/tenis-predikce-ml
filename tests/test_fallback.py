import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import fallback as FB


def test_relax_short_and_full_name():
    names = {"M1": "Zink T.", "M2": "Jannik Sinner", "W1": "Defalco J.", "M3": "Matsuda K.", "M4": "Ryuki Matsuda"}
    rx = FB.build_relax(names)
    assert FB.match_relax(rx, "M", "Tyler Zink") == "M1"
    assert FB.match_relax(rx, "M", "Zink T.") == "M1"
    assert FB.match_relax(rx, "M", "Sinner J.") == "M2"
    assert FB.match_relax(rx, "W", "Jenna Defalco") == "W1"
    assert FB.match_relax(rx, "M", "Ryuki Matsuda") == "M4"
    assert FB.match_relax(rx, "M", "Matsuda K.") == "M3"
    # stejné příjmení i iniciála u dvou hráčů není jednoznačné
    amb = FB.build_relax({"M5": "Vales A.", "M6": "Amit Vales"})
    assert FB.match_relax(amb, "M", "Vales A.") is None


def test_placeholder_and_priors():
    assert FB.is_placeholder("TBD") and FB.is_placeholder("Player") and not FB.is_placeholder("Jannik Sinner")
    m = {"circuit": "ITF muži", "qual": 0, "g": "M", "players": [{"name": "A"}, {"name": "B"}]}
    assert FB.tour_elo(m) == 1440
    m["qual"] = 1
    assert FB.tour_elo(m) == 1415
    assert abs(FB.elo_from_rank("M", 1) - 3050.7) < 1e-6


def test_fallback_prob_shrinks_unknown_and_tbd():
    m = {"circuit": "ATP", "qual": 0, "g": "M"}
    p, note = FB.fallback_prob(m, [1800, 1500], ["hist", "tour"])
    pe = 1 / (1 + 10 ** ((1500 - 1800) / 400))
    assert abs(p - (0.5 + (pe - 0.5) * 0.75)) < 1e-9
    assert "úrovně turnaje" in note
    p2, note2 = FB.fallback_prob(m, [1800, 1560], ["hist", "tbd"])
    pe2 = 1 / (1 + 10 ** ((1560 - 1800) / 400))
    assert abs(p2 - (0.5 + (pe2 - 0.5) * 0.35)) < 1e-9
    assert "není určen" in note2
    both, _ = FB.fallback_prob(m, [1440, 1440], ["tour", "tour"])
    assert both == 0.5


def test_prediction_for_keeps_model_when_both_known():
    m = {"g": "M", "circuit": "ATP", "qual": 0, "surface": "Hard", "best_of": 3,
         "players": [{"name": "Jannik Sinner"}, {"name": "Carlos Alcaraz"}]}
    seen = {}

    def predict(a, b):
        seen["ids"] = (a, b)
        return {"p": 0.62, "p_lr": 0.61}

    info = FB.prediction_for(m, ["M1", "M2"], ["M1", "M2"], lambda pid: 1800, lambda pid: 3, predict)
    assert info["pred"] == 0.62 and info["pred_low"] is False and info["pred_note"] is None
    assert info["_model"] is True and seen["ids"] == ("M1", "M2")
    # málo zápasů, ale přísná shoda: příznak nízké spolehlivosti se nezapíná
    assert info["pred_low"] is False


def test_prediction_for_low_only_on_relaxed_thin_history():
    m = {"g": "W", "circuit": "WTA", "qual": 0, "players": [{"name": "A"}, {"name": "B"}]}

    def predict(a, b):
        return {"p": 0.55, "p_lr": 0.54}

    thin = FB.prediction_for(m, [None, None], ["W1", "W2"], lambda pid: 1600, lambda pid: 2, predict)
    assert thin["pred"] == 0.55 and thin["pred_low"] is True and "Málo odehraných" in thin["pred_note"]
    rich = FB.prediction_for(m, [None, None], ["W1", "W2"], lambda pid: 1600, lambda pid: 40, predict)
    assert rich["pred_low"] is False and rich["pred_note"] is None


def test_prediction_for_fills_when_a_player_is_missing():
    m = {"g": "M", "circuit": "ITF muži", "qual": 0,
         "players": [{"name": "Spinolo R."}, {"name": "TBD"}]}
    info = FB.prediction_for(m, [None, None], [None, None], lambda pid: None, lambda pid: 0, lambda a, b: None)
    assert info["pred"] is not None and 0.02 <= info["pred"] <= 0.98
    assert info["pred_low"] is True and info["_model"] is False
    assert info["pred_note"]
