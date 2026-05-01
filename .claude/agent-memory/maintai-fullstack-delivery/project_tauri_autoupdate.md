---
name: Tauri 2 auto-update setup
description: Keypair generata, plugin configurato, endpoint backend /desktop/update implementato
type: project
---

Sistema di auto-aggiornamento Tauri 2 implementato (2026-04-27).

Keypair minisign generata con `npx @tauri-apps/cli@2 signer generate -w tauri_signing_key.txt --password "" --ci`.
File chiave in root: `tauri_signing_key.txt` (privata) e `tauri_signing_key.txt.pub` — entrambi in .gitignore.
Public key (base64 del .pub file) inserita in `tauri.conf.json` sotto `plugins.updater.pubkey`.

**Why:** il check all'avvio usa `#[cfg(not(debug_assertions))]` quindi non gira in dev mode, solo nelle build release.

**How to apply:**
- Il manifest `backend/update_manifest.json` inizia con signature/url vuoti: risponde 204 (nessun update) finché non viene popolato da `scripts/prepare_update.py <versione>`.
- Il flusso release completo: build installer → `python scripts/prepare_update.py <ver>` → carica exe su GitHub Releases → commit manifest → deploy backend.
- L'endpoint `/desktop/update` non richiede autenticazione (interrogato prima del login).
- Il CSRF middleware blocca POST/PUT/DELETE ma GET è libero, quindi l'endpoint updater funziona.
