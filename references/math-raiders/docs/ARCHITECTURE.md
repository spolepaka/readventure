# Architecture

A quick guide to how Math Raiders works for contributors.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER                                   │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  React Client (Vite :5173)                                 │    │
│  │  ├── Zustand store (gameStore.ts) - all game state        │    │
│  │  ├── PIXI.js - boss sprites, particles                     │    │
│  │  └── SpacetimeDB SDK - real-time sync                      │    │
│  └────────────────────────────────────────────────────────────┘    │
└──────────────┬─────────────────────────────┬────────────────────────┘
               │ WebSocket                   │ HTTP POST /verify
               │ (game data)                 │ (JWT verification)
               ▼                             ▼
┌──────────────────────────┐    ┌──────────────────────────────────────┐
│  SpacetimeDB (:3000)     │◄───│  Bun Worker/Gateway (:3001)          │
│                          │    │                                      │
│  • Tables (Rust)         │    │  • /verify - JWT check → session     │
│  • Reducers (Rust)       │    │  • /api/get-student-grade - TimeBack │
│  • Real-time sync        │    │  • TimeBack event processor          │
│                          │    │  • Connects as authorized_worker     │
└──────────────────────────┘    └──────────────────────────────────────┘
```

## Connection Flow

```
1. Client connects to SpacetimeDB (WebSocket)
   └── Gets ephemeral Identity

2. Client calls Gateway /verify with {token, stdbIdentity}
   ├── Gateway verifies JWT with Playcademy API
   ├── Gateway calls create_session(identity, playerId) reducer
   │   └── Only authorized_worker can call this (owner token)
   └── Returns verified playerId to client

3. Client subscribes to data filtered by playerId
   └── SELECT * FROM player WHERE id = '{playerId}'
   └── SELECT * FROM fact_mastery WHERE player_id = '{playerId}'
   └── (etc.)

4. Client calls connect(name, grade, ...) reducer
   └── Creates/updates Player row (session already exists)
```

**Anti-spoofing:** Step 2 is the security gate. Without a valid JWT, the gateway won't create a session. Without a session, the client can't do anything useful.

## Directory Structure

```
MathRaiders/
├── client/               # React frontend
│   └── src/
│       ├── store/        # gameStore.ts - THE state (Zustand)
│       ├── components/   # UI components
│       ├── game/         # PIXI.js bosses and effects
│       ├── hooks/        # React hooks
│       ├── spacetime/    # Generated SpacetimeDB bindings (DO NOT EDIT)
│       └── utils/        # Helpers
│
├── server/               # SpacetimeDB module
│   └── src/
│       ├── lib.rs        # Tables, reducers, views, constants
│       ├── math_facts.rs # Generated fact data
│       └── restore.rs    # Disaster recovery reducers
│
├── worker/               # Bun server (JWT gateway + TimeBack events)
│   └── src/
│       ├── index.ts      # HTTP server + STDB connection
│       └── spacetimedb/  # Generated bindings (DO NOT EDIT)
│
├── scripts/              # Dev tools, backups, TimeBack scripts
├── docs/                 # Documentation
└── admin/                # Admin dashboard (separate app)
```

## Key Files

| File | Purpose |
|------|---------|
| `client/src/store/gameStore.ts` | All client state. Connection, subscriptions, reducers. |
| `server/src/lib.rs` | All server logic. Tables, reducers, damage calc, boss HP. |
| `worker/src/index.ts` | JWT gateway + TimeBack event processing. |
| `client/src/game/bosses/bossConfig.ts` | Boss sprite configuration (add new bosses here). |

## Data Flow: A Single Answer

```
Player types "42" → gameStore.submitAnswer()
                    │
                    ▼
           SpacetimeDB.reducers.submitAnswer(problemId, 42, responseMs)
                    │
                    ▼ (WebSocket)
           server/lib.rs::submit_answer()
           ├── Validate session → get player
           ├── Calculate damage (response_ms → damage tier)
           ├── Update Raid.boss_hp
           ├── Update FactMastery (attempts, avg_time)
           ├── Insert PlayerAnswer
           └── Trigger mastery level recalc
                    │
                    ▼ (Real-time sync)
           Client receives updates via subscriptions
           ├── raid.onUpdate → setRaid()
           ├── factMastery.onUpdate → update masteries
           └── UI re-renders with new boss HP, damage numbers
```

## Tables (server/src/lib.rs)

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `session` | `connection_id` | Maps STDB Identity → playerId |
| `player` | `id` (String) | Player profile, stats, grade |
| `raid` | `id` (u64) | Active raid state, boss HP |
| `raid_player` | `id` (u64) | Player-in-raid with damage dealt |
| `problem` | `id` (u64) | Generated math problems |
| `player_answer` | `id` (u64) | Answer history |
| `fact_mastery` | `id` (u64) | Per-fact progress tracking |
| `performance_snapshot` | `id` (u64) | CQPM history for adaptive difficulty |
| `timeback_event_queue` | `id` (u64) | XP events waiting to send |
| `authorized_worker` | `identity` | Gateway authorization |

## Key Reducers (server/src/lib.rs)

| Reducer | Called by | What it does |
|---------|-----------|--------------|
| `create_session` | Gateway only | Links Identity → playerId (anti-spoof) |
| `connect` | Client | Creates/updates Player row |
| `create_private_room` | Client | Creates Raid + RaidPlayer, returns room code |
| `join_private_room` | Client | Joins existing Raid by code |
| `start_solo_raid` | Client | Creates solo Raid with scaled HP |
| `submit_answer` | Client | Core game loop - damage, mastery, XP |
| `request_problem` | Client | Generates next problem (weighted selection) |
| `leave_raid` | Client | Removes player from raid |

## Dynamic Subscriptions

Client doesn't subscribe to all data. It subscribes to:

**Always (base subscriptions):**
- Own player: `SELECT * FROM player WHERE id = '{playerId}'`
- Own problems: `SELECT * FROM problem WHERE player_id = '{playerId}'`
- Own answers: `SELECT * FROM player_answer WHERE player_id = '{playerId}'`
- Own masteries: `SELECT * FROM fact_mastery WHERE player_id = '{playerId}'`
- Own snapshots: `SELECT * FROM performance_snapshot WHERE player_id = '{playerId}'`

**When in a raid (dynamic subscriptions):**
- Raid: `SELECT * FROM raid WHERE id = {raidId}`
- All players in raid: `SELECT * FROM raid_player WHERE raid_id = {raidId}`

This means you only see other players when you're in a raid together.

## Adding Features

### Add a new boss sprite
1. Create `client/src/game/bosses/PureNewBoss.ts` (implement `BossInstance` interface)
2. Add entry to `BOSS_CONFIG` in `client/src/game/bosses/bossConfig.ts`

### Add a new table
1. Add struct with `#[table]` in `server/src/lib.rs`
2. Run `spacetime build && spacetime publish && spacetime generate`
3. Client bindings auto-generate in `client/src/spacetime/`

### Add a new reducer
1. Add function with `#[reducer]` in `server/src/lib.rs`
2. Regenerate bindings
3. Call via `ctx.reducers.myNewReducer({ args })`

### Modify damage formula
1. Edit `calculate_damage()` in `server/src/lib.rs` (~line 3160)
2. Update `BOSS_HP_VALUES` if needed (~line 707)

## Environment Variables

**Client (.env.development / .env.production):**
```
VITE_SPACETIMEDB_HOST=ws://localhost:3000
VITE_MODULE_NAME=math-raiders
```

**Worker (.env):**
```
SPACETIMEDB_URI=ws://localhost:3000
SPACETIMEDB_MODULE=math-raiders
SPACETIMEDB_TOKEN=<owner-token>  # Required for authorized_worker
TIMEBACK_CLIENT_ID=<oauth-id>
TIMEBACK_CLIENT_SECRET=<oauth-secret>
```

## Ports

| Port | Service |
|------|---------|
| 3000 | SpacetimeDB |
| 3001 | Worker/Gateway (JWT + TimeBack) |
| 5173 | Vite dev server (client) |

## Key Design Decisions

1. **Stable player IDs** - Not STDB Identity (ephemeral). Playcademy ID or device ID.
2. **Gateway pattern** - JWT verification happens outside STDB (HTTP can't call from reducers).
3. **Dynamic subscriptions** - Only subscribe to raid data when in a raid (performance).
4. **All public tables** - Views exist for RLS but blocked by SDK bug. Security via session binding.
5. **Boss HP ladder** - CQPM × 134 formula, derived from pilot data. See comments in lib.rs.

