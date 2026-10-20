import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
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
    assert SM.norm_sets([[6, 4], [-1, -1], [0, 0]]) == [[6, 4]]
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
