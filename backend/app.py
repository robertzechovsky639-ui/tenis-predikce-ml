"""FastAPI server: REST API + Server-Sent Events (/api/stream) + statický PWA frontend."""
import asyncio, json, os, re, time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from service import Service, F
import markov

WEB = F.ROOT / "web"
SVC: Service = None

@asynccontextmanager
async def lifespan(app):
    global SVC
    SVC = Service(demo=os.environ.get("TENIS_DEMO") == "1")
    task = None if os.environ.get("TENIS_NO_POLL") == "1" else asyncio.create_task(SVC.run())
    yield
    if task: task.cancel()

app = FastAPI(title="Tenis živě · predikce", lifespan=lifespan)

@app.get("/api/status")
def status(): return SVC.status

@app.get("/api/matches")
def matches(day: int = 0): return dict(day=day, status=SVC.status, matches=SVC.snapshot(day))

@app.get("/api/match/{mid}")
def match(mid: str):
    d = SVC.detail(mid)
    if not d: raise HTTPException(404, "zápas nenalezen")
    return d

@app.get("/api/players")
def players(q: str): return SVC.P.search(q)

@app.get("/api/player/{pid}")
def player(pid: str, surface: str = "Hard"):
    if pid not in SVC.P.s["name"]: raise HTTPException(404)
    return SVC.P.card(pid, surface)

@app.get("/api/predict")
def predict(a: str, b: str, surface: str = "Hard", best_of: int = 3, level: int = 2):
    P = SVC.P
    if a not in P.s["name"] or b not in P.s["name"]: raise HTTPException(404, "neznámý hráč")
    r = P.predict(a, b, surface, level, best_of, 0, int(a[0] == "W"))
    r["cards"] = [P.card(a, surface), P.card(b, surface)]; r["h2h_list"] = P.h2h_list(a, b)
    return r

@app.get("/api/markov")
def markov_ep(p: float, sa: int = 0, sb: int = 0, ga: int = 0, gb: int = 0, pa: int = 0, pb: int = 0, server: int = 0, female: int = 0, best_of: int = 3):
    sets = [(6, 0)] * sa + [(0, 6)] * sb
    return markov.live(p, sets, (ga, gb), (pa, pb), server or None, bool(female), best_of)

@app.get("/api/model")
def model(): return json.load(open(F.ROOT / "data" / "model" / "metrics.json"))

@app.get("/api/chat")
def chat(q: str):
    """Jednoduchý lokální asistent (bez LLM): 'Sinner vs Alcaraz [antuka]' -> predikce modelu."""
    m = re.split(r"\s+(?:vs\.?|v|proti|-)\s+", q.strip(), maxsplit=1, flags=re.I)
    surf = "Clay" if re.search(r"antuk|clay", q, re.I) else "Grass" if re.search(r"tráv|trav|grass", q, re.I) else "Hard"
    if len(m) == 2:
        clean = lambda s: re.sub(r"\b(antuka|antuce|tráva|trávě|tvrdý|hard|clay|grass)\b", "", s, flags=re.I).strip()
        A, B = SVC.P.search(clean(m[0]), 1), SVC.P.search(clean(m[1]), 1)
        if A and B:
            r = SVC.P.predict(A[0]["id"], B[0]["id"], surf, 2, 3, 0, int(A[0]["g"] == "W"))
            f = ", ".join(x["label"] for x in r["factors"][:3])
            return dict(answer=f"{A[0]['name']} vs {B[0]['name']} ({surf}): model {r['p']*100:.0f} % : {(1-r['p'])*100:.0f} %. "
                               f"Elo očekávání {r['elo_p']*100:.0f} %. H2H {r['h2h'][0]}:{r['h2h'][1]}. Hlavní faktory: {f}.")
        return dict(answer="Hráče jsem v datech nenašel. Zkus celé příjmení, např. „Lehečka vs Draper antuka“.")
    return dict(answer="Napiš dvojici hráčů, např. „Sinner vs Alcaraz antuka“, a spočítám predikci modelu. (Lokální asistent bez AI modelu.)")

@app.get("/api/stream")
async def stream(request: Request):
    q = asyncio.Queue(); SVC.subs.add(q)
    async def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected(): break
                try:
                    msg = await asyncio.wait_for(q.get(), 15)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps(dict(type='ping', t=time.time(), status=SVC.status))}\n\n"
        finally:
            SVC.subs.discard(q)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/")
def index(): return FileResponse(WEB / "index.html")

app.mount("/", StaticFiles(directory=WEB), name="web")
