# Data Model: #54 User logout

No schema change and no migration. The feature uses an existing table only.

## UserSession (`user_sessions`)

| Field | Use in this feature |
|-------|---------------------|
| `tokenHash` | Looked up with `hashSessionToken(cookie)`; unique, so it matches at most one session |
| `endedAt` | Set to now on logout; a non-null value means the session has already ended (logout is then a no-op that still answers 204) |
| `endReason` | Set to `logout` (existing `SessionEndReason` value); never overwritten when the session has already ended |

### State transition

```text
live (endedAt = null) --POST /auth/logout--> ended (endedAt = now, endReason = logout)
ended (any reason)    --POST /auth/logout--> unchanged (204, cookies cleared)
```

After `endReason = logout`, `SessionGuard` answers a plain 401 on every protected route (existing behavior).

Other sessions of the same user are not touched (logout-all is out of scope).
