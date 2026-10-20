"""Stáhne release `model` se zálohou z Actions cache.

Release se přepisuje smazáním a novým nahráním, takže soubor může chybět nebo být useknutý.
Špatný soubor se nepoužije a nepřepíše poslední celou zálohu. Do release se odsud nic nenahrává.
"""
import json, os, pathlib, shutil, subprocess, sys, tarfile, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "online-cache"
INCOMING = CACHE / "incoming"
MODEL = ROOT / "data" / "model"
RAW = ROOT / "data" / "raw"
PUBLISHED = ROOT / "data" / "online" / "state.published.json"
NEED = {"gbm.txt", "state.pkl", "logreg.pkl", "matches.pkl"}
REPO = os.environ.get("GITHUB_REPOSITORY", "robertzechovsky639-ui/tenis-predikce-ml")


def archive_ok(path):
    path = pathlib.Path(path)
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    try:
        with tarfile.open(path, "r:gz") as tar:
            names = {pathlib.PurePosixPath(m.name).name for m in tar.getmembers() if m.isfile()}
    except (tarfile.TarError, OSError, EOFError):
        return False
    return NEED <= names


def csv_ok(path):
    path = pathlib.Path(path)
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2 or "fs_id" not in lines[0]:
        return False
    # Useknutý poslední řádek (méně sloupců než hlavička) se nebere.
    return lines[-1].count(",") == lines[0].count(",")


def published_state_ok(obj):
    return isinstance(obj, dict) and isinstance(obj.get("matches"), list) and isinstance(obj.get("ids"), list)


def choose(incoming, cached, predicate):
    for path in (incoming, cached):
        if not path:
            continue
        path = pathlib.Path(path)
        if not path.is_file():
            continue
        try:
            if predicate(path):
                return path
        except Exception:
            continue
    return None


def download_asset(name, dest):
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    proc = subprocess.run(
        ["gh", "release", "download", "model", "-p", name, "-D", str(dest.parent), "-R", REPO],
        capture_output=True, text=True)
    if proc.returncode == 0 and dest.is_file() and dest.stat().st_size > 0:
        return True
    err = (proc.stderr or proc.stdout or "").strip()
    print(f"stažení {name} selhalo: {err}")
    if dest.exists():
        dest.unlink()
    return False


def download_ok(name, dest, predicate, retries=5, pause=10):
    """Opakuje i useknutý soubor. Release se při nahrání maže, takže chvíli není celý."""
    dest = pathlib.Path(dest)
    for attempt in range(1, retries + 1):
        if download_asset(name, dest) and predicate(dest):
            return True
        if dest.exists():
            print(f"{name} je neúplný ({attempt}/{retries})")
            dest.unlink()
        if attempt < retries:
            time.sleep(pause)
    return False


def extract_tar(archive, dest):
    dest = pathlib.Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        try:
            tar.extractall(dest, filter="data")
        except TypeError:
            tar.extractall(dest)


def take(chosen, cached):
    chosen, cached = pathlib.Path(chosen), pathlib.Path(cached)
    if chosen.resolve() != cached.resolve():
        cached.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(chosen, cached)
    return cached


def fetch_published():
    owner, repo = REPO.split("/", 1)
    url = f"https://{owner}.github.io/{repo}/data/state.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tenis-export"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
        obj = json.loads(raw.decode("utf-8"))
    except Exception as e:
        print("state.json z Pages nedostupné:", e)
        return False
    if not published_state_ok(obj):
        print("state.json z Pages nemá seznam zápasů a id")
        return False
    PUBLISHED.parent.mkdir(parents=True, exist_ok=True)
    tmp = PUBLISHED.with_name(PUBLISHED.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(tmp, PUBLISHED)
    print("state.json z Pages:", len(obj["matches"]), "zápasů")
    return True


def main():
    INCOMING.mkdir(parents=True, exist_ok=True)
    inc_model = INCOMING / "model.tar.gz"
    cached_model = CACHE / "model.tar.gz"
    download_ok("model.tar.gz", inc_model, archive_ok)
    chosen = choose(inc_model if inc_model.exists() else None, cached_model if cached_model.exists() else None, archive_ok)
    if chosen is None:
        print("model.tar.gz není k dispozici ani z release, ani ze zálohy", file=sys.stderr)
        shutil.rmtree(INCOMING, ignore_errors=True)
        sys.exit(1)
    extract_tar(chosen, MODEL)
    take(chosen, cached_model)
    print("model:", chosen)

    inc_csv = INCOMING / "live_results.csv"
    cached_csv = CACHE / "live_results.csv"
    download_ok("live_results.csv", inc_csv, csv_ok, retries=3, pause=5)
    chosen_csv = choose(inc_csv if inc_csv.exists() else None, cached_csv if cached_csv.exists() else None, csv_ok)
    if chosen_csv is None:
        print("live_results.csv chybí, export pojede bez něj")
    else:
        take(chosen_csv, cached_csv)
        RAW.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached_csv, RAW / "live_results.csv")
        print("live_results:", chosen_csv)

    fetch_published()
    shutil.rmtree(INCOMING, ignore_errors=True)


if __name__ == "__main__":
    main()
