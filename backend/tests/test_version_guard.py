from pathlib import Path
import hashlib


EXPECTED_DEPLOY_VERSION_FUNCTION_SHA256 = "2eec49cf29cd101a033a29fe43c3193b0150f9c49451a2329b15b2928fad61d8"


def test_deploy_version_function_is_not_touched():
    script = Path(__file__).resolve().parents[2] / "scripts" / "deploy_version.mjs"
    text = script.read_text(encoding="utf-8")
    start = "// BEGIN DEPLOY_VERSION_FUNCTION_DO_NOT_TOUCH"
    end = "// END DEPLOY_VERSION_FUNCTION_DO_NOT_TOUCH"

    protected_block = text[text.index(start): text.index(end) + len(end)]
    digest = hashlib.sha256(protected_block.encode("utf-8")).hexdigest()

    assert digest == EXPECTED_DEPLOY_VERSION_FUNCTION_SHA256
