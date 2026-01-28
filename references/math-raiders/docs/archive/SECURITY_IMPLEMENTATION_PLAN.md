# Security Implementation Plan

## Overview

Two security features needed before pilot:
1. **JWT Verification (Anti-Spoofing)** - Prevent identity spoofing ✅ DONE
2. **Views (Row-Level Security)** - Protect student PII from other clients ⏸️ BLOCKED

---

## 1. JWT Verification (Anti-Spoofing)

### Status: ✅ COMPLETE

### Problem (SOLVED)
Previously, clients could connect to SpacetimeDB with any `playerId` they chose. Nothing prevented a malicious client from connecting with someone else's ID.

### Solution: Gateway with JWT verification

```
Before (vulnerable):
  Client ──────────────────────────> SpacetimeDB
          (with arbitrary playerId)

After (secure):
  Client ──> Bun Gateway ──> SpacetimeDB
          (JWT + identity)  (verify → create_session)
```

### Implementation (DEPLOYED)

#### Flow
1. Client connects to SpacetimeDB → gets `identity`
2. Client sends Playcademy JWT + identity to gateway (`/verify` endpoint)
3. Gateway verifies JWT with Playcademy API
4. Gateway calls `create_session` reducer (authorized worker pattern)
5. Client calls `connect()` → server reads `player_id` FROM session
6. Player can only be who their JWT says they are ✅

#### Server Changes (`lib.rs`)

**Session table (simplified):**
```rust
#[table(name = session, public)]
pub struct Session {
    #[primary_key]
    pub connection_id: Identity,
    pub player_id: String,        // Verified by gateway
    pub connected_at: Timestamp,
}
```

**Create session reducer (authorized worker only):**
```rust
#[reducer]
pub fn create_session(ctx: &ReducerContext, client_identity: String, player_id: String) {
    // Only authorized workers can vouch for identities
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        panic!("Unauthorized: only gateway can create sessions");
    }
    // ... creates verified session
}
```

**Connect reducer (reads from trusted session):**
```rust
#[reducer]
pub fn connect(ctx: &ReducerContext, name: String, grade: Option<u8>, 
               timeback_id: Option<String>, email: Option<String>) {
    // Get player_id from verified session (created by gateway)
    let session = ctx.db.session()
        .connection_id()
        .find(&ctx.sender)
        .expect("Session not found - verify with gateway first");
    
    let player_id = session.player_id.clone();
    // Client can only affect their own record - playerId is verified
}
```

#### Gateway Changes (`worker/src/index.ts`)

**Verify endpoint:**
```typescript
if (url.pathname === '/verify' && req.method === 'POST') {
    const { token, stdbIdentity } = await req.json();
    
    // Dev mode bypass
    if (!token && process.env.NODE_ENV !== 'production') {
        const devPlayerId = `dev-${stdbIdentity.slice(0, 8)}`;
        await stdbConnection.reducers.createSession({
            clientIdentity: stdbIdentity,
            playerId: devPlayerId,
        });
        return Response.json({ playerId: devPlayerId });
    }
    
    // Verify with Playcademy API
    const playcademyClient = new PlaycademyClient({ baseUrl, token });
    const user = await playcademyClient.users.me();
    
    // Create verified session in SpacetimeDB
    await stdbConnection.reducers.createSession({
        clientIdentity: stdbIdentity,
        playerId: user.id,
    });
    
    return Response.json({ playerId: user.id, ... });
}
```

#### Client Changes (`gameStore.ts`, `App.tsx`)

```typescript
// Get identity from SpacetimeDB connection
const stdbIdentity = identity.toHexString();

// Verify with gateway
const verifyResponse = await fetch(`${GATEWAY_URL}/verify`, {
    method: 'POST',
    body: JSON.stringify({ token: playcademyToken, stdbIdentity })
});

// Now call connect (server reads playerId from session)
ctx.reducers.connect({ name, grade, timebackId, email });
```

### Verified Flows
- ✅ Initial connection (Playcademy SDK provides JWT)
- ✅ Page refresh (uses stored token from Playcademy client)
- ✅ Disconnect/reconnect (session preserved, re-verifies on reconnect)
- ✅ Dev mode (bypasses JWT, uses dev-* playerId)
- ✅ Spoofing attempt (rejected at gateway)

---

## 2. Views (Row-Level Security)

### Status: ⏸️ BLOCKED - SpacetimeDB 1.9 bug

### Problem
Currently, `player` table is `public` and contains PII:
- `timeback_id` 
- `email`

Any client subscribing to `SELECT * FROM player` could see other students' data.

**Mitigated by:** JWT verification ensures clients can only modify their own data, but exposure risk remains if malicious client queries other rows.

### Solution: Server-defined views
Instead of client filtering (`SELECT * FROM player WHERE id = '...'`), use server-defined views that enforce filtering.

### Implementation (ready, waiting for bug fix)

**Server view (already deployed):**
```rust
#[view(name = my_player, public)]
fn my_player(ctx: &ViewContext) -> Option<Player> {
    let session = ctx.db.session().connection_id().find(ctx.sender)?;
    ctx.db.player().id().find(&session.player_id)
}
```

**Client subscription (when bug is fixed):**
```typescript
// Change from:
`SELECT * FROM player WHERE id = '${playerId}'`

// To:
`SELECT * FROM my_player`
```

### Views needed (all blocked)
| View | Purpose | Return Type |
|------|---------|-------------|
| `my_player` | Current player's data | `Option<Player>` |
| `my_fact_mastery` | Player's fact mastery | `Vec<FactMastery>` |
| `my_performance` | Player's performance snapshots | `Vec<PerformanceSnapshot>` |
| `my_problems` | Player's current problems | `Vec<Problem>` |
| `my_answers` | Player's answers | `Vec<PlayerAnswer>` |
| `visible_raids` | Raids player can see | `Vec<Raid>` |
| `visible_raid_players` | Raid players in visible raids | `Vec<RaidPlayer>` |

### Bug details
SpacetimeDB 1.9 has a server-side BSATN serialization bug for views. Client deserialization fails with errors like:
```
RangeError: Tried to read 3575912922 byte(s) at relative offset 4, but only 187 byte(s) remain
```

Confirmed by SpacetimeDB team on Discord (dovos):
> "there is also a bug with the views on the server sides subscription handler bsatn serializer which leads to the clients deserializer to fail on random things like a -length or way too large length of bytes (this is for all languages afaik)"

### When to revisit
- Monitor SpacetimeDB releases for view bug fix
- The `my_player` view is already deployed on server
- Only client-side subscription change needed when fixed

---

## Summary

| Feature | Status | Risk Level | Notes |
|---------|--------|------------|-------|
| JWT Verification | ✅ Complete | Blocked | Prevents identity spoofing |
| Views (RLS) | ⏸️ Blocked | Low | PII exposure possible but requires malicious client; spoofing prevented |

### Current Security Posture
- **Spoofing:** ✅ Prevented (JWT verification)
- **Data exposure:** ⚠️ Mitigated (clients can query but can't modify others' data)

### Next Steps
1. Monitor SpacetimeDB for view bug fix
2. When fixed: change client subscriptions from table queries to view queries
3. No server changes needed - views already deployed

---

## References

- SpacetimeDB Views docs: https://spacetimedb.com/docs/server-languages/rust/views
- SpacetimeDB 1.9 release notes: Views feature released
- Discord confirmation: Views bug acknowledged by team member (dovos)
