"""
Guardia di regressione sulla configurazione di sicurezza del client desktop Tauri.

- La CSP non deve mai tornare a `null`.
- Le capability non devono reintrodurre permessi shell generici.
- La versione desktop deve restare allineata alla VERSION del backend.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TAURI_CONF = REPO_ROOT / "frontend" / "src-tauri" / "tauri.conf.json"
CAPABILITIES = REPO_ROOT / "frontend" / "src-tauri" / "capabilities" / "default.json"


def test_tauri_csp_is_defined():
    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    csp = conf["app"]["security"]["csp"]
    assert csp, "La CSP Tauri non deve essere null/vuota (hardening desktop, audit v1.2)"
    assert "default-src" in csp


def test_tauri_capabilities_no_generic_shell():
    caps = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    permissions = caps["permissions"]
    assert "shell:default" not in permissions, (
        "Non reintrodurre 'shell:default': nessun codice frontend usa il plugin shell"
    )
    for perm in permissions:
        assert not perm.startswith("shell:"), f"Permesso shell non atteso: {perm}"


def test_tauri_version_aligned_with_backend():
    from backend.core.config import VERSION
    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    assert conf["version"] == VERSION, (
        f"Versione desktop ({conf['version']}) disallineata dal backend ({VERSION})"
    )
