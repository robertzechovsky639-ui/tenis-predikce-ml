import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import markov
import scoremerge as SM


def _m(sets, pts=None, status="live", server=None, trust=0, src=None):
    return {"sets": sets, "pts": pts, "status": status, "server": server, "srv_trust": trust, "src_pts": src}


def test_behind_score_and_flip_do_not_replace():
    prev = _m([[6, 4], [3, 2]], [2, 1], server=1, trust=3, src="Sofascore")
    stale = _m([[6, 4], [2, 2]], [0, 0], server=2, trust=1, src="365scores")
    SM.keep_score(prev, stale)
    assert stale["sets"] == [[6, 4], [3, 2]] and stale["pts"] == [2, 1] and stale["server"] == 1
    flipped = _m([[4, 6], [2, 3]], [1, 2], server=2, trust=2)
    SM.keep_score(prev, flipped)
    assert flipped["sets"] == [[6, 4], [3, 2]] and flipped["server"] == 1


def test_negative_placeholder_sets_are_not_ahead():
    assert SM.norm_sets([[6, 4], [-1, -1], [0, 0]]) == [[6, 4], [0, 0]]
    assert SM.norm_sets([[6, 5], [0, 0]]) == [[6, 5]]
    assert SM.cmp_score([[6, 4]], None, [[6, 4], [-1, -1]], None) == 0


def test_deuce_reset_only_from_same_source():
    prev = _m([[6, 3], [1, 1]], [4, 3], server=1, trust=2, src="Sofascore")
    other = _m([[6, 3], [1, 1]], [3, 3], src="365scores")
    SM.keep_score(prev, other)
    assert other["pts"] == [4, 3]
    same = _m([[6, 3], [1, 1]], [3, 3], src="Sofascore")
    SM.keep_score(prev, same)
    assert same["pts"] == [3, 3]


def test_equal_score_keeps_higher_server_trust():
    prev = _m([[1, 1]], [1, 0], server=2, trust=3, src="pbp")
    low = _m([[1, 1]], [1, 0], server=1, trust=1, src="pbp")
    SM.keep_score(prev, low)
    assert low["server"] == 2 and low["srv_trust"] == 3


def test_finished_is_not_reopened():
    prev = _m([[6, 4], [6, 3]], None, status="finished")
    live = _m([[6, 4], [5, 3]], [1, 0], status="live", server=1, trust=1)
    SM.keep_score(prev, live)
    assert live["status"] == "finished" and live["sets"] == [[6, 4], [6, 3]]


def test_ahead_score_is_kept():
    prev = _m([[6, 4], [1, 1]], [1, 0])
    nxt = _m([[6, 4], [2, 1]], [0, 0], server=2, trust=1)
    assert SM.keep_score(prev, nxt) is nxt
    assert nxt["sets"] == [[6, 4], [2, 1]]


def test_tiebreak_set_then_zero_advances_and_stale_does_not():
    # 6:7 v tiebreaku je dohraný set. Čerstvější 0:0 dalšího setu jde dopředu, kratší starý stav ne.
    assert SM.norm_sets([[6, 3], [6, 7], [0, 0]]) == [[6, 3], [6, 7], [0, 0]]
    bare = SM.split_live([[6, 3], [6, 7]], "live")
    opened = SM.split_live([[6, 3], [6, 7], [0, 0]], "live")
    assert bare["n"] == opened["n"] == 3
    assert bare["cur"] == opened["cur"] == [0, 0]
    assert bare["done"] == [[6, 3], [6, 7]]
    assert opened["done"] == [[6, 3], [6, 7]]
    won = SM.split_live([[6, 3], [7, 6]], "live")
    assert won["n"] == 3 and won["done"] == [[6, 3], [7, 6]] and won["cur"] == [0, 0]
    assert SM.cmp_score([[6, 3], [6, 7]], [0, 0], [[6, 3], [6, 7], [0, 0]], [0, 0]) == 1
    assert SM.cmp_score([[6, 3], [6, 7], [0, 0]], [0, 0], [[6, 3], [6, 7]], [0, 0]) == -1
    assert SM.cmp_score([[6, 3], [6, 6]], [3, 3], [[6, 3], [6, 7], [0, 0]], [0, 0]) == 1
    assert SM.cmp_score([[6, 3], [7, 6]], [0, 0], [[6, 3], [6, 6]], [6, 5]) == -1
    # Nový set 0:0 je dopředu i když body klesnou. Samotné body a podávající zůstanou.
    assert SM.cmp_score([[6, 3], [6, 7]], [1, 0], [[6, 3], [6, 7], [0, 0]], [0, 0]) == 1
    prev = _m([[6, 3], [6, 6]], [6, 5], server=1, trust=1, src="Sofascore")
    fresh = _m([[6, 3], [6, 7], [0, 0]], [0, 0], server=2, trust=1, src="365scores")
    SM.keep_score(prev, fresh)
    assert fresh["sets"] == [[6, 3], [6, 7], [0, 0]] and fresh["pts"] == [0, 0]
    stale = _m([[6, 3], [6, 6]], [6, 6], server=1, trust=1, src="Sofascore")
    SM.keep_score(fresh, stale)
    assert stale["sets"] == [[6, 3], [6, 7], [0, 0]] and stale["pts"] == [0, 0]
    held = _m([[6, 3], [6, 7], [0, 0]], [0, 0], server=2, trust=1, src="365scores")
    SM.keep_score(_m([[6, 3], [6, 7]], [1, 0], server=1, trust=1, src="Sofascore"), held)
    assert held["sets"] == [[6, 3], [6, 7], [0, 0]]
    assert held["pts"] == [1, 0] and held["server"] == 1 and held["srv_trust"] == 1
    # Dohrání zápasu smí zahodit otevřené 0:0, ne vrátit se k nižšímu skóre.
    done = _m([[6, 3], [6, 4]], None, status="finished")
    SM.keep_score(_m([[6, 3], [6, 4], [0, 0]], [0, 0]), done)
    assert done["status"] == "finished" and done["sets"] == [[6, 3], [6, 4]]
    a = markov.live(0.44, [tuple(s) for s in bare["done"]], tuple(bare["cur"]), (0, 0), 1, False, 3)
    b = markov.live(0.44, [tuple(s) for s in opened["done"]], tuple(opened["cur"]), (0, 0), 1, False, 3)
    stuck = markov.live(0.44, [(6, 3)], (6, 7), (0, 0), 1, False, 3)
    assert 0.05 < a["set"] < 0.95
    assert abs(a["set"] - b["set"]) < 1e-12 and abs(a["match"] - b["match"]) < 1e-12
    assert stuck["set"] == 0


def test_rejected_finish_clears_winner_and_advantage_does_not_flip():
    prev = _m([[6, 4], [6, 5]], [1, 0], server=1, trust=1)
    bad = _m([[6, 4], [6, 4]], None, status="finished")
    bad["winner"] = 1
    SM.keep_score(prev, bad)
    assert bad["status"] == "live" and bad["sets"] == [[6, 4], [6, 5]] and not bad["winner"]
    adv = _m([[1, 1]], [4, 3], server=1, trust=2, src="365scores")
    flip = _m([[1, 1]], [3, 4], server=2, trust=1, src="Sofascore")
    SM.keep_score(adv, flip)
    assert flip["pts"] == [4, 3] and flip["server"] == 1


def test_two_sets_finish_best_of_three_but_not_five():
    live = _m([[4, 6], [4, 6]], [0, 0], server=1, trust=1, src="Sofascore")
    live["best_of"] = 3
    SM.keep_score(None, live)
    assert live["status"] == "finished" and live["winner"] == 2 and live["pts"] is None
    again = _m([[4, 6], [3, 6]], [1, 0], status="live")
    SM.keep_score(live, again)
    assert again["status"] == "finished" and again["sets"] == [[4, 6], [4, 6]]
    slam = _m([[6, 4], [6, 3], [0, 0]], [0, 0])
    slam["best_of"] = 5
    SM.keep_score(None, slam)
    assert slam["status"] == "live" and slam["sets"] == [[6, 4], [6, 3], [0, 0]]


def test_match_tiebreak_flag_and_set_order_independent_shape():
    assert SM.is_match_tb([[6, 4], [4, 6]], [5, 4], 3)
    assert not SM.is_match_tb([[6, 4], [3, 2]], [1, 0], 3)
    assert not SM.is_match_tb([[6, 6]], [5, 4], 3)


def test_finished_tiebreak_points_close_the_set_immediately():
    sets, pts, closed = SM.close_finished_tb([[6, 3], [6, 6]], [7, 5], 3)
    assert closed and sets == [[6, 3], [7, 6]] and pts == [0, 0]
    sets, pts, closed = SM.close_finished_tb([[6, 3], [6, 6]], [5, 7], 3)
    assert closed and sets == [[6, 3], [6, 7]] and pts == [0, 0]
    _, _, closed = SM.close_finished_tb([[6, 3], [6, 6]], [5, 3], 3)
    assert not closed
    _, _, closed = SM.close_finished_tb([[6, 4], [4, 6], [6, 6]], [8, 6], 3)
    assert not closed
    sets, pts, closed = SM.close_finished_tb([[6, 4], [4, 6], [6, 6]], [10, 8], 3)
    assert closed and sets[-1] == [7, 6] and pts == [0, 0]
    prev = _m([[6, 3], [6, 6]], [5, 4], server=1, trust=1)
    nxt = _m([[6, 3], [6, 6]], [7, 5], server=1, trust=1, src="365scores")
    nxt["best_of"] = 3
    SM.keep_score(prev, nxt)
    assert nxt["status"] == "finished" and nxt["winner"] == 1
    assert nxt["sets"] == [[6, 3], [7, 6]] and nxt["pts"] is None and nxt["pts_raw"] is None
    stale = _m([[6, 3], [6, 6]], [6, 6], server=2, trust=1)
    SM.keep_score(nxt, stale)
    assert stale["status"] == "finished" and stale["sets"] == [[6, 3], [7, 6]] and stale["pts"] is None


def test_map_point_keeps_tiebreak_counts():
    import sources
    assert sources.map_point(7) == 7
    assert sources.map_point(15) == 1
    assert sources.map_point(50) == 4
    assert sources.map_point(5) == 5
    assert sources.map_point(0) == 0
    assert sources.map_point("40") == 3
    assert sources.map_point("x") == 0
