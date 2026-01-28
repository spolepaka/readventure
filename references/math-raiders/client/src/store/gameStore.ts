import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { Identity, type Infer } from 'spacetimedb';
import * as Sentry from "@sentry/react";
import { DbConnection, EventContext, PlayerRow, RaidRow, RaidPlayerRow, ProblemRow, PlayerAnswerRow, FactMasteryRow, PerformanceSnapshotRow } from '../spacetime';

// HMR: Preserve store instance across hot reloads
declare global {
    interface Window {
        __GAME_STORE__?: UseBoundStore<StoreApi<GameState>>;
    }
}

type Player = Infer<typeof PlayerRow>;
type Raid = Infer<typeof RaidRow>;
type RaidPlayer = Infer<typeof RaidPlayerRow>;
type Problem = Infer<typeof ProblemRow>;
type PlayerAnswer = Infer<typeof PlayerAnswerRow>;
type FactMastery = Infer<typeof FactMasteryRow>;
type PerformanceSnapshot = Infer<typeof PerformanceSnapshotRow>;
import { calculateDivision } from '../utils/rankDivisions';
import { ALL_FACTS } from '../data/mathFacts';
import { generateFactKey } from '../utils/factKeys';
import { calculateTrackMasterStatuses } from '../hooks/useTrackMasterStatus';
import { getTracksForGrade, shouldShowAllButton, ALL_TRACK } from '../data/tracks';
import { calculateQuestProgress } from '../hooks/useQuestProgress';

export type ConnectionState = 
    | { tag: 'disconnected' }           // No connection
    | { tag: 'connecting' }             // Connecting (shows modal)
    | { tag: 'connected', conn: DbConnection };  // Connected and ready

export interface GameState {
    // Connection - explicit state machine
    connectionState: ConnectionState;
    connectionError: string | null;
    isOnline: boolean;
    
    // Computed getters for backward compatibility (derive from state machine)
    get connection(): DbConnection | null;
    get connecting(): boolean;
    
    // Game state
    currentPlayer: Player | null;
    playerName: string;
    playerId: string | null;  // Stable player ID
    currentRaid: Raid | null;
    raidPlayers: RaidPlayer[];
    currentProblem: Problem | null;
    problems: Problem[];  // All prefetched problems for current raid
    currentProblemSequence: number;  // Which problem we're showing (by sequence)
    factMasteries: FactMastery[];
    performanceHistory: PerformanceSnapshot[];
    
    // Sound settings
    soundEnabled: boolean;
    
    // Subscription tracking
    subscriptions: {
        base: any | null;      // Initial subscriptions (SpacetimeDB handle)
        raid: any | null;      // Dynamic raid subscription (SpacetimeDB handle)
        raidPlayers: any | null; // Dynamic raid_player subscription (SpacetimeDB handle)
    };
    currentRaidSubscriptionId: bigint | null; // Track which raid we're subscribed to
    
    // Raid progression tracking
    raidStartRank: string | null;
    raidStartDivision: string;
    raidStartMastered: number;
    raidStartAp: number;  // Captured before raid for delta calculation
    raidStartTrackMasters: string[];  // Track operations that were Master before raid
    raidStartStarTiers: Record<string, number>;  // trackId → 0-3 boss wins
    raidStartDailyComplete: boolean;  // Was daily quest complete before raid?
    raidStartWeeklyComplete: boolean;  // Was weekly quest complete before raid?
    raidStartBestDamages: Record<string, number>;  // track → best Quick Play damage (for PB detection)
    raidStartBestTimes: Record<string, number>;    // "boss-track" → best Mastery Trials time (for PB detection)
    
    // Client-side raid timing (avoids server/client clock skew)
    raidClientStartTime: number | null;
    
    // Reconnection support
    tokenGetter: (() => string | undefined) | null;  // Set by App.tsx after SDK init
    reconnectTimer: ReturnType<typeof setTimeout> | null;  // For auto-retry scheduling
    
    // Actions
    connect: (name: string, grade: number | undefined, playcademyToken?: string, timebackId?: string, email?: string) => Promise<void>;
    reconnect: () => void;  // Centralized reconnect - all triggers call this
    disconnect: () => void;
    createPrivateRoom: (track?: string | null, bossLevel?: number) => void;
    joinPrivateRoom: (code: string, track?: string | null) => void;
    startSoloRaid: (track?: string | null, bossLevel?: number) => void;
    submitAnswer: (problemId: bigint, answer: number, responseMs: number) => void;
    leaveRaid: () => void;
    raidAgain: () => void;
    soloAgain: (bossLevel?: number) => void;
    toggleReady: () => void;
    startRaidManual: () => void;
    setBossVisual: (visual: number) => void;
    setMasteryBoss: (bossLevel: number) => void;
    toggleSound: () => void;
    advanceToNextProblem: () => void;  // Move to next problem in prefetched queue
    
    // Internal updates from SpacetimeDB
    setOnlineStatus: (isOnline: boolean) => void;
    setPlayer: (player: Player) => void;
    setRaid: (raid: Raid | null) => void;
    updateRaidPlayers: (players: RaidPlayer[]) => void;
    setProblem: (problem: Problem | null) => void;
    setConnectionError: (error: string | null) => void;
    setTokenGetter: (getter: () => string | undefined) => void;
    
    // Computed getters
    get gamePhase(): 'connect' | 'lobby' | 'matchmaking' | 'raid' | 'results';
    get connected(): boolean;
    get masteredFactsCount(): number;
}

// Get the SpacetimeDB host from environment
// Dev: ws://localhost:3000 (from .env.development)
// Prod: ws://18.224.110.93:3000 (from .env.production)
const SPACETIMEDB_HOST = import.meta.env.VITE_SPACETIMEDB_HOST || 'ws://localhost:3000';
const MODULE_NAME = import.meta.env.VITE_MODULE_NAME || 'math-raiders';

// Gateway URL for JWT verification
// Dev: http://localhost:3001 (local worker)
// Staging: Set VITE_GATEWAY_URL to local worker
// Prod: through cloudflare tunnel
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL 
    || (import.meta.env.DEV 
        ? 'http://localhost:3001'
        : 'https://lip-jets-approx-pig.trycloudflare.com');

// Warn if using fallback
if (!import.meta.env.VITE_SPACETIMEDB_HOST) {
    console.warn('⚠️ VITE_SPACETIMEDB_HOST not set! Defaulting to localhost:3000');
}

// Helper: Check if boss level is adaptive (Quick Play)
function isAdaptiveBoss(bossLevel: number): boolean {
    return bossLevel === 0 || bossLevel >= 100;
}

// Helper: Capture current progression state before raid starts
function captureRaidStartState(
    currentPlayer: Player | null, 
    factMasteries: FactMastery[],
    performanceHistory: PerformanceSnapshot[]
): {
    raidStartRank: string | null;
    raidStartDivision: string;
    raidStartMastered: number;
    raidStartAp: number;
    raidStartTrackMasters: string[];
    raidStartStarTiers: Record<string, number>;
    raidStartDailyComplete: boolean;
    raidStartWeeklyComplete: boolean;
    raidStartBestDamages: Record<string, number>;
    raidStartBestTimes: Record<string, number>;
} {
    if (!currentPlayer) {
        return { 
            raidStartRank: null, 
            raidStartDivision: 'IV', 
            raidStartMastered: 0,
            raidStartAp: 0,
            raidStartTrackMasters: [],
            raidStartStarTiers: {},
            raidStartDailyComplete: false,
            raidStartWeeklyComplete: false,
            raidStartBestDamages: {},
            raidStartBestTimes: {},
        };
    }
    
    // Calculate current mastery stats for player's grade
    const gradeFacts = ALL_FACTS.filter(f => 
        f.grades.includes(currentPlayer.grade)
    );
    
    // Create valid fact keys for this grade
    const validFactKeys = new Set(
        gradeFacts.map(f => generateFactKey(f.left, f.right, f.operation))
    );
    
    // Count mastered facts (level 5+) that are in current grade
    const masteredCount = factMasteries.filter(fm => 
        fm.playerId === currentPlayer.id &&
        fm.masteryLevel >= 5 && 
        validFactKeys.has(fm.factKey)
    ).length;
    
    const currentDivision = calculateDivision(
        currentPlayer.rank,
        masteredCount,
        gradeFacts.length
    );
    
    // Calculate track masters (include ALL track when 2+ operation tracks)
    // Note: Locked tracks check not needed - LobbyScreen prevents ALL selection,
    // so ALL track master progress is impossible for locked players
    const operationTracks = getTracksForGrade(currentPlayer.grade);
    const tracks = shouldShowAllButton(currentPlayer.grade)
        ? [...operationTracks, ALL_TRACK]
        : operationTracks;
    const trackStatuses = calculateTrackMasterStatuses(currentPlayer, tracks, performanceHistory, factMasteries);
    const masters = trackStatuses.filter(t => t.isMaster).map(t => t.operation);
    
    // Build star tier map (trackId → goalBossWins)
    const starTiers: Record<string, number> = {};
    for (const ts of trackStatuses) {
        starTiers[ts.trackId] = ts.goalBossWins;
        starTiers[ts.operation] = ts.goalBossWins;
    }
    
    // Calculate quest completion state (reuse pure function)
    const { dailyComplete, weeklyComplete } = calculateQuestProgress(currentPlayer, performanceHistory);
    
    // Calculate best damages per track (Quick Play wins for PB detection)
    // Capture BEFORE raid starts so we have stable data at results time
    const bestDamages: Record<string, number> = {};
    const quickPlayWins = performanceHistory.filter(s =>
        s.playerId === currentPlayer.id &&
        s.grade === currentPlayer.grade &&
        isAdaptiveBoss(s.bossLevel) &&
        s.victory === true
    );
    for (const win of quickPlayWins) {
        const track = win.track ?? 'ALL';
        bestDamages[track] = Math.max(bestDamages[track] ?? 0, win.damageDealt);
    }
    
    // Calculate best times per boss-track combo (Mastery Trials for PB detection)
    // Mode-specific: solo and multi have separate PB pools (matches modal behavior)
    const bestTimes: Record<string, number> = {};
    const masteryWins = performanceHistory.filter(s =>
        s.playerId === currentPlayer.id &&
        s.grade === currentPlayer.grade &&
        s.bossLevel >= 1 && s.bossLevel <= 8 &&
        s.victory === true
    );
    for (const win of masteryWins) {
        const track = win.track ?? 'ALL';
        const raidType = win.raidType ?? 'solo';
        const key = `${raidType}-${win.bossLevel}-${track}`;
        const currentBest = bestTimes[key];
        // For time, lower is better
        bestTimes[key] = currentBest === undefined 
            ? win.sessionSeconds 
            : Math.min(currentBest, win.sessionSeconds);
    }
    
    return {
        raidStartRank: currentPlayer.rank || null,
        raidStartDivision: currentDivision,
        raidStartMastered: masteredCount,
        raidStartAp: currentPlayer.totalAp,
        raidStartTrackMasters: masters,
        raidStartStarTiers: starTiers,
        raidStartDailyComplete: dailyComplete,
        raidStartWeeklyComplete: weeklyComplete,
        raidStartBestDamages: bestDamages,
        raidStartBestTimes: bestTimes,
    };
}

// Performance helpers - avoid Array.from() in hot paths
function findRaidById(raids: Iterable<Raid>, raidId: bigint): Raid | null {
    for (const raid of raids) {
        if (raid.id === raidId) return raid;
    }
    return null;
}

function getRaidPlayers(raidPlayers: Iterable<RaidPlayer>, raidId: bigint): RaidPlayer[] {
    const result: RaidPlayer[] = [];
    for (const rp of raidPlayers) {
        if (rp.raidId === raidId) result.push(rp);
    }
    return result;
}

function findPlayerRaid(db: any, playerId: string): RaidPlayer | null {
    for (const rp of db.raidPlayer.iter()) {
        if (rp.playerId === playerId) return rp;
    }
    return null;
}

// Helper: Ensure player's raid subscription is current
// Single source of truth for "should we subscribe to this player's raid?"
function ensureRaidSubscription(
    conn: DbConnection, 
    player: Player, 
    get: () => GameState, 
    set: (state: Partial<GameState>) => void
) {
    const currentSubscriptionId = get().currentRaidSubscriptionId;
    const playerRaidId = player.inRaidId;
    
    // Subscribe if: player is in a raid AND we're not already subscribed to it
    if (playerRaidId && playerRaidId !== 0n && currentSubscriptionId !== playerRaidId) {
        if (import.meta.env.DEV) {
            console.log(`[DYNAMIC] Subscribing to raid ${playerRaidId} (was: ${currentSubscriptionId})`);
        }
        updateRaidSubscription(conn, player, get, set);
    }
}

// Helper: Set up all the table listeners
function setupTableListeners(conn: DbConnection, get: () => GameState, set: (state: Partial<GameState>) => void) {
    
    // Player updates via my_player view - Only receives OUR player data
    // IMPORTANT: Views may fire onInsert instead of onUpdate when underlying data changes.
    // This is undocumented SpacetimeDB behavior. To be safe, we treat both callbacks as
    // "player data changed" and run the same logic (setPlayer + ensureRaidSubscription).
    // See: https://spacetimedb.com/docs - view subscription semantics are not specified.
    // Permanent listener: handle all reducer-caused player updates
    // Bob Nystrom: correct over clever - always update, setPlayer is cheap
    conn.db.myPlayer.onInsert((ctx, player: Player) => {
        // Only process reducer events, not subscription data
        if (ctx.event.tag !== "Reducer") {
            return;
        }
        if (import.meta.env.DEV) {
            console.log('[PLAYER] Reducer update:', player.name);
        }
        get().setPlayer(player);
        ensureRaidSubscription(conn, player, get, set);
    });
    
    conn.db.myPlayer.onUpdate((ctx, oldPlayer: Player, newPlayer: Player) => {
        // Only process updates for our player
        if (newPlayer.id !== get().playerId) {
            return;
        }
        if (import.meta.env.DEV) {
            console.log('[PLAYER] onUpdate fired - ID:', newPlayer.id, 'inRaidId:', newPlayer.inRaidId);
        }
        get().setPlayer(newPlayer);
        ensureRaidSubscription(conn, newPlayer, get, set);
    });

    // Raid updates - Now only receiving our specific raid
    conn.db.raid.onInsert((ctx, raid: Raid) => {
        if (import.meta.env.DEV) {
            console.log('[LISTENER] raid.onInsert fired - raid:', raid.id, 'state:', raid.state.tag);
        }
        
        // We only receive raids we're subscribed to (our raid)
        // This happens when we join a raid and the subscription applies
        get().setRaid(raid);
    });
    
    conn.db.raid.onUpdate((ctx, oldRaid: Raid, newRaid: Raid) => {
        // We only receive updates for raids we're subscribed to (our raid)
        if (import.meta.env.DEV) {
            console.log('[RAID UPDATE] Raid', newRaid.id, 'state changed from', oldRaid.state.tag, 'to', newRaid.state.tag);
        }

        // On raid end, refresh dependent state from the SpacetimeDB cache BEFORE setting the raid.
        // SpacetimeDB table callbacks fire in undefined order, but the cache is updated atomically.
        // This ensures ResultsScreen's first render sees consistent `raidPlayers` + `performanceHistory`.
        if (newRaid.state.tag === 'Victory' || newRaid.state.tag === 'Failed') {
            const allRaidPlayers = getRaidPlayers(ctx.db.raidPlayer.iter(), newRaid.id);
            get().updateRaidPlayers(allRaidPlayers);

            // Refresh perf history from cache (avoids callback-order races with performanceSnapshot.onInsert)
            const perfSnapshots = Array.from(ctx.db.performanceSnapshot.iter());
            set({ performanceHistory: perfSnapshots });
        }

        get().setRaid(newRaid);
    });

    // Raid player updates - always refresh full list
    const refreshRaidPlayers = (raidId: bigint) => {
        const allRaidPlayers = getRaidPlayers(conn.db.raidPlayer.iter(), raidId);

        get().updateRaidPlayers(allRaidPlayers);
    };

    conn.db.raidPlayer.onInsert((ctx, raidPlayer: RaidPlayer) => {
        // With dynamic subscriptions, we only receive raid_player events for our raid
        const currentRaid = get().currentRaid;
        if (currentRaid) {
            refreshRaidPlayers(currentRaid.id);
        }
    });
    
    conn.db.raidPlayer.onUpdate((ctx, oldRP: RaidPlayer, newRP: RaidPlayer) => {
        // With dynamic subscriptions, we only receive updates for our raid
        const playerId = get().playerId;
        const currentRaid = get().currentRaid;
        
        if (playerId && newRP.playerId === playerId) {
            if (import.meta.env.DEV) {
                console.log('[RAID PLAYER] onUpdate fired:', {
                    playerId: newRP.playerId,
                    raidId: newRP.raidId,
                    wasActive: oldRP?.isActive,
                    isActive: newRP.isActive,
                    becameActive: !oldRP?.isActive && newRP.isActive
                });
            }
            
            if (!oldRP?.isActive && newRP.isActive && currentRaid) {
                refreshRaidPlayers(currentRaid.id);
                // With batch prefetch, problems are hydrated in onApplied - no server request needed
                return; // Early return - refreshRaidPlayers already called above
            }
        }
        
        // For other updates (not our player becoming active), refresh normally
        if (currentRaid) {
            refreshRaidPlayers(currentRaid.id);
        }
    });
    
    conn.db.raidPlayer.onDelete((ctx, raidPlayer: RaidPlayer) => {
        // With dynamic subscriptions, we only receive deletes for our raid
        const currentRaid = get().currentRaid;
        if (currentRaid) {
            refreshRaidPlayers(currentRaid.id);
        }
    });

    
    // Problem updates - Batch prefetch: all 150 problems arrive at raid start
    conn.db.problem.onInsert((ctx, problem: Problem) => {
        const playerId = get().playerId;
        // Only process problems for our player
        if (problem.playerId !== playerId) {
            return;
        }
        
        // Add to problems list (sorted insert by sequence)
        const currentProblems = get().problems;
        const updatedProblems = [...currentProblems, problem].sort((a, b) => a.sequence - b.sequence);
        set({ problems: updatedProblems });
        
        // Set currentProblem to first unanswered problem
        // This handles both batch arrival and refresh/resume cases
        const currentProblem = get().currentProblem;
        
        if (!currentProblem) {
            // Find first unanswered problem from sorted list
            const allProblems = get().problems;
            for (const p of allProblems) {
                let hasAnswer = false;
                for (const answer of ctx.db.playerAnswer.iter()) {
                    if (answer.problemId === p.id && answer.playerId === playerId) {
                        hasAnswer = true;
                        break;
                    }
                }
                
                if (!hasAnswer) {
                    if (import.meta.env.DEV) {
                        console.log(`[PROBLEM] Setting current problem: P${p.sequence} ${p.leftOperand}×${p.rightOperand}`);
                    }
                    set({ 
                        currentProblem: p,
                        currentProblemSequence: p.sequence 
                    });
                    break;
                }
            }
        }
        
        // Ensure raid is loaded if we don't have it yet
        const currentRaid = get().currentRaid;
        if (!currentRaid && problem.raidId) {
            const raid = findRaidById(ctx.db.raid.iter(), problem.raidId);
            if (raid) {
                get().setRaid(raid);
            } else {
                // Raid not in cache - subscribe to it specifically
                if (import.meta.env.DEV) {
                    console.log(`[PROBLEM] Subscribing to raid ${problem.raidId} for incoming problem`);
                }
                ctx.subscriptionBuilder()
                    .subscribe([`SELECT * FROM raid WHERE id = ${problem.raidId}`]);
            }
        }
    });

    // Answer updates - No filter needed, subscription already filtered
    conn.db.playerAnswer.onInsert((ctx, answer) => {
        console.log('[ANSWER] onInsert fired:', { 
            eventTag: ctx.event.tag,
            answerPlayerId: answer.playerId,
            damage: answer.damage 
        });
        
        // Only process reducer-caused inserts (new answers), not initial subscription data
        if (ctx.event.tag !== "Reducer") {
            console.log('[ANSWER] Skipping - not a Reducer event');
            return;
        }
        
        // Authoritative damage event for local player
        const playerId = get().playerId;
        console.log('[ANSWER] Checking:', { storePlayerId: playerId, answerPlayerId: answer.playerId, match: answer.playerId === playerId });
        
        if (playerId && answer.playerId === playerId) {
            console.log('[ANSWER] Dispatching damageDealt event:', answer.damage);
            window.dispatchEvent(new CustomEvent('damageDealt', {
                detail: { damage: Number(answer.damage), problemId: answer.problemId }
            }));
        }
    });
    
    // Fact mastery updates - Only for incremental changes during gameplay
    conn.db.factMastery.onInsert((ctx, mastery) => {
        if (ctx.event.tag !== "Reducer") return; // Skip subscription data (already loaded in onApplied)
        
        if (import.meta.env.DEV) {
            console.log('[FACT MASTERY] New fact mastery:', mastery);
        }
        const currentMasteries = get().factMasteries;
        set({ factMasteries: [...currentMasteries, mastery] });
    });
    
    conn.db.factMastery.onUpdate((ctx, oldMastery, newMastery) => {
        if (import.meta.env.DEV) {
            console.log('[FACT MASTERY] Updated:', oldMastery, '->', newMastery);
        }
        const currentMasteries = get().factMasteries;
        const updated = currentMasteries.map(m => m.id === newMastery.id ? newMastery : m);
        set({ factMasteries: updated });
    });
    
    conn.db.factMastery.onDelete((ctx, mastery) => {
        if (import.meta.env.DEV) {
            console.log('[FACT MASTERY] Deleted:', mastery);
        }
        const currentMasteries = get().factMasteries;
        set({ factMasteries: currentMasteries.filter(m => m.id !== mastery.id) });
    });
    
    // Performance snapshot updates - Only for incremental changes
    conn.db.performanceSnapshot.onInsert((ctx, snapshot) => {
        if (ctx.event.tag !== "Reducer") return; // Skip subscription data
        
        const playerId = get().playerId;
        if (playerId && snapshot.playerId !== playerId) return;
        
        if (import.meta.env.DEV) {
            console.log('[PERFORMANCE] New snapshot');
        }

        // Refresh from cache instead of appending to avoid callback-order races and duplicates.
        // (Base subscription is already scoped to this player_id, but we keep the guard above.)
        const perfSnapshots = Array.from(ctx.db.performanceSnapshot.iter());
        set({ performanceHistory: perfSnapshots });
    });
}

// Helper: Update raid subscription based on player's current raid
// Dynamic subscriptions - subscribe to both raid and raid_player tables

function updateRaidSubscription(
    ctx: DbConnection,
    player: Player,
    get: () => GameState,
    set: (state: Partial<GameState>) => void
) {
    const { subscriptions, currentRaidSubscriptionId } = get();
    
    // Check if we're already subscribed to this raid
    if (currentRaidSubscriptionId === player.inRaidId) {
        if (import.meta.env.DEV) {
          console.log(`[DYNAMIC] Already subscribed to raid ${player.inRaidId} - skipping`);
        }
        return;
    }
    
    // Clean up old subscriptions (we use the same handle for both tables)
    if (subscriptions.raid) {
        if (import.meta.env.DEV) {
          console.log('[DYNAMIC] Unsubscribing from old raid subscription');
        }
        subscriptions.raid.unsubscribe();
    }
    
    if (player.inRaidId && player.inRaidId !== 0n) {
        // Update tracking IMMEDIATELY to prevent duplicate subscriptions
        set({ currentRaidSubscriptionId: player.inRaidId });
        
        if (import.meta.env.DEV) {
          console.log(`[DYNAMIC] Player joined raid ${player.inRaidId} - subscribing to raid and raid_player tables`);
        }
        
        // Subscribe to BOTH raid and raid_player for our specific raid
        const raidSub = ctx.subscriptionBuilder()
            .onError((err) => console.error('[DYNAMIC] Raid subscription error:', err))
            .onApplied(() => {
                // Get fresh player state - server's connect() may have updated inRaidId
                const currentPlayer = get().currentPlayer;
                const raidId = currentPlayer?.inRaidId || player.inRaidId;
                
                if (import.meta.env.DEV) {
                  console.log(`[DYNAMIC] Successfully subscribed to raid ${raidId}`);
                }
                
                // Get our raid and players
                if (raidId && raidId !== 0n) {
                    const raid = findRaidById(ctx.db.raid.iter(), raidId);
                    if (raid) {
                        if (import.meta.env.DEV) {
                            console.log(`[DYNAMIC] Found raid ${raidId} in cache, state: ${raid.state.tag}`);
                        }
                        get().setRaid(raid);
                    } else {
                        if (import.meta.env.DEV) {
                            console.warn(`[DYNAMIC] Raid ${raidId} not found in cache after subscription applied!`);
                        }
                    }
                    
                    const raidPlayers = getRaidPlayers(ctx.db.raidPlayer.iter(), raidId);
                    get().updateRaidPlayers(raidPlayers);
                    if (import.meta.env.DEV) {
                      console.log(`[DYNAMIC] Loaded raid ${raidId} with ${raidPlayers.length} players`);
                    }
                }
            })
            .subscribe([
                `SELECT * FROM raid WHERE id = ${player.inRaidId}`,
                `SELECT * FROM raid_player WHERE raid_id = ${player.inRaidId}`
            ]);
        
        // Store the subscription handle (we use the same handle for both tables)
        set({ 
            subscriptions: { 
                ...subscriptions, 
                raid: raidSub, 
                raidPlayers: raidSub 
            } 
        });
    } else {
        if (import.meta.env.DEV) {
          console.log('[DYNAMIC] Player not in raid - clearing raid subscriptions');
        }
        set({ 
            currentRaidSubscriptionId: null,
            subscriptions: { 
                ...subscriptions, 
                raid: null, 
                raidPlayers: null 
            }
        });
    }
}

// Helper: Get connection only when connected (Bob Nystrom pattern - invalid states unrepresentable)
function getConnection(state: GameState): DbConnection | null {
    return state.connectionState.tag === 'connected' ? state.connectionState.conn : null;
}

/**
 * Initialize player connection with confirmation.
 * - Returning users: Player exists in subscription, return immediately (fire-and-forget OK)
 * - New users: Create player, wait for confirmation via subscription
 * 
 * Bob Nystrom pattern: Never proceed without confirmed player data.
 */
async function initializePlayer(
    ctx: DbConnection,
    playerId: string,
    name: string,
    grade: number | undefined,
    timebackId?: string,
    email?: string
): Promise<Player> {
    // Check if player already exists in initial subscription data (returning user)
    const existing = [...ctx.db.myPlayer.iter()].find(p => p.id === playerId);
    
    if (existing) {
        if (import.meta.env.DEV) {
            console.log('[INIT PLAYER] Returning user found:', existing.name);
        }
        // Returning user - update server (fire-and-forget OK, we already have data)
        ctx.reducers.connect({ name, grade, timebackId, email });
        return existing;
    }
    
    if (import.meta.env.DEV) {
        console.log('[INIT PLAYER] New user, waiting for player creation...');
    }
    
    // New user - must wait for player creation confirmation
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ctx.db.myPlayer.removeOnInsert(onCreated); // Clean up on timeout
            console.error('[INIT PLAYER] Timeout waiting for player creation');
            reject(new Error('Player creation timeout - please refresh and try again'));
        }, 10000);
        
        // Named callback for proper cleanup (SpacetimeDB + Bob Nystrom idiom)
        const onCreated = (_: EventContext, player: Player) => {
            if (player.id === playerId) {
                clearTimeout(timeout);
                ctx.db.myPlayer.removeOnInsert(onCreated); // Clean up!
                if (import.meta.env.DEV) {
                    console.log('[INIT PLAYER] Player created:', player.name);
                }
                resolve(player);
            }
        };
        
        // Set up listener BEFORE triggering creation
        ctx.db.myPlayer.onInsert(onCreated);
        
        // Now trigger creation
        ctx.reducers.connect({ name, grade, timebackId, email });
    });
}

/**
 * Retry wrapper for initializePlayer.
 * Handles transient failures (e.g., after laptop sleep/wake) with silent retries.
 * Only shows error after all attempts exhausted.
 */
async function initializePlayerWithRetry(
    ctx: DbConnection,
    playerId: string,
    name: string,
    grade: number | undefined,
    timebackId?: string,
    email?: string,
    attempt = 1,
    maxAttempts = 3
): Promise<Player> {
    try {
        return await initializePlayer(ctx, playerId, name, grade, timebackId, email);
    } catch (error) {
        if (attempt < maxAttempts) {
            if (import.meta.env.DEV) {
                console.log(`[INIT PLAYER] Attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`);
            }
            await new Promise(r => setTimeout(r, 2000));
            return initializePlayerWithRetry(ctx, playerId, name, grade, timebackId, email, attempt + 1, maxAttempts);
        }
        // All attempts failed - throw user-friendly error
        throw new Error('Connection failed after multiple attempts. Please try again.');
    }
}

// Helper: Load existing raid state after connection (player already set)
function loadExistingGameState(ctx: DbConnection, playerId: string, get: () => GameState, set: (state: Partial<GameState>) => void) {
    const player = get().currentPlayer;
    if (!player) {
        // Should never happen - we only call this after player is confirmed
        console.error('[LOAD STATE] Called without player - this is a bug');
        return;
    }
    
    // Check if player was in a raid
    if (player.inRaidId && player.inRaidId !== 0n) {
        if (import.meta.env.DEV) {
            console.log(`[LOAD STATE] Player has inRaidId: ${player.inRaidId}, subscribing to raid...`);
        }
        
        // Subscribe to raid - subscription.onApplied will load it for active raids
        updateRaidSubscription(ctx, player, get, set);
        
        // For ended raids, load immediately from cache for instant results screen
        const raid = findRaidById(ctx.db.raid.iter(), player.inRaidId);
        if (raid && (raid.state.tag === "Victory" || raid.state.tag === "Failed")) {
            if (import.meta.env.DEV) {
                console.log(`[LOAD STATE] Loading ended raid ${raid.id} immediately for results screen`);
            }
            get().setRaid(raid);
            const raidPlayers = getRaidPlayers(ctx.db.raidPlayer.iter(), raid.id);
            get().updateRaidPlayers(raidPlayers);
        }
    } else {
        if (import.meta.env.DEV) {
            console.log(`[LOAD STATE] Player not in raid, staying in lobby`);
        }
    }
}

// This is the SINGLE source of truth for game phase
// Export it so components can compute phase directly from selected state
export function determineGamePhase(
    player: Player | null,
    currentRaid: Raid | null,
    currentProblem: Problem | null
): GameState['gamePhase'] {
    // No player = connect screen
    if (!player) {
        return 'connect';
    }
    
    // Check if we're in a raid
    // First check currentRaid (most reliable when loaded)
    if (currentRaid) {
        // CRITICAL: Only show raid screens if player is ACTUALLY in this raid
        // Prevents showing results for stale raids after leaving (8-min cleanup grace)
        const isPlayerInRaid = player.inRaidId === currentRaid.id;
        
        if (isPlayerInRaid) {
            // Derive phase from raid state
            switch (currentRaid.state.tag) {
                case "Matchmaking":
                    return 'matchmaking';
                case "Countdown":  // 3-2-1-GO countdown (CountdownOverlay handles display)
                case "InProgress":
                case "Paused":  // Paused raids show raid screen (timer frozen)
                    // Raid started - go to raid screen even if problem not loaded yet
                    // RaidScreen handles its own loading state
                    return 'raid';
                case "Victory":
                case "Failed":
                case "Rematch":  // Rematch state shows results screen
                    return 'results';
                default:
                    return 'lobby';
            }
        }
        // currentRaid exists but player not in it (left raid, 8-min grace) → lobby
    }
    
    if (player.inRaidId && player.inRaidId !== 0n) {
        // Player has raid ID but raid not loaded yet
        // Stay on lobby (buttons will be disabled, no screen flash)
        // Once raid loads via subscription, currentRaid will be set and we'll show correct screen
        return 'lobby';
    }
    
    // Not in any raid
    return 'lobby';
}

// Create store (or reuse existing for HMR)
const createGameStore = () => create<GameState>((set, get) => ({
    // Initial state - explicit state machine
    connectionState: { tag: 'disconnected' },
    isOnline: true,
    connectionError: null,
    currentPlayer: null,
    playerName: '',
    playerId: null,
    currentRaid: null,
    raidPlayers: [],
    currentProblem: null,
    problems: [],
    currentProblemSequence: 0,
    factMasteries: [],
    performanceHistory: [],
    soundEnabled: localStorage.getItem('mathRaidersMuted') !== 'true',
    subscriptions: {
        base: null,
        raid: null,
        raidPlayers: null
    },
    currentRaidSubscriptionId: null,
    
    // Raid progression tracking - initial values
    raidStartRank: null,
    raidStartDivision: 'IV',
    raidStartMastered: 0,
    raidStartAp: 0,
    raidStartTrackMasters: [],
    raidStartStarTiers: {},
    raidStartDailyComplete: false,
    raidStartWeeklyComplete: false,
    raidStartBestDamages: {},
    raidStartBestTimes: {},

    // Client-side raid timing
    raidClientStartTime: null,
    
    // Reconnection support
    tokenGetter: null,
    reconnectTimer: null,
    
    // Connect to SpacetimeDB
    // playcademyToken: JWT from Playcademy SDK for verification (undefined in dev mode)
    // timebackId, email: PII from client (can only affect their own record)
    connect: async (name: string, grade: number | undefined, playcademyToken?: string, timebackId?: string, email?: string) => {
        const currentState = get().connectionState;
        if (currentState.tag === 'connected' || currentState.tag === 'connecting') {
            return; // Already connected or connecting
        }
        
        set({ connectionState: { tag: 'connecting' }, playerName: name });
        
        try {
            let builder = DbConnection.builder()
                .withUri(SPACETIMEDB_HOST)
                .withModuleName(MODULE_NAME);
            
            // Add owner token if both token exists AND admin mode is enabled
            // Use VITE_ADMIN_MODE=true to enable admin operations (grade changes, etc.)
            // Default false for student testing
            const ownerToken = import.meta.env.VITE_SPACETIMEDB_TOKEN;
            const adminMode = import.meta.env.VITE_ADMIN_MODE === 'true';
            
            if (ownerToken && adminMode) {
                builder = builder.withToken(ownerToken);
                if (import.meta.env.DEV) {
                    console.log('[CONNECT] Authenticating as owner/admin (ADMIN MODE)');
                }
            } else {
                if (import.meta.env.DEV) {
                    console.log('[CONNECT] Connecting as anonymous student');
                }
            }
            
            const conn = builder
                .onConnect((ctx, identity, token) => {
                    if (import.meta.env.DEV) {
                      console.log('[CONNECT] Connected to SpacetimeDB');
                    }
                    // Leave `connecting` true and don't expose ctx yet; only clear errors
                    set({ connectionError: null });
                    
                    const waitForActive = async () => {
                        const start = Date.now();
                        while (!ctx.isActive) {
                            if (Date.now() - start > 5000) {
                                throw new Error('Timed out waiting for websocket to become active');
                            }
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                    };

                    const initialiseConnection = async () => {
                        try {
                            await waitForActive();
                            
                            // Step 1: Verify with gateway and create session
                            const stdbIdentity = identity.toHexString();
                            if (import.meta.env.DEV) {
                                console.log('[VERIFY] Calling gateway to verify identity:', stdbIdentity);
                            }
                            
                            const verifyResponse = await fetch(`${GATEWAY_URL}/verify`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    token: playcademyToken,
                                    stdbIdentity
                                })
                            });
                            
                            if (!verifyResponse.ok) {
                                const error = await verifyResponse.json().catch(() => ({ error: 'Unknown error' }));
                                throw new Error(`Verification failed: ${error.error || verifyResponse.statusText}`);
                            }
                            
                            const verifyResult = await verifyResponse.json() as { playerId: string; name?: string; timebackId?: string; email?: string; grade?: number | null };
                            const verifiedPlayerId = verifyResult.playerId;
                            
                            if (import.meta.env.DEV) {
                                console.log('[VERIFY] Gateway verified identity, playerId:', verifiedPlayerId);
                            }
                            
                            // Store playerId for subscriptions
                            set({ playerId: verifiedPlayerId });

                            // Step 2: Subscribe to tables using verified playerId
                            const baseSub = ctx.subscriptionBuilder()
                                .onApplied(async () => {
            if (import.meta.env.DEV) {
              console.log('[SUBSCRIBE] Subscriptions applied, initializing player...');
            }

            try {
                // Step 3: Get or create player with confirmation
                // Bob Nystrom: Never proceed without confirmed player data
                // Uses retry wrapper to handle transient failures (e.g., after laptop sleep)
                // Token is source of truth: use name/email/timebackId/grade from /verify, not from client
                // Grade self-heals: TimeBack API is authoritative, updates on each login
                const verifiedName = verifyResult.name || name;  // Fallback for dev mode
                const verifiedGrade = verifyResult.grade ?? grade;  // TimeBack grade, fallback to client-resolved
                const player = await initializePlayerWithRetry(
                    ctx, verifiedPlayerId, verifiedName, verifiedGrade, verifyResult.timebackId, verifyResult.email
                );

                // Set Sentry user context for error tracking
                Sentry.setUser({
                    id: verifiedPlayerId,
                    username: player.name,
                    grade: verifiedGrade?.toString()
                });

                // Bulk-load initial data
                const initialFactMasteries = Array.from(ctx.db.factMastery.iter());
                const initialPerfSnapshots = Array.from(ctx.db.performanceSnapshot.iter());
                set({ 
                    factMasteries: initialFactMasteries,
                    performanceHistory: initialPerfSnapshots
                });

                // Set player immediately - we have confirmed data
                get().setPlayer(player);

                // Step 4: Register handlers for future changes
                setupTableListeners(ctx, get, set);

                // Step 5: HYDRATE existing problems (reconnect scenario with batch prefetch)
                // onInsert handlers only catch NEW data, not data that arrived with subscription.
                // Load all problems and find first unanswered one.
                const allProblems = [...ctx.db.problem.iter()]
                    .filter(p => p.playerId === verifiedPlayerId)
                    .sort((a, b) => a.sequence - b.sequence);
                
                if (allProblems.length > 0) {
                    // Store all problems for local advancement
                    set({ problems: allProblems });
                    
                    // Find first unanswered problem
                    const answers = [...ctx.db.playerAnswer.iter()]
                        .filter(a => a.playerId === verifiedPlayerId);
                    const answeredIds = new Set(answers.map(a => a.problemId));
                    
                    const firstUnanswered = allProblems.find(p => !answeredIds.has(p.id));
                    if (firstUnanswered) {
                        if (import.meta.env.DEV) {
                            console.log(`[HYDRATE] Found ${allProblems.length} problems, first unanswered: P${firstUnanswered.sequence}`);
                        }
                        set({ 
                            currentProblem: firstUnanswered,
                            currentProblemSequence: firstUnanswered.sequence
                        });
                    } else {
                        if (import.meta.env.DEV) {
                            console.log(`[HYDRATE] All ${allProblems.length} problems answered`);
                        }
                    }
                }
                
                // Load additional state (raid subscriptions, etc.)
                loadExistingGameState(ctx, verifiedPlayerId, get, set);
                
                set({ connectionState: { tag: 'connected', conn: ctx } });
                if (import.meta.env.DEV) {
                    console.log('[CONNECT] State transition: connecting → connected ✓');
                }
            } catch (error) {
                console.error('[CONNECT] Player initialization failed:', error);
                set({ 
                    connectionState: { tag: 'disconnected' }, 
                    connectionError: error instanceof Error ? error.message : 'Failed to initialize. Please refresh.'
                });
            }
                                })
                                .subscribe([
                            // Using my_player view for row-level security (fixed in SpacetimeDB 1.10)
                            `SELECT * FROM my_player`,
                            `SELECT * FROM problem WHERE player_id = '${verifiedPlayerId}'`,
                            `SELECT * FROM player_answer WHERE player_id = '${verifiedPlayerId}'`,
                            `SELECT * FROM fact_mastery WHERE player_id = '${verifiedPlayerId}'`,
                            `SELECT * FROM performance_snapshot WHERE player_id = '${verifiedPlayerId}'`
                        ]);

                            set({ subscriptions: { ...get().subscriptions, base: baseSub } });
                            if (import.meta.env.DEV) {
                              console.log('[PHASE 1] Base subscription ready (waiting for onApplied...)');
                            }
                        } catch (err) {
                            console.error('[CONNECT] Failed to initialise connection', err);
                            
                            // Bob Nystrom: Don't fight the platform. If token expired, reload fresh.
                            const errorMsg = err instanceof Error ? err.message : String(err);
                            if (errorMsg.includes('expired') || errorMsg.includes('Invalid') || errorMsg.includes('401')) {
                                console.log('[CONNECT] Token expired - reloading for fresh auth...');
                                set({ connectionError: 'Session expired. Refreshing...' });
                                setTimeout(() => window.location.reload(), 500);
                                return;
                            }
                            
                            // Transition: connecting → disconnected (failed)
                            set({ connectionState: { tag: 'disconnected' }, connectionError: 'Failed to initialise connection. Please retry.' });
                        }
                    };

                    void initialiseConnection();
                })
                .onConnectError((error) => {
                    console.error('Connection error:', error);
                    // Transition: connecting → disconnected (failed)
                    set({ connectionState: { tag: 'disconnected' }, connectionError: 'Failed to connect to game server. Please try again.' });
                    
                    // Schedule auto-retry after 2s (connection error may be transient)
                    const timer = setTimeout(() => get().reconnect(), 2000);
                    set({ reconnectTimer: timer });
                })
                .onDisconnect((ctx, error) => {
                    console.log('[DISCONNECT] Connection lost', error);
                    
                    const currentState = get();
                    
                    // Clean up subscriptions if we have any (regardless of current state)
                    const subs = currentState.subscriptions;
                    
                    // Clean up base subscription
                    if (subs.base) {
                        try {
                            subs.base.unsubscribe();
                        } catch (e) {
                            // Expected - connection already closed (WebSocket CLOSING/CLOSED)
                            // Silently ignore - subscriptions are cleaned up automatically on disconnect
                        }
                    }
                    
                    // Clean up raid subscription
                    if (subs.raid) {
                        try {
                            subs.raid.unsubscribe();
                        } catch (e) {
                            // Expected - connection already closed (WebSocket CLOSING/CLOSED)
                            // Silently ignore - subscriptions are cleaned up automatically on disconnect
                        }
                    }
                    
                    // ALWAYS transition to disconnected (ensures modal shows on connection loss)
                    set({
                        connectionState: { tag: 'disconnected' },
                        subscriptions: { base: null, raid: null, raidPlayers: null },
                        currentRaidSubscriptionId: null
                    });
                    
                    // Schedule auto-retry after 1.5s (gives browser online event a chance first)
                    const timer = setTimeout(() => get().reconnect(), 1500);
                    set({ reconnectTimer: timer });
                })
                .build();
            
            // Do not expose raw connection until fully initialised above
            // set({ connection: conn });

            
        } catch (error) {
            console.error('Failed to connect:', error);
            // Transition: connecting → disconnected (failed)
            set({ connectionState: { tag: 'disconnected' }, connectionError: 'Unable to connect. Check your internet connection.' });
        }
    },
    
    // Centralized reconnect - all triggers (onDisconnect, online event, button) call this
    reconnect: () => {
        const state = get();
        
        // Guard: only if disconnected
        if (state.connectionState.tag !== 'disconnected') {
            return;
        }
        
        // Guard: need player info to reconnect
        const player = state.currentPlayer;
        if (!player) {
            return;
        }
        
        // Clear any pending reconnect timer
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            set({ reconnectTimer: null });
        }
        
        // Get fresh token from stored getter
        const token = state.tokenGetter?.() || undefined;
        
        if (import.meta.env.DEV) {
            console.log('[RECONNECT] Attempting reconnect for', player.name);
        }
        
        // Reuse connect() - it has all the logic
        // Don't pass stale email/timebackId - /verify will provide fresh values from token
        get().connect(player.name, player.grade, token, undefined, undefined);
    },
    
    disconnect: async () => {
        const state = get();
        const connection = getConnection(state);
        const { subscriptions } = state;
        
        // Clean up dynamic subscriptions with error handling
        if (subscriptions.raid) {
            try {
                console.log('[DYNAMIC] Cleaning up raid subscription on disconnect');
                subscriptions.raid.unsubscribe();
            } catch (e) {
                // Connection already closed, that's fine
                console.debug('[DISCONNECT] Subscription cleanup failed (expected):', e);
            }
        }
        
        if (connection) {
            try {
                connection.disconnect();
            } catch (e) {
                console.warn('[DISCONNECT] Connection cleanup failed:', e);
            }
            // Give the websocket time to close properly
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        set({
                        connectionState: { tag: 'disconnected' },
            currentPlayer: null,
            playerId: null,
            currentRaid: null,
            raidPlayers: [],
            currentProblem: null,
            problems: [],
            currentProblemSequence: 0,
            subscriptions: { base: null, raid: null, raidPlayers: null },
            currentRaidSubscriptionId: null
        });
    },
    
    createPrivateRoom: (track?: string | null, bossLevel?: number) => {
        const state = get();
        const connection = getConnection(state);
        const { currentPlayer, factMasteries, performanceHistory } = state;
        
        if (connection) {
                const progressionState = captureRaidStartState(currentPlayer, factMasteries, performanceHistory);
                set(progressionState);
connection.reducers.createPrivateRoom({ track: track ?? undefined, bossLevel: bossLevel ?? undefined });
        }
    },
    
    joinPrivateRoom: (code: string, track?: string | null) => {
        const state = get();
        const connection = getConnection(state);
        const { currentPlayer, factMasteries, performanceHistory } = state;
        
        if (connection) {
                const progressionState = captureRaidStartState(currentPlayer, factMasteries, performanceHistory);
                set(progressionState);
                connection.reducers.joinPrivateRoom({ code, track: track ?? undefined });
        }
    },
    
    startSoloRaid: (track?: string | null, bossLevel?: number) => {
        const state = get();
        const connection = getConnection(state);
        const { currentPlayer, factMasteries, performanceHistory } = state;

        if (connection) {
                const progressionState = captureRaidStartState(currentPlayer, factMasteries, performanceHistory);
                set(progressionState);
connection.reducers.startSoloRaid({ track: track ?? undefined, bossLevel: bossLevel ?? undefined });
        } else {
            console.warn('Cannot start solo raid - not connected');
        }
    },
    
    submitAnswer: (problemId: bigint, answer: number, responseMs: number) => {
        const connection = getConnection(get());
        if (connection) {
            connection.reducers.submitAnswer({ problemId, answerValue: answer, responseMs });
            // With batch prefetch, client advances locally - no server requestProblem needed
        }
    },
    
    leaveRaid: () => {
        const connection = getConnection(get());
        if (connection) {
            connection.reducers.leaveRaid({});
            
            // Clear client state immediately (don't trust stale cache after leaving)
            set({ 
                currentRaid: null,
                raidPlayers: [],
                currentProblem: null,
                problems: [],
                currentProblemSequence: 0,
                raidClientStartTime: null
            });
        }
    },
    
    raidAgain: () => {
        const state = get();
        const connection = getConnection(state);
        const { currentPlayer, factMasteries, performanceHistory } = state;
        if (connection) {
            // Capture current progression state before starting rematch
            const progressionState = captureRaidStartState(currentPlayer, factMasteries, performanceHistory);
            set({
                ...progressionState,
                // Clear old raid state
                currentProblem: null,
                problems: [],
                currentProblemSequence: 0
            });
            
            // Atomic server-side operation: leave + start matchmaking
            connection.reducers.raidAgain({});
        }
    },
    
    soloAgain: (bossLevel?: number) => {
        const state = get();
        const connection = getConnection(state);
        const { currentPlayer, factMasteries, performanceHistory } = state;
        if (connection) {
            // Capture current progression state before starting new raid
            const progressionState = captureRaidStartState(currentPlayer, factMasteries, performanceHistory);
            set({
                ...progressionState,
                // Clear old raid state
                currentProblem: null,
                problems: [],
                currentProblemSequence: 0
            });
            
            // Atomic server-side operation: leave + start solo raid
            // Pass optional bossLevel override for boss picker
            connection.reducers.soloAgain({ bossLevel });
        }
    },
    
    toggleReady: () => {
        const connection = getConnection(get());
        if (connection) {
            connection.reducers.toggleReady({});
            // Trust SpacetimeDB callbacks to update raid_player state
        }
    },

    startRaidManual: () => {
        const connection = getConnection(get());

        if (connection) {
            connection.reducers.startRaidManual({});
            // Trust subscriptions to update state when raid changes
        }
    },
    
    setBossVisual: (visual: number) => {
        const connection = getConnection(get());
        if (connection) {
            connection.reducers.setBossVisual({ visual });
        }
    },

    setMasteryBoss: (bossLevel: number) => {
        const connection = getConnection(get());
        if (connection) {
            connection.reducers.setMasteryBoss({ bossLevel });
        }
    },
    
    toggleSound: () => {
        set(state => {
            const newEnabled = !state.soundEnabled;
            localStorage.setItem('mathRaidersMuted', String(!newEnabled));
            return { soundEnabled: newEnabled };
        });
    },
    
    // Internal state updates
    setOnlineStatus: (isOnline: boolean) => set({ isOnline }),
    
    setPlayer: (player: Player) => {
        if (import.meta.env.DEV) {
          console.log('[SET PLAYER] Setting player:', player.name);
        }
        
        // Clear raid state if player left
        if (!player.inRaidId || player.inRaidId === 0n) {
            const currentRaid = get().currentRaid;
            if (currentRaid) {
                // Player left the raid - clear raid state
                get().setRaid(null);
                set({ currentProblem: null });
            }
        }
        
        set({ currentPlayer: player });
    },
    
    setRaid: (raid: Raid | null) => {
        const previousRaid = get().currentRaid;
        const state = get();
        const connection = getConnection(state);
        
        // Clear start time when leaving raid completely OR starting a different raid
        if (!raid || (previousRaid && raid.id !== previousRaid.id)) {
            set({ raidClientStartTime: null });
        }
        
        // Update raidClientStartTime when:
        // 1. Entering active state (InProgress/Paused) from non-active state, OR
        // 2. Server's startedAt changed (happens on resume from pause)
        const isActiveState = raid?.state.tag === 'InProgress' || raid?.state.tag === 'Paused';
        const wasActiveState = previousRaid?.state.tag === 'InProgress' || previousRaid?.state.tag === 'Paused';
        const serverStartMs = raid?.startedAt?.toDate().getTime() ?? 0;
        const previousServerStartMs = previousRaid?.startedAt?.toDate().getTime() ?? 0;
        const startedAtChanged = serverStartMs !== previousServerStartMs;
        
        if (raid && isActiveState && (!wasActiveState || startedAtChanged)) {
            // Adjust for clock skew on fresh raids only
            // Reconnects/refreshes/resumes use server timestamp as-is
            const now = Date.now();
            const apparentElapsed = now - serverStartMs;
            
            let adjustedStartMs = serverStartMs;
            
            // Only adjust if raid JUST started on server (< 5 seconds old) and not a resume
            // This prevents adjusting on refresh/reconnect/resume to already-running raids
            const isResume = wasActiveState && startedAtChanged;
            if (apparentElapsed > 1000 && apparentElapsed < 5000 && !previousRaid && !isResume) {
                // Fresh raid with network delay (1-5 seconds)
                // Adjust to show it just started (set to 1 second ago)
                adjustedStartMs = now - 1000;
                if (import.meta.env.DEV) {
                    console.log('[TIMER] Fresh raid clock skew detected, adjusting by', apparentElapsed - 1000, 'ms');
                }
            }
            // If apparentElapsed > 5 seconds, it's a reconnect/refresh - use server time as-is
            
            set({ raidClientStartTime: adjustedStartMs });
            if (import.meta.env.DEV) {
                console.log('[TIMER] Set raid start time:', adjustedStartMs, 'for raid', raid.id, 
                    'state:', raid.state.tag, startedAtChanged ? '(startedAt changed)' : '');
            }
        }
        
        set({ currentRaid: raid });
        
        if (import.meta.env.DEV && raid) {
            console.log('[SET RAID] Setting currentRaid:', raid.id, 'state:', raid.state.tag, 'previous:', previousRaid?.state.tag);
        }
        
        // Clear raid players when raid is cleared or changes to a different raid
        if (!raid) {

            set({ raidPlayers: [] });
        } else if (previousRaid && raid.id !== previousRaid.id) {

            set({ raidPlayers: [] });
        }
    },
    
    updateRaidPlayers: (players: RaidPlayer[]) => {
        set({ raidPlayers: players });
    },
    
    setProblem: (problem: Problem | null) => {
        // Simple setter - logging happens in onInsert after deduplication
        set({ currentProblem: problem });
    },
    
    // Advance to next problem in prefetched queue (instant, no server wait)
    advanceToNextProblem: () => {
        const { problems, currentProblemSequence } = get();
        const nextSequence = currentProblemSequence + 1;
        const nextProblem = problems.find(p => p.sequence === nextSequence);
        
        if (nextProblem) {
            if (import.meta.env.DEV) {
                console.log(`[PROBLEM] Advancing to P${nextSequence}: ${nextProblem.leftOperand}×${nextProblem.rightOperand}`);
            }
            set({ 
                currentProblem: nextProblem, 
                currentProblemSequence: nextSequence 
            });
        } else {
            if (import.meta.env.DEV) {
                console.log(`[PROBLEM] No more problems in queue (sequence ${nextSequence})`);
            }
        }
    },
    
    setConnectionError: (error: string | null) => {
        set({ connectionError: error });
    },
    
    setTokenGetter: (getter: () => string | undefined) => {
        set({ tokenGetter: getter });
    },
    
    // Computed getter for game phase - always derived from state
    // NOTE: Zustand getters don't trigger re-renders automatically
    // Components should compute this directly from state instead
    get gamePhase() {
        const { currentPlayer, currentRaid, currentProblem } = get();
        return determineGamePhase(currentPlayer, currentRaid, currentProblem);
    },
    
    // Computed getters for backward compatibility (derive from state machine)
    get connection(): DbConnection | null {
        const state = get().connectionState;
        return state.tag === 'connected' ? state.conn : null;
    },
    get connecting(): boolean {
        return get().connectionState.tag === 'connecting';
    },
    get connected(): boolean {
        return get().connectionState.tag === 'connected';
    },
    
    // Mastery count for rank calculations
    get masteredFactsCount() {
        const masteries = get().factMasteries;
        const mastered = masteries.filter(m => m.masteryLevel >= 5);
        if (import.meta.env.DEV) {
            console.log('[MASTERY] Total masteries:', masteries.length, 
                        'Level 5+:', mastered.length,
                        'Sample levels:', masteries.slice(0, 5).map(m => 
                          `${m.factKey}:L${m.masteryLevel}`));
        }
        return mastered.length;
    },
}));

// HMR: Reuse existing store instance if available (survives hot reload)
export const useGameStore = (
    typeof window !== 'undefined' && 
    import.meta.hot && 
    window.__GAME_STORE__
) ? window.__GAME_STORE__ : createGameStore();

// HMR: Store the instance on window to survive hot reloads
if (typeof window !== 'undefined') {
    if (import.meta.hot) {
        // In dev, preserve store across HMR
        if (!window.__GAME_STORE__) {
            window.__GAME_STORE__ = useGameStore;
        }
    }
    // Expose for debugging
    (window as any).gameStore = useGameStore;
} 