# MathRaiders Authentication Refactor Plan

## Task Description

Refactor the authentication system to properly handle SpacetimeDB's ephemeral Identity model while maintaining stable player accounts across devices and sessions.

## Current Problem

1. **Identity Mismatch**: SpacetimeDB generates new Identities on each connection, but we're using Identity as a player identifier
2. **Race Conditions**: Client subscribes with new Identity while server is remapping player.id, causing "stuck on connecting"
3. **Conceptual Misalignment**: Using a session identifier (Identity) as a user identifier

## Understanding the Current Implementation

### Current Flow
```
1. Client connects → Gets new Identity from SpacetimeDB
2. Client calls connect(name, playcademy_id) reducer
3. Server finds player by playcademy_id OR creates new
4. Server updates player.id = ctx.sender (remapping)
5. Client subscriptions use Identity in WHERE clauses
6. Race: Subscriptions miss data during remapping
```

### Current Schema
- `Player.id: Identity` (primary key) - Gets remapped on each connection
- All foreign keys use `Identity` type
- Subscriptions filter by `Identity`

## Proposed Solution: Session-Based Architecture

### Core Concept
```
Connection (Identity) → Session → Player (Stable ID)
```

### New Schema Design
```rust
// Player: Stable across all sessions
Player {
    id: String,          // Primary key: "playcademy_123" or "anon_device_456"
    name: String,
    // ... all game stats remain the same
}

// Session: Links ephemeral connection to stable player
// MUST be public for client access!
#[table(name = session, public)]
Session {
    connection_id: Identity,  // Primary key: SpacetimeDB connection
    player_id: String,        // Foreign key to Player.id
    connected_at: Timestamp,
}

// Update all foreign keys
Problem { player_id: String }
RaidPlayer { player_id: String }
FactMastery { player_id: String }
PlayerAnswer { player_id: String }
```

## Implementation Plan (Optimized)

### Phase 1: Backend - All Changes Together (3 hours)
**Critical: DO NOT build/compile until ALL backend changes are complete!**

#### 1.1 Schema Changes
- Add `Session` table (with `#[table(name = session, public)]`)
- Change `Player.id` from `Identity` to `String`
- Update foreign keys in: `Problem`, `RaidPlayer`, `FactMastery`, `PlayerAnswer`
- Remove `playcademy_id` field from `Player`

#### 1.2 Helper Function
Add at top of lib.rs:
```rust
fn get_player(ctx: &ReducerContext) -> Result<Player, String> {
    let session = ctx.db.session()
        .connection_id()
        .find(&ctx.sender)
        .ok_or("No session found")?;
    
    ctx.db.player()
        .id()
        .find(&session.player_id)
        .ok_or("Player not found")
}
```

#### 1.3 Reducer Updates
- **65 replacements**: `ctx.db.player().id().find(&ctx.sender)` → `get_player(ctx)`
- **12 replacements**: `ctx.db.raid_player().player_id().find(&ctx.sender)` → `ctx.db.raid_player().player_id().find(&get_player(ctx)?.id)`
- Update `connect` reducer to create session
- Add `on_disconnect` reducer for session cleanup
- Update `issue_problem_to_player` signature

#### 1.4 Build & Generate
```bash
spacetime build
spacetime generate --lang typescript --out-dir client/src/spacetime
```

### Phase 2: Frontend - All Changes Together (2 hours)
**Work with newly generated types from Phase 1**

#### 2.1 Create Utilities
- Add `utils/identity.ts` with `getPlayerId()` function

#### 2.2 Update Store
- Add `playerId: string | null` to GameState
- Update `connect(name: string, playerId: string)` signature
- Store playerId in state during connection
- Update all subscriptions to use playerId in WHERE clauses
- Simplify `setupTableListeners` (no filtering needed)

#### 2.3 Update Components
- App.tsx: Use `getPlayerId()`, maintain 3-second timeout
- Replace all `.isEqual()` with `===`
- Update function signatures from Identity to string
- Replace `currentIdentity` usage with `playerId` from store
- Remove Identity imports (except gameStore.ts)

### Phase 3: Local Testing (1 hour)
- Start local SpacetimeDB: `spacetime start --in-memory`
- Test all scenarios:
  - Fresh player creation
  - Returning player (same device)
  - Page refresh during raid
  - Connection drops
  - Dev mode (3-second timeout)
  - Multiple browser tabs

### Phase 4: Deploy (30 minutes)
1. Deploy backend: `spacetime publish --delete-data`
2. Build frontend: `bun run build`
3. Upload to Playcademy

## Key Benefits of Optimized Phases

1. **Minimizes broken state**: Everything compiles at each phase boundary
2. **Enables testing**: Can test locally before any deployment
3. **Reduces risk**: All changes grouped logically
4. **Clear dependencies**: Backend types must exist before client updates
5. **Atomic deployment**: All-or-nothing approach

### Original Timeline vs Optimized
- **Original**: 9 hours (with lots of broken states)
- **Optimized**: 6.5 hours (clean transitions)
- **Saved**: 2.5 hours by avoiding incremental debugging

---

## Detailed Implementation Code

### 1. Connect Reducer (Backend)
```rust
#[reducer]
pub fn connect(ctx: &ReducerContext, name: String, player_id: String) {
    // Get or create player
    let player = if let Some(existing) = ctx.db.player().id().find(&player_id) {
        // Update last_played, handle resets, etc.
        existing
    } else {
        // Create new player with provided ID
        ctx.db.player().insert(Player {
            id: player_id.clone(),
            name,
            // ... initialize other fields
        });
        ctx.db.player().id().find(&player_id).unwrap()
    };
    
    // Create session linking this connection to player
    ctx.db.session().insert(Session {
        connection_id: ctx.sender,
        player_id: player.id,
        connected_at: ctx.timestamp,
    });
}

#[reducer(client_disconnected)]
pub fn on_disconnect(ctx: &ReducerContext) {
    ctx.db.session().connection_id().delete(&ctx.sender);
}
```

### 2. Create player ID utility
```typescript
// utils/identity.ts
export function getPlayerId(playcademyId?: string): string {
    if (playcademyId) return playcademyId;
    
    let deviceId = localStorage.getItem('mathRaidersDeviceId');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('mathRaidersDeviceId', deviceId);
    }
    return `anon_${deviceId}`;
}
```

### 3. Update connection flow
```typescript
// App.tsx
import { getPlayerId } from './utils/identity';

useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let hasInitialized = false;
    
    // Timeout after 3 seconds to allow dev mode
    timeoutId = setTimeout(() => {
        if (!hasInitialized) {
            console.warn('[MathRaiders] Playcademy SDK timeout, running in dev mode');
            hasInitialized = true;
            setIsLoadingSDK(false);
            
            // Dev mode: use device ID
            const playerId = getPlayerId(undefined);  // No Playcademy ID
            connect('⚡ Dev Player', playerId);
        }
    }, 3000);
    
    // Try Playcademy SDK
    PlaycademyClient.init()
        .then(async (client) => {
            if (!hasInitialized) {
                hasInitialized = true;
                setIsLoadingSDK(false);
                const user = await client.users.me();
                const playerId = getPlayerId(user.id);
                connect(`🎮 ${user.username}`, playerId);
            }
            if (timeoutId) clearTimeout(timeoutId);
        })
        .catch((err) => {
            if (!hasInitialized) {
                console.warn('[MathRaiders] Playcademy SDK failed:', err);
                hasInitialized = true;
                setIsLoadingSDK(false);
                const playerId = getPlayerId(undefined);
                connect('⚡ Dev Player', playerId);
            }
            if (timeoutId) clearTimeout(timeoutId);
        });
    
    return () => {
        if (timeoutId) clearTimeout(timeoutId);
    };
}, [connect]);
```

### 4. Rewrite subscription logic
```typescript
// gameStore.ts - Direct subscription with known player ID
connect: async (name: string, playerId: string) => {  // playerId is now required!
    // ... connection setup ...
    
    const conn = builder
        .onConnect((ctx, identity, token) => {
            // Player ID was determined by App.tsx using getPlayerId()
            // It's either a Playcademy ID or a device ID from localStorage
            
            // Store connection AND playerId for component access
            set({ 
                connection: ctx, 
                connecting: false,
                playerId  // NEW: Store stable player ID!
            });
            
            // Call connect reducer
            ctx.reducers.connect(name, playerId);
            
            // Subscribe directly to OUR data
            ctx.subscriptionBuilder()
                .onApplied(() => {
                    console.log('[SUBSCRIBE] Subscriptions applied');
                    // Note: setupTableListeners will be simpler - no filtering needed
                    // since we only subscribe to OUR data now!
                    setupTableListeners(ctx, identity, get, set);
                    loadExistingGameState(ctx, playerId, get, set);
                })
                .subscribe([
                    // Session for this connection
                    `SELECT * FROM session WHERE connection_id = '${identity.toHexString()}'`,
                    
                    // OUR player data (using known player ID)
                    `SELECT * FROM player WHERE id = '${playerId}'`,
                    `SELECT * FROM problem WHERE player_id = '${playerId}'`,
                    `SELECT * FROM player_answer WHERE player_id = '${playerId}'`,
                    `SELECT * FROM fact_mastery WHERE player_id = '${playerId}'`,
                    
                    // Shared data (needed for matchmaking/raids)
                    'SELECT * FROM raid',
                    'SELECT * FROM raid_player'
                ]);
        })
        .build();
}
```

### 5. Update shared data helpers
```typescript
// gameStore.ts - Update helper functions
function getRaidPlayers(raidPlayers: Iterable<RaidPlayer>, raidId: bigint): RaidPlayer[] {
    // No change needed - just filters by raidId
}

function findPlayerRaid(db: any, playerId: string): RaidPlayer | null {
    // CHANGED: playerId is now string, not Identity
    for (const rp of db.raidPlayer.iter()) {
        if (rp.playerId === playerId) return rp;  // String comparison!
    }
    return null;
}
```

### 6. Update component comparisons
```typescript
// Components like MatchmakingScreen.tsx
// BEFORE:
const currentIdentity = connection?.identity;
const currentRaidPlayer = raidPlayers.find(rp => 
    currentIdentity && rp.playerId.isEqual(currentIdentity)
);

// AFTER:
const playerId = useGameStore(state => state.playerId);  // Get from store!
const currentRaidPlayer = raidPlayers.find(rp => 
    rp.playerId === playerId  // Direct string comparison!
);

// RaidScreen.tsx - Update getPlayerName
// BEFORE:
const getPlayerName = (playerId: Identity) => {
    const raidPlayer = raidPlayers.find(rp => rp.playerId.isEqual(playerId));
    return raidPlayer ? raidPlayer.playerName : 'Unknown';
};

// AFTER:
const getPlayerName = (playerId: string) => {
    const raidPlayer = raidPlayers.find(rp => rp.playerId === playerId);
    return raidPlayer ? raidPlayer.playerName : 'Unknown';
};
```

### 7. Update loadExistingGameState
```typescript
function loadExistingGameState(ctx: DbContext, playerId: string, get: () => GameState, set: (state: Partial<GameState>) => void) {
    // playerId now passed as parameter from connect function
    const ourPlayer = ctx.db.player.id().find(playerId);
    
    if (ourPlayer) {
        get().setPlayer(ourPlayer);
        
        // Load other state...
        const problems = Array.from(ctx.db.problem.iter());
        // Problems are already filtered by subscription!
    } else {
        console.log('[LOAD STATE] Waiting for player creation...');
        // onInsert will handle it
    }
}
```

## Key Technical Constraints (Discovered Through Research)

### SpacetimeDB SQL Limitations
- **No complex JOINs** in subscriptions (max 1 JOIN)
- **No computed fields** in WHERE clauses
- **Must select entire rows** (`SELECT * FROM table`)
- **WHERE clauses work with String columns** (confirmed by docs)

### Subscription Model
- **Client knows player_id upfront** (Playcademy or device ID)
- **Can subscribe to specific data** immediately
- **Solution**: Direct subscription using known player_id in WHERE clauses

### Table Access
- **Session table MUST be public** for client SDK access
- **Generated SDK provides** table accessors automatically
- **WHERE clauses with String columns** work perfectly

## Shared Data Handling

### What Still Works
1. **Raid subscriptions**: We still subscribe to ALL raid and raid_player data
   ```sql
   SELECT * FROM raid
   SELECT * FROM raid_player
   ```
2. **Seeing other players**: RaidPlayer table still has all players in raids
3. **Matchmaking**: Players can still see who's in their raid lobby
4. **Leaderboards**: If implemented, would query Player table directly

### What Changes
1. **Foreign keys**: All references change from Identity to String
2. **Comparisons**: No more `.isEqual()`, just `===` for strings
3. **Helper functions**: Updated to use String player IDs
4. **Components**: Pass playerId (String) instead of Identity

### Why It Works
- We're NOT filtering raid data by player
- Shared game state (raids, matchmaking) remains accessible to all
- Only personal data (problems, answers, mastery) is filtered by player ID
- This maintains the multiplayer experience while securing personal progress

## Potential Impacts

### Breaking Changes
- **Data Loss**: Requires full database wipe
- **API Changes**: All client queries must be updated
- **No Rollback**: Can't revert without another wipe

### Performance Considerations
- **Optimal**: Subscribe only to YOUR data (fully scalable)
- **No filtering needed**: Data already filtered by SpacetimeDB
- **Better**: No race conditions AND no excess data transfer
- **Overhead**: Extra session lookup per reducer call (negligible)

### Security Implications
- **Session table is public**: All clients can see all sessions
- **Risk**: Players can see who's online and connection patterns
- **Mitigation**: Sessions only contain connection→player mapping
- **Alternative**: Consider private table with custom query reducer:
  ```rust
  #[reducer]
  pub fn get_my_session(ctx: &ReducerContext) -> Result<Session, String> {
      ctx.db.session()
          .connection_id()
          .find(&ctx.sender)
          .ok_or("No session found")
  }
  ```
- **No Change**: Still trust client-provided Playcademy ID
- **Future**: Could add server-side token validation

## Edge Cases to Handle

1. **Session without player**: Shouldn't happen, but handle gracefully
2. **Multiple sessions**: Same player on multiple devices (allowed)
3. **Orphaned sessions**: Clean up on disconnect
4. **Anonymous players**: Use device ID as player ID
5. **Race between connect and subscribe**: Handle in subscription onApplied
   ```typescript
   .onApplied(() => {
       // If player doesn't exist yet, wait for onInsert
       const player = ctx.db.player.id().find(playerId);
       if (!player) {
           console.log('Waiting for player creation...');
           // onInsert handler will trigger when ready
       }
   })
   ```

## Success Criteria

1. ✅ No more "stuck on connecting" issues
2. ✅ Seamless cross-device play with Playcademy
3. ✅ Clean, understandable architecture
4. ✅ Subscriptions work immediately (no race conditions)
5. ✅ Future-proof for other auth providers

## Risk Assessment

**Data Loss**: Not a concern - no production data yet!  
**Complexity**: Mechanical changes, low risk  
**Timeline**: 6 hours to implement correctly  

**Bottom Line**: Perfect time to do this right!

## Timeline

- **Phase 1**: 1 hour (Schema) - Direct changes, no migration
- **Phase 2**: 3 hours (Reducers) - Mechanical find/replace
- **Phase 3**: 1.5 hours (Client) - Simpler without compatibility
- **Phase 4**: 0.5 hours (Testing) - No migration to verify
- **Total**: ~6 hours of focused work

Faster because:
- No careful migration steps
- No backwards compatibility code
- Direct implementation of the right solution

## Why This Solves Our Core Problem

### The Problem We're Solving
- **User logs in via Playcademy** on any device
- **Gets their game progress** immediately
- **No "stuck on connecting"** issues
- **No race conditions** between subscriptions and data

### How This Architecture Fixes It
1. **Player.id = Playcademy ID** (never changes)
2. **Session maps Connection → Player** (clean separation)
3. **Client knows player_id upfront** (no lookup needed)
4. **Subscribe directly to YOUR data** (scalable and fast)

### The Key Insight
We stop fighting SpacetimeDB's identity model. Instead:
- **Identity** = "Which connection is this?" (ephemeral)
- **Player ID** = "Which human is this?" (permanent)
- **Session** = The bridge between them

## Implementation Approach

Since we're not in production:
1. **No incremental migration** - Just implement the right solution
2. **No backwards compatibility** - Clean slate with --delete-data
3. **No dual-write complexity** - Direct cut-over
4. **Focus on correctness** - Get the architecture right first time

This is the right engineering solution because:
1. Works WITH SpacetimeDB's constraints, not against them
2. Eliminates all race conditions permanently
3. Provides true cross-device play via Playcademy
4. Uses patterns common in multiplayer games

## Additional Areas to Update

Based on comprehensive review, here are ALL the areas that need updating:

### 1. **Utility Functions**
```typescript
// utils/playerHelpers.ts
export function getPlayerEmoji(playerId: string): string {  // Was Identity
  const animals = ['🦊', '🐺', '🦁', '🐯', '🐻', '🐼', '🐨', '🐵', '🦝', '🐱', '🐶', '🐭', '🐹', '🐰', '🦇', '🦉'];
  // Use first char of player ID for consistency
  const firstChar = playerId.charCodeAt(0);
  return animals[firstChar % animals.length];
}
```

### 2. **Component Identity Comparisons**
```typescript
// ResultsScreen.tsx
// BEFORE: p.playerId.isEqual(currentPlayer.id)
// AFTER: p.playerId === currentPlayer.id

// BEFORE: raidPlayer.playerId.isEqual(currentPlayer.id)
// AFTER: raidPlayer.playerId === currentPlayer.id
```

### 3. **Identity Imports**
After refactor, remove Identity imports from:
- `components/RaidScreen.tsx`
- `components/AnswerInput.tsx`
- `components/SquadUIMotivational.tsx`
- `utils/playerHelpers.ts`

Only keep Identity import in `gameStore.ts` for the connection identity.

### 4. **Type Changes in Components**
- `getPlayerName(playerId: string)` instead of `getPlayerName(playerId: Identity)`
- `currentIdentity` references replaced with `playerId` from store
- All `.isEqual()` calls replaced with `===`
- Update SquadUIMotivational props interface to accept `getPlayerName: (playerId: string) => string`

### 5. **Generated Code**
After schema changes, run:
```bash
spacetime build
spacetime generate --lang typescript --out-dir client/src/spacetime
```
This will update all table types with String instead of Identity.

### 6. **Scheduled Reducer Security Check**
The `cleanup_abandoned_raids` reducer uses `ctx.sender != ctx.identity()` to verify it's called by the scheduler. This check remains unchanged - it's about the connection identity, not player identity.

## Summary: Shared Data Will Work!

To directly answer your question about shared data:

1. **Raids still work** - We subscribe to ALL raid and raid_player data
2. **Matchmaking still works** - Players see each other in lobbies
3. **Squad UI still works** - Shows all players in the raid
4. **What changes**: Just the data types (Identity → String) and comparison methods

The refactor only changes HOW we identify players, not WHAT data is visible. Multiplayer features remain intact!

## Critical Implementation Order

**MUST follow this sequence to avoid errors:**

1. **Backend First**: 
   - Update schema (lib.rs)
   - Run `spacetime build`
   - Generate client code: `spacetime generate --lang typescript --out-dir client/src/spacetime`
   
2. **Then Frontend**:
   - The generated code will have String types instead of Identity
   - Update all client code to match new types
   - Test locally before deployment

3. **Deploy**:
   - `spacetime publish --delete-data` (backend)
   - Build and upload frontend

## Next Steps

1. Review this plan ✅
2. Confirm data wipe is acceptable
3. Begin implementation starting with schema changes
4. Test thoroughly in development
5. Deploy to production with confidence
