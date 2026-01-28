# Math Raiders - Codebase Audit

**Reviewed by:** @hbauer

---

## Executive Summary

### Context

Math Raiders is currently in pilot with fewer than 10 daily active users, but is scheduled to potentially see 20+ DAU in the coming weeks. Additionally, there is a chance that this game becomes the go-to-market leader for FastMath in the TimeBack ecosystem. 

Given this trajectory, we're auditing the codebase for overt security issues and architectural weaknesses, with an eye toward scalability.

### Scope of This Audit

**In Scope:**

- Security vulnerabilities
- Architectural scalability
- Infrastructure reliability

**Out of Scope:**

- Game mechanics and educational design
- Frontend UI/UX improvements
- Opinions on code style/quality

### What Was Found

**Security**

The codebase has 3 critical security vulnerabilities that must be addressed before wider release:

1. OAuth credentials exposed in client - Anyone can extract TimeBack API secrets from browser DevTools and impersonate the application.

2. No row-level security on student data - Anyone who connects can query and download all student PII by modifying subscription queries.

3. No identity authentication - The game trusts client-supplied `player_id` without verification, allowing account impersonation.

**Architecture**

5 observations about the current architecture that may be worth considering as the system scales:

- Single worker instance (consider redundancy at higher scale)
- Large data structures in tables (may affect memory at 100+ users)
- No caching layer (could optimize expensive queries)
- No rate limiting (not needed at current scale)
- Hardcoded production IPs (makes infrastructure changes require code updates)

---

## Table of Contents

### [Security](#security-1)

**High Priority**

- [OAuth Credentials Exposed in Client Bundle](#oauth-credentials-exposed-in-client-bundle)
- [No Row-Level Security on Student Data Tables](#no-row-level-security-on-student-data-tables)
- [No Authentication/Identity Binding on Connect](#no-authenticationidentity-binding-on-connect)
- [Client-Side Logic Trust](#client-side-logic-trust)

**Low Priority**

- [No Input Validation on Room Codes](#no-input-validation-on-room-codes)
- [WSS Enforcement for WebSocket](#wss-enforcement-for-websocket)

### [Architecture & Scalability](#architecture--scalability-1)

**Notes & Observations** _(Worth considering as you scale)_

- [Single Worker Instance](#single-worker-instance)
- [Large Data Structures in Tables](#large-data-structures-in-tables)
- [No Caching Layer](#no-caching-layer)
- [No Rate Limiting](#no-rate-limiting)
- [Hardcoded Production IPs](#hardcoded-production-ips)

### Additional Sections

- [Additional Resources](#additional-resources)

---

## SECURITY

### High Priority

#### OAuth Credentials Exposed in Client Bundle

**Affected Area**: `client/src/utils/fetchGradeFromAlphaMath.ts:14-15`

```typescript
const TIMEBACK_CLIENT_ID = import.meta.env.VITE_TIMEBACK_CLIENT_ID || '';
const TIMEBACK_CLIENT_SECRET = import.meta.env.VITE_TIMEBACK_CLIENT_SECRET || '';
```

**Issue**:

TimeBack API credentials are embedded in the client JavaScript bundle and used for client-side grade fetching from AlphaMath enrollments. Vite automatically embeds any `VITE_*` variable into the client JavaScript bundle at build time, making these secrets accessible to anyone.

Any user can:
- Extract credentials from browser DevTools
- Make direct API calls to TimeBack impersonating the application
- Access other students' data via TimeBack APIs
- Manipulate their own grade assignment by modifying client-side code
- Exceed rate limits causing service disruption

**Impact**: 

Complete compromise of TimeBack integration; potential FERPA violation if student data is accessed; data integrity issues.

**Fix**:

- Move all OAuth authentication to a backend service
- Create backend endpoint (e.g., `/api/student-grade`) that:
  1. Receives student TimeBack ID from client
  2. Fetches grade from TimeBack using server-stored credentials
  3. Returns grade to client
- Client should never make direct TimeBack API calls
- Use `VITE_` prefix only for public config (API URLs, feature flags, public DSNs)
- Never use `VITE_` for secrets, tokens, passwords, or private keys
- Keep secrets in backend environment variables, access them via API endpoints

---

#### No Row-Level Security on Student Data Tables

**Affected Area**: `server/src/lib.rs:171,277,326,473,496,597`

**Issue**:

SpacetimeDB uses `#[client_visibility_filter]` annotations with SQL-based filters to implement row-level security. The database already demonstrates this pattern correctly for `timeback_event_queue` (restricting access to authorized workers only), but this protection is missing from all student-facing tables.

All major tables are marked `public` with no Row-Level Security filters:
- `player` - student profiles, grades, emails, TimeBack IDs
- `raid`, `raid_player` - gameplay data  
- `player_answer`, `fact_mastery` - learning analytics
- `performance_snapshot` - performance data

Anyone who connects to the game can:
- Access all student data without authentication or authorization checks
- Modify their client code to subscribe to `SELECT * FROM player` and download all student records
- Access all student PII (names, emails, grades, TimeBack IDs) without restriction

Proof of concept:
```typescript
// A malicious client could do this:
connection.subscriptionBuilder()
  .subscribe(['SELECT * FROM player']) // Get ALL students
  .subscribe(['SELECT * FROM fact_mastery']) // Get ALL learning data
```

**Impact**: 

Complete exposure of student PII and learning data to bad actors.

**Fix**:

- Implement Row-Level Security (RLS) filters for tables containing student data
- The codebase already has a working example for `timeback_event_queue` (lines 651-655):

  ```rust
  #[client_visibility_filter]
  const PLAYER_VISIBILITY: Filter = Filter::Sql(
      "SELECT p.* FROM player p 
       JOIN session s ON s.player_id = p.id 
       WHERE s.connection_id = :sender"
  );
  ```

- Apply similar filters to: `player`, `fact_mastery`, `performance_snapshot`, `player_answer`, `problem`
- Only allow students to see their own data and data from raids they're actively in

---

#### No Authentication/Identity Binding on Connect

**Affected area**: `server/src/lib.rs:661` (`connect` reducer)

```rust
pub fn connect(ctx: &ReducerContext, name: String, player_id: String, 
               grade: Option<u8>, timeback_id: Option<String>, email: Option<String>)
```

**Risk**:

- The `connect` reducer trusts all client-supplied parameters without verification
- Any user can supply any `player_id` and impersonate another student
- Client can modify `email`, `timebackId`, and other identity fields
- No cryptographic proof that the client owns the `player_id` they claim

**Example Attack**:
```typescript
connection.reducers.connect(
  "Student Name",
  "another-students-playcademy-id", // Impersonation
  3, // grade
  "another-timeback-id",
  "another@email.com"
);
```

**Impact**: Complete account takeover; grade manipulation; false data attribution; FERPA violations

**Fix**:

Integrate with Playcademy's existing token verification system. The `connect` reducer should verify the token via Playcademy's API before trusting any claims.

**High-Level Pattern**:
```rust
#[reducer]
pub fn connect(ctx: &ReducerContext, playcademy_token: String) {
    // Call Playcademy's /api/games/verify endpoint to verify token
    // Endpoint returns: { user: { sub, email, name, timeback_id }, game_id }
    
    let verified_user = verify_token_via_http_call(playcademy_token)?;
    
    // Use ONLY verified claims (can't be spoofed by client)
    let player_id = verified_user.sub;
    let email = verified_user.email;
    let name = verified_user.name;
    let timeback_id = verified_user.timeback_id;
    
    // ... rest of connect logic with verified identity
}
```

**Key Points**:

- Client passes Playcademy game token (not raw identity data)
- Reducer makes HTTP POST to `https://hub.playcademy.com/api/games/verify`
- Only use identity claims returned from Playcademy API
- Will need Rust HTTP client (e.g., `reqwest`)

**Reference**: [verifyGameToken](https://docs.dev.playcademy.net/sdk/server.html#verifygametoken) shows the TypeScript pattern; same HTTP endpoint can be called from Rust.

---

#### Client-Side Logic Trust

**Affected Area**: `client/src/store/gameStore.ts` (`captureRaidStartState` and related state management)

**Issue**:

The client is responsible for significant game logic, including capturing raid start state and calculating various game metrics. The server then trusts these client-supplied values without independent validation.

Examples:

- Client calculates and submits raid state snapshots
- Client determines timing and scoring parameters
- Client manages game state transitions that affect rewards

**Risk**:

- Malicious users can modify client code to submit inflated scores
- Game state can be manipulated to grant unearned rewards
- Leaderboard integrity compromised by client-side "score hacking"
- Invalid state submissions can corrupt game data

**Impact**: 

Score manipulation; unfair leaderboard rankings; compromised game integrity; potential data corruption from invalid state.

**Fix**:

- Treat all client input as untrusted
- Server should independently validate and recalculate critical values:
  - Answer verification: **Already implemented** - `submit_answer` recalculates correctness and timing server-side
  - Raid summaries: **Not implemented** - Server should emit authoritative rank/division deltas, AP earned, facts mastered, and track master unlocks instead of trusting client-calculated `captureRaidStartState` snapshots
  - State transitions: **Not implemented** - Drive rank-up modals, "Raid Again" eligibility, and reward unlocks from server summaries, not client-side delta calculations in `ResultsScreen.tsx`
- Client should be treated as a "view" that submits user actions; server should be the authoritative source for all scoring, rewards, and progression

---

### Low Priority

#### No Input Validation on Room Codes

**Affected Area**: `server/src/lib.rs` (room code generation and validation)

**Issue**:

- No rate limiting on room code attempts
- No expiration on room codes
- 1.6M combinations makes brute force impractical for casual attackers
- Private rooms are typically short-lived (single game session)

**Impact**: 

Low likelihood of unauthorized access to private games. Main risk is griefing, not data exposure.

**Recommendation**:

- Add rate limiting on `joinPrivateRoom` reducer for defense in depth
- Consider room code expiration if rooms become long-lived

---

#### WSS Enforcement for WebSocket

**Affected Area**: WebSocket connections currently use `ws://` instead of `wss://`

**Issue**:

WebSocket connections use unencrypted `ws://` protocol instead of secure `wss://` (WebSocket over TLS).

Current setup works for development and pilot phases. Private repository and controlled deployment environment reduce immediate risk.

**Impact**: 

Data transmitted in plain text without encryption. Not urgent given current deployment model, but worth addressing for defense in depth as scale increases.

**Recommendation**:

- Migrate WebSocket connections to `wss://` (WebSocket over TLS)
- Can be implemented at infrastructure level (load balancer, reverse proxy)
- Standard practice as applications mature

---

## ARCHITECTURE & SCALABILITY

### Notes & Observations

#### Large Data Structures in Tables

**Affected Area**: `server/src/lib.rs:527`

```rust
pub recent_attempts: Vec<AttemptRecord>,  // Up to 10,000 attempts
```

**Observation**:

`FactMastery` table stores up to 10,000 attempts per fact as a vector in the table. All attempts are loaded into memory when a client subscribes to their mastery data.

**At Current Scale**: No issues with <10 users.

**Future Consideration** (at 100+ users): May want to limit the number of attempts kept in hot storage (e.g., keep only most recent 100) to reduce memory footprint and subscription load times. A student with 100 mastered facts × 10,000 attempts = 1M records loaded into memory per connection

---

#### No Caching Layer

**Affected Area**: Leaderboard queries, performance snapshots

**Observation**:

No caching layer implemented. Leaderboards and performance stats are queried directly from the database on each request (e.g., every time a player visits the lobby).

**At Current Scale**: No performance issues with <10 DAU.

**Future Consideration** (at 100+ users): Consider adding a caching layer for frequently accessed data. For example, leaderboards could be cached since they're already rebuilt after each raid. This would reduce database query load and improve response times as more concurrent users access the same data

---

#### No Rate Limiting

**Affected Area**: All reducers in `server/src/lib.rs`

**Observation**:

No rate limiting or request throttling implemented on reducers. Clients can make unlimited requests.

**At Current Scale**: Not a concern with <10 DAU and trusted users.

**Future Consideration** (at 100+ users): Consider adding request throttling per connection (e.g., max 100 requests/minute) to prevent abuse or accidental infinite loops. Can be implemented at proxy layer or SpacetimeDB level

---

#### Single Worker Instance

**Affected Area**: `worker/src/index.ts`

**Observation**:

Single worker instance processes TimeBack events. The worker is well-designed with reactive subscriptions and retry logic (MAX_RETRIES = 5), but there's no redundancy or failover. If the worker crashes, events queue up until it restarts.

**At Current Scale**: Not a concern with <10 DAU. Events are persisted in database, so temporary worker downtime just delays processing without data loss.

**Future Consideration** (at 100+ users): Consider deploying multiple worker instances with health checks and distributed locking. This provides redundancy (no single point of failure) and handles higher event throughput during peak usage

---

#### Hardcoded Production IPs

**Affected Area**: `client/package.json:8`, `admin/admin.ts:9`

```json
"dev:prod": "VITE_SPACETIMEDB_HOST=ws://18.224.110.93:3000 vite",
```

**Observation**:

Production server IP (`18.224.110.93:3000`) is hardcoded in package scripts and source code. Not a security concern since repository is private, but means any IP change requires code updates and client redeployment.

**If You Migrate Infrastructure**: Consider using domain names (e.g., `wss://api.mathraiders.com`) instead of direct IPs. This makes it easier to change servers, add load balancing, or implement DNS-based failover without requiring client code changes

---

## Additional Resources

- [SpacetimeDB Row-Level Security Docs](https://spacetimedb.com/docs)
- [FERPA Compliance for EdTech](https://studentprivacy.ed.gov/)