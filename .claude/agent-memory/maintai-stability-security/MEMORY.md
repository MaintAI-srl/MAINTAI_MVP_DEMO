# Agent Memory Index — MaintAI Stability & Security

- [AI Privacy Anonymization Pattern](project_ai_privacy.md) — anonymizer.mask_text() must wrap all user text before OpenAI calls; confirmed pattern and covered endpoints
- [IMAP SSRF Prevention](project_imap_ssrf.md) — _validate_imap_server() blocks private/loopback IPs via DNS resolution before _test_imap(); added to email_config.py POST
- [Test Setup](project_test_setup.md) — test environment requires pip install -r requirements.txt --ignore-installed PyJWT; tests pass with JWT_SECRET + ENCRYPTION_KEY env vars
- [Upload & Storage Security P1](project_upload_security_p1.md) — June 2026: file_validation extended, storage privatized (path model), download endpoints, 14 tests; 140 tests total pass
