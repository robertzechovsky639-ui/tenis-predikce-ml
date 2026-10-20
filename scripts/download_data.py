"""Stáhne veřejné datasety Jeffa Sackmanna (singly ATP/WTA, Challenger/kvalifikace, Futures/ITF) od 1968.
Primárně github.com/JeffSackmann, při 404 záložní veřejný mirror (Aneeshers/tennis-sackmann-archive)."""
import concurrent.futures as cf, pathlib, sys, urllib.request, datetime
RAW = pathlib.Path(__file__).resolve().parents[1] / "data" / "raw"
SOURCES = {
  "atp": ["https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/{f}",
          "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/atp/{f}"],
  "wta": ["https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/{f}",
          "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/wta/{f}"],
}
def files():
    y1 = datetime.date.today().year
    for y in range(1968, y1 + 1):
        yield "atp", f"atp_matches_{y}.csv"
        yield "wta", f"wta_matches_{y}.csv"
        yield "wta", f"wta_matches_qual_itf_{y}.csv"
        if y >= 1978: yield "atp", f"atp_matches_qual_chall_{y}.csv"
        if y >= 1991: yield "atp", f"atp_matches_futures_{y}.csv"
    yield "atp", "atp_players.csv"; yield "wta", "wta_players.csv"
def get(tour, f):
    out = RAW / tour / f
    if out.exists() and out.stat().st_size > 0: return f, "cache"
    out.parent.mkdir(parents=True, exist_ok=True)
    for u in SOURCES[tour]:
        try:
            with urllib.request.urlopen(u.format(f=f), timeout=60) as r: out.write_bytes(r.read())
            return f, u.split("/")[3]
        except Exception: continue
    return f, "MISSING"
if __name__ == "__main__":
    with cf.ThreadPoolExecutor(16) as ex:
        res = list(ex.map(lambda a: get(*a), files()))
    src = {}
    for f, s in res: src[s] = src.get(s, 0) + 1
    print("hotovo:", src); print("chybí:", [f for f, s in res if s == "MISSING"])
