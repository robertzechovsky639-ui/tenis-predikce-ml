"""Uloží kompaktní tabulku historických zápasů (pro H2H výpis v detailu). Spouští se po train.py."""
import features as F
if __name__ == "__main__":
    df = F.load()[["date", "wid", "lid", "winner_name", "loser_name", "tourney_name", "surface", "round", "score", "circuit"]]
    df.to_pickle(F.ROOT / "data" / "model" / "matches.pkl"); print(len(df))
