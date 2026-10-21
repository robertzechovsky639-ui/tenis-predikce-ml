"""Bayesovská aktualizace bodu na podání v živé predikci (backend i prohlížeč musí počítat stejně)."""
import os, sys, json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / "backend"))
import markov

def test_bayes_serve_shrinkage():
    assert markov.bayes_serve(0.64, None) == 0.64
    assert markov.bayes_serve(0.64, (0, 0)) == 0.64
    assert abs(markov.bayes_serve(0.64, (100, 80)) - (400 * 0.64 + 80) / 500) < 1e-12
    assert markov.bayes_serve(0.64, (10, 20)) == 0.64  # nesmysl (vyhráno > odehráno) se ignoruje

def test_live_uses_serve_stats():
    base = markov.live(0.6, [(6, 4)], (2, 2), (0, 0), 1)
    same = markov.live(0.6, [(6, 4)], (2, 2), (0, 0), 1, srv_stats=None)
    assert base["match"] == same["match"]
    good_b = markov.live(0.6, [(6, 4)], (2, 2), (0, 0), 1, srv_stats=((60, 33), (60, 48)))  # B podává mnohem líp
    assert good_b["match"] < base["match"] and good_b["pb"] > base["pb"] and good_b["pa"] < base["pa"]

JS = r"""
const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8');
const MK=new Function(src.match(/const MK = \(\(\) => \{[^]*?\n\}\)\(\);/)[0]+'\nreturn MK;')();
const r=MK.live(0.6,[[6,4]],[2,2],[0,0],1,false,3,null,false,[[60,33],[60,48]]);
const b=MK.live(0.6,[[6,4]],[2,2],[0,0],1,false,3,null,false,null);
console.log(JSON.stringify({r:r.match,b:b.match,pa:r.serve_a,pb:r.serve_b}));
"""

def test_js_matches_python():
    out = subprocess.check_output(["node", "-e", JS,
                                   str(ROOT / "web/static.js")], cwd=ROOT)
    js = json.loads(out)
    py = markov.live(0.6, [(6, 4)], (2, 2), (0, 0), 1, srv_stats=((60, 33), (60, 48)))
    pyb = markov.live(0.6, [(6, 4)], (2, 2), (0, 0), 1)
    assert abs(js["r"] - py["match"]) < 2e-3 and abs(js["b"] - pyb["match"]) < 2e-3
    assert abs(js["pb"] - py["pb"]) < 1e-3 and js["r"] < js["b"]

def test_parse_sofa_statistics_fixture():
    code = r"""
const fs=require('fs');const src=fs.readFileSync('web/static.js','utf8');
const fn=new Function(src.match(/function parseSofaStats[^]*?\n(?=async function sofaStats)/)[0]+'\nreturn parseSofaStats;')();
const d=JSON.parse(fs.readFileSync('tests/fixtures/sofa_statistics.json','utf8'));
console.log(JSON.stringify([fn(d,true),fn(d,false),fn({},true)]));"""
    a, b, c = json.loads(subprocess.check_output(["node", "-e", code], cwd=ROOT))
    assert a == [[96, 65], [89, 69]] and b == [a[1], a[0]] and c is None

def test_parse_sofa_statistics_itf_return_only():
    code = r"""
const fs=require('fs');const src=fs.readFileSync('web/static.js','utf8');
const fn=new Function(src.match(/function parseSofaStats[^]*?\n(?=async function sofaStats)/)[0]+'\nreturn parseSofaStats;')();
const d=JSON.parse(fs.readFileSync('tests/fixtures/sofa_statistics_itf.json','utf8'));console.log(JSON.stringify(fn(d,true)));"""
    st = json.loads(subprocess.check_output(["node", "-e", code], cwd=ROOT))
    d = json.load(open(ROOT / "tests/fixtures/sofa_statistics_itf.json")); it = {x["key"]: x for g in d["statistics"][0]["groups"] for x in g["statisticsItems"]}
    # body vyhrané domácím na podání = servicePointsScored (kontrola odvození z returnů soupeře)
    assert st[0][1] == it["servicePointsScored"]["homeValue"] and st[1][1] == it["servicePointsScored"]["awayValue"]
    assert st[0][0] > st[0][1] > 0 and st[1][0] > st[1][1] > 0
