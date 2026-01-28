# Dynamic Subscriptions Implementation Guide

## Overview

This document outlines the implementation of dynamic subscriptions in MathRaiders to handle 1000+ concurrent players. Currently, every player receives updates for ALL raids and ALL raid players, creating a massive bottleneck at scale.

## The Problem

### Current Architecture (Global Subscriptions)
```typescript
// Every player subscribes to:
'SELECT * FROM raid',              // ALL raids (even ones they're not in)
'SELECT * FROM raid_player'        // ALL players in ALL raids
```

### The Math at Scale
- **100 players** = ~10 raids × 100 clients = 1,000 updates per change ✅
- **500 players** = ~50 raids × 500 clients = 25,000 updates per change ⚠️
- **1000 players** = ~100 raids × 1000 clients = 100,000 updates per change 💀

Each player processes 99% irrelevant updates, causing:
- Network congestion
- Client CPU waste (React re-renders)
- Server broadcast overhead
- Database query evaluation on every change

## The Solution: Dynamic Subscriptions

### Core Principle
Players should only see:
1. **In Lobby**: Matchmaking raids only
2. **In Raid**: Their specific raid and its players only

This reduces network traffic by ~95% at scale.

### SpacetimeDB Confirmed Patterns
- Subscribe to new queries BEFORE unsubscribing old ones (no gaps)
- Subscriptions can be created anytime (not just onConnect)
- Auto-cleanup on disconnect
- Use `onError` for error handling
- Multiple subscriptions to same table are fine

## Implementation Phases

### Phase 1: Infrastructure Setup (30 minutes)
**Goal**: Add subscription tracking without changing behavior

#### 1.1 Update GameState Interface
```typescript
// client/src/store/gameStore.ts
export interface GameState {
    // ... existing state ...
    
    // Add subscription tracking
    subscriptions: {
        base: any | null;      // Initial subscriptions
        raid: any | null;      // Dynamic raid subscription
        raidPlayers: any | null; // Dynamic raid_player subscription
    };
}
```

#### 1.2 Initialize in Store
```typescript
export const useGameStore = create<GameState>((set, get) => ({
    // ... existing state ...
    subscriptions: {
        base: null,
        raid: null,
        raidPlayers: null
    },
    // ... rest of store
}));
```

#### 1.3 Store Initial Subscription Handle
```typescript
// In connect() method, around line 510
const baseSub = ctx.subscriptionBuilder()
    .onApplied(() => {
        console.log('[SUBSCRIBE] Subscriptions applied, loading state...');
        setupTableListeners(ctx, get, set);
        loadExistingGameState(ctx, playerId, get, set);
    })
    .subscribe([
        // ... existing subscriptions ...
    ]);

// Store the handle
set({ subscriptions: { ...get().subscriptions, base: baseSub } });
```

**Testing Phase 1**:
- Game works exactly as before ✅
- Can log subscription handles to console ✅
- No behavior changes ✅

---

### Phase 2: Dynamic Raid Subscription (1 hour)
**Goal**: Only see matchmaking raids + your current raid

#### 2.1 Change Initial Raid Subscription
```typescript
// In connect() method subscriptions
// CHANGE FROM:
'SELECT * FROM raid',

// TO:
`SELECT * FROM raid WHERE state = 'Matchmaking'`,
```

#### 2.2 Add Raid Update Function
```typescript
// Add new function after setupTableListeners
function updateRaidSubscription(
    ctx: DbConnection,
    player: Player,
    get: () => GameState,
    set: (state: Partial<GameState>) => void
) {
    const { subscriptions } = get();
    
    // Clean up old raid subscription
    if (subscriptions.raid?.isActive()) {
        subscriptions.raid.unsubscribe();
    }
    
    if (player.inRaidId && player.inRaidId !== 0n) {
        console.log(`[SUBSCRIBE] Subscribing to raid ${player.inRaidId}`);
        
        // Subscribe to specific raid
        const raidSub = ctx.subscriptionBuilder()
            .onError((err) => console.error('[SUBSCRIBE] Raid subscription error:', err))
            .subscribe([`SELECT * FROM raid WHERE id = ${player.inRaidId}`]);
        
        set({ subscriptions: { ...subscriptions, raid: raidSub } });
    } else {
        // Not in raid - clear subscription
        set({ subscriptions: { ...subscriptions, raid: null } });
    }
}
```

#### 2.3 Hook Into Player Updates
```typescript
// In setupTableListeners, modify player.onUpdate (around line 111)
conn.db.player.onUpdate((ctx, oldPlayer, newPlayer) => {
    console.log('[PLAYER] onUpdate fired - ID:', newPlayer.id);
    get().setPlayer(newPlayer);
    
    // NEW: Handle raid subscription changes
    if (oldPlayer?.inRaidId !== newPlayer.inRaidId) {
        updateRaidSubscription(ctx, newPlayer, get, set);
    }
});
```

**Testing Phase 2**:
- Lobby shows only matchmaking rooms ✅
- Join room → see your raid appear ✅
- Leave room → raid disappears ✅
- Other raids not visible ✅
- Console shows subscription changes ✅

---

### Phase 3: Dynamic Raid Player Subscription (45 minutes)
**Goal**: Only see players in your raid

#### 3.1 Change Initial Raid Player Subscription
```typescript
// In connect() method subscriptions
// CHANGE FROM:
'SELECT * FROM raid_player'

// TO:
`SELECT * FROM raid_player WHERE 1=0`  // Empty result set
```

#### 3.2 Enhance Update Function
```typescript
function updateRaidSubscription(
    ctx: DbConnection,
    player: Player,
    get: () => GameState,
    set: (state: Partial<GameState>) => void
) {
    const { subscriptions } = get();
    
    // Clean up old subscriptions
    if (subscriptions.raid?.isActive()) {
        subscriptions.raid.unsubscribe();
    }
    if (subscriptions.raidPlayers?.isActive()) {
        subscriptions.raidPlayers.unsubscribe();
    }
    
    if (player.inRaidId && player.inRaidId !== 0n) {
        console.log(`[SUBSCRIBE] Subscribing to raid ${player.inRaidId}`);
        
        // Subscribe to specific raid
        const raidSub = ctx.subscriptionBuilder()
            .onError((err) => console.error('[SUBSCRIBE] Raid subscription error:', err))
            .subscribe([`SELECT * FROM raid WHERE id = ${player.inRaidId}`]);
        
        // Subscribe to raid players
        const playersSub = ctx.subscriptionBuilder()
            .onError((err) => console.error('[SUBSCRIBE] Raid players subscription error:', err))
            .onApplied(() => {
                // Force refresh raid players when subscription is ready
                const raid = get().currentRaid;
                if (raid) {
                    const raidPlayers = getRaidPlayers(ctx.db.raidPlayer.iter(), raid.id);
                    get().updateRaidPlayers(raidPlayers);
                }
            })
            .subscribe([`SELECT * FROM raid_player WHERE raid_id = ${player.inRaidId}`]);
        
        set({ 
            subscriptions: { 
                ...subscriptions, 
                raid: raidSub,
                raidPlayers: playersSub
            } 
        });
    } else {
        // Not in raid - clear subscriptions
        set({ 
            subscriptions: { 
                ...subscriptions, 
                raid: null,
                raidPlayers: null
            } 
        });
    }
}
```

**Testing Phase 3**:
- Lobby shows no players ✅
- Join room → see only your room's players ✅
- Other rooms' players not visible ✅
- Leave room → players cleared ✅

---

### Phase 4: Reconnection Handling (30 minutes)
**Goal**: Handle players already in raids on connect/refresh

#### 4.1 Update loadExistingGameState
```typescript
// In loadExistingGameState function (around line 350)
// After setting the player and before checking for raids
if (ourPlayer && ourPlayer.inRaidId && ourPlayer.inRaidId !== 0n) {
    console.log('[LOAD STATE] Player already in raid, updating subscriptions');
    updateRaidSubscription(ctx, ourPlayer, get, set);
}
```

#### 4.2 Handle Initial Subscription Case
```typescript
// In the subscription onApplied callback
.onApplied(() => {
    console.log('[SUBSCRIBE] Subscriptions applied, loading state...');
    setupTableListeners(ctx, get, set);
    loadExistingGameState(ctx, playerId, get, set);
    
    // NEW: Check if player exists and is in raid
    const player = ctx.db.player.id.find(playerId);
    if (player && player.inRaidId && player.inRaidId !== 0n) {
        updateRaidSubscription(ctx, player, get, set);
    }
})
```

**Testing Phase 4**:
- Join raid → refresh browser → still in raid ✅
- See correct raid and players after refresh ✅
- Not in raid → refresh → see only matchmaking ✅

---

### Phase 5: Cleanup & Edge Cases (30 minutes)
**Goal**: Handle disconnection and errors gracefully

#### 5.1 Clean Up on Disconnect
```typescript
// In connect() method, modify onDisconnect (around line 544)
.onDisconnect(() => {
    console.log('[DISCONNECT] Cleaning up subscriptions');
    const { subscriptions } = get();
    
    // Clean up all dynamic subscriptions
    Object.entries(subscriptions).forEach(([key, sub]) => {
        if (sub?.isActive()) {
            console.log(`[DISCONNECT] Unsubscribing from ${key}`);
            sub.unsubscribe();
        }
    });
    
    set({ 
        connection: null,
        subscriptions: { base: null, raid: null, raidPlayers: null }
    });
})
```

#### 5.2 Error Boundary for Subscriptions
```typescript
// Wrap updateRaidSubscription calls in try-catch
try {
    updateRaidSubscription(ctx, player, get, set);
} catch (error) {
    console.error('[SUBSCRIBE] Failed to update subscriptions:', error);
    // Continue with existing subscriptions
}
```

**Testing Phase 5**:
- Disconnect → reconnect → subscriptions reset ✅
- Invalid raid ID → doesn't crash ✅
- Rapid raid join/leave → handles gracefully ✅

---

## Performance Metrics

### Before Implementation
- **Network Traffic**: O(n²) where n = number of players
- **Updates per second**: raids × players × actions
- **At 1000 players**: ~1,000,000 updates/second

### After Implementation
- **Network Traffic**: O(1) per player (only their data)
- **Updates per second**: ~10 per player (their raid only)
- **At 1000 players**: ~10,000 updates/second (99% reduction!)

## Testing Strategy

### Manual Testing Checklist
- [ ] **Single Player Flow**
  - Create room
  - Join room
  - Start raid
  - Complete raid
  - Return to lobby

- [ ] **Multi-Tab Testing**
  - Open 3+ browser tabs
  - Each creates/joins different rooms
  - Verify isolation (can't see other rooms' data)
  - Check console for subscription logs

- [ ] **Refresh Testing**
  - Refresh at each stage
  - Verify correct data loads
  - Check subscription recreation

- [ ] **Edge Cases**
  - Join non-existent room
  - Rapid join/leave
  - Network interruption
  - Server restart

### Console Monitoring
```javascript
// Add to browser console for monitoring
let subCount = 0;
const originalSubscribe = DbConnection.prototype.subscriptionBuilder;
DbConnection.prototype.subscriptionBuilder = function() {
    const builder = originalSubscribe.call(this);
    const originalSub = builder.subscribe;
    builder.subscribe = function(queries) {
        console.log(`[MONITOR] Subscription #${++subCount}:`, queries);
        return originalSub.call(this, queries);
    };
    return builder;
};
```

## Rollback Plan

If issues arise, revert by:
1. Remove subscription tracking from GameState
2. Change back to original subscriptions:
   ```typescript
   'SELECT * FROM raid',
   'SELECT * FROM raid_player'
   ```
3. Remove updateRaidSubscription function
4. Remove player.onUpdate modifications

The changes are isolated and can be reverted in ~10 minutes.

## Future Optimizations

1. **Spatial Queries** (when SpacetimeDB supports)
   - Subscribe to raids in geographic region
   - Subscribe to players within view distance

2. **Subscription Pooling**
   - Reuse subscriptions for common queries
   - Reduce subscription churn

3. **Predictive Subscriptions**
   - Pre-subscribe to likely next state
   - Smoother transitions

## FAQ

**Q: Why not filter client-side?**  
A: Every client would still receive all updates, wasting bandwidth and CPU.

**Q: What about subscription overhead?**  
A: SpacetimeDB confirmed subscriptions are lightweight and designed for this pattern.

**Q: Can subscriptions be updated mid-game?**  
A: Yes, SpacetimeDB supports dynamic subscription updates at any time.

**Q: What if a subscription fails?**  
A: The onError callback handles failures; the game continues with existing data.

## Conclusion

This implementation will allow MathRaiders to scale to 1000+ concurrent players by reducing network traffic by ~95%. Each phase builds on the previous one and can be tested independently, minimizing risk while maximizing impact.

Total implementation time: ~3-4 hours
Expected outcome: Support for 1000+ concurrent players






