# Fair Raid Disconnect/Reconnect Implementation Plan

## Problem Statement

When students disconnect during a raid due to poor WiFi (or refresh the page), they currently lose all raid progress and XP. This creates unfair time penalties - students must redo work to earn back lost XP for their sports time. Since raids are 2-3 minutes and students need 120 XP total, multiple DCs/refreshes can add 10+ minutes of extra work, causing frustration and game abandonment.

**Refresh = Disconnect from server's perspective** - Browser refresh closes WebSocket, server sees disconnect, then client reconnects. Both should resume identically.

## Core Requirements

**Solo Raids:** Timer pauses when player DCs, resumes on reconnect (no time penalty)

**Multiplayer Raids:** Timer continues if other players active (fair - squad kept playing)

**Student Experience:** Blame WiFi for interruption, not game for stealing time

## Architecture: Idiomatic Multiplayer Patterns + Bob Nystrom's Explicit State Machine

**React/TypeScript Patterns Applied:**
- **Separation of Concerns:** App.tsx handles UI (events, modals), gameStore.ts handles business logic (connections, subscriptions, state)
- **Single Responsibility:** Components render UI, Store manages state and side effects
- **Idiomatic Hooks:** useEffect for event listeners, Zustand for state management
- **State Management:** Store is single source of truth, components consume via selectors

**Bob Nystrom's Core Principles Applied:**
1. **Explicit State** - State enum is single source of truth, not inferred from fields
2. **Fix Root Causes** - Removes aggressive cleanup that prevents resume, doesn't add workarounds
3. **Simplicity** - Shifting timestamp is simpler than tracking accumulated pause time
4. **Invalid States Unrepresentable** - Enum prevents invalid combinations (can't have `InProgress` with `pause_started_at` set)
5. **Explicit Error Handling** - Errors logged, not silently ignored (`let _ = ...` replaced with explicit checks)
6. **Clear Intent** - Guards and early returns make the happy path obvious

**This plan follows standard multiplayer game patterns, adapted to Math Raiders' specific needs:**

### Standard Multiplayer Patterns Used:

1. **State Preservation Across Disconnects** ✅
   - Server maintains authoritative game state (raid, players, progress)
   - Client reconnects and syncs to server state
   - **Your game:** Raid state persists, `player.in_raid_id` preserved

2. **Graceful Degradation** ✅
   - Multiplayer games continue if some players DC
   - Remaining players aren't penalized
   - **Your game:** Squad continues playing if 1 player DCs, timer keeps running

3. **Solo vs Multi Behavior** ✅
   - Solo games pause on disconnect (fair - no one else playing)
   - Multiplayer games continue (fair - squad keeps playing)
   - **Your game:** Solo pauses timer, multi continues with active players

4. **Explicit State Machine** ✅
   - Clear states (Paused, InProgress, etc.) - Bob Nystrom pattern
   - Type-safe transitions - enum prevents invalid states
   - **Your game:** `RaidState::Paused` variant, explicit transitions

5. **Subscription-Based Sync** ✅
   - Client subscribes to relevant data
   - Server pushes updates automatically
   - **Your game:** Client subscribes to raid + raid_player tables

6. **Reconnect Handling** ✅
   - Server detects reconnect in `connect()` reducer
   - Resumes state based on game's current state
   - **Your game:** Checks raid state (Paused/InProgress/Victory/Failed) and resumes accordingly

7. **Refresh = Disconnect Pattern** ✅
   - Refresh treated as disconnect/reconnect (industry standard)
   - Server can't distinguish refresh from WiFi DC
   - **Your game:** Both use same resume logic in `connect()`

8. **Session Management** ✅
   - Ephemeral sessions (connection_id) map to stable players
   - Sessions cleaned up on disconnect, players persist
   - **Your game:** Uses SpacetimeDB's `session` table pattern

9. **Inactive Player Tracking** ✅
   - Mark players inactive instead of deleting (preserves stats)
   - Reactivate on reconnect
   - **Your game:** `is_active` flag in `raid_player` table

10. **Timeout Handling** ✅
    - Paused games don't timeout (fair)
    - Running games timeout normally
    - **Your game:** Cancel timeout on pause, reschedule on resume

### Math Raiders-Specific Adaptations:

- **Timer Fairness:** Solo raids pause timer (K-5 students don't lose time to WiFi)
- **Shifting Timestamp Pattern:** Elegant way to handle pause duration without modifying timer logic
- **Raid-Specific Resume:** Checks raid state explicitly (Paused/InProgress/Victory/Failed)

### Comparison to Industry Patterns:

| Pattern | Industry Standard | Math Raiders Plan | Status |
|---------|------------------|-------------------|--------|
| State preservation | ✅ Server maintains state | ✅ Raid persists across DC | ✅ Idiomatic |
| Multiplayer continue | ✅ Squad keeps playing | ✅ Timer runs, squad plays | ✅ Idiomatic |
| Solo pause | ✅ Common in single-player | ✅ Timer pauses | ✅ Idiomatic |
| Reconnect resume | ✅ Server detects reconnect | ✅ `connect()` checks state | ✅ Idiomatic |
| Refresh handling | ✅ Treated as DC | ✅ Same resume logic | ✅ Idiomatic |
| Subscription sync | ✅ Push-based updates | ✅ SpacetimeDB subscriptions | ✅ Idiomatic |
| Explicit states | ✅ State machines | ✅ `RaidState` enum | ✅ Idiomatic |
| Inactive tracking | ✅ Flag instead of delete | ✅ `is_active` flag | ✅ Idiomatic |

**Conclusion:** This plan uses standard multiplayer patterns, adapted to Math Raiders' timer fairness requirements. It's idiomatic, not custom workarounds.

## Architecture: Bob Nystrom's Explicit State Machine Pattern

**Explicit State Machine** - `Paused` is a state, not a hidden field. Use enum to enforce correctness.

**Shifting Timestamp Pattern** - Instead of tracking accumulated pause duration, shift `Raid.started_at` forward on resume. This keeps all existing timer calculations working without modification.

**State Machine:**
- **Matchmaking:** Pre-raid, forming group
- **InProgress:** Active raid, players solving problems, timeout scheduled
- **Paused:** **ALL players disconnected** (solo DC'd OR last player in multi DC'd), timeout canceled, `pause_started_at` tracks when paused
- **Victory:** Boss defeated (terminal)
- **Failed:** Timeout/defeat (terminal)
- **Rematch:** Post-raid, group rematching

**When Pause Happens:**
- **Solo raids:** Player DCs → `active_count: 1 → 0` → **PAUSE** (timer freezes)
- **Multi raids, 1 player DCs, others active:** `active_count: 3 → 2` → **NO PAUSE** (squad continues, timer runs)
- **Multi raids, last player DCs:** `active_count: 1 → 0` → **PAUSE** (timer freezes for everyone)

**Key Insight:** Timer calculation `elapsed = now - started_at` works for both running and resumed states because start time shifts. State enum enforces correctness - can't have invalid combinations.

## Quick Start for Junior Developers

**What you're building:** A system that pauses solo raids when players disconnect, and allows them to resume exactly where they left off. Multiplayer raids continue running (fair - squad keeps playing).

**Time estimate:** 2 days (Day 1: Server + Client, Day 2: Testing + Bug fixes)

**Files you'll modify:**
- `server/src/lib.rs` - Server logic (Phase 1)
- `client/src/store/gameStore.ts` - Client state management (Phase 2)
- `client/src/App.tsx` - UI modal and reconnect logic (Phase 2)

**If you get stuck:**
- Read the "Gotchas" section (section 12) - common mistakes are documented there
- Check the "Edge Case Analysis" section for examples of how things should work
- If line numbers don't match, search for the code patterns described (code may have shifted)

**Before starting:** Make sure you can build and run the server locally. Test that you can start a raid before making changes.

## Implementation Steps

### Phase 1: Server Changes (server/src/lib.rs)

#### 1.1 Add Paused State to RaidState Enum

**Add `Paused` variant to `RaidState` enum (line 309-315):**

```rust
#[derive(SpacetimeType, Debug, Clone, PartialEq)]
pub enum RaidState {
    Matchmaking,  // Pre-raid: forming group
    InProgress,   // Active raid (running)
    Paused,       // ADD THIS - Explicit paused state
    Victory,      // Boss defeated
    Failed,       // Timeout/defeat
    Rematch,      // Post-raid: group rematching
}
```

#### 1.1b Add Pause Tracking Field to Raid Table

**How to find:** Search for `pub struct Raid` in `server/src/lib.rs`. Look for fields like `pub started_at: Timestamp` or `pub boss_hp: u32`. Add the new field after the `started_at` field (around line 296).

**Add field to `Raid` struct:**

```rust
/// When raid was paused (Some = when pause started, None = not paused)
/// Only used for calculating pause duration - state enum is authoritative
pub pause_started_at: Option<Timestamp>,
```

**Where exactly:** Add it right after `pub started_at: Timestamp;` and before the next field. The order doesn't matter functionally, but keeping it near `started_at` makes sense.

**Why both:**
- `state: RaidState::Paused` - Explicit state (single source of truth)
- `pause_started_at` - Tracks when pause began (needed for duration calculation)

#### 1.2 Create Helper Functions

**Where to add:** Insert these helper functions right before the `on_disconnect` reducer (around line 888). Look for the comment `/// Clean up session when player disconnects` or the line `#[reducer(client_disconnected)]`.

**Note:** The helpers `find_raid_player` and `update_raid_player` already exist (lines 79-88), so you don't need to add those. Only add the new helpers below.

**Helper: Count active players in raid**

```rust
fn count_active_raid_players(ctx: &ReducerContext, raid_id: u64) -> usize {
    ctx.db.raid_player()
        .raid_id().filter(&raid_id)
        .filter(|rp| rp.is_active)
        .count()
}
```

**Note:** This uses SpacetimeDB's filter chaining. The `.raid_id().filter(&raid_id)` filters by raid_id, then `.filter(|rp| rp.is_active)` filters for active players only.

**Helper: Mark player inactive in raid (preserves in_raid_id for resume)**

```rust
/// Mark player as inactive WITHOUT clearing player.in_raid_id
/// This allows resume on reconnect - only cleanup_player_raid_data clears in_raid_id
fn mark_player_inactive_in_raid(ctx: &ReducerContext, player_id: &String, raid_id: u64) {
    if let Some(mut rp) = find_raid_player(ctx, player_id, raid_id) {
        rp.is_active = false;
        update_raid_player(ctx, rp);
        log::info!("Marked player {} inactive in raid {}", player_id, raid_id);
    }
    // If find_raid_player returns None, player wasn't in raid - that's fine, do nothing
}
```

**Note:** `find_raid_player` already exists (line 79). If it returns `None`, the player wasn't in the raid, so we just skip updating (safe).

**Helper: Cancel raid timeout (idempotent)**

```rust
fn cancel_raid_timeout(ctx: &ReducerContext, raid_id: u64) {
    let schedules: Vec<_> = ctx.db.raid_timeout_schedule().iter()
        .filter(|s| s.raid_id == raid_id)
        .collect();
    
    for schedule in schedules {
        log::info!("Canceling timeout schedule {} for raid {}", schedule.id, raid_id);
        ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
    }
}
```

**Helper: Pause raid (transitions to Paused state, cancels timeout)**

**CRITICAL**: Only pauses when `active_player_count == 0` (solo DC or all multi players DC'd)

```rust
fn pause_raid_if_empty(ctx: &ReducerContext, raid_id: u64) -> Result<(), String> {
    let mut raid = ctx.db.raid().id().find(&raid_id)
        .ok_or("Raid not found")?;
    
    // Guards
    if raid.state != RaidState::InProgress {
        return Ok(());  // Only pause active raids
    }
    if count_active_raid_players(ctx, raid_id) > 0 {
        return Ok(());  // Still has active players - DON'T PAUSE (squad continues)
    }
    
    // Transition: InProgress -> Paused
    // Only reached when active_count == 0 (solo DC or last player in multi DC'd)
    raid.state = RaidState::Paused;
    raid.pause_started_at = Some(ctx.timestamp);
    cancel_raid_timeout(ctx, raid_id);
    ctx.db.raid().id().update(raid);
    
    log::info!("Raid {} paused - all players disconnected", raid_id);
    Ok(())
}
```

**Why explicit state:** Type system enforces correctness. Can't have `InProgress` with `pause_started_at` set - state is single source of truth.

**Pause logic (explicit and clear):**
- Solo raid: Player DCs → count 1→0 → pause (guard passes, state transitions)
- Multi raid, 1 DC: Player DCs → count 3→2 → NO pause (guard fails, early return)
- Multi raid, last DC: Last player DCs → count 1→0 → pause (guard passes, state transitions)

**Bob Nystrom Principle:** Guards are explicit and clear. Early returns make the happy path obvious. State transitions are explicit (enum assignment), not inferred.

**Helper: Resume raid (transitions to InProgress, shifts started_at, reschedules timeout)**

```rust
fn resume_raid_from_pause(ctx: &ReducerContext, raid_id: u64) -> Result<(), String> {
    let mut raid = ctx.db.raid().id().find(&raid_id)
        .ok_or("Raid not found")?;
    
    // Guard: Only resume Paused raids
    if raid.state != RaidState::Paused {
        return Ok(());  // Not paused, nothing to resume
    }
    
    // Get pause start time (must exist if state is Paused)
    let pause_started_at = raid.pause_started_at
        .ok_or("Invalid state: Paused but no pause_started_at")?;
    
    // Calculate pause duration
    let pause_duration = ctx.timestamp.duration_since(pause_started_at)
        .ok_or("Invalid pause timestamp")?;
    
    // Shift start time forward by pause duration (using std::time::Duration for Timestamp arithmetic)
    // CRITICAL: Must use std::time::Duration, NOT TimeDuration (different types)
    let pause_secs = pause_duration.as_secs();
    let new_started_at = raid.started_at + std::time::Duration::from_secs(pause_secs);
    
    // Validate time remaining (calculate from shifted start time)
    // Note: duration_since can fail if new_started_at > now (shouldn't happen, but be explicit)
    let elapsed = match ctx.timestamp.duration_since(new_started_at) {
        Some(d) => d,
        None => {
            log::error!("Invalid time: raid {} started_at ({:?}) > now ({:?})", 
                raid_id, new_started_at, ctx.timestamp);
            return Err("Invalid timestamp: start time is in the future".to_string());
        }
    };
    let time_remaining_secs = 150u64.saturating_sub(elapsed.as_secs());
    
    if time_remaining_secs == 0 {
        log::info!("Raid {} expired during pause - ending as defeat", raid_id);
        end_raid(ctx, raid_id, false);
        return Ok(());
    }
    
    // Transition: Paused -> InProgress
    raid.state = RaidState::InProgress;
    raid.started_at = new_started_at;
    raid.pause_started_at = None;
    ctx.db.raid().id().update(raid);
    
    // Reschedule timeout
    let new_timeout = ctx.timestamp + std::time::Duration::from_secs(time_remaining_secs);
    ctx.db.raid_timeout_schedule().insert(RaidTimeoutSchedule {
        id: 0,
        raid_id,
        scheduled_at: ScheduleAt::Time(new_timeout.into()),
    });
    
    log::info!("Raid {} resumed - {}s remaining", raid_id, time_remaining_secs);
    Ok(())
}
```

**Why explicit state:** Single check (`state == Paused`) instead of dual check. Type system prevents invalid states.

**Bob Nystrom Principle:** The state enum is the single source of truth. We don't check `pause_started_at.is_some()` - that would be inferring state from fields. Instead, we check the explicit state enum.

#### 1.3 Modify on_disconnect Reducer (lines 889-907)

**CRITICAL**: Do NOT call `cleanup_player_raid_data` here - it clears `player.in_raid_id` which prevents resume. Only mark inactive.

**How to find:** Search for `#[reducer(client_disconnected)]` or the function `pub fn on_disconnect`. It should be around line 889-907.

**Replace entire function** (delete old version, paste new version):

```rust
#[reducer(client_disconnected)]
pub fn on_disconnect(ctx: &ReducerContext) {
    log::info!("Player disconnected: {}", ctx.sender);
    
    if let Some(session) = ctx.db.session().connection_id().find(&ctx.sender) {
        if let Some(player) = ctx.db.player().id().find(&session.player_id) {
            if let Some(raid_id) = player.in_raid_id {
                // Count BEFORE marking inactive (critical for pause logic)
                // If count == 1, this player is the last active player
                let was_last_active = count_active_raid_players(ctx, raid_id) == 1;
                
                // Mark inactive ONLY - preserves player.in_raid_id for resume
                // Do NOT call cleanup_player_raid_data - that clears in_raid_id!
                mark_player_inactive_in_raid(ctx, &player.id, raid_id);
                
                // Pause ONLY if this was the last active player
                // Solo: Always true (1 player) → pause
                // Multi: Only true if last player DCs → pause
                // Multi: False if others still active → NO pause (squad continues)
                if was_last_active {
                    if let Err(e) = pause_raid_if_empty(ctx, raid_id) {
                        log::warn!("Failed to pause raid {}: {}", raid_id, e);
                        // Continue anyway - player is marked inactive, which is the critical part
                    }
                }
            }
        }
        
        // Delete session (ephemeral connection mapping)
        ctx.db.session().connection_id().delete(&ctx.sender);
    }
}
```

#### 1.4 Modify connect() Reducer (lines 649-791)

**How to find:** Search for `pub fn connect` - it should start around line 651.

**Remove aggressive cleanup sections (these prevent resume):**
- **Delete lines 655-661:** Look for a loop that cleans up `raid_player` rows. It should say something like "Clean up any raid membership from previous session" or iterate over `ctx.db.raid_player().player_id().filter(&player_id)`.
- **Delete lines 663-684:** Look for a loop that cleans up problems from InProgress raids. It should iterate over `ctx.db.problem()` and check for `matches!(raid.state, RaidState::InProgress)`.
- **Delete lines 742-747:** Look for code that clears `existing.in_raid_id = None` or similar. This prevents resume.

**Important:** If line numbers have shifted, search for the code patterns described above rather than relying on exact line numbers.

**Add resume logic after email/grade updates, before session creation:**

**How to find:** Look for where `existing.email` or `existing.grade` is updated (around line 740). Right after that code, before the session creation code (look for `ctx.db.session().insert(...)`), add the resume logic below.

```rust
// Resume paused raid if player was in one
if let Some(raid_id) = existing.in_raid_id {
    if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
        match raid.state {
            RaidState::Paused => {
                // Raid is paused - reactivate player and resume
                if let Some(mut rp) = find_raid_player(ctx, &player_id, raid_id) {
                    rp.is_active = true;
                    update_raid_player(ctx, rp);
                    log::info!("Reactivated player {} in paused raid {}", player_id, raid_id);
                }
                
                // Resume raid from pause (shifts started_at, reschedules timeout)
                if let Err(e) = resume_raid_from_pause(ctx, raid_id) {
                    log::error!("Failed to resume raid {}: {}", raid_id, e);
                    // Player is reactivated - they can still play if raid resumes manually
                }
            }
            RaidState::InProgress => {
                // Raid is running (squad continued playing) - reactivate player and rejoin
                // Timer kept running, so player sees elapsed time (fair - squad was playing)
                if let Some(mut rp) = find_raid_player(ctx, &player_id, raid_id) {
                    if !rp.is_active {
                        rp.is_active = true;
                        update_raid_player(ctx, rp);
                        log::info!("Reactivated player {} in running raid {} - rejoining squad", player_id, raid_id);
                    }
                }
                // Player can immediately continue playing - problems will arrive via subscription
            }
            RaidState::Victory | RaidState::Failed => {
                // Raid ended while player was DC'd - player will see results screen
                // No action needed, client will load ended raid state and show results
                log::info!("Player {} reconnected to ended raid {} - will see results screen", player_id, raid_id);
            }
            _ => {
                // Other states (Matchmaking, Rematch) - handle normally
            }
        }
    }
}
```

**Why match instead of if:** Explicit handling of all states. Type system ensures we handle `Paused` correctly.

#### 1.5 Update check_raid_timeout (lines 2020-2044)

Add pause check before ending raid (after line 2032):

```rust
match raid.state {
    RaidState::InProgress => {
        // Running raid - timeout is valid
        log::info!("Raid {} timed out at 2.5 minutes - ending as defeat", schedule.raid_id);
        end_raid(ctx, schedule.raid_id, false);
    }
    RaidState::Paused => {
        // Paused raid - don't timeout (timeout was canceled when paused)
        log::warn!("Timeout fired for paused raid {} - not ending", schedule.raid_id);
        ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
    }
    _ => {
        // Already ended or other state - cleanup schedule
        log::info!("Raid {} already ended (state: {:?}), skipping timeout", schedule.raid_id, raid.state);
    }
}
```

**Why match:** Explicit handling. `Paused` state prevents timeout - clear and correct.

#### 1.6 Fix Paused Raid Cleanup (in cleanup_abandoned_raids after line 2064)

**REPLACE** the existing InProgress cleanup logic (currently checks raid age > 60s) with paused duration check:

```rust
match raid.state {
    RaidState::Paused => {
        // Raid is paused - check how long it's been paused
        if let Some(pause_started_at) = raid.pause_started_at {
            let pause_duration = now.duration_since(pause_started_at).unwrap_or_default();
            if pause_duration.as_secs() > 300 {
                // Paused for > 5 minutes - consider abandoned
                log::info!("Raid {} abandoned (paused for {}s) - ending", raid.id, pause_duration.as_secs());
                end_raid(ctx, raid.id, false);
            }
            // Still within pause grace period - skip cleanup
        }
        continue; // Skip to next raid
    }
    RaidState::InProgress => {
        // Running raid - use existing cleanup logic (age_seconds > 60)
        // Fall through to existing cleanup below
    }
    _ => {
        // Other states handled by existing cleanup logic
        // Fall through
    }
}

// Existing cleanup logic for non-paused InProgress raids continues...
// (age_seconds > 60 check remains for broken/non-paused raids)
```

**Why match:** Explicit state handling. `Paused` state has different cleanup rules - clear separation.

#### 1.7 Update All State Checks to Handle Paused

**CRITICAL**: After adding `Paused` state, update all `InProgress` checks. Search for:
- `matches!(raid.state, RaidState::InProgress)`
- `raid.state == RaidState::InProgress`
- `raid.state != RaidState::InProgress`

**Decision for each check:**
- **Timer calculations** → Allow both `InProgress | Paused` (both need timer)
- **Problem issuing** → Only `InProgress` (don't issue problems to paused raids)
- **Answer submission** → Only `InProgress` (don't accept answers when paused)
- **Timeout checks** → Handle `Paused` separately (don't timeout paused raids)
- **Cleanup** → Handle `Paused` separately (different cleanup rules)

**Example updates needed:**
- `submit_answer` (line 1446): Keep `InProgress` only (can't submit when paused)
- `request_problem` (line 1583): Keep `InProgress` only (server will resume first)
- `cleanup_abandoned_raids` (line 2082): Add `Paused` case (handled in section 1.6)
- `check_raid_timeout` (line 2032): Add `Paused` case (handled in section 1.5)
- `connect()` problem cleanup (line 673): **REMOVED** in section 1.4 (prevents resume - don't clean up problems)

#### 1.8 Initialize pause_started_at in Raid Creation and Updates

**When CREATING raids (struct initialization):**
Add `pause_started_at: None,` to:
- `create_private_room` (line 950, in `Raid { ... }` struct literal)
- `start_solo_raid` (line 1162, in `Raid { ... }` struct literal)

**When UPDATING raids to InProgress:**
In `start_raid` function (line 1398), when updating raid state to InProgress, ensure:

```rust
// Update raid state and HP
raid.boss_hp = total_hp;
raid.boss_max_hp = total_hp;
raid.state = RaidState::InProgress;  // Explicit state transition
raid.started_at = ctx.timestamp;
raid.pause_started_at = None;  // Ensure raid starts unpaused
log::info!("Raid {} transitioning to InProgress", raid_id);
ctx.db.raid().id().update(raid);
```

**Why both:**
- New raids created from scratch need `pause_started_at: None` in struct literal
- Existing raids transitioning from Matchmaking → InProgress need `pause_started_at = None` to clear any stale state
- State enum (`InProgress`) is authoritative - `pause_started_at` is just for duration calculation

### Phase 2: Client Changes

#### 2.1 Add Browser Online Reconnect (client/src/App.tsx)

**React Pattern:** App.tsx handles UI concerns (browser events, modal display). Store handles business logic (reconnect timing, connection management).

Modify `handleOnline` in browser event handler (currently line 155-160):

```typescript
const handleOnline = () => {
  console.log('[BROWSER] Back online');
  setOnlineStatus(true);  // UI state - controls modal display
  
  // Always need refresh check after DC (connection state may be broken)
  setNeedsRefresh(true);  // UI state - shows "reconnecting" message
  
  // Trigger reconnect via store action (store handles timing/business logic)
  // Store's reconnect logic will handle the timing and state checks
  setTimeout(() => {
    const state = useGameStore.getState();
    const player = state.currentPlayer;
    const playerId = state.playerId;
    
    // Only reconnect if disconnected and have player data
    // This is coordination logic (UI → Store), not business logic
    if (!state.connection && !state.connecting && player && playerId) {
      connect(player.name, playerId, player.grade, undefined, undefined);
    }
  }, 2000);
  
  // Check if reconnect succeeded after 5 seconds (UI feedback)
  setTimeout(() => {
    const state = useGameStore.getState();
    if (state.connection) {
      // Connection rebuilt successfully - hide modal (UI concern)
      setNeedsRefresh(false);
    }
  }, 5000);
};
```

**Why this is idiomatic React:**
- **App.tsx responsibilities:** Browser event listeners, UI state (`needsRefresh`), calling store actions
- **Store responsibilities:** Connection management, business logic, state persistence
- **Separation:** Component coordinates UI → Store, Store handles all business logic

#### 2.2 Add Raid Subscription in loadExistingGameState (client/src/store/gameStore.ts)

**React Pattern:** Store handles all subscription and state loading logic. Components just consume state.

**CRITICAL**: This MUST be done FIRST before removing auto-kick blocks.

**How to find:** Search for `get().setPlayer(ourPlayer);` in `loadExistingGameState` function. It should be around line 480.

**Add immediately after** `get().setPlayer(ourPlayer);`:

```typescript
// Set the player immediately since we need it for raid checking below
get().setPlayer(ourPlayer);

// CRITICAL: Subscribe to raid if player has inRaidId (enables resume)
// This MUST happen before any raid loading attempts
if (ourPlayer.inRaidId && ourPlayer.inRaidId !== 0n) {
    // Force raid subscription setup - this subscribes to raid and raid_player tables
    // updateRaidSubscription already exists (line 371) - just call it here
    updateRaidSubscription(ctx, ourPlayer, get, set);
    // For InProgress raids, raid will load in subscription.onApplied callback
    // For ended raids, we load immediately below (section 2.3) for instant results screen
}
```

**Note:** `updateRaidSubscription` already exists in the file (around line 371). You're just calling it here - don't create a new function.

#### 2.3 Remove Auto-Kick and Fix Raid Loading (client/src/store/gameStore.ts)

**CRITICAL**: After adding subscription (section 2.2), we need to handle ended raids properly AND avoid double-loading.

**Step 1: Remove three auto-kick blocks (these prevent resume on refresh AND cause broken UI state):**
- Lines 488-492 (InProgress raid kick) - DELETE this entire `if` block
  - **Why remove:** 
    - Refresh should resume just like DC. Students shouldn't lose progress on accidental refresh.
    - **CRITICAL:** Calling `ctx.reducers.leaveRaid()` on refresh BEFORE connection is fully ready causes reducer calls to fail, leaving UI in broken state where you can't call any reducers
- Lines 509-512 (fallback InProgress kick) - DELETE this entire `if` block
- Lines 532-535 (no inRaidId InProgress kick) - DELETE this entire `if` block

**Refresh behavior after fix:**
- Refresh mid-raid → Server sees disconnect → Client reconnects → Server resumes (same as DC)
- Refresh in lobby → No raid to resume → Stays in lobby ✅
- Refresh on results → Shows results screen ✅
- **No more broken UI state** - connection is properly established before loading raid, all reducers work ✅

**Step 2: Replace the direct raid loading logic (lines 483-545) with subscription-aware loading:**

REPLACE the existing raid loading code (lines 483-545) with:

```typescript
// If player is in a raid, subscribe to it (raid will load via subscription.onApplied)
if (ourPlayer.inRaidId !== undefined && ourPlayer.inRaidId !== null && ourPlayer.inRaidId !== 0n) {
    // Subscription already set up above - raid will load in onApplied callback
    // For ended raids (Victory/Failed), try to load from cache immediately for results screen
    const raid = findRaidById(ctx.db.raid.iter(), ourPlayer.inRaidId);
    if (raid && (raid.state.tag === "Victory" || raid.state.tag === "Failed")) {
        // Ended raid - load immediately for results screen (don't wait for subscription)
        get().setRaid(raid);
        const raidPlayers = getRaidPlayers(ctx.db.raidPlayer.iter(), raid.id);
        get().updateRaidPlayers(raidPlayers);
    }
    // For InProgress raids, subscription.onApplied will load it
    // This prevents race conditions and ensures we get the latest server state
}
```

**Why this change:**
- Ended raids (Victory/Failed) can load immediately - they're static
- InProgress raids MUST load via subscription to get paused state and shifted timestamps
- Prevents double-loading race conditions
- **CRITICAL:** Subscription ensures connection is fully ready before accessing raid data. This prevents the broken UI state where reducers don't work because connection wasn't ready when raid state was loaded.

#### 2.4 Fix Timer to Use Server Time (client/src/store/gameStore.ts)

**How to find:** Search for the function `setRaid` in `gameStore.ts`. Look for code that sets `raidClientStartTime: Date.now()` or `raidClientStartTime = Date.now()`.

**Replace the entire block** that sets `raidClientStartTime` with the code below:

```typescript
// Capture client start time when raid transitions to InProgress (or resumes from Paused)
// This runs AFTER the clear, so new raids get fresh timing
if (raid && (raid.state.tag === 'InProgress' || raid.state.tag === 'Paused') && 
    (!previousRaid || (previousRaid.state.tag !== 'InProgress' && previousRaid.state.tag !== 'Paused'))) {
    // CRITICAL: Always use server's authoritative start time
    // This handles both fresh raids and resumed raids (with shifted started_at)
    // Server's started_at is the source of truth, even after pause/resume
    // For Paused raids, timer shows remaining time when paused (correct UX)
    const serverStartMs = raid.startedAt.toDate().getTime();
    set({ raidClientStartTime: serverStartMs });
    if (import.meta.env.DEV) {
        console.log('[TIMER] Set raid start time from server:', serverStartMs, 'for raid', raid.id, 'state:', raid.state.tag);
    }
}
```

**Why this works:** When raid resumes, server shifts `started_at` forward, so `raid.startedAt` reflects the adjusted time. Client timer calculation `remaining = 150 - (now - started_at)` works correctly. For `Paused` state, timer shows remaining time when paused (frozen display).

#### 2.5 Update Modal State Logic (client/src/App.tsx)

**React Pattern:** Component handles UI rendering (modal display). Store provides state (`isOnline`, `connection`). Clear separation of concerns.

**The modal is currently commented out (lines 259-286). Re-enable with smarter logic:**

```typescript
{(!isOnline || needsRefresh) && (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center">
    <div className="bg-gray-900/95 border-2 border-red-500/50 rounded-2xl p-8 max-w-md mx-4 text-center">
      <div className="text-6xl mb-4">🌐</div>
      <h2 className="text-2xl font-bold text-white mb-2">
        {!isOnline ? 'Connection Lost' : 'Reconnected'}
      </h2>
      <p className="text-gray-300 mb-6">
        {!isOnline ? (
          'Your WiFi disconnected. Waiting to reconnect...'
        ) : needsRefresh ? (
          'Connection restored. Reconnecting to your raid...'
        ) : (
          'Reconnecting to your raid...'
        )}
      </p>
      {!isOnline ? (
        <div className="flex items-center justify-center gap-2 text-yellow-400">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
          <span>Reconnecting...</span>
        </div>
      ) : connection ? (
        // Connected successfully - modal will auto-hide when needsRefresh becomes false
        <div className="flex items-center justify-center gap-2 text-green-400">
          <span>✓ Connected</span>
        </div>
      ) : (
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          Refresh to Continue 🔄
        </button>
      )}
    </div>
  </div>
)}
```

**Key behavior:**
- Shows instantly on `offline` event
- Updates message when `online` fires
- Auto-hides when `connection` is restored and `needsRefresh` becomes false
- Only shows refresh button if reconnect fails after 5 seconds

### Phase 3: Testing Checklist

**How to test offline/online simulation:**
1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Click "Offline" checkbox (or use "Throttling" dropdown → "Offline")
4. Trigger a raid (start solo or join multiplayer)
5. Wait 20-30 seconds (simulates WiFi drop)
6. Uncheck "Offline" (reconnects)
7. Verify raid resumes correctly

**How to test actual disconnect:**
1. Start a raid on your computer
2. Turn off WiFi (or disconnect ethernet)
3. Wait 20-30 seconds
4. Turn WiFi back on
5. Verify modal appears and raid resumes

**How to test refresh:**
1. Start a raid
2. Hit F5 (refresh page)
3. Verify raid resumes (same as disconnect)

**Testing Checklist:**

**Solo Raid DC Scenarios:**
- [ ] DC at 1:30 remaining for 20s → resume shows 1:30 (timer paused)
- [ ] DC twice (20s + 15s) → both pauses counted, timer correct
- [ ] DC for 3 minutes → raid ended as Failed, shows results screen
- [ ] DC at 0:05 remaining → resume works, can finish

**Multiplayer Raid DC Scenarios:**
- [ ] DC with 2+ others active → timer runs (NO pause), can reconnect and keep playing immediately
- [ ] DC with 2+ others active, reconnect → sees timer advanced, boss HP lower, can continue playing
- [ ] DC with 2+ others active, squad finishes raid → reconnect shows Victory/Failed results screen
- [ ] All 3 players DC → timer pauses → first reconnect resumes for all
- [ ] Last player DCs → pauses → timeout cancels correctly

**Edge Cases:**
- [ ] Refresh in lobby → stays in lobby (no raid to resume)
- [ ] **Refresh mid-raid → resumes correctly (SAME as DC - server treats refresh as disconnect+reconnect)**
- [ ] Refresh mid-solo-raid → resumes with paused timer (fair)
- [ ] Refresh mid-multi-raid → rejoins if squad still playing, or shows results if ended
- [ ] Raid paused for 6 minutes → auto-cleaned up as abandoned
- [ ] Network tab Offline mode → modal shows instantly
- [ ] 50% packet loss → game continues, no modal
- [ ] **DC during raid, raid ends while DC'd, reconnect → shows results screen (not stuck)**
- [ ] **DC during raid, raid paused, reconnect → resumes correctly**
- [ ] **DC during raid, another player leaves, raid ends → reconnect shows results**
- [ ] **Multiple rapid reconnects → no double-loading or race conditions**
- [ ] **Refresh vs DC behavior identical** - both use same resume logic

**Student Experience Testing:**
- [ ] WiFi drop feels like "game paused" not "game broken"
- [ ] Resume is seamless (problem appears, can answer)
- [ ] Lost time in multi feels fair (can see squad kept playing)
- [ ] Modal blames WiFi, not game

### Phase 4: Build & Deploy

**Step 1: Rebuild server module**
```bash
cd server
cargo build --release
# Module will be compiled - you'll see output about .wasm file
```

**Step 2: Test client locally**
```bash
cd client
npm run dev
# Open browser, test with DevTools offline/online (see Phase 3)
```

**Step 3: Deploy to test environment**
```bash
cd /path/to/MathRaiders
./scripts/ops/deploy.sh local
# Follow prompts - this deploys to test SpacetimeDB instance
```

**Step 4: Test on real WiFi**
- Connect 2-3 devices to same WiFi network
- Start multiplayer raid
- Disconnect one device's WiFi for 30 seconds
- Reconnect and verify resume works

**Step 5: Deploy to production**
```bash
./scripts/ops/deploy.sh production
# Follow prompts - this deploys to production SpacetimeDB instance
```

**Important:** Test thoroughly in test environment before deploying to production!

## Acceptance Criteria

**Must Have:**
- [ ] Solo raid DC for 30s → resume with timer showing SAME time (paused)
- [ ] Multiplayer DC → squad continues → timer reflects real elapsed time
- [ ] No manual refresh needed (auto-reconnect works)
- [ ] Modal provides clear feedback ("WiFi issue" framing)

**Nice to Have:**
- [ ] Resume animation/transition (vs. jarring snap back)
- [ ] "You were disconnected for Xs" message
- [ ] Track DC count in analytics

## Timeline

- **Day 1 Morning:** Server implementation (helpers, on_disconnect, connect changes)
- **Day 1 Afternoon:** Client implementation (reconnect, timer, modal)
- **Day 2 Morning:** Edge case testing, bug fixes
- **Day 2 Afternoon:** Deploy and test on real WiFi

**Total: 2 days**

## Risks & Mitigations

**Risk:** Timeout reschedule math wrong → raid never ends  
**Mitigation:** Keep 3-minute safety timeout in check_raid_timeout (already exists line 1454)

**Risk:** Client/server clock skew → timer shows wrong value  
**Mitigation:** Acceptable 1-2 second visual discrepancy, XP calculation uses server time

**Risk:** Pause logic has bugs → kids lose more time  
**Mitigation:** Extensive testing Phase 3, soft launch before alpha pilot

## Success Metrics

**Before:** 1 DC in 40min playtest required teacher intervention

**After:** DCs handled automatically, students blame WiFi not game, continue playing

**Alpha Pilot Goal:** <5% student complaints about lost progress due to DC

## Edge Case Analysis

### Case 1: Simple Solo DC
- t=0: Raid starts, `started_at = 100`, timeout at t=250
- t=60: DC, `active_players = 0`, set `state = Paused`, `pause_started_at = 160`, cancel timeout
- t=90: Reconnect, shift `started_at = 130`, `state = InProgress`, `pause_started_at = None`, reschedule timeout for t=280
- Result: Timer shows correct remaining time, student loses no time

### Case 2: Multi DC (Squad Continues)
- 3 players active (`active_count = 3`)
- t=60: Player 1 DCs, `active_count: 3 → 2`, guard check `count > 0` → **NO PAUSE** (squad continues)
- t=60-90: Squad keeps playing, timer runs, boss HP decreases
- t=90: Player 1 reconnects → `connect()` sees `state == InProgress` → reactivates player
- t=90: Player rejoins, sees timer at 1:00 (30s elapsed), boss HP lower, can immediately play
- Result: Fair - student sees squad kept playing, timer reflects real elapsed time, can continue

**Alternative: Raid ends while DC'd**
- t=60: Player 1 DCs, squad continues
- t=120: Squad defeats boss (Victory)
- t=150: Player 1 reconnects → `connect()` sees `state == Victory` → no resume, client loads results
- Result: Player sees Victory results screen, can see squad's success

### Case 3: All Players DC (Multi Raid)
- 3 players active (`active_count = 3`)
- t=70: Player 1 DCs, `active_count: 3 → 2`, guard check `count > 0` → **NO PAUSE**
- t=75: Player 2 DCs, `active_count: 2 → 1`, guard check `count > 0` → **NO PAUSE**
- t=80: Player 3 DCs (last), `active_count: 1 → 0`, guard check `count == 0` → **PAUSE**
- t=120: First player reconnects, resume with shifted time
- Result: Fair - everyone was frozen when last player DC'd, timer paused for all

### Case 4: Timeout Fires While Paused
- Raid paused (`state = Paused`), timeout was canceled when paused
- check_raid_timeout sees `state == Paused`, doesn't end raid (cleans up schedule)
- Result: Safe - paused raids don't timeout (timeout rescheduled on resume)

### Case 5: DC for Too Long
- Paused at t=160
- Player reconnects at t=500 (340s later)
- resume_raid_from_pause calculates `time_remaining = 0`
- Immediately ends raid as Failed
- Result: Fair - student was gone entire duration

### Case 6: Multiple Rapid DCs
- DC for 10s → shift `started_at += 10s`
- DC for 15s → shift `started_at += 15s` (cumulative)
- DC for 20s → shift `started_at += 20s`
- Result: Each shift compounds correctly, timer accurate

## Critical Corrections Summary

**Before implementing, understand these fixes:**

1. **`on_disconnect` MUST NOT clear `player.in_raid_id`** - Use `mark_player_inactive_in_raid` instead of `cleanup_player_raid_data`
2. **Timestamp arithmetic** - Use `std::time::Duration` when adding to `Timestamp`, not `TimeDuration`
3. **Explicit state** - Use `RaidState::Paused` enum variant, not hidden `paused_at` field checks
4. **Resume check** - In `connect`, check `raid.state == RaidState::Paused` (single check, type-enforced)
5. **Cleanup logic** - `cleanup_abandoned_raids` must check pause duration for `Paused` state, not raid age
6. **Client subscription** - Call `updateRaidSubscription` BEFORE trying to access raid data
7. **Timer source** - Always use `raid.startedAt` (server time), never `Date.now()` for client timer
8. **Raid loading** - Load ended raids immediately, but let subscription load InProgress/Paused raids (prevents stale state)
9. **Ended raid handling** - If raid ended while DC'd, player sees results screen (server state check prevents resume)
10. **State transitions** - Explicit transitions: `InProgress -> Paused -> InProgress` (clear and type-safe)

## Implementation Gotchas

**Bob Nystrom's Approval Checklist:**

✅ **Explicit State Machine** - `Paused` is an enum variant, not inferred from fields
✅ **Root Cause Fix** - Removes aggressive cleanup, fixes the actual problem
✅ **Simple & Clear** - Shifting timestamp is simpler than tracking accumulated pause
✅ **Invalid States Unrepresentable** - Enum prevents `InProgress` with `pause_started_at` set
✅ **Explicit Error Handling** - Errors logged, not silently ignored
✅ **Early Returns** - Guards make happy path obvious
✅ **No Workarounds** - Fixes the architecture, doesn't add band-aids

**Gotcha 1:** Count active players BEFORE marking inactive
```rust
// Wrong:
mark_player_inactive_in_raid(...);  // Sets is_active = false
let count = count_active_raid_players();  // Gets 0!

// Right:
let was_last = count_active_raid_players(...) == 1;
mark_player_inactive_in_raid(...);
if was_last { pause_raid(); }
```

**Gotcha 1b:** NEVER call `cleanup_player_raid_data` in `on_disconnect` (Bob Nystrom: Fix root cause, not symptoms)
```rust
// Wrong:
cleanup_player_raid_data(ctx, &player.id, raid_id);  // Clears player.in_raid_id!
// Player can't resume - in_raid_id is gone

// Right:
mark_player_inactive_in_raid(ctx, &player.id, raid_id);  // Only sets is_active = false
// Player.in_raid_id preserved for resume
```

**Gotcha 2:** Reschedule uses shifted start time AND correct Duration type
```rust
// Wrong:
new_timeout = ctx.timestamp + 150s  // From now (ignores pause)

// Wrong:
new_timeout = raid.started_at + TimeDuration::from_secs(150)  // Type mismatch

// Right:
let remaining = 150u64.saturating_sub(elapsed.as_secs());
let new_timeout = ctx.timestamp + std::time::Duration::from_secs(remaining);
// Schedule from current time, with remaining seconds calculated from shifted start
```

**Gotcha 3:** Check state before every operation (Bob Nystrom: Explicit state, not inferred)
```rust
// Raid could end between finding it and pausing
if raid.state != RaidState::InProgress {
    return;  // Don't pause ended raid
}

// With explicit state machine, idempotency is automatic:
// - If already Paused, pause_raid_if_empty guard will return early
// - No need to check pause_started_at - state enum is single source of truth
```

**Gotcha 3b:** In `connect`, check state explicitly (Bob Nystrom: Match statements make all cases explicit)
```rust
// Wrong:
if raid.state == RaidState::InProgress {  // Resume even if not paused?

// Wrong:
if matches!(raid.state, RaidState::InProgress) && raid.pause_started_at.is_some() {
    // Dual check - error-prone, contradicts explicit state pattern

// Right:
match raid.state {
    RaidState::Paused => {
        // Explicit - only resume if actually paused (state enum is authoritative)
        resume_raid_from_pause(ctx, raid_id);
    }
    RaidState::InProgress => {
        // Just reactivate player, raid is running (no pause)
    }
    _ => {
        // Ended or other state - no action
    }
}
```

**Gotcha 4:** Handle negative time remaining
```rust
let time_remaining = 150 - elapsed;
if time_remaining <= 0 {
    end_raid(ctx, raid_id, false);  // Expired, don't reschedule
    return;
}
```

**Gotcha 5:** No index on raid_timeout_schedule.raid_id
```rust
// Must iterate to find schedules, can't use .raid_id().filter()
let schedules: Vec<_> = ctx.db.raid_timeout_schedule().iter()
    .filter(|s| s.raid_id == raid_id)
    .collect();
```

**Gotcha 6:** Timestamp arithmetic requires `std::time::Duration`
```rust
// Wrong:
let new_start = raid.started_at + pause_duration;  // Type mismatch

// Right:
let pause_secs = pause_duration.as_secs();
let new_start = raid.started_at + std::time::Duration::from_secs(pause_secs);
```

**Gotcha 7:** Client must subscribe to raid BEFORE trying to load it
```typescript
// Wrong:
if (ourPlayer.inRaidId) {
    const raid = findRaidById(...);  // Raid not in cache yet!
    get().setRaid(raid);  // null or stale
}

// Right:
if (ourPlayer.inRaidId) {
    updateRaidSubscription(ctx, ourPlayer, get, set);  // Subscribe first
    // For InProgress raids, load in subscription.onApplied callback
    // For ended raids, can load immediately from cache
}
```

**Gotcha 8:** Handle ended raids differently than InProgress raids
```typescript
// Wrong: Try to load InProgress raid directly (might get stale paused state)
if (raid && raid.state.tag === "InProgress") {
    get().setRaid(raid);  // Stale state, wrong timer
}

// Right: Let subscription load InProgress raids (gets latest pause_started_at, shifted started_at)
// But load ended raids immediately (they're static)
if (raid && (raid.state.tag === "Victory" || raid.state.tag === "Failed")) {
    get().setRaid(raid);  // Safe - ended raids don't change
}
```

**Gotcha 9:** Refresh vs DC - Same behavior (server treats both as disconnect+reconnect)
```rust
// From server's perspective, refresh IS a disconnect:
// 1. Browser closes WebSocket (refresh)
// 2. Server calls on_disconnect() → marks player inactive
// 3. Browser reconnects (new WebSocket)
// 4. Server calls connect() → resumes if paused/rejoins if running

// Both refresh and DC use the same resume logic in connect()
// No special handling needed - refresh = DC from server's view
```

**Gotcha 10:** Server resume logic handles ended raids gracefully
```rust
// In connect reducer, resume logic checks state explicitly:
match raid.state {
    RaidState::Paused => {
        // Only resume if actually paused
        resume_raid_from_pause(ctx, raid_id);
    }
    RaidState::InProgress => {
        // Just reactivate player, raid is running
    }
    _ => {
        // If raid ended while DC'd, state is Victory/Failed, so resume is skipped
        // Player's in_raid_id persists, but they'll see results screen on reconnect
    }
}
```

**Gotcha 11:** Update client to handle `Paused` state
```typescript
// Client must handle Paused state in determineGamePhase (App.tsx line 32):
switch (currentRaid.state.tag) {
    case "Matchmaking":
        return 'matchmaking';
    case "Rematch":
        return 'results';
    case "InProgress":
        return 'raid';
    case "Paused":  // ADD THIS - show raid screen (timer frozen)
        return 'raid';  // Same as InProgress, timer will show paused time
    case "Victory":
    case "Failed":
        return 'results';
    default:
        return 'lobby';
}
```

**Also update gameStore.ts determineGamePhase (line 564):**
```typescript
switch (currentRaid.state.tag) {
    case "Matchmaking":
        return 'matchmaking';
    case "InProgress":
    case "Paused":  // ADD THIS - treat same as InProgress for phase
        return 'raid';
    case "Victory":
    case "Failed":
        return 'results';
    default:
        return 'lobby';
}
```

**Gotcha 12:** All state checks must handle `Paused`
```rust
// Wrong: Only checks InProgress
if matches!(raid.state, RaidState::InProgress) { ... }

// Right: Check both if needed
if matches!(raid.state, RaidState::InProgress | RaidState::Paused) { ... }

// Or better: Handle each explicitly
match raid.state {
    RaidState::InProgress => { /* running */ }
    RaidState::Paused => { /* paused */ }
    _ => { /* other */ }
}
```

## Student-Facing Behavior

**What students see (solo raid DC or refresh):**
1. Playing raid, timer at 1:30
2. WiFi drops (or accidentally refresh) → screen freezes/disconnects
3. Modal appears: "Your WiFi disconnected. Waiting to reconnect..." (or reconnect happens automatically)
4. WiFi returns (or page reloads) after 30s
5. Modal updates: "Reconnecting to your raid..." (or seamless reconnect)
6. Screen unfreezes: boss still there, timer still at 1:30
7. New problem appears, can continue
8. Complete raid, earn full XP

**Student thinks:** "My WiFi sucks (or I hit refresh) but the game paused for me, fair"

**Note:** Refresh and DC behave identically - server treats both as disconnect+reconnect. Both resume.

**What students see (multiplayer DC, squad continues):**
1. Playing with squad, timer at 1:30
2. WiFi drops → screen freezes, modal shows "Connection Lost"
3. WiFi returns after 30s, reconnect
4. Screen unfreezes: boss HP lower (squad did damage), timer at 1:00 (30s elapsed)
5. Can see squad kept playing in damage meters (their damage increased)
6. New problem appears immediately, can continue playing
7. Complete raid, earn XP (less than if didn't DC, but fair)

**Student thinks:** "My WiFi sucked, I missed 30 seconds but can still play, fair"

**What students see (multiplayer DC, squad finishes while DC'd):**
1. Playing with squad, timer at 1:30
2. WiFi drops → screen freezes, modal shows
3. Squad defeats boss (Victory) while DC'd
4. WiFi returns, reconnect
5. Screen shows Victory results screen
6. Can see squad's success, earned XP

**Student thinks:** "My WiFi dropped but my squad won, I still get rewards"

## Troubleshooting

**Problem: Compilation errors after adding `Paused` state**
- Make sure you added `Paused,` to the enum (with comma)
- Check that all `match` statements handle `Paused` case
- Search for `matches!(raid.state, RaidState::InProgress)` and update them

**Problem: Raid doesn't resume after disconnect**
- Check that `on_disconnect` calls `mark_player_inactive_in_raid` (NOT `cleanup_player_raid_data`)
- Verify `connect()` reducer has the resume logic (section 1.4)
- Check that `player.in_raid_id` is NOT cleared anywhere in `connect()`

**Problem: Timer shows wrong time after resume**
- Verify `setRaid` uses `raid.startedAt.toDate().getTime()` (server time)
- Check that `resume_raid_from_pause` correctly shifts `started_at`
- Make sure client subscription loads raid (section 2.2)

**Problem: Subscription not working**
- Verify `updateRaidSubscription` is called in `loadExistingGameState` (section 2.2)
- Check that subscription happens BEFORE raid loading (critical ordering)
- Look for errors in browser console about subscription failures

**Problem: Modal doesn't appear on disconnect**
- Check that `handleOffline` sets `setOnlineStatus(false)` (section 2.1)
- Verify modal condition: `{(!isOnline || needsRefresh) && ...}`
- Make sure `isOnline` state exists in `gameStore.ts`

**Problem: Refresh doesn't resume (sends to lobby)**
- Verify auto-kick blocks are removed (section 2.3, Step 1)
- Check that subscription is set up before raid loading (section 2.2)
- Ensure `connect()` reducer has resume logic (section 1.4)

**Problem: Refresh leaves UI in broken state (can't call reducers) - THIS IS WHAT YOU EXPERIENCED**
- **Root cause:** Old code calls `ctx.reducers.leaveRaid()` on refresh (line 491) BEFORE connection is fully ready (subscriptions not applied yet), causing reducer calls to fail silently
- **Symptoms:** UI shows raid screen but buttons don't work, can't submit answers, can't leave raid - stuck in broken state
- **Fix:** Plan removes ALL auto-kick blocks (section 2.3, Step 1) - no more `leaveRaid()` calls on refresh
- **Fix:** Plan sets up subscription BEFORE loading raid state (section 2.2) - ensures connection is ready
- **Fix:** Plan loads raid via subscription `onApplied` callback - connection guaranteed ready when callback fires
- **Result:** Refresh now resumes smoothly - connection is ready, all reducers work, no broken UI state ✅

## Next Steps After Implementation

1. Test extensively with DevTools network simulation
2. Test on actual sports center WiFi with 2-3 students
3. Collect feedback: "Did you feel penalized by disconnects?"
4. If students still frustrated → investigate WiFi quality vs. game issues
5. If students satisfied → deploy for alpha pilot

