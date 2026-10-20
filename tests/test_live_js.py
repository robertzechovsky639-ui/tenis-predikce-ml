import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_live_merge_and_coverage():
    subprocess.check_call(["node", "tests/test_live_merge.js"], cwd=ROOT)
    subprocess.check_call(["node", "tests/test_pred_coverage.js"], cwd=ROOT)
    subprocess.check_call(["node", "tests/test_live_speed.js"], cwd=ROOT)
