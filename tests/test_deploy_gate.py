import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import deploy_gate

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHA = "0e99659a4f4ae4cfdd6b20f3cd76e956e5c376c3"
OLDER = "a1bc014c72436821cea9ea859bf01d5c42a65d58"


def test_push_always_publishes():
    assert deploy_gate.allow_publish("push", SHA, OLDER)
    assert deploy_gate.allow_publish("push", SHA, "", fetch_ok=False)


def test_refresh_skips_when_main_moved():
    for event in ("schedule", "workflow_dispatch"):
        assert not deploy_gate.allow_publish(event, OLDER, SHA)
        assert deploy_gate.allow_publish(event, SHA, SHA)


def test_refresh_publishes_when_main_cannot_be_fetched():
    assert deploy_gate.allow_publish("schedule", OLDER, "", fetch_ok=False)
    assert not deploy_gate.allow_publish("schedule", OLDER, "", fetch_ok=True)


def test_pages_workflow_splits_queues_and_gates_upload():
    yml = (ROOT / ".github/workflows/pages.yml").read_text()
    assert "pages-${{ github.event_name == 'push' && 'push' || 'refresh' }}" in yml
    assert "cancel-in-progress: false" in yml
    assert "python scripts/deploy_gate.py" in yml
    assert yml.count("steps.gate.outputs.deploy == 'true'") >= 2
    assert "needs.build.outputs.deploy == 'true'" in yml
    assert "gh release upload" not in yml
    learn = (ROOT / ".github/workflows/learn.yml").read_text()
    assert "group: learn" in learn
    assert "gh release upload model" in learn
