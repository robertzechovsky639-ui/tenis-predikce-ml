import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import sources as S


def test_cali_names_are_one_pair_and_tournament():
    assert S.same_player("Ficovich J. P.", "J. Pablo Ficovich")
    assert S.same_player("Meligeni Alves F.", "F. Meligeni Alves")
    assert S.same_player("Sinner J.", "Jannik Sinner")
    assert S.same_player("de Minaur A.", "Alex de Minaur")
    assert not S.same_player("Carlos Alcaraz", "Albert Alcaraz")
    assert not S.same_player("Ficovich J. P.", "F. Meligeni Alves")
    assert not S.same_player("TBD", "TBD")
    assert S.same_player("Tirante T. A.", "Thiago Agustin Tirante")
    assert S.same_player("Ryan Ziegann S.", "Sam Ryan Ziegann")
    assert S.same_player("Bhamidipaty S. R.", "Shrivalli Rashmikaa Bhamidipaty")
    assert S.same_player("Wan I W.", "I Wen Wan")
    assert S.same_player("Yuhan L.", "Yuhan Liu")
    assert S.same_player("Zhang S.", "Zhang Shuai")
    assert S.same_player("Shi H.", "Shi Han")
    assert S.same_player("Guo H.", "Guo Hanyu")
    assert S.same_player("Cerundolo J. M.", "Juan Manuel Cerundolo")
    assert not S.same_player("Manuel J.", "Juan Manuel Cerundolo")
    assert not S.same_player("Pierre H.", "Pierre-Hugues Herbert")
    assert not S.same_player("Zhang S.", "Zhang Z.")
    assert not S.same_player("Martin T.", "Tomas Martin Etcheverry")
    assert not S.same_player("Luciano L.", "Luciano Darderi")
    assert not S.same_player("Alex M.", "Alex de Minaur")
    assert not S.same_player("Yang Y.", "Yang Y. Y.")
    assert not S.same_pair("TBD", "TBD", "TBD", "TBD")
    assert S.same_pair("Ficovich J. P.", "Meligeni Alves F.", "F. Meligeni Alves", "J. Pablo Ficovich")
    assert S.surname_key("Sinner J.") == S.surname_key("Jannik Sinner") == "sinner"
    assert S.surname_key("Meligeni Alves F.") == S.surname_key("F. Meligeni Alves") == "alves"
    assert S.surname_key("Ficovich J. P.") == S.surname_key("J. Pablo Ficovich") == "ficovich"
    assert S.canon_tournament("Cali (Colombia)") == S.canon_tournament("Cali, Colombia") == "Cali"
    assert S.canon_tournament("Roland Garros") == "Roland Garros"


def test_merge_compound_names_and_keeps_the_further_score():
    espn = dict(id="espn-1", src="ESPN", g="M", tournament="Cali, Colombia", surface=None, status="live",
                sets=[[2, 6], [1, 1]], players=[dict(name="J. Pablo Ficovich"), dict(name="F. Meligeni Alves")])
    fs = dict(id="fs-1", src="Flashscore", g="M", tournament="Cali (Colombia)", surface="Clay", status="live",
              sets=[[6, 2], [2, 2]], players=[dict(name="Meligeni Alves F.", slug="a"), dict(name="Ficovich J. P.", slug="b")],
              fs=dict(id="abc", pids=["p-mel", "p-fic"]))
    out = S.merge([espn], [fs])
    assert len(out) == 1
    m = out[0]
    assert m["id"] == "espn-1"
    assert m["tournament"] == "Cali"
    assert m["surface"] == "Clay"
    assert m["sets"] == [[2, 6], [2, 2]]
    assert m["fs"]["id"] == "abc"
    assert m["fs"]["pids"] == ["p-fic", "p-mel"]
    assert m["players"][0]["slug"] == "b"
