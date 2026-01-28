# Math Raiders Architecture Deep Dive

This document provides a comprehensive analysis of Math Raiders' architecture, API integrations, and game mechanics for reference when building similar Playcademy games.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack by Component](#tech-stack-by-component)
3. [User Flow (Auth → Gameplay → Analytics)](#user-flow)
4. [API Integrations](#api-integrations)
5. [XP Calculation](#xp-calculation)
6. [AP Calculation (In-Game Currency)](#ap-calculation)
7. [Key Files Reference](#key-files-reference)

---

## Architecture Overview

Math Raiders uses a **3-tier architecture**: Client, Server (SpacetimeDB), and Worker.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MATH RAIDERS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐      WebSocket      ┌──────────────────┐                  │
│  │   CLIENT    │◄───────────────────►│  SPACETIMEDB     │                  │
│  │  (Browser)  │    (Real-time)      │    SERVER        │                  │
│  │             │                     │   (Rust/WASM)    │                  │
│  │ • React 19  │                     │                  │                  │
│  │ • TypeScript│                     │ • Game Logic     │                  │
│  │ • Zustand   │                     │ • Player Data    │                  │
│  │ • PIXI.js   │                     │ • Raid State     │                  │
│  │ • Tailwind  │                     │ • Fact Mastery   │                  │
│  └─────────────┘                     └────────┬─────────┘                  │
│         │                                     │                            │
│         │ HTTP                                │ Event Queue                │
│         ▼                                     ▼                            │
│  ┌─────────────┐                     ┌──────────────────┐                  │
│  │   WORKER    │◄────────────────────│  TimeBack APIs   │                  │
│  │  (Gateway)  │      REST           │  (Alpha 1EdTech) │                  │
│  │             │                     │                  │                  │
│  │ • Bun       │                     │ • OneRoster      │                  │
│  │ • JWT Verify│                     │ • Caliper        │                  │
│  │ • Grade API │                     │ • Gradebook      │                  │
│  └─────────────┘                     └──────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SpacetimeDB** | Real-time multiplayer without building infra; Rust for performance |
| **Rust on server** | Type safety, no runtime errors, compiles to WASM |
| **Bun** | 3x faster than Node for worker service |
| **Separate Worker** | OAuth credentials stay server-side; async analytics processing |
| **Zustand** | Simpler than Redux, works well with subscriptions |
| **React 19 RC** | Server components, improved performance |

---

## Tech Stack by Component

### 1. Client (Browser)

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.0.0-rc.1 | UI framework |
| **TypeScript** | ^5 | Type safety |
| **Vite** | ^6.3.5 | Build tool & dev server |
| **Zustand** | ^5.0.6 | State management |
| **SpacetimeDB SDK** | ^1.11.4 | Real-time WebSocket connection |
| **PIXI.js** | ^8.11.0 | Hardware-accelerated particle effects |
| **Framer Motion** | ^12.23.9 | UI animations |
| **Tailwind CSS** | ^4.1.11 | Styling |
| **Radix UI** | Various | Accessible components |
| **Playcademy SDK** | ^0.2.2 | Authentication |
| **Bun** | Latest | Package manager & runtime |

### 2. Server (SpacetimeDB)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Rust** | 2021 Edition | Server-side game logic |
| **SpacetimeDB** | 1.10.0 | Real-time multiplayer database |
| **WASM** | wasm32-unknown-unknown | Compiled target |
| **serde_json** | 1.0 | JSON serialization |
| **chrono** | 0.4 | Date/time handling |

**SpacetimeDB** is a unique database that:
- Runs your **Rust code inside the database** (as WASM modules)
- Provides **real-time subscriptions** over WebSocket
- Has **row-level security** built in
- Auto-generates **TypeScript client bindings**

### 3. Worker (Gateway Service)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Bun** | Latest | Runtime |
| **TypeScript** | Latest | Type-safe API code |
| **SpacetimeDB SDK** | ^1.11.4 | Subscribe to event queue |
| **Playcademy SDK** | ^0.2.2 | JWT verification (server) |

---

## User Flow

### Phase 1: Playcademy SDK Initialization

**File:** `client/src/App.tsx`

```typescript
PlaycademyClient.init()
  .then(async (client: PlaycademyClient) => {
    setTokenGetter(() => client.getToken() || undefined);
    const user = await client.users.me();
    // Extract: displayName, email, timebackId
    connect(displayName, resolvedGrade, playcademyToken, timebackId);
  })
```

**Playcademy SDK Methods:**

| Method | Purpose |
|--------|---------|
| `PlaycademyClient.init()` | Initialize SDK |
| `client.getToken()` | Get JWT for backend verification |
| `client.users.me()` | Get authenticated user profile |
| `client.timeback.user?.id` | Get TimeBack ID (new API) |

### Phase 2: Gateway JWT Verification

**File:** `worker/src/index.ts` (endpoint: `POST /verify`)

```
Client → POST /verify { token, stdbIdentity }
       ↓
Gateway → verifyGameToken(token, { baseUrl }) // Playcademy SDK server
       ↓
Gateway → TimeBack API (enrich user data)
       ↓
Gateway → SpacetimeDB createSession()
       ↓
Client ← { playerId, name, email, timebackId, grade, lockedTracks }
```

**Playcademy Server SDK:**

```typescript
import { verifyGameToken } from '@playcademy/sdk/server';

const { user, gameId } = await verifyGameToken(token, { baseUrl: playcademyBaseUrl });
// user.sub, user.email, user.name, user.timeback_id
```

### Phase 3: SpacetimeDB Connection

**File:** `client/src/store/gameStore.ts`

```typescript
// Connect to SpacetimeDB
const conn = DbConnection.builder()
  .withUri(SPACETIMEDB_URI)
  .withModuleName('math-raiders')
  .build();

// Subscribe to player-specific tables (RLS)
ctx.subscriptionBuilder().subscribe([
  `SELECT * FROM my_player`,
  `SELECT * FROM problem WHERE player_id = '${playerId}'`,
  `SELECT * FROM player_answer WHERE player_id = '${playerId}'`,
  `SELECT * FROM fact_mastery WHERE player_id = '${playerId}'`,
  `SELECT * FROM performance_snapshot WHERE player_id = '${playerId}'`
]);
```

### Phase 4: Analytics Flow (Async)

```
1. Raid ends → Rust creates TimebackEventQueue record
2. Worker subscribes to queue → polls for unsent events
3. Worker → Caliper API (learning events)
4. Worker → marks event sent
```

---

## API Integrations

### Summary Table

| Service | API Type | Purpose | When Called |
|---------|----------|---------|-------------|
| **Playcademy** | SDK | Auth, user profile, JWT | App init |
| **Playcademy** | Server SDK | JWT verification | `/verify` endpoint |
| **TimeBack/OneRoster** | REST | User lookup, enrollments | Grade resolution, enrollment sync |
| **TimeBack Gradebook** | REST | Speed Scores (assessments) | Grade/track determination |
| **TimeBack Caliper** | REST | Learning analytics | Raid completion |
| **SpacetimeDB** | WebSocket | Real-time game state | Throughout gameplay |

### TimeBack/OneRoster APIs

**Base URLs:**
- Rostering: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2`
- Gradebook: `https://api.alpha-1edtech.ai/ims/oneroster/gradebook/v1p2`
- Auth: `https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token`

#### Authentication (OAuth 2.0 Client Credentials)

```typescript
POST /oauth2/token
Body: grant_type=client_credentials&client_id=...&client_secret=...
Response: { access_token, expires_in, token_type }
```

#### OneRoster Rostering APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/users?filter=email='{email}'` | GET | Find user by email |
| `/enrollments?filter=user.sourcedId='{id}'&limit=200` | GET | Get student enrollments |
| `/enrollments/` | POST | Create enrollment |
| `/enrollments/{id}` | PATCH | Update enrollment (set endDate) |
| `/enrollments/{id}` | DELETE | Soft delete enrollment |

#### OneRoster Gradebook APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/assessmentResults?filter=student.sourcedId='{id}'&limit=3000&offset={n}` | GET | Get Speed Scores (paginated) |

### Caliper Analytics

**API Endpoint:** `POST https://caliper.alpha-1edtech.ai/caliper/event`

**Events Sent (per raid):**

1. **ActivityEvent** (what they accomplished)
```json
{
  "type": "ActivityEvent",
  "action": "Completed",
  "profile": "TimebackProfile",
  "generated": {
    "items": [
      { "type": "xpEarned", "value": 120 },
      { "type": "totalQuestions", "value": 15 },
      { "type": "correctQuestions", "value": 12 },
      { "type": "masteredUnits", "value": 2 }
    ]
  }
}
```

2. **TimeSpentEvent** (how long they spent)
```json
{
  "type": "TimeSpentEvent",
  "action": "SpentTime",
  "profile": "TimebackProfile",
  "generated": {
    "items": [
      { "type": "active", "value": 180 }
    ]
  }
}
```

### Math Raiders Class IDs (Grade → Class mapping)

```typescript
{
  0: 'a747e46c-db9d-43de-a586-44b4cc17e003', // Grade K
  1: 'd7f70171-ad42-4cc9-9ebb-59c210bc6604', // Grade 1
  2: 'db8df2b3-70d5-42b6-a5cd-15ec27031f4c', // Grade 2
  3: 'f0dc89af-4867-47ea-86d5-5cf7124afd1c', // Grade 3
  4: '46c143a7-83eb-4362-921f-8afea732bcda', // Grade 4
  5: 'fa2ca870-b475-44fe-9dc1-9f94dba5cb93', // Grade 5
}
```

### What's NOT Integrated

- **QTI** - No QTI integration
- **PowerPath** - Explicitly avoided (comment in code: "PowerPath measures general math placement, not fluency. Mixing data sources creates inconsistency.")

---

## XP Calculation

XP is sent to TimeBack for grade progression tracking. The formula is:

```
XP = active_duration_minutes × engagement
```

**But only if:**
1. **Accuracy ≥ 80%** - Must get 80%+ correct answers
2. **Engagement > 0** - Not AFK (see below)

### Engagement Multiplier Formula

```rust
floor = max(2.0, player_best_cqpm × 0.25)
raw_engagement = session_cqpm / floor

if raw_engagement < 0.3:
    return 0.0  // True AFK gets nothing
else:
    return min(1.0, raw_engagement)  // Capped at 1.0
```

**Where:**
- `session_cqpm` = Correct Questions Per Minute in this raid
- `player_best_cqpm` = Player's best CQPM on this track (from history)
- `floor` = Personal minimum expectation (25% of their best, min 2.0)

### Anti-Gaming Rules

| Rule | Purpose |
|------|---------|
| **80% accuracy threshold** | Prevents guessing spam |
| **Personal floor (25% of best)** | Prevents sandbagging (playing slow to farm time) |
| **30% AFK threshold** | Zero XP if below 30% of floor |
| **Duration capped at 2.5 min** | `active_duration_minutes.min(2.5)` prevents time inflation |
| **Blocklist** | Students who completed Fast Math get no XP (prevent mining) |

### Example Calculation

```
Student's best CQPM on this track: 20
This session's CQPM: 15
Duration: 2 minutes
Accuracy: 85%

floor = max(2.0, 20 × 0.25) = 5.0
raw_engagement = 15 / 5.0 = 3.0
engagement = min(1.0, 3.0) = 1.0  // Capped

XP = 2.0 × 1.0 = 2.0 XP
```

---

## AP Calculation

AP (Adventure Points) is the **in-game currency** for cosmetics, separate from TimeBack XP.

### Victory AP

```rust
base_ap = 50
damage_bonus = min(damage_dealt / 10, 100)
accuracy_bonus = if accuracy >= 90 { 50 } else if accuracy >= 80 { 25 } else { 0 }
multiplayer_bonus = if players > 1 { 25 } else { 0 }

total_ap = base + damage_bonus + accuracy_bonus + multiplayer_bonus
```

### Defeat AP

```rust
base_ap = 25
effort_bonus = min(problems_answered × 3, 50)
multiplayer_bonus = if players > 1 { 25 } else { 0 }

total_ap = base + effort_bonus + multiplayer_bonus
```

### Loot Chest Bonus (Random)

After each raid, a chest drops with weighted random AP:

| Rarity | AP | Weight | Probability |
|--------|-----|--------|-------------|
| Common | 25 | 65 | 65% |
| Uncommon | 50 | 20 | 20% |
| Rare | 75 | 10 | 10% |
| Epic | 150 | 4 | 4% |
| Legendary | 300 | 1 | 1% |

---

## Key Files Reference

### Client

| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Playcademy SDK init, auth flow |
| `client/src/store/gameStore.ts` | Gateway verify, SpacetimeDB connection |
| `client/src/utils/resolveStudentGrade.ts` | Grade resolution logic |
| `client/src/spacetime/` | Auto-generated SpacetimeDB bindings |

### Server

| File | Purpose |
|------|---------|
| `server/src/lib.rs` | Main game logic (4700+ lines) |
| `server/src/math_facts.rs` | Fact definitions |
| `server/Cargo.toml` | Rust dependencies |

### Worker

| File | Purpose |
|------|---------|
| `worker/src/index.ts` | HTTP server + event processor |
| `worker/src/spacetimedb/` | Auto-generated bindings |

### Folder Structure

```
math-raiders/
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── store/       # Zustand store (gameStore.ts)
│   │   ├── spacetime/   # Auto-generated SpacetimeDB bindings
│   │   ├── hooks/       # Custom React hooks
│   │   └── utils/       # Helper functions
│   └── package.json     # Bun/npm dependencies
│
├── server/              # SpacetimeDB module
│   ├── src/
│   │   ├── lib.rs       # Main game logic (4700+ lines)
│   │   └── math_facts.rs # Fact definitions
│   └── Cargo.toml       # Rust dependencies
│
├── worker/              # Gateway & analytics worker
│   ├── src/
│   │   ├── index.ts     # HTTP server + event processor
│   │   └── spacetimedb/ # Auto-generated bindings
│   └── package.json
│
└── scripts/             # Admin utilities (TimeBack sync, etc.)
```

---

## Summary

**Math Raiders is a 3-tier real-time multiplayer game:**

1. **Client** = React + TypeScript + PIXI.js (browser)
2. **Server** = Rust + SpacetimeDB (real-time database with embedded logic)
3. **Worker** = Bun + TypeScript (gateway, JWT verification, analytics)

The key innovation is **SpacetimeDB** - instead of a traditional REST API + database, the game logic runs *inside* the database as Rust/WASM, with real-time subscriptions pushed to clients over WebSocket.

**TimeBack XP** is designed to be **anti-gaming** - you can't inflate it by playing slow, guessing randomly, or going AFK. It rewards genuine effort at or above your personal baseline.
