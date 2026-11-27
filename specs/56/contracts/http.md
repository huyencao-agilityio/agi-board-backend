# Contracts: #56

**No HTTP contract change.** The four routes keep their request bodies, status codes, and error codes exactly as #22 and the password-reset spec define them:

| Route | Success | Failures (unchanged) |
|---|---|---|
| `POST /auth/change-password` | 204 | 400 `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_NOT_SET`, `VALIDATION_FAILED`; 429 `CHANGE_PASSWORD_LOCKED` |
| `DELETE /auth/sessions/:sessionId` | 204 | 400 `CURRENT_SESSION`; 404 `SESSION_NOT_FOUND` |
| `DELETE /auth/sessions` | 204 (also when nothing to end) | — |
| `POST /auth/reset-password` | as today | link-invalid error as today |

The only new observable effect is an `audit_log_entries` row, described in [data-model.md](../data-model.md). No route reads it (clarification Q2).
