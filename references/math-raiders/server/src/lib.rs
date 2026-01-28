use spacetimedb::{
    ReducerContext, Identity, Table, Timestamp, ScheduleAt,
    table, reducer, view, SpacetimeType, rand::Rng,
    client_visibility_filter, Filter,
};
use serde_json;
use serde_json::{json, Value};

// Import generated math facts
mod math_facts;
use math_facts::{get_facts_for_grade, get_facts_for_grade_and_track, parse_fact_key};

// Import bulk restore reducers for disaster recovery
mod restore;

// ==================== CONSTANTS ====================

/// Maximum players per raid (supports up to 10-player squads)
const MAX_PLAYERS_PER_RAID: usize = 10;

/// Duration of 3-2-1-GO countdown before raid starts (seconds)
const COUNTDOWN_DURATION_SECS: u64 = 4;

/// Quick Play HP multiplier: HP = avg_dpm × this
/// With 2:30 timer: 2.0 = 30s buffer (87% wins), 2.25 = 15s buffer (~70% wins)
const ADAPTIVE_HP_MULTIPLIER: f32 = 2.25;

/// TimeBack IDs of players who should NOT receive XP
/// (e.g., already completed Fast Math - would be XP mining)
const TIMEBACK_XP_BLOCKLIST: &[&str] = &[
    "cce6f8d6-216f-45fb-9211-96153e9b9d66",  // Atticus Gieskes - completed Fast Math
];

/// Grade-based automaticity thresholds (Alpha School CQPM standards)
/// Returns threshold in milliseconds for given grade
fn get_fast_threshold_ms(grade: u8) -> u32 {
    match grade {
        0 => 3000,      // K: 20 CQPM (3.0s per problem)
        1..=3 => 2000,  // G1-3: 30 CQPM (2.0s per problem)
        4 => 1700,      // G4: 35 CQPM (1.7s per problem)
        _ => 1500,      // G5+: 40 CQPM (1.5s per problem)
    }
}

/// Goal boss for Track Master certification at a grade
/// Beating this boss 3× proves grade-level fluency
fn get_grade_goal_boss(grade: u8) -> u8 {
    match grade {
        0 => 4,      // K → Boss 4 (Boomer, 20 CQPM)
        1..=3 => 6,  // G1-3 → Boss 6 (Titan, 30 CQPM)
        4 => 7,      // G4 → Boss 7 (Captain Nova, 35 CQPM)
        _ => 8,      // G5+ → Boss 8 (Void Emperor, 40 CQPM)
    }
}

// ==================== HELPER FUNCTIONS ====================

// -------------------- Boss Level Encoding --------------------
// Boss level uses a simple encoding to support adaptive difficulty with visual selection:
//   0       = Adaptive HP, random visual (legacy, equivalent to 100)
//   1-8     = Fixed HP tier (900-6000 HP), fixed visual
//   100     = Adaptive HP, random visual
//   101-108 = Adaptive HP, specific visual (101 = boss 1 visual, etc.)
//
// This avoids a schema migration while letting players pick their favorite boss
// in Quick Play mode. The encoding is centralized here - use these helpers everywhere.

/// Check if boss level uses adaptive HP (personalized to player performance)
fn is_adaptive_boss(boss_level: u8) -> bool {
    boss_level == 0 || boss_level >= 100
}

/// Encode adaptive boss level with specific visual selection
/// visual: 0 = Clank, 1-8 = specific boss visual (7 = Captain Nova, 8 = Void Emperor)
fn encode_adaptive_boss(visual: u8) -> u8 {
    100 + visual.min(8)  // Adaptive + specific visual (capped at 108)
}
// -------------------- End Boss Level Encoding --------------------

/// Get player from session using the sender's identity
/// This abstracts the session lookup pattern used throughout reducers
fn get_player(ctx: &ReducerContext) -> Result<Player, String> {
    let session = ctx.db.session()
        .connection_id()
        .find(&ctx.sender)
        .ok_or("No session found".to_string())?;
    
    ctx.db.player()
        .id()
        .find(&session.player_id)
        .ok_or("Player not found".to_string())
}

/// Parse quest JSON data from player's quests field
fn parse_quests(quests_json: &Option<String>) -> Value {
    quests_json.as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| json!({}))
}

/// Reset all quests that start with the given prefix (e.g., "daily_", "weekly_")
/// Preserves streak quests (anything containing "streak")
fn reset_quests_by_prefix(player: &mut Player, prefix: &str) {
    let mut quests = parse_quests(&player.quests);
    if let Some(obj) = quests.as_object_mut() {
        for (key, value) in obj.iter_mut() {
            if key.starts_with(prefix) && !key.contains("streak") {
                *value = json!(0);
            }
        }
    }
    player.quests = Some(quests.to_string());
}

/// Increment a quest counter and return the new value
fn increment_quest(player: &mut Player, quest_name: &str) -> u64 {
    let mut quests = parse_quests(&player.quests);
    let current = quests[quest_name].as_u64().unwrap_or(0);
    quests[quest_name] = json!(current + 1);
    player.quests = Some(quests.to_string());
    current + 1
}

/// Quest time targets (in seconds)
const DAILY_TIME_TARGET_SECS: u32 = 10 * 60;   // 10 minutes
const WEEKLY_TIME_TARGET_SECS: u32 = 50 * 60;  // 50 minutes
const DAILY_QUEST_REWARD: u32 = 400;
const WEEKLY_QUEST_REWARD: u32 = 1500;

/// Get today's start timestamp (midnight PST = 8am UTC)
fn get_today_start(current: Timestamp) -> u64 {
    const RESET_HOUR_UTC: u64 = 8;
    let hour_in_micros = 60 * 60 * 1_000_000u64;
    let day_in_micros = 24 * hour_in_micros;
    let offset_micros = RESET_HOUR_UTC * hour_in_micros;
    
    let current_micros = current.to_micros_since_unix_epoch() as u64;
    let current_offset = current_micros.saturating_sub(offset_micros);
    let current_day = current_offset / day_in_micros;
    
    // Convert back to absolute timestamp
    current_day * day_in_micros + offset_micros
}

/// Get this week's start timestamp (Monday midnight PST)
fn get_week_start(current: Timestamp) -> u64 {
    const RESET_HOUR_UTC: u64 = 8;
    let hour_in_micros = 60 * 60 * 1_000_000u64;
    let day_in_micros = 24 * hour_in_micros;
    let week_in_micros = 7 * day_in_micros;
    
    // Unix epoch was Thursday, Monday = 4 days offset
    let days_offset = 4u64;
    let total_offset_micros = (days_offset * 24 + RESET_HOUR_UTC) * hour_in_micros;
    
    let current_micros = current.to_micros_since_unix_epoch() as u64;
    let current_offset = current_micros.saturating_sub(total_offset_micros);
    let current_week = current_offset / week_in_micros;
    
    current_week * week_in_micros + total_offset_micros
}

/// Calculate total play time from performance snapshots for a player since a given timestamp
fn calculate_play_time_since(ctx: &ReducerContext, player_id: &str, since_micros: u64) -> u32 {
    ctx.db.performance_snapshot()
        .player_id()
        .filter(&player_id.to_string())
        .filter(|s| s.timestamp.to_micros_since_unix_epoch() as u64 >= since_micros)
        .map(|s| s.session_seconds)
        .sum()
}

/// Check and award time-based quest rewards
/// Returns (daily_awarded, weekly_awarded) AP amounts
fn check_and_award_time_quests(ctx: &ReducerContext, player: &mut Player, current: Timestamp) -> (u32, u32) {
    let today_start = get_today_start(current);
    let week_start = get_week_start(current);
    
    // Calculate total time played today and this week
    let daily_time = calculate_play_time_since(ctx, &player.id, today_start);
    let weekly_time = calculate_play_time_since(ctx, &player.id, week_start);
    
    let mut quests = parse_quests(&player.quests);
    let mut daily_awarded = 0u32;
    let mut weekly_awarded = 0u32;
    
    // Generate date keys for tracking awards (YYYYMMDD format)
    let today_key = format!("daily_time_awarded_{}", today_start / 1_000_000); // Rough date identifier
    let week_key = format!("weekly_time_awarded_{}", week_start / 1_000_000);
    
    // Check daily quest
    if daily_time >= DAILY_TIME_TARGET_SECS && !quests[&today_key].as_bool().unwrap_or(false) {
        player.total_ap = player.total_ap.saturating_add(DAILY_QUEST_REWARD);
        quests[today_key] = json!(true);
        daily_awarded = DAILY_QUEST_REWARD;
        log::info!("[QUEST] daily complete player:{} time:{}s ap:{}", player.name, daily_time, DAILY_QUEST_REWARD);
    }
    
    // Check weekly quest
    if weekly_time >= WEEKLY_TIME_TARGET_SECS && !quests[&week_key].as_bool().unwrap_or(false) {
        player.total_ap = player.total_ap.saturating_add(WEEKLY_QUEST_REWARD);
        quests[week_key] = json!(true);
        weekly_awarded = WEEKLY_QUEST_REWARD;
        log::info!("[QUEST] weekly complete player:{} time:{}s ap:{}", player.name, weekly_time, WEEKLY_QUEST_REWARD);
    }
    
    player.quests = Some(quests.to_string());
    (daily_awarded, weekly_awarded)
}

/// Helper: Find raid_player for a given player in a given raid
fn find_raid_player(ctx: &ReducerContext, player_id: &String, raid_id: u64) -> Option<RaidPlayer> {
    ctx.db.raid_player()
        .iter()
        .find(|rp| &rp.player_id == player_id && rp.raid_id == raid_id)
}

/// Helper: Update raid_player by ID
fn update_raid_player(ctx: &ReducerContext, raid_player: RaidPlayer) {
    ctx.db.raid_player().id().update(raid_player);
}

/// Completely remove a player from a raid and clean up ALL related data
/// This is the idiomatic way to ensure no stale data can put them back in
fn cleanup_player_raid_data(ctx: &ReducerContext, player_id: &String, raid_id: u64) {
    // Cleanup logs demoted to debug - not needed for normal ops
    
    // Check if player was leader BEFORE marking inactive
    let was_leader = find_raid_player(ctx, player_id, raid_id)
        .map(|rp| rp.is_leader)
        .unwrap_or(false);
    
    // Mark player as inactive instead of deleting row
    // This preserves damage/stats for results screen while removing from active player lists
    if let Some(mut rp) = find_raid_player(ctx, player_id, raid_id) {
        rp.is_active = false;
        update_raid_player(ctx, rp);
    }
    
    // If they were leader in a matchmaking or rematch raid, assign new leader
    if was_leader {
        if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
            if matches!(raid.state, RaidState::Matchmaking | RaidState::Rematch) {
                // Make the first remaining active player the leader
                if let Some(mut new_leader) = ctx.db.raid_player()
                    .raid_id()
                    .filter(&raid_id)
                    .find(|rp| rp.is_active && &rp.player_id != player_id)
                {
                    let new_leader_id = new_leader.player_id.clone();
                    new_leader.is_leader = true;
                    update_raid_player(ctx, new_leader);
                    log::info!("[RAID] leadership transferred raid:{} to:{}", raid_id, &new_leader_id[..8.min(new_leader_id.len())]);
                }
            }
        }
    }
    
    // 2. Clean up all unanswered problems
    let problems_to_clean: Vec<_> = ctx.db.problem()
        .iter()
        .filter(|p| &p.player_id == player_id && p.raid_id == raid_id)
        .filter(|p| {
            // Only clean up unanswered problems
            ctx.db.player_answer()
                .iter()
                .find(|a| a.problem_id == p.id && &a.player_id == player_id)
                .is_none()
        })
        .collect();
        
    for problem in problems_to_clean {
        // Debug: not needed in production
        ctx.db.problem().id().delete(&problem.id);
    }
    
    // 3. Clear player's in_raid_id
    if let Some(mut player) = ctx.db.player().id().find(player_id) {
        if player.in_raid_id == Some(raid_id) {
            player.in_raid_id = None;
            ctx.db.player().id().update(player);
        }
    }
    
    // Debug: raid cleanup complete - not needed in production
}

// ==================== TABLES ====================

/// Session links ephemeral connection to stable player
/// PRIVATE: Links connection identity to player ID (no PII)
#[table(name = session)]
pub struct Session {
    #[primary_key]
    pub connection_id: Identity,
    
    /// Stable player ID (Playcademy ID or device ID) - verified by gateway
    pub player_id: String,
    
    /// When this session was created
    pub connected_at: Timestamp,
}

/// Player profile with automaticity tracking
/// PRIVATE: Clients access via my_player view for RLS
#[table(name = player)]
#[derive(Clone)]
pub struct Player {
    #[primary_key]
    pub id: String,
    
    /// Display name (emoji avatar for MVP)
    pub name: String,
    
    /// Grade level (0=K, 1-5)
    pub grade: u8,
    
    /// Current rank based on mastery percentage
    /// None = unranked, Some("bronze"|"silver"|"gold"|"diamond"|"legendary")
    pub rank: Option<String>,
    
    /// Total problems attempted
    pub total_problems: u32,
    
    /// Total correct answers
    pub total_correct: u32,
    
    /// Average response time in milliseconds
    pub avg_response_ms: u32,
    
    /// Best response time ever
    pub best_response_ms: u32,
    

    
    /// Total raids completed (victory or defeat)
    pub total_raids: u32,
    
    /// Quest progress stored as JSON
    /// Example: {"daily_raid_count": 2, "daily_streak": 3, "daily_time_awarded_XXX": true}
    pub quests: Option<String>,
    
    /// Last play timestamp for daily/weekly quest resets
    pub last_played: Timestamp,
    
    /// Last raid completion timestamp for streak validation
    /// Separate from last_played because streak requires raiding, not just logging in
    pub last_raid: Timestamp,
    
    /// Last weekly reset timestamp
    pub last_weekly_reset: Timestamp,
    
    /// Total Account Points earned
    pub total_ap: u32,
    
    /// Currently in a raid
    pub in_raid_id: Option<u64>,
    
    /// TimeBack user ID for learning analytics
    pub timeback_id: Option<String>,
    
    /// Email for TimeBack events (required by API)
    pub email: Option<String>,
}

// ==================== VIEWS ====================

/// View: Returns only the current user's player data
/// This is the secure way for clients to access their own player
/// Fixed in SpacetimeDB 1.10 - clients now use: SELECT * FROM my_player
#[view(name = my_player, public)]
fn my_player(ctx: &spacetimedb::ViewContext) -> Option<Player> {
    // Find session for this identity
    let session = ctx.db.session().connection_id().find(ctx.sender)?;
    // Return player data for this session
    ctx.db.player().id().find(&session.player_id)
}

/// TimeBack event queue - reliable delivery of XP events to TimeBack API
/// SECURITY: Public table with RLS protection - only authorized workers can see rows
#[table(name = timeback_event_queue, public)]
pub struct TimebackEventQueue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Player who earned the XP
    #[index(btree)]
    pub player_id: String,
    
    /// JSON: {timebackId, email, resourceId, raidEndTime, raidDurationMinutes, xpEarned}
    pub payload: String,
    
    /// Created timestamp for FIFO processing
    #[index(btree)]
    pub created_at: Timestamp,
    
    /// Has this been sent successfully?
    #[index(btree)]
    pub sent: bool,
    
    /// Send attempt count (max 5)
    pub attempts: u8,
    
    /// When to retry (NULL = now)
    #[index(btree)]
    pub next_retry_at: Option<Timestamp>,
    
    /// Last error if failed
    pub last_error: Option<String>,
    
    /// When successfully sent
    pub sent_at: Option<Timestamp>,
}

/// Authorized identities that can access protected tables and admin reducers
/// Used for RLS filtering and reducer authorization checks
#[table(name = authorized_worker)]
pub struct AuthorizedWorker {
    #[primary_key]
    pub identity: Identity,
}

/// Active raid session
#[table(name = raid, public)]
pub struct Raid {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Current boss HP
    pub boss_hp: u32,
    
    /// Max boss HP for UI display
    pub boss_max_hp: u32,
    
    /// Raid state
    pub state: RaidState,
    
    /// Room code for private multiplayer rooms (None for solo)
    pub room_code: Option<String>,
    
    /// Start timestamp
    pub started_at: Timestamp,
    
    /// When raid was paused (Some = when pause started, None = not paused)
    /// Only used for calculating pause duration - state enum is authoritative
    #[default(None::<Timestamp>)]
    pub pause_started_at: Option<Timestamp>,
    
    /// Duration in seconds (set when raid completes)
    pub duration_seconds: Option<u32>,
    
    /// Problems issued so far
    pub problems_issued: u32,
    
    /// Max problems for this raid
    pub max_problems: u32,
    
    /// Boss difficulty level (0 = Adaptive, 1-7 = Fixed HP tiers)
    #[default(0u8)]
    pub boss_level: u8,
    
    /// When countdown started (for client sync during 3-2-1-GO)
    /// None for legacy raids or after countdown completes
    #[default(None::<Timestamp>)]
    pub countdown_started_at: Option<Timestamp>,
}

#[derive(SpacetimeType, Debug, Clone, PartialEq)]
pub enum RaidState {
    Matchmaking,  // Pre-raid: forming group
    InProgress,   // Active raid (running)
    Paused,       // All players disconnected (solo DC'd OR last player in multi DC'd)
    Victory,      // Boss defeated
    Failed,       // Timeout/defeat
    Rematch,      // Post-raid: group rematching
    Countdown,    // 3-2-1-GO before raid starts (added at end for migration safety)
}

/// Players in a raid
/// Note: No unique constraint on player_id - players can be in multiple raid_player rows
/// (from different raids). Reducers manually check for duplicates within the same raid.
#[table(name = raid_player, public)]
#[derive(Clone)]
pub struct RaidPlayer {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    #[index(btree)]
    pub player_id: String,
    
    #[index(btree)]
    pub raid_id: u64,
    
    /// Player name (denormalized for efficient queries)
    pub player_name: String,
    
    /// Player grade (denormalized for matchmaking display)
    pub grade: u8,
    
    /// Player rank (denormalized for matchmaking display)
    pub rank: Option<String>,
    
    /// Player division (denormalized for matchmaking display)
    pub division: Option<String>,
    
    /// Connection status: true = active, false = disconnected/left
    /// Set to false on disconnect or explicit leave
    /// Results screen shows all players; modal shows only active players
    pub is_active: bool,
    
    /// Damage dealt in this raid
    pub damage_dealt: u32,
    
    /// Problems answered
    pub problems_answered: u32,
    
    /// Correct answers
    pub correct_answers: u32,
    
    /// Fastest answer time this raid
    pub fastest_answer_ms: u32,
    
    /// Is this player ready to start
    pub is_ready: bool,
    
    /// Is this the raid leader
    pub is_leader: bool,
    
    /// Recent problems shown to this player (last 10, comma-separated)
    /// Format: "7x8,3x4,5x6" - used to prevent repeats
    pub recent_problems: String,
    
    /// Pre-calculated chest bonus (None = not calculated yet or already claimed)
    pub pending_chest_bonus: Option<u32>,
    
    /// Track selected for this raid (None = all facts for grade, "ALL" = explicit all selection)
    pub track: Option<String>,
}

/// Math problem presented to players
#[table(
    name = problem, 
    public,
    index(name = idx_raid_player, btree(columns = [raid_id, player_id]))
)]
pub struct Problem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Which raid this problem belongs to
    #[index(btree)]
    pub raid_id: u64,
    
    /// Which player this problem is for
    #[index(btree)]
    pub player_id: String,
    
    /// Left operand
    pub left_operand: u8,
    
    /// Right operand  
    pub right_operand: u8,
    
    /// Operation (for now just multiplication)
    pub operation: Operation,
    
    /// Correct answer
    pub answer: u16,
    
    /// When this problem was shown
    pub issued_at: Timestamp,
    
    /// Problem sequence number in raid
    pub sequence: u32,
}

#[derive(SpacetimeType, Debug, Clone, PartialEq)]
pub enum Operation {
    Add,
    Subtract,
    Multiply,
    Divide,
}

impl Operation {
    /// Compute the result of applying this operation to two operands
    pub fn compute(&self, left: u8, right: u8) -> i16 {
        match self {
            Operation::Add => (left as i16) + (right as i16),
            Operation::Subtract => (left as i16) - (right as i16),
            Operation::Multiply => (left as i16) * (right as i16),
            Operation::Divide => {
                // For division, we ensure no division by zero
                // This should be handled by fact generation, but let's be safe
                if right == 0 {
                    0
                } else {
                    (left as i16) / (right as i16)
                }
            }
        }
    }
    
    /// Get the display symbol for this operation
    pub fn symbol(&self) -> &'static str {
        match self {
            Operation::Add => "+",
            Operation::Subtract => "-",
            Operation::Multiply => "×",
            Operation::Divide => "÷",
        }
    }
}

/// Single attempt record for fact mastery tracking
#[derive(SpacetimeType, Clone, Debug)]
pub struct AttemptRecord {
    /// Response time in milliseconds
    pub time_ms: u32,
    /// Whether answer was correct
    pub correct: bool,
    /// When this attempt occurred
    pub timestamp: Timestamp,
}

/// Player's answer to a problem
#[table(name = player_answer, public)]  // Client needs to subscribe
pub struct PlayerAnswer {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    #[index(btree)]
    pub problem_id: u64,
    
    #[index(btree)]
    pub player_id: String,
    
    /// Response time in milliseconds
    pub response_ms: u32,
    
    /// Whether answer was correct
    pub is_correct: bool,
    
    /// Damage dealt (0 if incorrect)
    pub damage: u32,
}

/// Track player performance on specific multiplication facts for automaticity training
#[table(name = fact_mastery, public)]  // Needs public for client subscriptions
pub struct FactMastery {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Player this record belongs to
    #[index(btree)]
    pub player_id: String,
    
    /// Normalized fact key (e.g., "3x7" where first number is always smaller)
    #[index(btree)]
    pub fact_key: String,
    
    /// Total attempts on this fact (all time)
    pub total_attempts: u32,
    
    /// Total correct attempts (all time)
    pub total_correct: u32,
    
    /// Last time this fact was practiced
    pub last_seen: Timestamp,
    
    /// Average response time for correct answers (milliseconds)
    pub avg_response_ms: u32,
    
    /// Fastest correct response ever (milliseconds)
    pub fastest_ms: u32,
    
    /// Recent attempt history (up to 100 attempts)
    /// Used to calculate mastery_level based on current grade
    pub recent_attempts: Vec<AttemptRecord>,
    
    /// Mastery level (0-5) - server-maintained cache
    /// CACHE INVALIDATION:
    /// - Every answer: recalculated immediately using current player grade
    /// - Grade change: batch recalculation via set_grade reducer for all player facts
    /// - Always consistent: SpacetimeDB transactions ensure atomicity
    /// DERIVED FROM: Last 3 recent_attempts + player.grade + fast_threshold
    pub mastery_level: u8,
}

/// Schedule table for cleanup tasks
#[table(name = cleanup_schedule, scheduled(cleanup_abandoned_raids))]
pub struct CleanupSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// When to run the cleanup
    pub scheduled_at: ScheduleAt,
}

/// Schedule table for raid timeouts (2:30 for adaptive, 2:00 for fixed boss levels, 3:00 safety net)
#[table(name = raid_timeout_schedule, scheduled(check_raid_timeout))]
pub struct RaidTimeoutSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Which raid this timeout is for
    pub raid_id: u64,
    
    /// When to check for timeout
    pub scheduled_at: ScheduleAt,
}

/// Schedule table for countdown completion (3-2-1-GO before raid starts)
/// After countdown completes, raid transitions to InProgress and problems are issued
#[table(name = countdown_schedule, public, scheduled(countdown_complete))]
pub struct CountdownSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Which raid this countdown is for
    pub raid_id: u64,
    
    /// When countdown finishes (4 seconds after start for 3-2-1-GO display)
    pub scheduled_at: ScheduleAt,
}

/// Leaderboard rankings for each grade
#[table(name = leaderboard_entry, public)]
pub struct LeaderboardEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Grade level for this leaderboard (0=K, 1-5)
    #[index(btree)]
    pub grade: u8,
    
    /// Position in grade (1-based ranking)
    pub position: u32,
    
    /// Player ID
    pub player_id: String,
    
    /// Player name (denormalized for display)
    pub player_name: String,
    
    /// Current rank
    pub rank: String,
    
    /// Division within rank (I-IV, or empty for legendary)
    pub division: String,
    
    /// Mastery percentage (0-100)
    pub mastery_percent: u32,
    
    /// Speed percentage based on recent fast answers (0-100)
    pub speed_percent: u32,
}

/// Performance tracking for CQPM analytics
#[table(name = performance_snapshot, public)]  // Client needs to subscribe
pub struct PerformanceSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Player this snapshot belongs to
    #[index(btree)]
    pub player_id: String,
    
    /// When this snapshot was recorded
    pub timestamp: Timestamp,
    
    /// Player's grade at time of snapshot (0=K, 1-5)
    pub grade: u8,
    
    /// Track practiced during this session (None = all facts for grade, Some("ALL") = explicit all)
    pub track: Option<String>,
    
    /// Player's rank at time of snapshot
    pub rank: Option<String>,
    
    /// Player's division within rank at time of snapshot (I, II, III, IV)
    pub division: Option<String>,
    
    /// Number of facts mastered (Level 5) at time of snapshot
    pub facts_mastered_at_snapshot: u32,
    
    /// Problems attempted in this session
    pub problems_attempted: u32,
    
    /// Problems answered correctly
    pub problems_correct: u32,
    
    /// Session duration in seconds
    pub session_seconds: u32,
    
    /// Total damage dealt during this session
    pub damage_dealt: u32,
    
    /// Raid type: Some("solo") or Some("multiplayer"), None for pre-1.6 data
    #[default(None::<String>)]
    pub raid_type: Option<String>,
    
    /// Commutative units for TimeBack (5×6 and 6×5 count as 2)
    #[default(0u32)]
    pub timeback_units_at_snapshot: u32,
    
    /// Boss difficulty level (0 = Adaptive, 1-7 = Fixed HP tiers)
    #[default(0u8)]
    pub boss_level: u8,
    
    /// Whether this raid was won (None = pre-tracking data, unknown)
    #[default(None::<bool>)]
    pub victory: Option<bool>,
}

// ==================== BOSS LEVEL SYSTEM ====================

/// Boss HP values - validated ladder based on CQPM (Correct Questions Per Minute)
/// 
/// ## The Model (Nov 2025, 352 pilot student raids)
/// 
/// Formula: HP = CQPM × 150 (validated against Seth, Renee, De'Marcus, Finn)
/// 
/// At these HP values:
///   - Students AT target CQPM win ~33% of the time (good days only)
///   - Students BELOW target win ~0% (properly gated out)
///   - Clean separation confirmed at 20 CQPM and 30 CQPM benchmarks
/// 
/// ## What Beating The Boss Means
/// 
///   - Beat once = "First Clear" celebration, you hit grade level on a good day
///   - Beat 3× = "Track Master" badge, proven fluency, go take the test
/// 
/// ## Grade Benchmarks (AlphaMath Fluency targets)
/// 
/// - K:    20 CQPM → Level 4 (3,000 HP) - validated with Renee/De'Marcus/Finn
/// - G1-3: 30 CQPM → Level 6 (4,500 HP) - validated with Seth
/// - G4:   35 CQPM → Level 7 (5,250 HP) - extrapolated
/// - G5:   40 CQPM → Level 8 (6,000 HP) - extrapolated
/// 
/// ## Why 33% Win Rate?
/// 
/// Students beat the boss only on "good days" (above-average performance).
/// This means when they beat it, they've demonstrated they CAN hit the target.
/// The 3× requirement for Track Master filters out lucky peaks.
/// 
/// Timeout: Fixed levels use exactly 2:00 (120s) to match the HP model
const BOSS_HP_VALUES: [u32; 9] = [
    0,    // Level 0: Adaptive (uses player's recent performance)
    900,  // Level 1:  5 CQPM - Gloop Jr. (Slime)
    1750, // Level 2: 10 CQPM - Whisper (Ghost)
    2600, // Level 3: 15 CQPM - Bonehead (Skull)
    3500, // Level 4: 20 CQPM - Boomer (Bomb) - K goal ⭐
    4200, // Level 5: 25 CQPM - Frosty (Snowman)
    5000, // Level 6: 30 CQPM - Titan (Mech) - G1-3 goal ⭐
    5500, // Level 7: 35 CQPM - Captain Nova - G4 goal ⭐
    6000, // Level 8: 40 CQPM - Void Emperor - G5 goal ⭐
];

/// Calculate boss HP based on level and player count
fn boss_hp_for_level(level: u8, player_count: u32, adaptive_hp: u32) -> u32 {
    if is_adaptive_boss(level) {
        // Adaptive: use personalized HP calculation
        return adaptive_hp;
    }
    
    // Fixed HP: base value × player count
    let level_idx = level as usize;
    if level_idx >= BOSS_HP_VALUES.len() {
        return adaptive_hp;  // Invalid level, fallback to adaptive
    }
    BOSS_HP_VALUES[level_idx] * player_count
}

/// Raid timeout duration based on boss level
fn raid_timeout_seconds(boss_level: u8) -> u64 {
    if is_adaptive_boss(boss_level) {
        150  // Adaptive: 2:30 (personalized, more forgiving)
    } else {
        120  // Fixed tiers: 2:00 exactly (HP model assumes 2 min, variance provides cushion)
    }
}

// ==================== ROW LEVEL SECURITY ====================

/// RLS Filter: Only authorized workers (module owner) can see timeback_event_queue rows
/// This prevents students from seeing sensitive TimeBack event data while still
/// allowing the worker to subscribe and process events
#[client_visibility_filter]
const TIMEBACK_QUEUE_VISIBILITY: Filter = Filter::Sql(
    "SELECT tq.* FROM timeback_event_queue tq 
     JOIN authorized_worker aw WHERE aw.identity = :sender"
);

// ==================== REDUCERS ====================

/// Create a verified session for a client identity
/// This is called by the Bun gateway AFTER verifying the Playcademy JWT
/// Only authorized workers (gateway with owner token) can call this
#[reducer]
pub fn create_session(ctx: &ReducerContext, client_identity: String, player_id: String) {
    // Authorization check: only authorized workers can create sessions
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        panic!("Unauthorized: only gateway can create sessions");
    }
    
    let identity = Identity::from_hex(&client_identity)
        .expect("Invalid identity hex string");
    
    // Delete stale sessions: same player (unclean reconnect) OR same connection_id (prevents PK conflict)
    let stale_sessions: Vec<_> = ctx.db.session()
        .iter()
        .filter(|s| s.player_id == player_id || s.connection_id == identity)
        .map(|s| s.connection_id)
        .collect();
    for conn_id in stale_sessions {
        ctx.db.session().connection_id().delete(&conn_id);
    }
    
    // Create verified session
    ctx.db.session().insert(Session {
        connection_id: identity,
        player_id: player_id.clone(),
        connected_at: ctx.timestamp,
    });
    
    log::info!("[SESSION] created player:{} ws:{}", &player_id[..8.min(player_id.len())], &client_identity[..8.min(client_identity.len())]);
}

/// Player connects to the game
/// The player_id is read from the verified session created by the gateway
/// PII (timeback_id, email) comes from client - can only affect their own record
#[reducer]
pub fn connect(ctx: &ReducerContext, name: String, grade: Option<u8>, timeback_id: Option<String>, email: Option<String>) {
    // Get player_id from verified session (created by gateway)
    // This is the ONLY thing we verify - client can't spoof playerId
    let session = ctx.db.session()
        .connection_id()
        .find(&ctx.sender)
        .expect("Session not found - verify with gateway first");
    
    let player_id = session.player_id.clone();
    // timeback_id and email from client are fine - they can only affect their own record
    
    // Get or create player
    let _player = if let Some(mut existing) = ctx.db.player().id().find(&player_id) {
        // Existing player - update last played and handle resets
        
        // Update last played and reset daily if new day
        if is_new_day(existing.last_played, ctx.timestamp) {
            // Check RAID streak (not login streak) before resetting daily quests
            // Streak requires raiding daily, not just logging in
            let days_since_raid = calculate_days_between(existing.last_raid, ctx.timestamp);
            if days_since_raid > 1 {
                // Didn't raid yesterday - break streak
                let mut quests = parse_quests(&existing.quests);
                let old_streak = quests["daily_streak"].as_u64().unwrap_or(0);
                quests["daily_streak"] = json!(0);
                existing.quests = Some(quests.to_string());
                log::info!("[QUEST] streak broken player:{} lost_streak:{} days_since_raid:{}", 
                    existing.name, old_streak, days_since_raid - 1);
            }
            
            reset_quests_by_prefix(&mut existing, "daily_");
            log::info!("[CONNECT] daily reset for {}", existing.name);
        }
        
        // Reset weekly if new week (Monday reset)
        if is_new_week(existing.last_weekly_reset, ctx.timestamp) {
            reset_quests_by_prefix(&mut existing, "weekly_");
            existing.last_weekly_reset = ctx.timestamp;
            log::info!("[CONNECT] weekly reset for {}", existing.name);
        }
        
        existing.last_played = ctx.timestamp;
        
        // Only update grade if provided (Some = from API, None = API failed, keep existing)
        let old_grade = existing.grade;
        match grade {
            Some(new_grade) if existing.grade != new_grade => {
                log::info!("[CONNECT] grade {} → {} for {}", existing.grade, new_grade, existing.name);
                existing.grade = new_grade.min(5);
            }
            None => {
                // API failed - keeping existing. Worth noting for debugging grade issues.
                log::debug!("[CONNECT] grade API failed, keeping {} for {}", existing.grade, existing.name);
            }
            _ => {} // Grade unchanged, no log needed
        }
        
        // Update identity fields from verified token (track changes for canonical log)
        let old_email = existing.email.clone();
        let old_timeback = existing.timeback_id.clone();
        existing.name = name;
        if timeback_id.is_some() {
            existing.timeback_id = timeback_id.clone();
        }
        if email.is_some() {
            existing.email = email.clone();
        }
        let email_changed = old_email != existing.email;
        let timeback_changed = old_timeback != existing.timeback_id;
        
        // Recalculate grade-dependent data if grade changed
        recalculate_for_grade_change(ctx, &mut existing, old_grade);
        
        // Save updated player (includes grade change effects if any)
        ctx.db.player().id().update(existing.clone());
        
        // Resume paused raid if player was in one
        if let Some(raid_id) = existing.in_raid_id {
            if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
                let state_name = match raid.state {
                    RaidState::Paused => "paused",
                    RaidState::InProgress => "running",
                    RaidState::Victory => "victory",
                    RaidState::Failed => "defeat",
                    RaidState::Rematch => "rematch",
                    RaidState::Matchmaking => "matchmaking",
                    RaidState::Countdown => "countdown",
                };
                
                match raid.state {
                    RaidState::Paused => {
                        if let Some(mut rp) = find_raid_player(ctx, &player_id, raid_id) {
                            rp.is_active = true;
                            update_raid_player(ctx, rp);
                        }
                        if let Err(e) = resume_raid_from_pause(ctx, raid_id) {
                            log::error!("[RAID] resume failed raid:{} error:{}", raid_id, e);
                        }
                    }
                    RaidState::InProgress | RaidState::Victory | RaidState::Failed | RaidState::Rematch => {
                        if let Some(mut rp) = find_raid_player(ctx, &player_id, raid_id) {
                            if !rp.is_active {
                                rp.is_active = true;
                                if raid.state == RaidState::Rematch {
                                    rp.is_ready = false;
                                }
                                update_raid_player(ctx, rp);
                            }
                        }
                    }
                    _ => {}
                }
                
                // One canonical log for reconnect-to-raid
                log::info!("[CONNECT] {} rejoining raid:{} state:{}", existing.name, raid_id, state_name);
            } else {
                log::warn!("[CONNECT] {} had stale raid:{} - cleared", existing.name, raid_id);
                existing.in_raid_id = None;
                ctx.db.player().id().update(existing.clone());
            }
        }
        
        // Wide event: one canonical log with full player context
        let pid = &player_id[..8.min(player_id.len())];
        let has_timeback = existing.timeback_id.is_some();
        let quests = parse_quests(&existing.quests);
        let streak = quests["daily_streak"].as_u64().unwrap_or(0);
        let rank_str = existing.rank.as_deref().unwrap_or("unranked");
        
        if email_changed || timeback_changed {
            log::warn!("[CONNECT] player=\"{}\" player_id={} type=returning grade={} rank={} raids={} streak={} timeback={} identity_change=true", 
                existing.name, pid, existing.grade, rank_str, existing.total_raids, streak, has_timeback);
        } else {
            log::info!("[CONNECT] player=\"{}\" player_id={} type=returning grade={} rank={} raids={} streak={} timeback={}", 
                existing.name, pid, existing.grade, rank_str, existing.total_raids, streak, has_timeback);
        }
        
        existing
    } else {
        // Create new player
        let resolved_grade = grade.unwrap_or(3).min(5);
        let grade_source = if grade.is_some() { "api" } else { "default" };
        let new_player = Player {
            id: player_id.clone(),
            name,
            grade: resolved_grade,
            rank: None, // New players start unranked
            total_problems: 0,
            total_correct: 0,
            avg_response_ms: 0,
            best_response_ms: u32::MAX,
            total_raids: 0,
            quests: Some(json!({
                "daily_raid_count": 0,
                "daily_streak": 0
            }).to_string()),
            last_played: ctx.timestamp,
            last_raid: ctx.timestamp,  // Initialize to now (no existing streak)
            last_weekly_reset: ctx.timestamp,
            total_ap: 0,
            in_raid_id: None,
            timeback_id,  // From client (can only affect their own record)
            email         // From client (can only affect their own record)
        };
        ctx.db.player().insert(new_player.clone());
        
        // Wide event: one canonical log for new player
        let pid = &player_id[..8.min(player_id.len())];
        let has_timeback = new_player.timeback_id.is_some();
        log::info!("[CONNECT] player=\"{}\" player_id={} type=new grade={} rank=unranked raids=0 streak=0 timeback={} grade_source={}", 
            new_player.name, pid, new_player.grade, has_timeback, grade_source);
        
        new_player
    };
}

/// Recalculate grade-dependent data when player's grade changes
/// Called by both set_grade (admin) and connect (Timeback API)
fn recalculate_for_grade_change(ctx: &ReducerContext, player: &mut Player, old_grade: u8) {
    // Early return if grade didn't actually change
    if player.grade == old_grade {
        return;
    }
    
    let player_id = player.id.clone();
    
    // Recalculate ALL fact mastery levels for new grade thresholds
    let mut recalc_count = 0;
    for mut fact in ctx.db.fact_mastery().player_id().filter(&player_id) {
        // mastery_level change tracking removed (was used for verbose logging)
        fact.mastery_level = calculate_mastery_level(&fact, player.grade);
        
        ctx.db.fact_mastery().id().update(fact);
        recalc_count += 1;
    }
    
    // Recalculate rank for new grade's fact pool
    let (mastered_count, total_facts) = get_player_mastery_stats(ctx, &player);
    let new_rank = calculate_player_rank(mastered_count, total_facts);
    player.rank = new_rank.clone();
    
    // Refresh leaderboards for both old and new grades
    refresh_leaderboard(ctx, old_grade);
    if old_grade != player.grade {
        refresh_leaderboard(ctx, player.grade);
    }
    
    // One canonical log for grade change
    log::info!("[GRADE] changed player:{} grade:{}→{} recalc:{} rank:{:?}", 
        &player_id[..8.min(player_id.len())], old_grade, player.grade, recalc_count, new_rank);
}

/// Update player's grade level
/// - Admins can change any player's grade
/// - Non-TimeBack students can self-service their own grade (it's just a difficulty setting)
/// - TimeBack students' grades are locked (synced from AlphaMath enrollment)
/// Set player's TimeBack ID (admin function for fixing Playcademy sync failures)
#[reducer]
pub fn set_timeback_id(ctx: &ReducerContext, player_id: String, timeback_id: String) {
    // Authorization check: only authorized workers can manually set TimeBack IDs
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized set_timeback_id attempt by {}", ctx.sender);
        return;
    }
    
    // Admin-only: Manually fix TimeBack ID when Playcademy integration fails
    if let Some(mut player) = ctx.db.player().id().find(&player_id) {
        player.timeback_id = Some(timeback_id.clone());
        ctx.db.player().id().update(player);
        log::info!("[ADMIN] set_timeback_id player:{} timeback:{}", &player_id[..8.min(player_id.len())], &timeback_id[..8.min(timeback_id.len())]);
    } else {
        log::error!("set_timeback_id: Player {} not found", player_id);
    }
}

/// Update player's grade level
/// - Admins: Can change any player's grade
/// - Non-TimeBack students: Can self-service their own grade (difficulty setting)
/// - TimeBack students: Grade locked (synced from AlphaMath enrollment)
#[reducer]
pub fn set_grade(ctx: &ReducerContext, grade: u8, player_id: Option<String>) {
    let is_admin = ctx.db.authorized_worker().identity().find(&ctx.sender).is_some();
    
    if !is_admin {
        // Self-service mode: verify student can change own grade
        
        // Can't change someone else's grade
        if player_id.is_some() {
            log::warn!("Non-admin attempted to change another player's grade");
        return;
        }
        
        // Get own player
        let player = match get_player(ctx) {
            Ok(p) => p,
            Err(e) => {
                log::error!("set_grade self-service failed: {}", e);
                return;
            }
        };
        
        // TimeBack students can't self-service (grade syncs from AlphaMath enrollment)
        // Treat empty string as no TimeBack (admin may have cleared it)
        let has_timeback = player.timeback_id.as_ref().map_or(false, |id| !id.is_empty());
        if has_timeback {
            log::warn!("TimeBack student {} attempted to self-change grade (rejected)", player.name);
            return;
        }
        
        // OK - non-TimeBack student changing own grade
    }
    
    let mut player = if let Some(id) = player_id {
        // Admin mode: change specified player's grade
        match ctx.db.player().id().find(&id) {
            Some(p) => p,
            None => {
                log::error!("set_grade: player {} not found", id);
                return;
            }
        }
    } else {
        // Self-service mode: change own grade
        match get_player(ctx) {
            Ok(p) => p,
            Err(e) => {
                log::error!("set_grade failed: {}", e);
                return;
            }
        }
    };
    
    let old_grade = player.grade;
    player.grade = grade.min(5); // Cap at grade 5
    
    // Save grade FIRST so leaderboard refresh sees correct grade in DB
    ctx.db.player().id().update(player.clone());
    
    // Recalculate all grade-dependent data (updates rank in memory)
    recalculate_for_grade_change(ctx, &mut player, old_grade);
    
    // Save final player state (with updated rank)
    ctx.db.player().id().update(player);
}

/// Admin: Reset a player's progress (keep identity, wipe stats)
/// Used when sibling plays on wrong account, demo resets, etc.
#[reducer]
pub fn admin_reset_player(ctx: &ReducerContext, player_id: String) {
    // Authorization check: only authorized workers (admin panel with owner token)
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        panic!("Unauthorized: only admin can reset players");
    }
    
    let mut player = match ctx.db.player().id().find(&player_id) {
        Some(p) => p,
        None => {
            log::error!("admin_reset_player: Player {} not found", player_id);
            return;
        }
    };
    
    let player_name = player.name.clone();
    
    // Delete all performance snapshots
    let snapshots: Vec<_> = ctx.db.performance_snapshot()
        .player_id().filter(&player_id)
        .collect();
    let snapshot_count = snapshots.len();
    for ps in snapshots {
        ctx.db.performance_snapshot().id().delete(&ps.id);
    }
    
    // Delete all fact mastery (will repopulate on play)
    let masteries: Vec<_> = ctx.db.fact_mastery()
        .player_id().filter(&player_id)
        .collect();
    let mastery_count = masteries.len();
    for fm in masteries {
        ctx.db.fact_mastery().id().delete(&fm.id);
    }
    
    // Reset player to defaults (keep id, name, grade, timeback_id, email)
    player.rank = None;
    player.total_problems = 0;
    player.total_correct = 0;
    player.avg_response_ms = 0;
    player.best_response_ms = u32::MAX;
    player.total_raids = 0;
    player.total_ap = 0;
    player.quests = Some(json!({
        "daily_raid_count": 0,
        "daily_streak": 0
    }).to_string());
    player.last_played = ctx.timestamp;
    player.last_raid = ctx.timestamp;
    player.last_weekly_reset = ctx.timestamp;
    player.in_raid_id = None;
    
    ctx.db.player().id().update(player);
    
    log::info!("[ADMIN] reset player:{} snapshots:{} masteries:{}", player_name, snapshot_count, mastery_count);
}

// ==================== PAUSE/RESUME HELPERS ====================

/// Count active players in a raid
fn count_active_raid_players(ctx: &ReducerContext, raid_id: u64) -> usize {
    ctx.db.raid_player()
        .raid_id().filter(&raid_id)
        .filter(|rp| rp.is_active)
        .count()
}

/// Mark player as inactive WITHOUT clearing player.in_raid_id
/// This allows resume on reconnect - only cleanup_player_raid_data clears in_raid_id
fn mark_player_inactive_in_raid(ctx: &ReducerContext, player_id: &String, raid_id: u64) {
    if let Some(mut rp) = find_raid_player(ctx, player_id, raid_id) {
        rp.is_active = false;
        update_raid_player(ctx, rp);
    }
}

/// Cancel raid timeout (idempotent)
fn cancel_raid_timeout(ctx: &ReducerContext, raid_id: u64) {
    for schedule in ctx.db.raid_timeout_schedule().iter().filter(|s| s.raid_id == raid_id) {
        ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
    }
}

fn cancel_countdown_schedule(ctx: &ReducerContext, raid_id: u64) {
    for schedule in ctx.db.countdown_schedule().iter().filter(|s| s.raid_id == raid_id) {
        ctx.db.countdown_schedule().id().delete(&schedule.id);
    }
}

/// Pause raid if all players disconnected
/// Only pauses when active_player_count == 0 (solo DC or all multi players DC'd)
fn pause_raid_if_empty(ctx: &ReducerContext, raid_id: u64) -> Result<(), String> {
    let mut raid = ctx.db.raid().id().find(&raid_id)
        .ok_or("Raid not found")?;
    
    if raid.state != RaidState::InProgress {
        return Ok(());  // Only pause active raids
    }
    if count_active_raid_players(ctx, raid_id) > 0 {
        return Ok(());  // Still has active players - DON'T PAUSE (squad continues)
    }
    
    // Transition: InProgress -> Paused
    raid.state = RaidState::Paused;
    raid.pause_started_at = Some(ctx.timestamp);
    cancel_raid_timeout(ctx, raid_id);
    ctx.db.raid().id().update(raid);
    Ok(())
}

/// Resume raid from pause (transitions to InProgress, shifts started_at, reschedules timeout)
fn resume_raid_from_pause(ctx: &ReducerContext, raid_id: u64) -> Result<(), String> {
    let mut raid = ctx.db.raid().id().find(&raid_id)
        .ok_or("Raid not found")?;
    
    if raid.state != RaidState::Paused {
        return Ok(());
    }
    
    let pause_started_at = raid.pause_started_at
        .ok_or("Invalid state: Paused but no pause_started_at")?;
    
    let pause_duration = ctx.timestamp.duration_since(pause_started_at)
        .ok_or("Invalid pause timestamp")?;
    
    // Shift started_at forward by pause duration so existing timer logic still works
    let pause_secs = pause_duration.as_secs();
    let new_started_at = raid.started_at + std::time::Duration::from_secs(pause_secs);
    
    // Validate time remaining (calculate from shifted start time)
    let elapsed = match ctx.timestamp.duration_since(new_started_at) {
        Some(d) => d,
        None => {
            log::error!("Invalid time: raid {} started_at ({:?}) > now ({:?})", 
                raid_id, new_started_at, ctx.timestamp);
            return Err("Invalid timestamp: start time is in the future".to_string());
        }
    };
    // Use correct timeout duration based on boss level
    let total_duration = raid_timeout_seconds(raid.boss_level);
    let time_remaining_secs = total_duration.saturating_sub(elapsed.as_secs());
    
    if time_remaining_secs == 0 {
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
    
    Ok(())
}

/// Clean up session when player disconnects
#[reducer(client_disconnected)]
pub fn on_disconnect(ctx: &ReducerContext) {
    if let Some(session) = ctx.db.session().connection_id().find(&ctx.sender) {
        if let Some(player) = ctx.db.player().id().find(&session.player_id) {
            // Calculate session duration
            let session_duration_secs = ctx.timestamp.duration_since(session.connected_at)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let in_raid = player.in_raid_id.is_some();
            // Canonical log for disconnect with session context
            log::info!("[DISCONNECT] {} player:{} session_min:{:.1} in_raid:{}", 
                player.name, &player.id[..8.min(player.id.len())], 
                session_duration_secs as f32 / 60.0, in_raid);
            if let Some(raid_id) = player.in_raid_id {
                
                // DC from matchmaking leaves queue (prevents limbo state on reconnect)
                if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
                    if raid.state == RaidState::Matchmaking {
                        log::info!("[DISCONNECT] {} left matchmaking raid:{}", player.name, raid_id);
                        cleanup_player_raid_data(ctx, &player.id, raid_id);
                        ctx.db.session().connection_id().delete(&ctx.sender);
                        return;
                    }
                }
                
                // Active raid: mark inactive, preserve in_raid_id for resume
                let was_last_active = count_active_raid_players(ctx, raid_id) == 1;
                mark_player_inactive_in_raid(ctx, &player.id, raid_id);
                
                // Pause if last player left (solo always pauses, multi only if last)
                if was_last_active {
                    if let Err(e) = pause_raid_if_empty(ctx, raid_id) {
                        log::warn!("Failed to pause raid {}: {}", raid_id, e);
                    }
                }
        }
    }
    
        // Delete session (ephemeral connection mapping)
    ctx.db.session().connection_id().delete(&ctx.sender);
    }
}

/// Generate a unique 4-letter room code
fn generate_room_code(ctx: &ReducerContext) -> String {
    use spacetimedb::rand::Rng;
    // Avoid confusing letters (no I, O, 0, 1)
    const CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = ctx.rng();
    (0..4)
        .map(|_| CHARS.chars().nth(rng.gen_range(0..CHARS.len())).unwrap())
        .collect()
}

/// Create a private room with a shareable code
#[reducer]
pub fn create_private_room(ctx: &ReducerContext, track: Option<String>, boss_level: Option<u8>) {
    let level = boss_level.unwrap_or(0); // Default to adaptive
    // Entry log removed - canonical log at end
    
    // Check player exists and not in a raid
    let mut player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_none() => p,
        Ok(p) => {
            log::warn!("Player {} already in raid: {:?}", p.id, p.in_raid_id);
            return;
        },
        Err(e) => {
            log::error!("Player lookup failed: {}", e);
            return;
        }
    };
    
    // Generate unique code
    let mut code = generate_room_code(ctx);
    
    // Ensure uniqueness (unlikely collision but safe)
    while ctx.db.raid()
        .iter()
        .any(|r| r.room_code == Some(code.clone()) && 
                 matches!(r.state, RaidState::Matchmaking)) {
        code = generate_room_code(ctx);
    }
    
    // Create raid with room code
    let raid = ctx.db.raid().insert(Raid {
        id: 0, // Auto-increment
        boss_hp: 1000,  // Placeholder, updated when raid starts
        boss_max_hp: 1000,
        state: RaidState::Matchmaking,
        room_code: Some(code.clone()),
        started_at: ctx.timestamp,
        pause_started_at: None,
        duration_seconds: None,
        problems_issued: 0,
        max_problems: 999,
        boss_level: level,
        countdown_started_at: None, // Not in countdown yet
    });
    
    // Add creator as leader
    // Calculate division for matchmaking display
    let (mastered_count, total_facts) = get_player_mastery_stats(ctx, &player);
    let division = calculate_division(&player.rank, mastered_count, total_facts);
    
    // Check for duplicate (player already in this raid)
    // SpacetimeDB doesn't support multi-column unique constraints, so we check manually
    let already_in_raid = ctx.db.raid_player()
        .iter()
        .any(|rp| rp.player_id == player.id && rp.raid_id == raid.id);
    
    if already_in_raid {
        log::warn!("Player {} already has raid_player row for raid {}", player.id, raid.id);
        return; // Don't insert duplicate
    }
    
    let raid_player = RaidPlayer {
        id: 0, // Auto-inc
        player_id: player.id.clone(),
        raid_id: raid.id,
        player_name: player.name.clone(),
        grade: player.grade,
        rank: player.rank.clone(),
        division: Some(division),
        is_active: true,  // Player is actively in raid
        damage_dealt: 0,
        problems_answered: 0,
        correct_answers: 0,
        fastest_answer_ms: u32::MAX,
        is_ready: false,
        is_leader: true, // Creator is always leader
        recent_problems: String::new(),
        pending_chest_bonus: None,
        track: track.clone(), // Store track selection
    };
    
    ctx.db.raid_player().insert(raid_player);
    
    // Update player
    player.in_raid_id = Some(raid.id);
    let player_name = player.name.clone();
    ctx.db.player().id().update(player);
    
    log::info!("[ROOM] created code:{} player:{}", code, player_name);
    // Room code is now accessible through the raid's room_code field
}

/// Set boss visual for adaptive raids (Quick Play)
/// Leaders can pick which boss to fight while keeping adaptive HP
/// visual: 0 = random, 1-8 = specific boss visual
#[reducer]
pub fn set_boss_visual(ctx: &ReducerContext, visual: u8) {
    // Entry log removed - canonical log at end
    
    // Get player and their raid
    let player = match get_player(ctx) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("set_boss_visual: Player lookup failed: {}", e);
            return;
        }
    };
    
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::warn!("set_boss_visual: Player {} not in a raid", player.id);
            return;
        }
    };
    
    // Get the raid
    let mut raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) => r,
        None => {
            log::warn!("set_boss_visual: Raid {} not found", raid_id);
            return;
        }
    };
    
    // Must be in Matchmaking or Rematch state (both are "waiting to start" states)
    if !matches!(raid.state, RaidState::Matchmaking | RaidState::Rematch) {
        log::warn!("set_boss_visual: Raid {} not in Matchmaking/Rematch state", raid_id);
        return;
    }
    
    // Must be the leader
    let raid_player = ctx.db.raid_player()
        .raid_id()
        .filter(&raid_id)
        .find(|rp| rp.player_id == player.id);
    
    match raid_player {
        Some(rp) if rp.is_leader => {}
        _ => {
            log::warn!("set_boss_visual: Player {} is not the leader of raid {}", player.id, raid_id);
            return;
        }
    }
    
    // Only allow visual selection for adaptive raids (0 or >= 100)
    if !is_adaptive_boss(raid.boss_level) {
        log::warn!("set_boss_visual: Raid {} is not adaptive (boss_level={})", raid_id, raid.boss_level);
        return;
    }
    
    // Validate visual is in valid range (0-8, includes Captain Nova at 7, Void Emperor at 8)
    if visual > 8 {
        log::warn!("set_boss_visual: Invalid visual {} (must be 0-8)", visual);
        return;
    }
    
    // Encode the visual selection
    let new_boss_level = encode_adaptive_boss(visual);
    raid.boss_level = new_boss_level;
    ctx.db.raid().id().update(raid);
    
    log::info!("[RAID] boss visual set raid:{} visual:{}", raid_id, visual);
}

/// Leaders can pick which Mastery Trial boss to fight (fixed HP tiers 1-8)
/// boss_level: 1-8 = specific boss tier with fixed HP
#[reducer]
pub fn set_mastery_boss(ctx: &ReducerContext, boss_level: u8) {
    // Entry log removed - canonical log at end
    
    // Get player and their raid
    let player = match get_player(ctx) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("set_mastery_boss: Player lookup failed: {}", e);
            return;
        }
    };
    
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::warn!("set_mastery_boss: Player {} not in a raid", player.id);
            return;
        }
    };
    
    // Get the raid
    let mut raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) => r,
        None => {
            log::warn!("set_mastery_boss: Raid {} not found", raid_id);
            return;
        }
    };
    
    // Must be in Matchmaking or Rematch state (both are "waiting to start" states)
    if !matches!(raid.state, RaidState::Matchmaking | RaidState::Rematch) {
        log::warn!("set_mastery_boss: Raid {} not in Matchmaking/Rematch state", raid_id);
        return;
    }
    
    // Must be the leader
    let raid_player = ctx.db.raid_player()
        .raid_id()
        .filter(&raid_id)
        .find(|rp| rp.player_id == player.id);
    
    match raid_player {
        Some(rp) if rp.is_leader => {}
        _ => {
            log::warn!("set_mastery_boss: Player {} is not the leader of raid {}", player.id, raid_id);
            return;
        }
    }
    
    // Only allow for fixed HP raids (1-8), not adaptive (0 or >= 100)
    if is_adaptive_boss(raid.boss_level) {
        log::warn!("set_mastery_boss: Raid {} is adaptive (boss_level={}), use set_boss_visual instead", raid_id, raid.boss_level);
        return;
    }
    
    // Validate boss_level is in valid range (1-8)
    if boss_level < 1 || boss_level > 8 {
        log::warn!("set_mastery_boss: Invalid boss_level {} (must be 1-8)", boss_level);
        return;
    }
    
    // Set the boss level directly (no encoding needed for fixed HP)
    raid.boss_level = boss_level;
    ctx.db.raid().id().update(raid);
    
    log::info!("[RAID] boss level set raid:{} level:{}", raid_id, boss_level);
}

/// Join a private room using a code
#[reducer]
pub fn join_private_room(ctx: &ReducerContext, code: String, track: Option<String>) {
    // Entry log removed - canonical log at end
    
    // Validate room code format - must be 4 alphanumeric characters
    const VALID_CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    if code.len() != 4 || !code.chars().all(|c| VALID_CHARS.contains(c)) {
        log::warn!("Invalid room code format: '{}' from {}", code, ctx.sender);
        return;
    }
    
    // Validate player
    let mut player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_none() => p,
        Ok(p) => {
            log::warn!("Player {} already in raid: {:?}", p.id, p.in_raid_id);
            return;
        },
        Err(e) => {
            log::error!("Player lookup failed: {}", e);
            return;
        }
    };
    
    // Find room with code (case insensitive)
    let raid = match ctx.db.raid()
        .iter()
        .find(|r| r.room_code == Some(code.to_uppercase()) && 
                  matches!(r.state, RaidState::Matchmaking)) {
        Some(r) => r,
        None => {
            // Distinguish between different failure reasons for better debugging
            let exists_but_wrong_state = ctx.db.raid()
                .iter()
                .any(|r| r.room_code == Some(code.to_uppercase()));
            
            if exists_but_wrong_state {
                log::warn!("Room {} exists but is not in Matchmaking state", code);
            } else {
                log::warn!("Room code {} does not exist", code);
            }
            return;
        }
    };
    
    // Check room not full (count only active players)
    let active_player_count = ctx.db.raid_player()
        .raid_id()
        .filter(&raid.id)
        .filter(|rp| rp.is_active)
        .count();
        
    if active_player_count >= MAX_PLAYERS_PER_RAID {
        log::warn!("Room {} is full ({}/{} active players)", code, active_player_count, MAX_PLAYERS_PER_RAID);
        return;
    }
    
    // Add player (not leader since joining)
    // Calculate division for matchmaking display
    let (mastered_count, total_facts) = get_player_mastery_stats(ctx, &player);
    let division = calculate_division(&player.rank, mastered_count, total_facts);
    
    // Check if player was previously in this raid (inactive row from refresh/disconnect)
    if let Some(mut existing_rp) = ctx.db.raid_player()
        .iter()
        .find(|rp| rp.player_id == player.id && rp.raid_id == raid.id)
    {
        if !existing_rp.is_active {
            // Reactivate existing row instead of creating new one
            existing_rp.is_active = true;
            existing_rp.is_ready = false;  // Reset ready state
            existing_rp.is_leader = false; // Reset leadership (in case they were leader before)
            update_raid_player(ctx, existing_rp);
            
            // Update player's in_raid_id
            player.in_raid_id = Some(raid.id);
            ctx.db.player().id().update(player);
            
            return;
        } else {
            // Truly duplicate - already active
            log::warn!("Player {} already active in raid {}", player.id, raid.id);
            return;
        }
    }
    
    // No existing row - create new one
    let raid_player = RaidPlayer {
        id: 0,
        player_id: player.id.clone(),
        raid_id: raid.id,
        player_name: player.name.clone(),
        grade: player.grade,
        rank: player.rank.clone(),
        division: Some(division),
        damage_dealt: 0,
        problems_answered: 0,
        correct_answers: 0,
        fastest_answer_ms: u32::MAX,
        is_active: true,
        is_ready: false,
        is_leader: false, // Joiners are not leaders
        recent_problems: String::new(),
        pending_chest_bonus: None,
        track: track.clone(), // Store track selection
    };
    
    ctx.db.raid_player().insert(raid_player);
    
    // Update player
    player.in_raid_id = Some(raid.id);
    let player_name = player.name.clone();
    ctx.db.player().id().update(player);
    
    log::info!("[ROOM] joined code:{} player:{}", code, player_name);
}



/// Start a solo practice raid (single player)
#[reducer]
pub fn start_solo_raid(ctx: &ReducerContext, track: Option<String>, boss_level: Option<u8>) {
    let level = boss_level.unwrap_or(0); // Default to adaptive
    // Entry log removed - canonical log at end
    
    // Player must exist and not be in a raid
    let mut player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_none() => p,
        Ok(p) => {
            log::warn!("Player {} already in raid: {:?}", p.id, p.in_raid_id);
            return;
        },
        Err(e) => {
            log::warn!("Player lookup failed: {}", e);
            return;
        }
    };
    
    // Calculate HP based on boss level or adaptive
    let adaptive_hp = calculate_player_contribution_with_context(&player, Some(ctx), track.as_deref());
    let hp = boss_hp_for_level(level, 1, adaptive_hp);
    
    // Verbose debug log removed - canonical [RAID] solo created log at end
    
    // Create raid in Countdown state (3-2-1-GO before starting)
    // Timeout and problems are scheduled in countdown_complete, not here
    let raid = ctx.db.raid().insert(Raid {
        id: 0, // Auto-increment
        boss_hp: hp,
        boss_max_hp: hp,
        state: RaidState::Countdown, // Start with countdown
        room_code: None, // Solo raids don't have room codes
        started_at: ctx.timestamp, // Will be overwritten in countdown_complete
        pause_started_at: None,
        duration_seconds: None,
        problems_issued: 0,
        max_problems: 999,
        boss_level: level,
        countdown_started_at: Some(ctx.timestamp), // For client sync
    });
    
    // Schedule countdown completion (3-2-1-GO display)
    let countdown_time = ctx.timestamp + std::time::Duration::from_secs(COUNTDOWN_DURATION_SECS);
    ctx.db.countdown_schedule().insert(CountdownSchedule {
        id: 0,
        raid_id: raid.id,
        scheduled_at: ScheduleAt::Time(countdown_time.into()),
    });
    // Add player as the only participant
    // Calculate division for matchmaking display (even though solo, keeps data consistent)
    let (mastered_count, total_facts) = get_player_mastery_stats(ctx, &player);
    let division = calculate_division(&player.rank, mastered_count, total_facts);
    
    // Check for duplicate (shouldn't happen in solo, but defensive programming)
    let already_in_raid = ctx.db.raid_player()
        .iter()
        .any(|rp| rp.player_id == player.id && rp.raid_id == raid.id);
    
    if already_in_raid {
        log::warn!("Player {} already in raid {}", player.id, raid.id);
        return;
    }
    
    ctx.db.raid_player().insert(RaidPlayer {
        id: 0,
        player_id: player.id.clone(),
        raid_id: raid.id,
        player_name: player.name.clone(), // Denormalized for efficient queries
        grade: player.grade,
        rank: player.rank.clone(),
        division: Some(division),
        is_active: true,  // Player is actively in raid
        damage_dealt: 0,
        problems_answered: 0,
        correct_answers: 0,
        fastest_answer_ms: u32::MAX,
        is_ready: true, // Auto-ready for solo
        is_leader: true, // Solo player is always leader
        recent_problems: String::new(),
        pending_chest_bonus: None,
        track: track.clone(), // Store track selection
    });
    
    // Update player
    player.in_raid_id = Some(raid.id);
    let player_id = player.id.clone();
    ctx.db.player().id().update(player);
    
    log::info!("[RAID] solo created raid:{} player:{}", raid.id, &player_id[..8.min(player_id.len())]);
    // Note: Problems are generated in countdown_complete, not here
}

/// Toggle ready state for a player
#[reducer]
pub fn toggle_ready(ctx: &ReducerContext) {
    // Entry log removed - not needed for toggle_ready
    
    // Get raid player entry
    let player = get_player(ctx).ok();
    if let Some(p) = player {
        // Find raid_player for this player's current raid
        if let Some(raid_id) = p.in_raid_id {
            let raid_player = ctx.db.raid_player()
                .iter()
                .find(|rp| rp.player_id == p.id && rp.raid_id == raid_id);
            
            if let Some(mut rp) = raid_player {
                rp.is_ready = !rp.is_ready;
                ctx.db.raid_player().id().update(rp);
                // No log needed - client sees state change via subscription
            }
        }
    }
    // Error case: no log needed - player just doesn't see toggle effect
}

/// Leader starts the raid manually
#[reducer]
pub fn start_raid_manual(ctx: &ReducerContext) {
    // Entry log removed - [RAID] starting log at end
    
    // Find player's raid and verify they're the leader
    let player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_some() => p,
        _ => {
            log::warn!("start_raid_manual: Player not in a raid");
            return;
        }
    };
    
    // Safe to unwrap because we checked is_some() above, but let's be explicit
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::error!("start_raid_manual: Unexpected None in_raid_id");
            return;
        }
    };
    // Check if sender is the leader (only active players)
    let raid_players: Vec<_> = ctx.db.raid_player()
        .raid_id()
        .filter(&raid_id)
        .filter(|rp| rp.is_active)
        .collect();
        
    let is_leader = raid_players.iter()
        .any(|rp| rp.player_id == player.id && rp.is_leader);
    
    if !is_leader {
        log::warn!("Player {} is not the leader of raid {}", player.id, raid_id);
        return; // Only leader can start
    }
    
    // Multiplayer raids require at least 2 players
    // (Use start_solo_raid for single player practice)
    if raid_players.len() < 2 {
        log::warn!("Raid {} only has {} players, need at least 2 for multiplayer", 
            raid_id, raid_players.len());
        return;
    }
    
    // Check if all players are ready
    let all_ready = raid_players.iter().all(|rp| rp.is_ready);
    
    if !all_ready {
        log::warn!("Not all players are ready in raid {}", raid_id);
        return; // All players must be ready
    }
    
    // All checks passed - start_raid will log [RAID] starting
    start_raid(ctx, raid_id);
}

/// Start a raid that has enough players
pub fn start_raid(ctx: &ReducerContext, raid_id: u64) {
    // Double-check that all players are actually ready (safety)
    let raid_players: Vec<_> = ctx.db.raid_player()
        .raid_id()
        .filter(&raid_id)
        .collect();
        
    let active_players: Vec<_> = raid_players.iter()
        .filter(|rp| rp.is_active)
        .cloned()
        .collect();
    
    if !active_players.iter().all(|rp| rp.is_ready) {
        log::error!("[RAID] ✗ start failed raid:{} reason:not_all_ready", raid_id);
        return;
    }
    
    if active_players.len() < 2 {
        log::error!("[RAID] ✗ start failed raid:{} reason:not_enough_players count:{}", raid_id, active_players.len());
        return;
    }
    let mut raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) if matches!(r.state, RaidState::Matchmaking | RaidState::Rematch) => r,
        _ => {
            log::warn!("start_raid called but raid {} is not in Matchmaking/Rematch state", raid_id);
            return;
        }
    };
    // Calculate HP based on boss level or adaptive
    let total_hp = if is_adaptive_boss(raid.boss_level) {
        // Adaptive: sum all players' contributions
        let mut hp = 0u32;
    for rp in &active_players {
        if let Some(player) = ctx.db.player().id().find(&rp.player_id) {
            let contribution = calculate_player_contribution_with_context(&player, Some(ctx), rp.track.as_deref());
                hp = hp.saturating_add(contribution);
        }
    }
        hp.max(300) // Ensure minimum HP for safety
    } else {
        // Fixed tier: HP from lookup table
        boss_hp_for_level(raid.boss_level, active_players.len() as u32, 0)
    };
    
    // Update raid state and HP - start with countdown
    raid.boss_hp = total_hp;
    raid.boss_max_hp = total_hp;
    raid.state = RaidState::Countdown;
    raid.started_at = ctx.timestamp; // Will be overwritten in countdown_complete
    raid.countdown_started_at = Some(ctx.timestamp); // For client sync
    raid.pause_started_at = None;
    
    // Canonical log: one line for raid start with squad info for multiplayer
    let squad_names: Vec<&str> = active_players.iter().map(|rp| rp.player_name.as_str()).collect();
    log::info!("[RAID] starting raid:{} players:{} squad={:?} hp:{} level:{}", 
        raid_id, active_players.len(), squad_names, total_hp, raid.boss_level);
    
    ctx.db.raid().id().update(raid);
    
    // Schedule countdown completion (3-2-1-GO display)
    let countdown_time = ctx.timestamp + std::time::Duration::from_secs(COUNTDOWN_DURATION_SECS);
    ctx.db.countdown_schedule().insert(CountdownSchedule {
        id: 0,
        raid_id,
        scheduled_at: ScheduleAt::Time(countdown_time.into()),
    });
    // Note: Problems are generated in countdown_complete, not here
}

/// Submit an answer to the current problem
#[reducer]
pub fn submit_answer(ctx: &ReducerContext, problem_id: u64, answer_value: u16, response_ms: u32) {
    
    // Get player
    let player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_some() => p,
        _ => {
            log::warn!("submit_answer: Player not in a raid");
            return;
        }
    };
    
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::error!("submit_answer: Unexpected None in_raid_id");
            return;
        }
    };
    
    // Edge case: Check if raid is still in progress
    let raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) if matches!(r.state, RaidState::InProgress) => r,
        _ => {
            log::warn!("submit_answer: Raid {} not in progress", raid_id);
            return;
        }
    };
    
    // Auto-reconnect: If player was marked inactive but is submitting answers, they are back!
    // This fixes the "ghost player" bug where disconnected players could play but were hidden in UI
    if let Some(mut rp) = find_raid_player(ctx, &player.id, raid_id) {
        if !rp.is_active {
            rp.is_active = true;
            update_raid_player(ctx, rp);
        }
    }

    // Safety net: 3-minute hard timeout (scheduler should fire at 2:30 for adaptive or 2:00 for fixed levels)
    let duration_secs = ctx.timestamp.duration_since(raid.started_at).unwrap_or_default().as_secs();
    if duration_secs >= 180 {
        log::warn!("Raid {} exceeded 3-minute safety timeout (scheduler may have failed)", raid_id);
        end_raid(ctx, raid_id, false);
        return;
    }
    
    // Get problem
    let problem = match ctx.db.problem().id().find(&problem_id) {
        Some(p) if p.raid_id == raid_id && p.player_id == player.id => p,
        _ => {
            log::warn!("submit_answer: Problem {} not found or not for this player", problem_id);
            return;
        }
    };

    // Use client timing since problems are batch-prefetched at raid start
    // Client tracks when each problem is displayed, server validates correctness
    // Clamp to reasonable bounds (min 200ms to prevent cheating, max 60s)
    let response_ms = response_ms.clamp(200, 60_000);
    
    // Check if already answered - allow retry ONLY if previous was wrong AND new is correct
    let previous_answer = ctx.db.player_answer()
        .iter()
        .find(|a| a.problem_id == problem.id && a.player_id == player.id);
    
    let is_correct = answer_value == problem.answer;
    let is_retry;  // Track for mastery update decision
    
    if let Some(prev) = previous_answer {
        if prev.is_correct {
            // Already answered correctly - reject duplicate
            log::warn!("Player {} already answered problem {} correctly", player.id, problem.id);
            return;
        }
        // Previous was wrong
        if !is_correct {
            // Still wrong - no point updating, keep original wrong answer
            return;
        }
        // Previous wrong, new correct = successful retry, delete old
        ctx.db.player_answer().id().delete(prev.id);
        is_retry = true;
    } else {
        is_retry = false;
    }
    
    // Calculate damage based on speed and correctness
    // Retries deal 2/3 damage - reward for recovery, but first attempt is always better
    let damage = if is_correct {
        let base = calculate_damage(response_ms, player.grade, ctx);
        if is_retry { base * 2 / 3 } else { base }.min(raid.boss_hp)
    } else { 0 };
    
    // Record answer
    let answer = PlayerAnswer { 
        id: 0, // auto-increment will handle this
        problem_id: problem.id, 
        player_id: player.id.clone(), 
        response_ms, 
        is_correct, 
        damage 
    };
    ctx.db.player_answer().insert(answer);
    
    // Track fact mastery for automaticity training
    // Skip mastery update on retry - the wrong answer already recorded the struggle
    // Retry just gives them damage, doesn't count toward learning
    if !is_retry {
        update_fact_mastery(
            ctx,
            player.id.clone(),
            problem.left_operand,
            problem.right_operand,
            &problem.operation,
            is_correct,
            response_ms,
        );
    }
    
    // Update player stats BEFORE boss death check (so final blow counts)
    update_player_stats(ctx, &player.id, is_correct, response_ms);
    
    // Update raid player stats
    let player_again = get_player(ctx).ok();
    if let Some(p) = player_again {
        if let Some(current_raid_id) = p.in_raid_id {
            let raid_player = ctx.db.raid_player()
                .iter()
                .find(|rp| rp.player_id == p.id && rp.raid_id == current_raid_id);
            
            if let Some(mut rp) = raid_player {
                rp.damage_dealt = rp.damage_dealt.saturating_add(damage);
                // Only count stats on first attempt (retry = helper, not real correct)
                // This ensures Timeback gets honest accuracy
                if !is_retry {
                    rp.problems_answered = rp.problems_answered.saturating_add(1);
                    if is_correct {
                        rp.correct_answers = rp.correct_answers.saturating_add(1);
                    }
                }
                // Fastest answer tracked regardless (could be retry)
                if is_correct && response_ms < rp.fastest_answer_ms {
                    rp.fastest_answer_ms = response_ms;
                }
                ctx.db.raid_player().id().update(rp);
            }
        }
    }
    
    // Apply damage to boss
    if damage > 0 {
        if let Some(mut raid) = ctx.db.raid().id().find(&raid_id) {
            // Edge case: Prevent multiple players from "winning" simultaneously
            if raid.boss_hp == 0 {
                return;
            }
            
            raid.boss_hp = raid.boss_hp.saturating_sub(damage);
            let new_hp = raid.boss_hp;
            ctx.db.raid().id().update(raid);
            
            // Check for victory immediately after damage
            if new_hp == 0 {
                log::info!("Boss defeated! Player {} dealt the final blow", player.id);
                end_raid(ctx, raid_id, true);
                return;
            }
        }
    }
    
    // NOTE: No need to issue next problem - all problems pre-generated at raid start
    // Client displays from local queue instantly
}

/// Request a new problem if player doesn't have one
#[reducer]
pub fn request_problem(ctx: &ReducerContext) {
    // Player must be in an active raid
    let player = match get_player(ctx) {
        Ok(p) if p.in_raid_id.is_some() => p,
        _ => {
            log::warn!("request_problem: Player {} not found or not in raid", ctx.sender);
            return;
        }
    };
    
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::error!("request_problem: Unexpected None in_raid_id for player {}", player.id);
            return;
        }
    };
    
    // Raid must be in progress
    let _raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) if matches!(r.state, RaidState::InProgress) => r,
        Some(r) => {
            log::warn!("request_problem: Raid {} not in progress (state: {:?})", raid_id, r.state);
            return;
        }
        None => {
            log::warn!("request_problem: Raid {} not found", raid_id);
            return;
        }
    };
    
    // Check if player already has an unanswered problem
    let unanswered_problem = ctx.db.problem()
        .iter()
        .filter(|p| p.raid_id == raid_id && p.player_id == player.id)
        .find(|p| {
            // Problem is unanswered if no answer exists for it
            // With composite primary key, we need to check for this specific player's answer
            ctx.db.player_answer()
                .iter()
                .find(|a| a.problem_id == p.id && a.player_id == player.id)
                .is_none()
        });
    
    if unanswered_problem.is_some() {
        return;
    }
    
    // Check if player is active in raid (issue_problem_to_player also checks this, but log here too)
    let player_in_raid = ctx.db.raid_player()
        .iter()
        .any(|rp| rp.raid_id == raid_id && rp.player_id == player.id && rp.is_active);
    
    if !player_in_raid {
        log::warn!("request_problem: Player {} not actively in raid {} (is_active = false)", player.id, raid_id);
        return;
    }
    
    // Only issue new problem if player doesn't have one
    issue_problem_to_player(ctx, raid_id, player.id);
}

/// Number of problems to pre-generate per raid (enough for any raid duration)
/// At 60 problems/min max, 150 covers 2.5 min raid with buffer
const PROBLEMS_PER_RAID: u32 = 150;

/// Generate all problems for a raid at once (batch prefetch)
/// This eliminates per-problem network latency - client displays from local queue
fn generate_problem_batch(ctx: &ReducerContext, raid_id: u64, player_id: &str) {
    let mut raid_player = match ctx.db.raid_player()
        .iter()
        .find(|rp| rp.player_id == player_id && rp.raid_id == raid_id)
    {
        Some(rp) => rp,
        None => {
            log::error!("generate_problem_batch: Player {} not in raid {}", player_id, raid_id);
            return;
        }
    };
    
    for sequence in 0..PROBLEMS_PER_RAID {
        let (left, right, operation) = generate_problem(sequence, ctx, &mut raid_player);
        let answer = operation.compute(left, right) as u16;
        
        let problem = Problem {
            id: 0, // Auto-increment
            raid_id,
            player_id: player_id.to_string(),
            left_operand: left,
            right_operand: right,
            operation,
            answer,
            issued_at: ctx.timestamp,
            sequence,
        };
        ctx.db.problem().insert(problem);
    }
    
    // Update the raid_player with final recent_problems list
    ctx.db.raid_player().id().update(raid_player);
    
}

/// Issue a problem to a specific player
/// DEPRECATED: Use generate_problem_batch for new raids
pub fn issue_problem_to_player(ctx: &ReducerContext, raid_id: u64, player_id: String) {
    let raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) if matches!(r.state, RaidState::InProgress) => r,
        _ => return,
    };
    
    // Edge case: Double-check boss isn't already dead
    if raid.boss_hp == 0 {
        // Don't call end_raid here - it should have been called by submit_answer
        // This prevents duplicate performance snapshots
        return;
    }
    
    // Edge case: Verify player is still actively in the raid
    let player_in_raid = ctx.db.raid_player()
        .iter()
        .any(|rp| rp.raid_id == raid_id && rp.player_id == player_id && rp.is_active);
        
    if !player_in_raid {
        log::warn!("Not issuing problem - player {} not actively in raid {}", player_id, raid_id);
        return;
    }
    
    // IDIOMATIC: Always check for existing unanswered problem to prevent duplicates
    // This prevents race conditions between submit_answer and request_problem
    let unanswered_problem = ctx.db.problem()
        .iter()
        .filter(|p| p.raid_id == raid_id && p.player_id == player_id)
        .find(|p| {
            // Problem is unanswered if no answer exists for it
            // With composite primary key, we need to check for this specific player's answer
            ctx.db.player_answer()
                .iter()
                .find(|a| a.problem_id == p.id && a.player_id == player_id)
                .is_none()
        });
    
    if unanswered_problem.is_some() {
        return;
    }
    
    // Count problems answered by this player
    let player_problem_count = ctx.db.player_answer()
        .iter()
        .filter(|a| {
            if let Some(problem) = ctx.db.problem().id().find(&a.problem_id) {
                problem.raid_id == raid_id && a.player_id == player_id
            } else {
                false
            }
        })
        .count() as u32;
    
    // Generate problem based on this player's progression
    let raid_player = ctx.db.raid_player()
        .iter()
        .find(|rp| rp.player_id == player_id && rp.raid_id == raid_id);
    
    let mut raid_player = match raid_player {
        Some(rp) => rp,
        None => {
            log::error!("issue_problem_to_player: Player {} not in raid {}", player_id, raid_id);
            return;
        }
    };
    
    let (left, right, operation) = generate_problem(player_problem_count, ctx, &mut raid_player);
    
    // Update the raid_player with new recent_problems list
    ctx.db.raid_player().id().update(raid_player);
    
    // Compute answer using the operation's compute method
    let answer = operation.compute(left, right) as u16;
    
    let problem = Problem {
        id: 0, // Auto-increment
        raid_id,
        player_id, // This will be updated by issue_problem_to_player
        left_operand: left,
        right_operand: right,
        operation,
        answer,
        issued_at: ctx.timestamp,
        sequence: player_problem_count,
    };
    ctx.db.problem().insert(problem);
}

/// Leave current raid and return to lobby
/// Note: Players must create/join a new room - auto-matchmaking removed for safety
/// Transition completed raid to Rematch state (shows ready-check modal)
/// Doesn't create new raid yet - just marks intent to rematch
#[reducer]
pub fn raid_again(ctx: &ReducerContext) {
    let player = match get_player(ctx) {
        Ok(p) => p,
        Err(e) => {
            log::error!("raid_again: Could not get player: {}", e);
            return;
        }
    };
    
    // Must be in a completed raid
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::warn!("raid_again: Player {} not in a raid", player.id);
            return;
        }
    };
    
    let mut raid = match ctx.db.raid().id().find(&raid_id) {
        Some(r) => r,
        None => {
            log::error!("raid_again: Raid {} not found", raid_id);
            return;
        }
    };
    
    // Can only raid_again from completed raids
    if !matches!(raid.state, RaidState::Victory | RaidState::Failed) {
        log::warn!("raid_again: Raid {} not completed (state: {:?})", raid_id, raid.state);
        return;
    }
    
    // Transition to Rematch state (triggers modal on client)
    raid.state = RaidState::Rematch;
    ctx.db.raid().id().update(raid);
    
    // Reset all active players' ready states for new ready-check
    for mut rp in ctx.db.raid_player().raid_id().filter(&raid_id) {
        if rp.is_active {
            rp.is_ready = false;
            update_raid_player(ctx, rp);
        }
    }
    
}

/// Start a new raid from Rematch state (creates new raid with same group)
#[reducer]
pub fn start_rematch(ctx: &ReducerContext) {
    let player = match get_player(ctx) {
        Ok(p) => p,
        Err(e) => {
            log::error!("start_rematch: {}", e);
            return;
        }
    };
    
    let old_raid_id = match player.in_raid_id {
        Some(id) => id,
        None => return,
    };
    
    let old_raid = match ctx.db.raid().id().find(&old_raid_id) {
        Some(r) if r.state == RaidState::Rematch => r,
        _ => {
            log::warn!("start_rematch: Raid not in Rematch state");
            return;
        }
    };
    
    // Get active players only
    let old_players: Vec<_> = ctx.db.raid_player()
        .raid_id()
        .filter(&old_raid_id)
        .filter(|rp| rp.is_active)
        .collect();
    
    // Check all active players ready
    if !old_players.iter().all(|rp| rp.is_ready) || old_players.len() < 2 {
        log::warn!("start_rematch: Not all active players ready or not enough players");
        return;
    }
    
    // Preserve boss level from previous raid
    let boss_level = old_raid.boss_level;
    
    // Calculate HP based on boss level or adaptive
    let total_hp = if is_adaptive_boss(boss_level) {
        // Adaptive: sum players' contributions
        let mut hp = 0u32;
    for rp in &old_players {
        if let Some(p) = ctx.db.player().id().find(&rp.player_id) {
                hp = hp.saturating_add(calculate_player_contribution_with_context(&p, Some(ctx), rp.track.as_deref()));
        }
    }
        hp
    } else {
        // Fixed tier: HP from lookup table
        boss_hp_for_level(boss_level, old_players.len() as u32, 0)
    };
    
    // Create new raid in Countdown state
    let new_raid = ctx.db.raid().insert(Raid {
        id: 0,
        boss_hp: total_hp,
        boss_max_hp: total_hp,
        state: RaidState::Countdown,  // Start with countdown
        room_code: old_raid.room_code.clone(),
        started_at: ctx.timestamp, // Will be overwritten in countdown_complete
        pause_started_at: None,
        duration_seconds: None,
        problems_issued: 0,
        max_problems: 999,
        boss_level,
        countdown_started_at: Some(ctx.timestamp), // For client sync
    });
    
    // Schedule countdown completion (3-2-1-GO display)
    let countdown_time = ctx.timestamp + std::time::Duration::from_secs(COUNTDOWN_DURATION_SECS);
    ctx.db.countdown_schedule().insert(CountdownSchedule {
        id: 0,
        raid_id: new_raid.id,
        scheduled_at: ScheduleAt::Time(countdown_time.into()),
    });
    // Mark old raid_players as inactive (preserves stats, logically removes from old raid)
    for old_rp in &old_players {
        if let Some(mut rp) = ctx.db.raid_player().id().find(&old_rp.id) {
            rp.is_active = false;
            update_raid_player(ctx, rp);
        }
    }
    
    // Migrate players to new raid
    for old_rp in &old_players {
        if let Some(mut p) = ctx.db.player().id().find(&old_rp.player_id) {
            p.in_raid_id = Some(new_raid.id);
            ctx.db.player().id().update(p);
        }
        
        ctx.db.raid_player().insert(RaidPlayer {
            id: 0,
            player_id: old_rp.player_id.clone(),
            raid_id: new_raid.id,
            player_name: old_rp.player_name.clone(),
            grade: old_rp.grade,
            rank: old_rp.rank.clone(),
            division: old_rp.division.clone(),
            damage_dealt: 0,
            problems_answered: 0,
            correct_answers: 0,
            fastest_answer_ms: u32::MAX,
            is_active: true,
            is_ready: false,
            is_leader: old_rp.is_leader,
            recent_problems: String::new(),
            pending_chest_bonus: None,
            track: old_rp.track.clone(),
        });
        // Note: Problems are generated in countdown_complete, not here
    }
    
}

/// Atomically leave current raid and start a new solo raid
/// Preserves track selection; optionally override boss level for boss picker
#[reducer]
pub fn solo_again(ctx: &ReducerContext, boss_level: Option<u8>) {
    // Get player
    let player = match get_player(ctx) {
        Ok(p) => p,
        Err(_) => {
            log::warn!("solo_again: Could not get player");
            return;
        }
    };
    
    // Get track and current boss_level from current raid (before leaving)
    let (track, current_boss) = player.in_raid_id.map_or((None, 0), |raid_id| {
        let track = find_raid_player(ctx, &player.id, raid_id).and_then(|rp| rp.track);
        let level = ctx.db.raid().id().find(&raid_id).map(|r| r.boss_level).unwrap_or(0);
        (track, level)
    });
    
    // Use provided boss_level or fall back to current
    let level = boss_level.unwrap_or(current_boss);
    
    // Leave current raid
    leave_raid_internal(ctx);
    
    // Start new raid with same track and selected boss level
    start_solo_raid(ctx, track, Some(level));
}

/// Leave current raid
#[reducer]
pub fn leave_raid(ctx: &ReducerContext) {
    leave_raid_internal(ctx);
}

/// Internal helper to leave raid (used by multiple reducers)
fn leave_raid_internal(ctx: &ReducerContext) {
    if let Ok(player) = get_player(ctx) {
        if let Some(raid_id) = player.in_raid_id {
            // Mark player inactive and clear their in_raid_id
            cleanup_player_raid_data(ctx, &player.id, raid_id);
            
            // If raid is now empty (all players left), delete it immediately
            // This prevents abandoned raids from timing out and creating fake performance snapshots
            if count_active_raid_players(ctx, raid_id) == 0 {
                // Log closure before cleanup deletes data
                if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
                    let state_name = match raid.state {
                        RaidState::Matchmaking => "matchmaking",
                        RaidState::Countdown => "countdown",
                        RaidState::InProgress => "in_progress",
                        RaidState::Paused => "paused",
                        RaidState::Rematch => "rematch",
                        RaidState::Victory => "victory",
                        RaidState::Failed => "failed",
                    };
                    let age_micros = ctx.timestamp.to_micros_since_unix_epoch() - raid.started_at.to_micros_since_unix_epoch();
                    let age_seconds = age_micros / 1_000_000;
                    let player_count = ctx.db.raid_player().raid_id().filter(&raid_id).count();
                    let total_damage: u32 = ctx.db.raid_player()
                        .raid_id().filter(&raid_id)
                        .map(|rp| rp.damage_dealt)
                        .sum();
                    
                    log::info!("[RAID] closed raid_id={} reason=left state={} age_sec={} players={} damage={}",
                        raid_id, state_name, age_seconds, player_count, total_damage);
                }
                cleanup_raid_data(ctx, raid_id);
            }
        }
    }
}

/// Open loot chest and claim pre-calculated bonus
#[reducer]
pub fn open_loot_chest(ctx: &ReducerContext) {
    let mut player = match get_player(ctx) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("open_loot_chest: {}", e);
            return;
        }
    };
    
    // Must be in a completed raid
    let raid_id = match player.in_raid_id {
        Some(id) => id,
        None => {
            log::warn!("open_loot_chest: Player {} not in a raid", player.id);
            return;
        }
    };
    
    // Verify raid is complete
    match ctx.db.raid().id().find(&raid_id) {
        Some(r) if matches!(r.state, RaidState::Victory | RaidState::Failed) => {},
        _ => {
            log::warn!("open_loot_chest: Raid {} not complete", raid_id);
            return;
        }
    };
    
    // Find raid_player record with pending bonus
    let mut raid_player = match find_raid_player(ctx, &player.id, raid_id) {
        Some(rp) => rp,
        None => {
            log::warn!("open_loot_chest: No raid_player record found");
            return;
        }
    };
    
    // Claim the pre-calculated bonus
    match raid_player.pending_chest_bonus {
        Some(bonus) => {
            // Award AP
            player.total_ap = player.total_ap.saturating_add(bonus);
            
            // Clear the pending bonus (can only claim once)
            raid_player.pending_chest_bonus = None;
            update_raid_player(ctx, raid_player);
            
            // Update player
            ctx.db.player().id().update(player);
            
        },
        None => {
            log::warn!("open_loot_chest: Player {} already claimed chest or no bonus available", 
                player.id);
        }
    }
}

/// Manually leave a completed raid (when done viewing results)
#[reducer]
pub fn leave_completed_raid(ctx: &ReducerContext) {
    if let Ok(mut player) = get_player(ctx) {
        if let Some(raid_id) = player.in_raid_id {
            // Only allow leaving completed raids
            if let Some(raid) = ctx.db.raid().id().find(&raid_id) {
                if matches!(raid.state, RaidState::Victory | RaidState::Failed | RaidState::Rematch) {
                    // Mark inactive instead of delete (preserves stats, consistent with other cleanup)
                    if let Some(mut rp) = find_raid_player(ctx, &player.id, raid_id) {
                        rp.is_active = false;
                        update_raid_player(ctx, rp);
                    }
                    
                    // Clear player's raid association
                    player.in_raid_id = None;
                    ctx.db.player().id().update(player);
                    
                    // Scheduler will clean up when no active players remain
                } else {
                    log::warn!("Player {} tried to leave non-completed raid {}", 
                        ctx.sender, raid_id);
                }
            }
        }
    }
}


/// Countdown finished - transition raid to InProgress and issue problems
/// This is the "GO!" moment after 3-2-1 countdown
#[reducer]
pub fn countdown_complete(ctx: &ReducerContext, schedule: CountdownSchedule) {
    // Only allow scheduler to call this, not clients
    if ctx.sender != ctx.identity() {
        log::warn!("Client {} attempted to call countdown_complete", ctx.sender);
        return;
    }
    
    // Find raid and verify it's in Countdown state
    let mut raid = match ctx.db.raid().id().find(&schedule.raid_id) {
        Some(r) if r.state == RaidState::Countdown => r,
        Some(r) => {
            log::warn!("Countdown fired but raid {} is in {:?}, ignoring", schedule.raid_id, r.state);
            return;
        }
        None => {
            log::warn!("Countdown fired but raid {} doesn't exist", schedule.raid_id);
            return;
        }
    };
    
    // Transition to InProgress - this is the real "start time"
    raid.state = RaidState::InProgress;
    raid.started_at = ctx.timestamp;
    raid.countdown_started_at = None; // Clear countdown timestamp
    let boss_level = raid.boss_level;
    let raid_id = raid.id;
    ctx.db.raid().id().update(raid);
    
    // NOW schedule timeout (timer starts after countdown)
    let timeout_duration = raid_timeout_seconds(boss_level);
    let timeout_time = ctx.timestamp + std::time::Duration::from_secs(timeout_duration);
    ctx.db.raid_timeout_schedule().insert(RaidTimeoutSchedule {
        id: 0,
        raid_id,
        scheduled_at: ScheduleAt::Time(timeout_time.into()),
    });
    // NOW issue first problem batch to each active player
    let active_players: Vec<_> = ctx.db.raid_player()
        .raid_id()
        .filter(&raid_id)
        .filter(|rp| rp.is_active)
        .collect();
    
    for player in active_players {
        generate_problem_batch(ctx, raid_id, &player.player_id);
    }
    
}

/// Check if raid has timed out (scheduled reducer)
#[reducer]
pub fn check_raid_timeout(ctx: &ReducerContext, schedule: RaidTimeoutSchedule) {
    // Only allow scheduler to call this, not clients
    if ctx.sender != ctx.identity() {
        log::warn!("Client {} attempted to call check_raid_timeout", ctx.sender);
        ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
        return;
    }
    
    // Check raid state explicitly
    if let Some(raid) = ctx.db.raid().id().find(&schedule.raid_id) {
        match raid.state {
            RaidState::InProgress => {
                // Running raid - timeout is valid, end as defeat
                end_raid(ctx, schedule.raid_id, false);
            }
            RaidState::Paused => {
                // Paused raid - don't timeout (timeout was canceled when paused)
                ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
            }
            _ => {
                // Already ended or other state - cleanup schedule only
            }
        }
    }
    
    // Clean up schedule row after handling event (idiomatic pattern)
    ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
}

/// Scheduled cleanup task (runs every 30 seconds).
/// 
/// Despite the name, this handles TWO things:
/// 1. Abandoned raids - delete raids stuck >1hr 
/// 2. TimeBack events - delete sent events after 7d, log+delete dead letters after 7d
/// 
/// Why the misleading name? SpacetimeDB doesn't support renaming scheduled reducers.
/// Renaming would fail the migration. So we kept the legacy name.
#[reducer]
pub fn cleanup_abandoned_raids(ctx: &ReducerContext, _schedule: CleanupSchedule) {
    // Only allow scheduler to call this, not clients
    if ctx.sender != ctx.identity() {
        log::warn!("Client {} attempted to call cleanup_abandoned_raids", ctx.sender);
        return;
    }
    
    let now = ctx.timestamp;
    
    // Find raids to clean up
    for raid in ctx.db.raid().iter() {
        // Count ACTIVE players only (is_active = true)
        let active_player_count = ctx.db.raid_player()
            .raid_id()
            .filter(&raid.id)
            .filter(|rp| rp.is_active)
            .count();
        
        // Only process raids with no active players
        if active_player_count > 0 {
            continue; // Active players still in raid - skip
        }
        
        // Calculate age of the raid
        let age_micros = now.to_micros_since_unix_epoch() - raid.started_at.to_micros_since_unix_epoch();
        let age_seconds = age_micros / 1_000_000;
        
        // Simple rule: Clean up empty raids after 8 minutes
        // Generous grace period handles all reconnect scenarios:
        // - Student disconnects and reboots Chromebook (5+ min from raid end)
        // - Squad coordinating rematch
        // - Network hiccup during results screen
        // - Paused solo raids (proper grace from pause time)
        let should_cleanup = age_seconds > 480;
        
        if should_cleanup {
            // Gather context for wide event before cleanup deletes data
            let state_name = match raid.state {
                RaidState::Matchmaking => "matchmaking",
                RaidState::Countdown => "countdown",
                RaidState::InProgress => "in_progress",
                RaidState::Paused => "paused",
                RaidState::Rematch => "rematch",
                RaidState::Victory => "victory",
                RaidState::Failed => "failed",
            };
            let player_count = ctx.db.raid_player().raid_id().filter(&raid.id).count();
            let total_damage: u32 = ctx.db.raid_player()
                .raid_id().filter(&raid.id)
                .map(|rp| rp.damage_dealt)
                .sum();
            
            log::info!("[RAID] closed raid_id={} reason=abandoned state={} age_sec={} players={} damage={}",
                raid.id, state_name, age_seconds, player_count, total_damage);
            
            cleanup_raid_data(ctx, raid.id);
        }
    }
    
    // -------------------- TimeBack Event Queue Cleanup --------------------
    // Delete sent events 7 days after sent_at (audit window closed)
    // Log + delete dead letters 7 days after created_at (Axiom preserves for replay)
    
    let seven_days_micros: i128 = 7 * 24 * 60 * 60 * 1_000_000;
    let now_micros = now.to_micros_since_unix_epoch() as i128;
    
    for event in ctx.db.timeback_event_queue().iter() {
        if event.sent {
            // Use sent_at for TTL (fallback to created_at for legacy rows)
            let reference_time = event.sent_at.unwrap_or(event.created_at);
            let age_micros = now_micros - reference_time.to_micros_since_unix_epoch() as i128;
            
            if age_micros > seven_days_micros {
                // Sent successfully, past audit window - delete silently
                ctx.db.timeback_event_queue().id().delete(&event.id);
            }
        } else {
            // Unsent events: use created_at for age
            let age_micros = now_micros - event.created_at.to_micros_since_unix_epoch() as i128;
            
            if age_micros > seven_days_micros {
                // Dead letter - log with full payload for Axiom replay, then delete
                let player_prefix = &event.player_id[..8.min(event.player_id.len())];
                log::error!(
                    "[TIMEBACK] ✗ dead_letter event:{} player:{} attempts:{} age:{}d error:{} payload:{}",
                    event.id,
                    player_prefix,
                    event.attempts,
                    age_micros / (24 * 60 * 60 * 1_000_000),
                    event.last_error.as_deref().unwrap_or("none"),
                    event.payload
                );
                ctx.db.timeback_event_queue().id().delete(&event.id);
            }
        }
    }
}

/// Refresh leaderboard for a specific grade (private helper function)
/// Called internally after grade changes, not exposed as a reducer
fn refresh_leaderboard(ctx: &ReducerContext, grade: u8) {
    // Delete existing entries for this grade
    for entry in ctx.db.leaderboard_entry().iter() {
        if entry.grade == grade {
            ctx.db.leaderboard_entry().id().delete(&entry.id);
        }
    }
    
    // Get all players in this grade
    let players: Vec<_> = ctx.db.player()
        .iter()
        .filter(|p| p.grade == grade)
        .collect();
    
    // Calculate speed and mastery for each player
    // Note: We only collect mastery/speed here. Rank and division are derived
    // fresh from mastery_percent in the insert loop (single source of truth).
    let mut leaderboard_data: Vec<(Player, u32, u32, u32, u32)> = players.iter()
        .map(|player| {
            // Get mastery stats using existing helper
            let (mastered_count, total_facts) = get_player_mastery_stats(ctx, player);
            let mastery_percent = if total_facts > 0 {
                (mastered_count * 100) / total_facts
            } else {
                0
            };
            
            // Calculate speed from recent responses
            // Filter to grade-appropriate facts only (same as mastery grid)
            let grade_facts = get_facts_for_grade(player.grade);
            let valid_fact_keys: std::collections::HashSet<String> = grade_facts
                .iter()
                .map(|f| f.to_key())
                .collect();
            
            let facts: Vec<_> = ctx.db.fact_mastery()
                .player_id()
                .filter(&player.id)
                .filter(|fm| valid_fact_keys.contains(&fm.fact_key))
                .collect();
            
            let fast_threshold = get_fast_threshold_ms(player.grade);
            
            let (total_fast, total_recent) = facts.iter()
                .fold((0, 0), |(fast_sum, total_sum), fact| {
                    // Count correct AND fast attempts from recent attempts (for speed percentage)
                    let fast = fact.recent_attempts.iter().rev().take(3)
                        .filter(|a| a.correct && a.time_ms < fast_threshold)
                        .count();
                    let total = fact.recent_attempts.len().min(3);
                    (fast_sum + fast, total_sum + total)
                });
            
            let speed_percent = if total_recent > 0 {
                ((total_fast * 100) / total_recent) as u32
            } else {
                0
            };
            
            // Return raw data - rank/division calculated fresh in insert loop
            (player.clone(), mastery_percent, speed_percent, mastered_count, total_facts)
        })
        .collect();
    
    // Sort by mastery %, then speed %, then player ID
    // Note: Rank and division are calculated FROM mastery %, so sorting by mastery
    // automatically groups by rank and orders by division correctly
    leaderboard_data.sort_by(|a, b| {
        b.1.cmp(&a.1)  // Higher mastery first
            .then(b.2.cmp(&a.2))  // Higher speed as tiebreaker
            .then(a.0.id.cmp(&b.0.id))  // Player ID for stable ordering
    });
    
    // Insert sorted entries with tie-aware positions
    let mut display_position = 1;
    
    for (i, (player, mastery_percent, speed_percent, mastered_count, total_facts)) in leaderboard_data.iter().enumerate() {
        // Check if tied with previous entry (same mastery AND speed)
        if i > 0 {
            let prev = &leaderboard_data[i - 1];
            if prev.1 != *mastery_percent || prev.2 != *speed_percent {
                // Not tied - advance to actual index position
                display_position = (i + 1) as u32;
            }
            // If tied, keep same display_position
        }
        
        // Calculate rank from mastery_percent (not stale player.rank)
        let calculated_rank = if *mastery_percent >= 90 {
            "legendary"
        } else if *mastery_percent >= 75 {
            "diamond"
        } else if *mastery_percent >= 50 {
            "gold"
        } else if *mastery_percent >= 25 {
            "silver"
        } else {
            "bronze"
        };
        
        // Calculate division using fresh calculated_rank (not stale player.rank)
        let calculated_division = calculate_division(
            &Some(calculated_rank.to_string()),
            *mastered_count,
            *total_facts
        );
        
        ctx.db.leaderboard_entry().insert(LeaderboardEntry {
            id: 0,  // auto_inc
            grade,
            position: display_position,  // Ties get same position, next skips
            player_id: player.id.clone(),
            player_name: player.name.clone(),
            rank: calculated_rank.to_string(),
            division: calculated_division,
            mastery_percent: *mastery_percent,
            speed_percent: *speed_percent,
        });
    }
    
}

/// Initialize module - set up scheduled tasks
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    // Add module owner to authorized workers for RLS and reducer access control
    // In init, ctx.sender is the module owner identity
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        ctx.db.authorized_worker().insert(AuthorizedWorker {
            identity: ctx.sender,
        });
    }
    
    // Schedule cleanup task to run every 30 seconds
    // This handles abandoned raids and stale data gracefully
    // (only cleans up raids that have been empty for 60+ seconds)
    
    // Check if scheduler already exists to avoid duplicates on hot-reload
    if ctx.db.cleanup_schedule().iter().count() == 0 {
        ctx.db.cleanup_schedule().insert(CleanupSchedule {
            id: 0, // auto_inc will handle this
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_secs(30).into()),
        });
    }
    
    // Log module initialization for debugging
    log::info!("Math Raiders module initialized successfully");
    
    // Future initialization tasks could go here:
    // - Set up default configuration records
    // - Initialize leaderboards
    // - Create system accounts
    // - Run data migrations
}

// ==================== HELPER FUNCTIONS ====================

/// Default HP for each grade when no performance data is available
/// Tuned for ~30 second raids at expected CQPM:
/// K~10, G1~13, G2~17, G3~18, G4~20, G5~25 CQPM
fn get_grade_default_hp(grade: u8) -> u32 {
    match grade {
        0 => 225,   // K: 30s @ 10 CQPM
        1 => 350,   // G1: 30s @ 13 CQPM
        2 => 500,   // G2: 30s @ 17 CQPM
        3 => 550,   // G3: 30s @ 18 CQPM
        4 => 600,   // G4: 30s @ 20 CQPM
        5 => 900,   // G5: 30s @ 25 CQPM
        _ => 550,   // Default to G3
    }
}

/// Calculate a player's HP contribution based on recent performance snapshots
/// Uses average DPM (Damage Per Minute) from recent raids to calculate HP for 2-minute target
/// Tiered fallback: Track-specific → Grade-wide → Lifetime stats → Grade defaults
fn calculate_player_contribution_with_context(
    player: &Player, 
    ctx: Option<&ReducerContext>,
    track: Option<&str>,  // NEW: Track for track-specific HP calculation
) -> u32 {
    
    // First raid only: Use grade-based default (cold start)
    // After raid 1, system adapts immediately based on actual performance
    // 
    // Design goal: ~30 second raids at expected CQPM for grade
    // - Comfortable win but not a walkover (10s would feel hollow)
    // - Values tuned for: K~10, G1~13, G2~17, G3~18, G4~20, G5~25 CQPM
    if player.total_raids == 0 {
        return get_grade_default_hp(player.grade);
    }
    
    // Try to use recent performance snapshots with tiered fallback
    if let Some(ctx) = ctx {
        // TIER 1: Try track-specific performance history (most accurate)
        if let Some(track_id) = track {
            let track_snapshots: Vec<_> = ctx.db.performance_snapshot()
                .player_id()
                .filter(&player.id)
                .collect::<Vec<_>>()
                .into_iter()
                .filter(|s| s.grade == player.grade && s.track.as_deref() == Some(track_id))
                .rev()  // Most recent first
                .take(5)
                .collect();
            
            // First time on this track: Use grade default (cold start for new skill)
            if track_snapshots.len() == 0 {
                return get_grade_default_hp(player.grade);
            }
            
            // If we have 1+ raids on THIS specific track, use that data
            if track_snapshots.len() >= 1 {
                let avg_dpm = track_snapshots.iter()
                    .map(|s| {
                        let minutes = s.session_seconds as f32 / 60.0;
                        s.damage_dealt as f32 / minutes
                    })
                    .sum::<f32>() / track_snapshots.len() as f32;
                
                    // HP = avg_dpm × multiplier (see ADAPTIVE_HP_MULTIPLIER constant)
                    let hp = (avg_dpm * ADAPTIVE_HP_MULTIPLIER) as u32;
                
                let grade_default = get_grade_default_hp(player.grade);
                
                // Blending smooths the curve - trust the blend, don't cap
                let calculated_hp = hp.max(75);
                let final_hp = if track_snapshots.len() < 5 {
                    // Blend with grade default to smooth early variance
                    let confidence = track_snapshots.len() as f32 / 5.0;
                    ((calculated_hp as f32 * confidence) + (grade_default as f32 * (1.0 - confidence))) as u32
                } else {
                    // 5+ samples: trust the average fully
                    calculated_hp
                };
                
                return final_hp;
            }
        }
        
        // TIER 2: Fall back to grade-wide performance (any track)
        let snapshots: Vec<_> = ctx.db.performance_snapshot()
            .player_id()
            .filter(&player.id)
            .collect::<Vec<_>>()
            .into_iter()
            .filter(|s| s.grade == player.grade)  // Only use snapshots from current grade
            .rev()  // Most recent first
            .take(5)  // Last 5 raids
            .collect();
        
        // Use any snapshots we have (blend with defaults for 1-4 samples)
        if snapshots.len() >= 1 {
            // Calculate average DPM from recent raids using ACTUAL damage dealt
            let avg_dpm = snapshots.iter()
                .map(|s| {
                    let minutes = s.session_seconds as f32 / 60.0;
                    s.damage_dealt as f32 / minutes
                })
                .sum::<f32>() / snapshots.len() as f32;
            
            // HP = avg_dpm × multiplier (see ADAPTIVE_HP_MULTIPLIER constant)
            let hp = (avg_dpm * ADAPTIVE_HP_MULTIPLIER) as u32;
            
            let grade_default = get_grade_default_hp(player.grade);
            
            // Blending smooths the curve - trust the blend, don't cap
            let calculated_hp = hp.max(75);
            let final_hp = if snapshots.len() < 5 {
                // Blend with grade default to smooth early variance
                let confidence = snapshots.len() as f32 / 5.0;
                ((calculated_hp as f32 * confidence) + (grade_default as f32 * (1.0 - confidence))) as u32
            } else {
                // 5+ samples: trust the average fully
                calculated_hp
            };
            
            return final_hp;
        }
    }
    
    // Tier 3: Use lifetime stats with DPM approach (rare - only for players without recent history)
    let accuracy = player.total_correct as f32 / player.total_problems.max(1) as f32;
    let problems_per_minute = 60000.0 / (player.avg_response_ms + 1000) as f32;  // +1s pause between problems
    let correct_per_minute = problems_per_minute * accuracy;
    
    // Calculate DPM (estimation only - no real damage data available)
    // Use average damage without crit RNG for estimation
    let damage_per_answer = estimate_average_damage(player.avg_response_ms, player.grade) as f32;
    let dpm = correct_per_minute * damage_per_answer;
    
    // HP = dpm × multiplier (see ADAPTIVE_HP_MULTIPLIER constant)
    let hp = (dpm * ADAPTIVE_HP_MULTIPLIER) as u32;
    
    // SAFETY: Blend with grade default since lifetime stats can be unreliable
    let grade_default = get_grade_default_hp(player.grade);
    let calculated_hp = hp.max(75);
    
    // Blend 50/50 since we don't know how reliable lifetime stats are
    let final_hp = ((calculated_hp as f32 * 0.5) + (grade_default as f32 * 0.5)) as u32;
    
    final_hp
}

// Removed calculate_player_dps, calculate_player_dps_with_mastery, and CategoryPerformance
// Now using recent performance snapshots in calculate_player_contribution_with_context




// Phase 1: Tier system removed - all facts available
// Phase 2: Will add grade-based filtering

/// Generate problem using adaptive selection based on fact mastery
fn generate_adaptive_problem(sequence: u32, ctx: &ReducerContext, raid_player: &mut RaidPlayer) -> Option<(u8, u8, Operation)> {
    // Get player's grade for filtering
    let player = ctx.db.player().id().find(&raid_player.player_id)?;
    
    // Filter facts by grade AND track (if specified)
    let grade_facts = if let Some(ref track) = raid_player.track {
        if track == "ALL" {
            // Explicit "ALL" selection - use all grade facts
            get_facts_for_grade(player.grade)
        } else {
            // Specific track selected - filter by track
            get_facts_for_grade_and_track(player.grade, track)
        }
    } else {
        // No track specified - default to all facts (backwards compatibility)
        get_facts_for_grade(player.grade)
    };
    
    let allowed_facts: Vec<String> = grade_facts.iter()
        .map(|f| f.to_key())
        .collect();
    
    // Get all fact mastery records for this player
    let player_facts: Vec<FactMastery> = ctx.db.fact_mastery()
        .player_id()
        .filter(&raid_player.player_id)
        .collect();
    
    // Parse recent problems to prevent repeats
    let recent_problems: Vec<String> = if raid_player.recent_problems.is_empty() {
        Vec::new()
    } else {
        raid_player.recent_problems.split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    };
    
    let last_problem = recent_problems.last().cloned();
    
    // Use timestamp + sequence for randomness
    let seed = ctx.timestamp.to_micros_since_unix_epoch() as u64 + sequence as u64;
    
    // Build weighted list of facts
    let mut weighted_facts: Vec<(String, f32)> = Vec::new();
    
    // Add existing facts with their weights (ONLY if allowed by tier)
    for fact in &player_facts {
        // ULTRACORE: Skip facts not allowed in current tier
        if !allowed_facts.contains(&fact.fact_key) {
            continue;
        }
        
        let mut weight = calculate_fact_weight(&fact, ctx.timestamp);
        
        // Phase 4: Prevent consecutive repeats
        if let Some(ref last) = last_problem {
            // Never repeat the exact same fact
            if &fact.fact_key == last {
                weight = 0.0;
            } else {
                // Prevent same operands in consecutive problems
                if let (Some((last_l, last_r, _)), Some((fact_l, fact_r, _))) = 
                    (parse_fact_key(last), parse_fact_key(&fact.fact_key)) {
                    // Check if any operand matches
                    if last_l == fact_l || last_l == fact_r ||
                       last_r == fact_l || last_r == fact_r {
                        weight = 0.0;
                    }
                }
            }
        }
        
        // Reduce weight if in recent 10 problems
        if recent_problems.contains(&fact.fact_key) {
            weight *= 0.1; // Drastically reduce but don't eliminate
        }
        
        if weight > 0.0 {
            weighted_facts.push((fact.fact_key.clone(), weight));
        }
    }
    
    // Add any tier facts not yet in the pool with moderate weight for discovery
    // This ensures all tier facts are always available, preventing the "missing 10×12" problem
    for fact_key in allowed_facts.iter() {
        // Skip if already added from mastery records
        if weighted_facts.iter().any(|(k, _)| k == fact_key) {
            continue;
        }
        
        // Check for repeat prevention (don't add if it's the last problem or shares a multiplier)
        if let Some(ref last) = last_problem {
            if fact_key == last {
                continue;  // Never repeat the exact same fact
            }
            
            // Prevent same operands in consecutive problems
            if let (Some((last_l, last_r, _)), Some((fact_l, fact_r, _))) = 
                (parse_fact_key(last), parse_fact_key(fact_key)) {
                // Check if any operand matches
                if last_l == fact_l || last_l == fact_r ||
                   last_r == fact_l || last_r == fact_r {
                    continue;  // Skip facts that share an operand with the last problem
                }
            }
        }
        
        // Skip if in recent problems (but with lower penalty than mastered facts)
        if recent_problems.contains(fact_key) {
            continue;  // Skip entirely rather than low weight to maintain variety
        }
        
        // Add with same weight as L0-1 facts (they're essentially unattempted hard facts)
        weighted_facts.push((fact_key.clone(), 10.0));
    }
    
    // Analyze top weighted facts for debugging
    let mut sorted_facts = weighted_facts.clone();
    sorted_facts.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    
    // Select a fact using weighted random
    let selected_fact = weighted_random_selection(weighted_facts, seed)?;
    
    // Parse the fact key (e.g., "7×8" -> (7, 8, Multiply))
    let (left, right, operation) = match parse_fact_key(&selected_fact) {
        Some(parsed) => parsed,
        None => {
            log::error!("Invalid fact key format: {}", selected_fact);
            return None;
        }
    };
    
    // 50% chance to swap operands for variety (only for commutative operations)
    let (final_left, final_right) = match operation {
        Operation::Add | Operation::Multiply => {
            // Commutative - can swap
            if (seed % 2) == 0 {
                (right, left)
            } else {
                (left, right)
            }
        },
        Operation::Subtract | Operation::Divide => {
            // Non-commutative - keep original order
            (left, right)
        }
    };
    
    // Update recent_problems list (keep last 10)
    let mut updated_recent = recent_problems.clone();
    updated_recent.push(selected_fact.clone());
    if updated_recent.len() > 10 {
        updated_recent.remove(0); // Remove oldest
    }
    raid_player.recent_problems = updated_recent.join(",");
    
    Some((final_left, final_right, operation))
}

fn generate_problem(sequence: u32, ctx: &ReducerContext, raid_player: &mut RaidPlayer) -> (u8, u8, Operation) {
    // Try adaptive generation first
    if let Some(result) = generate_adaptive_problem(sequence, ctx, raid_player) {
        return result;
    }
    
    // Fallback to random generation from grade-appropriate facts
    log::debug!("Falling back to random generation (no fact history)");
    
    // Get player's grade
    let player = match ctx.db.player().id().find(&raid_player.player_id) {
        Some(p) => p,
        None => {
            // Shouldn't happen, but provide a basic problem
            return (5, 5, Operation::Multiply);
        }
    };
    
    // Get facts filtered by grade AND track (if specified)
    let grade_facts = if let Some(ref track) = raid_player.track {
        if track == "ALL" {
            get_facts_for_grade(player.grade)
        } else {
            get_facts_for_grade_and_track(player.grade, track)
        }
    } else {
        get_facts_for_grade(player.grade)
    };
    
    if grade_facts.is_empty() {
        // Safety fallback
        return (5, 5, Operation::Multiply);
    }
    
    // Use timestamp + sequence for randomness
    let seed = ctx.timestamp.to_micros_since_unix_epoch() as u64 + sequence as u64;
    
    // Pick a random fact from grade-appropriate facts
    let fact_index = (seed % grade_facts.len() as u64) as usize;
    let fact = &grade_facts[fact_index];
    
    // Parse the fact
    let (left, right, operation) = match parse_fact_key(&fact.to_key()) {
        Some(parsed) => parsed,
        None => (5, 5, Operation::Multiply), // Shouldn't happen
    };
    
    // Update recent_problems list
    let fact_key = fact.to_key();
    let recent_problems: Vec<String> = if raid_player.recent_problems.is_empty() {
        Vec::new()
    } else {
        raid_player.recent_problems.split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    };
    
    let mut updated_recent = recent_problems;
    updated_recent.push(fact_key.clone());
    if updated_recent.len() > 10 {
        updated_recent.remove(0);
    }
    raid_player.recent_problems = updated_recent.join(",");
    
    // 50% chance to swap for commutativity practice (only for commutative ops)
    let (final_left, final_right) = match operation {
        Operation::Add | Operation::Multiply => {
            if (seed % 2) == 0 {
                (right, left)
            } else {
                (left, right)
            }
        },
        Operation::Subtract | Operation::Divide => {
            // Non-commutative - keep original order
            (left, right)
        }
    };
    
    log::debug!("Problem #{}: {}{}{} (Fallback from {} facts)", 
        sequence, final_left, operation.symbol(), final_right, grade_facts.len());
    
    (final_left, final_right, operation)
}

/// Calculate expected average damage (for HP estimation, no RNG)
/// Note: Grade affects speed threshold only, not damage multiplier.
/// This allows clean CQPM → DPS mapping for boss ladder modeling.
fn estimate_average_damage(response_ms: u32, grade: u8) -> u32 {
    let fast_threshold = match grade {
        0 => 3000,
        1..=3 => 2000,
        4 => 1700,
        _ => 1500,
    };
    
    // Damage scaled 1.5x (base values match calculate_damage)
    // No grade multiplier - same damage for all grades at their threshold
    if response_ms <= fast_threshold {
        86  // Average of 75 (85%) + 150 (15%) ≈ 86
    } else if response_ms <= fast_threshold + 1000 {
        60  // 40 × 1.5
    } else if response_ms <= fast_threshold + 2000 {
        45  // 30 × 1.5
    } else if response_ms <= fast_threshold + 3000 {
        30  // 20 × 1.5
    } else if response_ms <= fast_threshold + 5000 {
        23  // 15 × 1.5
    } else {
        15  // 10 × 1.5
    }
}

/// Calculate damage for a correct answer based on response time.
/// Grade affects the speed threshold (what counts as "fast"), not the damage output.
/// This allows clean CQPM → DPS mapping: same CQPM = same DPS regardless of grade.
fn calculate_damage(response_ms: u32, grade: u8, ctx: &ReducerContext) -> u32 {
    let fast_threshold = get_fast_threshold_ms(grade);
    
    // Smooth damage curve (scaled 1.5x to differentiate DPS from CQPM)
    // No grade multiplier - K at 3.0s deals same damage as G5 at 1.5s
    if response_ms <= fast_threshold {
        // Fast answers can crit (WoW-style: 15% chance for 2x damage)
        let crit_roll = ctx.rng().gen_range(0..100);
        if crit_roll < 15 {
            150  // CRIT (100 × 1.5)
        } else {
            75   // Normal (50 × 1.5)
        }
    } else if response_ms <= fast_threshold + 1000 {
        60   // +1s (40 × 1.5)
    } else if response_ms <= fast_threshold + 2000 {
        45   // +2s (30 × 1.5)
    } else if response_ms <= fast_threshold + 3000 {
        30   // +3s (20 × 1.5)
    } else if response_ms <= fast_threshold + 5000 {
        23   // +5s (15 × 1.5, rounded)
    } else {
        15   // Beyond (10 × 1.5)
    }
}

// ==================== FACT MASTERY HELPERS ====================

/// Normalize a fact to canonical form
/// For commutative operations (Add, Multiply): smaller operand first
/// For non-commutative operations (Subtract, Divide): as-is
fn normalize_fact(left: u8, right: u8, operation: &Operation) -> String {
    match operation {
        Operation::Add | Operation::Multiply => {
            // Commutative: normalize to smaller × larger
            let (min, max) = if left <= right { (left, right) } else { (right, left) };
            format!("{}{}{}", min, operation.symbol(), max)
        }
        Operation::Subtract | Operation::Divide => {
            // Non-commutative: keep order as-is
            format!("{}{}{}", left, operation.symbol(), right)
        }
    }
}

/// Calculate mastery level from recent attempts and current grade
/// Uses last 3 attempts with grade-appropriate fast threshold
fn calculate_mastery_level(fact: &FactMastery, grade: u8) -> u8 {
    if fact.total_attempts == 0 {
        return 0;
    }
    
    // Get last 3 attempts (or all if fewer than 3)
    let total = fact.recent_attempts.len();
    let start_idx = if total > 3 { total - 3 } else { 0 };
    let last_3 = &fact.recent_attempts[start_idx..];
    
    let fast_threshold = get_fast_threshold_ms(grade);
    
    // Count correct and fast attempts in last 3
    let correct_count = last_3.iter().filter(|a| a.correct).count();
    
    // Grade-relative speed tiers for progressive mastery
    // K: 20 CQPM (3s), G1-3: 30 CQPM (2s), G4: 35 CQPM (1.7s), G5+: 40 CQPM (1.5s)
    
    // Check speed tiers in last 3 attempts (grade-relative thresholds)
    // L5 requires 2+ fast to reduce false positives from lucky single attempts
    let hit_1x_count = last_3.iter().filter(|a| a.correct && a.time_ms <= fast_threshold).count();
    let hit_2x = last_3.iter().any(|a| a.correct && a.time_ms <= fast_threshold * 2);
    let hit_3x = last_3.iter().any(|a| a.correct && a.time_ms <= fast_threshold * 3);
    
    if hit_1x_count >= 2 {
        5  // Mastered: 2+ fast in last 3 (consistent speed, not lucky)
    } else if hit_2x {
        4  // Close: Within 2x threshold (building speed)
    } else if hit_3x {
        3  // Developing: Within 3x threshold (some speed progress)
    } else if correct_count >= 2 {
        2  // Cyan: Learning (2+ correct but slow)
    } else if correct_count >= 1 {
        1  // Cyan: Practicing (at least 1 correct)
    } else {
        0  // Gray: All wrong (needs help)
    }
}

// ==================== ADAPTIVE SELECTION HELPERS ====================

/// Calculate weight for a fact based on mastery data and time since last seen
fn calculate_fact_weight(fact: &FactMastery, current_time: Timestamp) -> f32 {
    // Use server-maintained mastery level (already calculated and cached)
    let mastery_level = fact.mastery_level;
    
    // Bucket weights (1:7:2 ratio - ZPD dominant for optimal learning)
    // 70% ZPD (where learning happens), 20% mastered (confidence), 10% hard (stretch)
    let mut weight: f32 = match mastery_level {
        0 | 1 => 10.0,    // Hard bucket (L0-1) - limited exposure
        2..=4 => 70.0,    // ZPD bucket (L2-4) - where learning happens
        5 => 20.0,        // Mastered bucket (L5) - confidence + speed
        _ => 10.0,        // Shouldn't happen
    };
    
    // Never attempted = hard weight (they are weak/unknown facts)
    if fact.total_attempts == 0 {
        return 10.0;
    }
    
    // Time-based spacing boost
    // Boost facts not seen recently to implement spaced repetition
    let current_micros = current_time.to_micros_since_unix_epoch();
    let last_seen_micros = fact.last_seen.to_micros_since_unix_epoch();
    let ms_since = current_micros.saturating_sub(last_seen_micros) / 1000;
    let hours_since = ms_since as f32 / (1000.0 * 60.0 * 60.0);
    
    // Apply forgetting curve boost
    if hours_since >= 72.0 {
        weight *= 2.0;  // 3+ days: double weight (needs review)
    } else if hours_since >= 24.0 {
        weight *= 1.5;  // 1+ day: 50% boost (due for practice)  
    } else if hours_since >= 8.0 {
        weight *= 1.2;  // 8+ hours: slight boost
    }
    // Recent (< 8 hours): no time boost
    
    weight.max(0.1f32) // Keep small positive weight even for mastered facts
}

/// Calculate division within rank based on mastery progress
/// Returns I, II, III, or IV based on position within current rank
fn calculate_division(rank: &Option<String>, mastered_count: u32, total_count: u32) -> String {
    if rank.is_none() || total_count == 0 {
        return "IV".to_string();
    }
    
    let rank_str = rank.as_ref().unwrap();
    
    // Legendary has no divisions - it's the pinnacle
    if rank_str == "legendary" {
        return "".to_string();
    }
    
    let percentage = (mastered_count as f32 / total_count as f32) * 100.0;
    
    // Get rank boundaries
    let (min_threshold, max_threshold) = match rank_str.as_str() {
        "bronze" => (0.0, 25.0),
        "silver" => (25.0, 50.0),
        "gold" => (50.0, 75.0),
        "diamond" => (75.0, 90.0),
        "legendary" => (90.0, 100.0),
        _ => return "IV".to_string(),
    };
    
    // Calculate position within current rank (0-1)
    let rank_range = max_threshold - min_threshold;
    let progress_in_rank = percentage - min_threshold;
    let position_in_rank = (progress_in_rank / rank_range).max(0.0).min(1.0);
    
    // Map to divisions (4 divisions per rank)
    if position_in_rank >= 0.75 {
        "I".to_string()
    } else if position_in_rank >= 0.50 {
        "II".to_string()
    } else if position_in_rank >= 0.25 {
        "III".to_string()
    } else {
        "IV".to_string()
    }
}

/// Get player's mastery statistics for their current grade
/// Returns (mastered_count, total_facts) where both are filtered to the player's grade
fn get_player_mastery_stats(ctx: &ReducerContext, player: &Player) -> (u32, u32) {
    // Get all facts for the player's grade
    let grade_facts = get_facts_for_grade(player.grade);
    let total_facts = grade_facts.len() as u32;
    
    // Build set of valid fact keys for this grade
    let valid_fact_keys: std::collections::HashSet<String> = grade_facts
        .iter()
        .map(|f| f.to_key())
        .collect();
    
    // Count only mastered facts that exist in this grade
    // Use server-maintained mastery_level (already calculated and fresh)
    let mastered_count = ctx.db.fact_mastery()
        .player_id()
        .filter(&player.id)
        .filter(|fm| {
            fm.mastery_level >= 5 && valid_fact_keys.contains(&fm.fact_key)
        })
        .count() as u32;
    
    (mastered_count, total_facts)
}


/// Calculate player rank based on mastery percentage
/// Returns rank name for bronze through legendary (never None)
fn calculate_player_rank(mastered_count: u32, total_facts: u32) -> Option<String> {
    if total_facts == 0 {
        return Some("bronze".to_string());
    }
    
    let percentage = (mastered_count as f32 / total_facts as f32) * 100.0;
    
    // Ranks based purely on mastery percentage
    // L5 mastery requires hitting grade speed threshold in recent attempts
    if percentage >= 90.0 {
        Some("legendary".to_string())
    } else if percentage >= 75.0 {
        Some("diamond".to_string())
    } else if percentage >= 50.0 {
        Some("gold".to_string())
    } else if percentage >= 25.0 {
        Some("silver".to_string())
    } else {
        Some("bronze".to_string())  // 0-25% = Bronze
    }
}

/// Select a fact using weighted random selection
fn weighted_random_selection(facts: Vec<(String, f32)>, seed: u64) -> Option<String> {
    if facts.is_empty() {
        return None;
    }
    
    let total_weight: f32 = facts.iter().map(|(_, w)| w).sum();
    
    // Scramble seed with Knuth's multiplicative hash (spreads sequential seeds)
    let scrambled = seed.wrapping_mul(2654435761);
    
    if total_weight == 0.0 {
        // All weights are 0, pick randomly
        let idx = (scrambled % facts.len() as u64) as usize;
        return Some(facts[idx].0.clone());
    }
    
    // Generate random value between 0 and total_weight
    let random_value = ((scrambled % 10000) as f32 / 10000.0) * total_weight;
    
    let mut cumulative = 0.0;
    for (fact_key, weight) in &facts {
        cumulative += weight;
        if random_value <= cumulative {
            return Some(fact_key.clone());
        }
    }
    
    // Fallback to last item (shouldn't happen)
    facts.last().map(|(key, _)| key.clone())
}


/// Update or create a FactMastery record for a fact
fn update_fact_mastery(
    ctx: &ReducerContext,
    player_id: String,
    left: u8,
    right: u8,
    operation: &Operation,
    is_correct: bool,
    response_ms: u32,
) {
    // Normalize the fact key
    let fact_key = normalize_fact(left, right, operation);
    
    // Find existing record
    let existing = ctx.db.fact_mastery()
        .player_id()
        .filter(&player_id)
        .filter(|f| f.fact_key == fact_key)
        .next();
    
    if let Some(mut fact) = existing {
        // Update aggregates
        fact.total_attempts = fact.total_attempts.saturating_add(1);
        
        if is_correct {
            fact.total_correct = fact.total_correct.saturating_add(1);
            
            // Update average response time (rolling average for correct answers)
            if fact.total_correct == 1 {
                fact.avg_response_ms = response_ms;
            } else {
                let count = fact.total_correct.saturating_sub(1) as u64;
                let avg = fact.avg_response_ms as u64;
                
                if let Some(total_ms) = avg.checked_mul(count) {
                    if let Some(new_total) = total_ms.checked_add(response_ms as u64) {
                        fact.avg_response_ms = (new_total / fact.total_correct as u64).min(u32::MAX as u64) as u32;
                    }
                }
            }
            
            // Update fastest time
            if response_ms < fact.fastest_ms {
                fact.fastest_ms = response_ms;
            }
        }
        
        // Update metadata
        fact.last_seen = ctx.timestamp;
        
        // Add to recent attempts (maintain 100 max rolling window)
        fact.recent_attempts.push(AttemptRecord {
            time_ms: response_ms,
            correct: is_correct,
            timestamp: ctx.timestamp,
        });
        
        // Keep only last 100 attempts (enough for trend analysis)
        if fact.recent_attempts.len() > 100 {
            fact.recent_attempts.remove(0);
        }
        
        // Get player grade for mastery calculation
        let player_grade = ctx.db.player().id().find(&player_id)
            .map(|p| p.grade)
            .unwrap_or(3);
        
        // Recalculate mastery level (server-authoritative)
        fact.mastery_level = calculate_mastery_level(&fact, player_grade);
        
        ctx.db.fact_mastery().id().update(fact);
    } else {
        // Create new record
        let player_grade = ctx.db.player().id().find(&player_id)
            .map(|p| p.grade)
            .unwrap_or(3);
        
        let mut new_fact = FactMastery {
            id: 0, // auto_inc
            player_id: player_id.clone(),
            fact_key: fact_key.clone(),
            total_attempts: 1,
            total_correct: if is_correct { 1 } else { 0 },
            last_seen: ctx.timestamp,
            avg_response_ms: if is_correct { response_ms } else { 0 },
            fastest_ms: if is_correct { response_ms } else { u32::MAX },
            recent_attempts: vec![AttemptRecord {
                time_ms: response_ms,
                correct: is_correct,
                timestamp: ctx.timestamp,
            }],
            mastery_level: 0,  // Will be calculated below
        };
        
        // Calculate initial mastery level (server-authoritative)
        new_fact.mastery_level = calculate_mastery_level(&new_fact, player_grade);
        
        ctx.db.fact_mastery().insert(new_fact);
    }
}

fn update_player_stats(ctx: &ReducerContext, player_id: &String, is_correct: bool, response_ms: u32) {
    if let Some(mut player) = ctx.db.player().id().find(player_id) {
        player.total_problems = player.total_problems.saturating_add(1);
        
        if is_correct {
            player.total_correct = player.total_correct.saturating_add(1);
            
            // Update average response time with overflow protection
            if player.total_correct == 1 {
                player.avg_response_ms = response_ms;
            } else {
                // Use saturating arithmetic to prevent overflow
                let count = player.total_correct.saturating_sub(1) as u64;
                let avg = player.avg_response_ms as u64;
                
                // Check for potential overflow before multiplication
                if let Some(total_ms) = avg.checked_mul(count) {
                    if let Some(new_total) = total_ms.checked_add(response_ms as u64) {
                        player.avg_response_ms = (new_total / player.total_correct as u64).min(u32::MAX as u64) as u32;
                    } else {
                        // If overflow would occur, keep current average
                        log::warn!("Average response time calculation would overflow, keeping current value");
                    }
                } else {
                    // If overflow would occur, keep current average
                    log::warn!("Average response time calculation would overflow, keeping current value");
                }
            }
            
            // Update best time
            if response_ms < player.best_response_ms {
                player.best_response_ms = response_ms;
            }
        }
        
        player.last_played = ctx.timestamp;
        player.last_raid = ctx.timestamp;  // Track raid completion for streak
        ctx.db.player().id().update(player);
    }
}

fn end_raid(ctx: &ReducerContext, raid_id: u64, victory: bool) {
    // Cancel any pending timeout for this raid
    for schedule in ctx.db.raid_timeout_schedule().iter() {
        if schedule.raid_id == raid_id {
            ctx.db.raid_timeout_schedule().id().delete(&schedule.id);
        }
    }
    
    if let Some(mut raid) = ctx.db.raid().id().find(&raid_id) {
        // Debug removed - [RAID] ended log is canonical
        
        // Defensive: Check if already ended to prevent duplicate performance snapshots
        if matches!(raid.state, RaidState::Victory | RaidState::Failed) {
            log::warn!("end_raid: Raid {} already in {:?} state, ignoring duplicate call", 
                      raid_id, raid.state);
            return;
        }
        
        // Capture data we need before modifying raid
        let raid_started_at = raid.started_at;
        let raid_room_code = raid.room_code.clone();
        let raid_boss_level = raid.boss_level;
        let raid_boss_max_hp = raid.boss_max_hp; // Starting HP (difficulty)
        
        // CRITICAL: Update state IMMEDIATELY to prevent race conditions
        // Set state first so duplicate end_raid calls will hit the defensive check
        raid.state = if victory { RaidState::Victory } else { RaidState::Failed };
        
        // Calculate raid duration
        let duration_micros = ctx.timestamp.to_micros_since_unix_epoch() - 
                             raid_started_at.to_micros_since_unix_epoch();
        let duration_seconds = ((duration_micros / 1_000_000) as u32).max(1); // Minimum 1 second
        raid.duration_seconds = Some(duration_seconds);
        
        // Capture raid type
        let raid_type = if raid_room_code.is_some() {
            Some("multiplayer".to_string())
        } else {
            Some("solo".to_string())
        };
        
        // Update raid with both state and duration
        ctx.db.raid().id().update(raid);
        
        // Collect participants for aggregate stats and XP processing
        let raid_players: Vec<_> = ctx.db.raid_player()
            .raid_id()
            .filter(&raid_id)
            .filter(|rp| rp.damage_dealt > 0 || rp.problems_answered > 0)
            .collect();
        
        // Calculate aggregate stats for wide event
        let total_damage: u32 = raid_players.iter().map(|rp| rp.damage_dealt).sum();
        let total_problems: u32 = raid_players.iter().map(|rp| rp.problems_answered).sum();
        let total_correct: u32 = raid_players.iter().map(|rp| rp.correct_answers).sum();
        let avg_accuracy = if total_problems > 0 { (total_correct * 100) / total_problems } else { 0 };
        let squad_names: Vec<&str> = raid_players.iter().map(|rp| rp.player_name.as_str()).collect();
        let is_multiplayer = raid_room_code.is_some();
        let track = raid_players.first().map(|rp| rp.track.as_deref().unwrap_or("unknown")).unwrap_or("unknown");
        
        // Wide event: one canonical log for raid outcome
        log::info!("[RAID] ended raid_id={} outcome={} duration_sec={} players={} squad={:?} is_multiplayer={} total_damage={} boss_max_hp={} boss_level={} track={} total_problems={} avg_accuracy={}",
            raid_id, if victory { "victory" } else { "defeat" }, duration_seconds,
            raid_players.len(), squad_names, is_multiplayer,
            total_damage, raid_boss_max_hp, raid_boss_level, track, total_problems, avg_accuracy);
        
        for raid_player in &raid_players {
            if let Some(mut player) = ctx.db.player().id().find(&raid_player.player_id) {
                // Calculate CQPM correctly - use active time, not full raid duration
                // For inactive players, we estimate active time since we don't track it
                // For active players, we use actual raid duration
                let active_duration_seconds = if !raid_player.is_active {
                    // INACTIVE PLAYER: Estimate active time from problems
                    // Conservative estimate: 1 problem ≈ 10 seconds of focused work
                    // 
                    // Rationale: Average problem takes ~10 seconds (reading + solving + submitting)
                    // This is conservative (may slightly under-estimate for fast workers, over-estimate for slow)
                    // Purpose: Fair proxy for "focused minutes" when we don't track actual active time
                    // Same threshold applies (2 CQPM + 80% accuracy) ensures learning quality
                    //
                    // Example: 6 problems = 60 seconds = 1 minute of focused time
                    raid_player.problems_answered * 10
                } else {
                    // ACTIVE PLAYER: Use actual raid duration (accurate measurement)
                    duration_seconds
                };
                
                // Calculate CQPM using active duration (same formula for both)
                let session_cqpm = if active_duration_seconds > 0 {
                    (raid_player.correct_answers as f32 / active_duration_seconds as f32) * 60.0
                } else {
                    0.0
                };
                
                // Calculate and update player rank using rolling average INCLUDING current session
                let (mastered_count, total_facts) = get_player_mastery_stats(ctx, &player);
                
                let new_rank = calculate_player_rank(mastered_count, total_facts);
                
                // Log rank change if it occurred (structured for Axiom queries)
                if new_rank != player.rank {
                    let old_rank_str = player.rank.as_deref().unwrap_or("none");
                    let new_rank_str = new_rank.as_deref().unwrap_or("none");
                    log::info!("[RANK] player=\"{}\" from={} to={} mastered={}/{}", 
                        player.name, old_rank_str, new_rank_str, mastered_count, total_facts);
                }
                
                // Update player rank
                player.rank = new_rank.clone();
                
                // Calculate division within rank
                let division = calculate_division(&new_rank, mastered_count, total_facts);
                
                // Calculate commutative units for TimeBack
                let timeback_units = calculate_mastered_units_for_timeback(ctx, &raid_player.player_id, player.grade);
                
                // Record performance snapshot with rank, division, track, and raid type
                ctx.db.performance_snapshot().insert(PerformanceSnapshot {
                    id: 0, // auto_inc
                    player_id: raid_player.player_id.clone(),
                    timestamp: ctx.timestamp,
                    grade: player.grade,
                    track: raid_player.track.clone(), // Store track for adaptive HP
                    rank: new_rank,
                    division: if division.is_empty() { None } else { Some(division) },
                    facts_mastered_at_snapshot: mastered_count,
                    problems_attempted: raid_player.problems_answered,
                    problems_correct: raid_player.correct_answers,
                    session_seconds: duration_seconds,
                    damage_dealt: raid_player.damage_dealt,
                    raid_type: raid_type.clone(),
                    timeback_units_at_snapshot: timeback_units,
                    boss_level: raid_boss_level,
                    victory: Some(victory),
                });
                
                // Track Master achievement: 3× solo wins on goal boss
                // Wide event for guide workflow: grep [TRACK_MASTER] to find students ready for post-test
                if victory && raid_type.as_deref() == Some("solo") && raid_boss_level == get_grade_goal_boss(player.grade) {
                    let goal_boss_wins: usize = ctx.db.performance_snapshot()
                        .player_id()
                        .filter(&raid_player.player_id)
                        .filter(|s| s.grade == player.grade 
                            && s.track == raid_player.track 
                            && s.boss_level == raid_boss_level 
                            && s.raid_type == Some("solo".to_string())
                            && s.victory == Some(true))
                        .count();
                    
                    if goal_boss_wins == 3 {
                        log::info!("[TRACK_MASTER] player=\"{}\" player_id={} grade={} track={} boss={} email={}",
                            player.name, &raid_player.player_id[..8.min(raid_player.player_id.len())], 
                            player.grade, raid_player.track.as_deref().unwrap_or("unknown"), 
                            raid_boss_level, player.email.as_deref().unwrap_or(""));
                    }
                }
                
                // Increment total raids completed
                let was_first_raid = player.total_raids == 0;
                player.total_raids = player.total_raids.saturating_add(1);
                
                // Log first raid ever (new player milestone!)
                if was_first_raid {
                    log::info!("[FIRST_RAID] player=\"{}\" grade={} track={}", 
                        player.name, player.grade, raid_player.track.as_deref().unwrap_or("unknown"));
                }
                
                // Track streak (raid-based - requires daily raiding)
                // Reset daily_raid_count if new day (handles edge case of staying connected past midnight)
                if is_new_day(player.last_raid, ctx.timestamp) {
                    reset_quests_by_prefix(&mut player, "daily_");
                }
                let quests = parse_quests(&player.quests);
                let daily_raid_count = quests["daily_raid_count"].as_u64().unwrap_or(0);
                
                // Increment raid count (for streak tracking only, not rewards)
                let mut quests_mut = parse_quests(&player.quests);
                quests_mut["daily_raid_count"] = json!(daily_raid_count + 1);
                player.quests = Some(quests_mut.to_string());
                
                // Increment streak on first raid of the day
                if daily_raid_count == 0 {
                    let new_streak = increment_quest(&mut player, "daily_streak");
                    
                    // Log streak milestones (7, 14, 30 days)
                    match new_streak {
                        7 => log::info!("[STREAK] player=\"{}\" days=7 milestone=weekly", player.name),
                        14 => log::info!("[STREAK] player=\"{}\" days=14 milestone=biweekly", player.name),
                        30 => log::info!("[STREAK] player=\"{}\" days=30 milestone=monthly", player.name),
                        _ => {}
                    }
                }
                
                // Time-based quest rewards (derived from PerformanceSnapshot)
                let (_daily_reward, _weekly_reward) = check_and_award_time_quests(ctx, &mut player, ctx.timestamp);
                
                // Award AP based on performance
                let base_ap = if victory {
                    // Victory rewards
                    let base = 50;
                    let damage_bonus = (raid_player.damage_dealt / 10).min(100);
                    let accuracy = if raid_player.problems_answered > 0 {
                        (raid_player.correct_answers * 100) / raid_player.problems_answered
                    } else {
                        0
                    };
                    let accuracy_bonus = if accuracy >= 90 { 50 } else if accuracy >= 80 { 25 } else { 0 };
                    base + damage_bonus + accuracy_bonus
                } else {
                    // Defeat rewards - effort is valuable!
                    let base = 25;  // Higher base for trying
                    let effort_bonus = (raid_player.problems_answered * 3).min(50);  // More reward for persistence
                    base + effort_bonus
                };
                
                // Squad bonus for multiplayer (2+ players)
                let multiplayer_bonus = if raid_players.len() > 1 { 25 } else { 0 };
                
                // AP is predictable based on performance - no random bonus
                // The excitement comes from the loot chest variability instead
                let ap_earned = base_ap + multiplayer_bonus;
                
                player.total_ap = player.total_ap.saturating_add(ap_earned);
                
                let player_id_hex = player.id.clone();
                // total_ap tracking removed (was used for verbose logging)
                
                // Calculate and store chest bonus for this player - Robinhood style!
                // Weighted rarity system matching client PALETTE
                let chest_bonus = {
                    // Define rarities with weights (must match client)
                    let rarities = [
                        (25,  65),  // Common: 25 AP, weight 65
                        (50,  20),  // Uncommon: 50 AP, weight 20
                        (75,  10),  // Rare: 75 AP, weight 10
                        (150, 4),   // Epic: 150 AP, weight 4
                        (300, 1),   // Legendary: 300 AP, weight 1
                    ];
                    
                    // Calculate total weight
                    let total_weight: u32 = rarities.iter().map(|(_, w)| w).sum();
                    
                    // Roll the dice!
                    let mut roll = ctx.rng().gen_range(0..total_weight);
                    let mut chosen_ap = 25; // Default to common
                    
                    // Find which rarity we hit
                    for (ap, weight) in rarities.iter() {
                        if roll < *weight {
                            chosen_ap = *ap;
                            break;
                        }
                        roll -= weight;
                    }
                    
                    chosen_ap
                };
                
                // Update raid_player with chest bonus
                let mut updated_raid_player = raid_player.clone();
                updated_raid_player.pending_chest_bonus = Some(chest_bonus);
                update_raid_player(ctx, updated_raid_player);
                
                // Calculate mastery delta for TimeBack
                let mastered_after = calculate_mastered_units_for_timeback(ctx, &player_id_hex, player.grade);
                
                let mastered_before = ctx.db.performance_snapshot()
                    .player_id()
                    .filter(&player_id_hex)
                    .filter(|s| s.grade == player.grade && s.timestamp < raid_started_at)
                    .max_by_key(|s| s.timestamp)
                    .map(|s| s.timeback_units_at_snapshot)
                    .unwrap_or(0);
                
                let mastery_delta = mastered_after as i32 - mastered_before as i32;
                
                // Create TimeBack event if player has TimeBack ID
                if let (Some(timeback_id), Some(email)) = (&player.timeback_id, &player.email) {
                    // Skip blocklisted players (e.g., already completed Fast Math)
                    if TIMEBACK_XP_BLOCKLIST.contains(&timeback_id.as_str()) {
                        log::info!("[XP] player=\"{}\" player_id={} outcome=skipped reason=blocklisted", player.name, &player_id_hex[..8.min(player_id_hex.len())]);
                    } else {
                    // Calculate TimeBack XP with engagement-based scaling
                    let accuracy = if raid_player.problems_answered > 0 {
                        (raid_player.correct_answers * 100) / raid_player.problems_answered
                    } else {
                        0
                    };
                    
                    // Get player's best CQPM on this track for engagement calculation
                    let player_best_cqpm = get_player_best_cqpm(ctx, &player_id_hex, &raid_player.track);
                    let engagement = calculate_engagement(session_cqpm, player_best_cqpm);
                    
                    // Still require 80% accuracy for any XP
                    let meets_accuracy_threshold = accuracy >= 80;
                    
                    // Calculate XP: time × engagement (if accuracy met)
                    // Engagement scales based on how much of their personal floor they hit
                    let active_duration_minutes = active_duration_seconds as f32 / 60.0;
                    let timeback_xp = if meets_accuracy_threshold && engagement > 0.0 {
                        active_duration_minutes.min(2.5) * engagement
                    } else {
                        0.0
                    };
                    
                    // Calculate floor for logging (matches calculate_engagement logic)
                    let floor = f32::max(2.0, player_best_cqpm * 0.25);
                    
                    // Always send event to TimeBack (enables accurate accuracy/time tracking)
                    // XP = 0 when criteria not met, but attempt is still recorded
                    create_timeback_event(
                        ctx,
                        &player_id_hex,
                        timeback_id,
                        email,
                        active_duration_minutes,  // Use active duration (actual or estimated)
                        timeback_xp,              // 0.0 when criteria not met
                        raid_id,                  // Pass raid ID for unique attempt tracking
                        raid_player.problems_answered,
                        raid_player.correct_answers,
                        mastery_delta,
                        player.grade,             // Pass grade for routing to correct course
                    );
                    
                    // Wide event: one line tells the whole story for support tickets
                    if timeback_xp > 0.0 {
                        log::info!("[XP] player=\"{}\" player_id={} outcome=earned xp={:.2} duration_min={:.1} accuracy={} cqpm={:.1} engagement={:.2} floor={:.1} best_cqpm={:.1} track={} boss={} victory={} grade={} raid_id={}",
                            player.name, &player_id_hex[..8.min(player_id_hex.len())], timeback_xp, active_duration_minutes, accuracy, session_cqpm, engagement, floor, player_best_cqpm, raid_player.track.as_deref().unwrap_or("unknown"), raid_boss_level, victory, player.grade, raid_id);
                    } else {
                        let reason = if accuracy < 80 { "low_accuracy" } else { "low_engagement" };
                        
                        // Event sent with xp=0, TimeBack sees attempt for accurate tracking
                        log::info!("[XP] player=\"{}\" player_id={} outcome=reported xp=0 reason={} accuracy={} cqpm={:.1} engagement={:.2} floor={:.1} best_cqpm={:.1} track={} boss={} victory={} grade={} raid_id={}",
                            player.name, &player_id_hex[..8.min(player_id_hex.len())], reason, accuracy, session_cqpm, engagement, floor, player_best_cqpm, raid_player.track.as_deref().unwrap_or("unknown"), raid_boss_level, victory, player.grade, raid_id);
                    }
                    }
                }
                
                ctx.db.player().id().update(player);
                
                // TimeBack XP logged via [XP] above - AP not logged (in-game only)
            }
        }
        
        // Refresh leaderboard once after all players updated (prevents stale rank display)
        // Collect unique grades (handles potential multi-grade raids, though unlikely)
        let grades_in_raid: std::collections::HashSet<u8> = raid_players.iter()
            .filter_map(|rp| ctx.db.player().id().find(&rp.player_id).map(|p| p.grade))
            .collect();
        
        for grade in grades_in_raid {
            refresh_leaderboard(ctx, grade);
        }
        
        // Schedule cleanup after 60 seconds (give players time to see results)
        // Note: SpacetimeDB will automatically call cleanup_abandoned_raids 
        // based on the scheduled table attribute
        
    } else {
        log::error!("end_raid: Could not find raid {}", raid_id);
    }
}

/// Get player's best CQPM on a specific track.
/// Returns 10.0 for new players (generous default).
fn get_player_best_cqpm(ctx: &ReducerContext, player_id: &str, track: &Option<String>) -> f32 {
    let snapshots: Vec<_> = ctx.db.performance_snapshot()
        .player_id()
        .filter(player_id)
        .collect::<Vec<_>>()
        .into_iter()
        .filter(|s| s.track == *track && s.session_seconds > 30)
        .collect();
    
    // Find max CQPM
    let best = snapshots.iter()
        .map(|s| s.problems_correct as f32 * 60.0 / s.session_seconds as f32)
        .fold(0.0_f32, |a, b| a.max(b));
    
    // Default for new players
    if best < 1.0 { 10.0 } else { best }
}

/// Calculate engagement multiplier for XP.
/// Floor = max(2.0, 25% of their best CQPM on this track)
/// No cap - scales with player ability to prevent sandbagging.
/// Returns 0.0 if below 30% of floor (true AFK), otherwise proportional.
fn calculate_engagement(session_cqpm: f32, player_best_cqpm: f32) -> f32 {
    let floor = f32::max(2.0, player_best_cqpm * 0.25);
    let raw_engagement = session_cqpm / floor;
    
    if raw_engagement < 0.3 {
        0.0  // True AFK gets nothing
    } else {
        f32::min(1.0, raw_engagement)
    }
}

/// Calculate mastered units for Timeback reporting (AlphaMath structure)
/// Counts 5×6 and 6×5 as separate units to match AlphaMath's 169/144 fact count
/// Symmetric facts (5×5, 3+3) count as 1, asymmetric (5×6, 3+4) count as 2
/// Only counts facts for current grade (not facts from previous grades)
fn calculate_mastered_units_for_timeback(ctx: &ReducerContext, player_id: &str, grade: u8) -> u32 {
    // Get valid fact keys for current grade
    let grade_facts = get_facts_for_grade(grade);
    let valid_fact_keys: std::collections::HashSet<String> = grade_facts
        .iter()
        .map(|f| f.to_key())
        .collect();
    
    // Only count mastered facts that belong to current grade
    let mastered_facts = ctx.db.fact_mastery()
        .player_id()
        .filter(player_id)
        .filter(|fm| fm.mastery_level >= 5 && valid_fact_keys.contains(&fm.fact_key));
    
    let mut count = 0;
    for fact in mastered_facts {
        // Check if commutative operation (multiply or add)
        let is_commutative = fact.fact_key.contains('×') || fact.fact_key.contains('+');
        
        if is_commutative {
            // Parse to check if symmetric (5×5) or asymmetric (5×6)
            let parts: Vec<&str> = if fact.fact_key.contains('×') {
                fact.fact_key.split('×').collect()
            } else {
                fact.fact_key.split('+').collect()
            };
            
            if parts.len() == 2 {
                let left: Result<u8, _> = parts[0].parse();
                let right: Result<u8, _> = parts[1].parse();
                
                if let (Ok(l), Ok(r)) = (left, right) {
                    if l == r {
                        count += 1;  // Symmetric (5×5): only one fact
                    } else {
                        count += 2;  // Asymmetric (5×6): counts as both 5×6 and 6×5
                    }
                } else {
                    count += 1;  // Parse failed, default to 1
                }
            } else {
                count += 1;  // Unexpected format, default to 1
            }
        } else {
            count += 1;  // Division/subtraction = one direction only
        }
    }
    
    count
}

/// Create a TimeBack event for XP tracking
fn create_timeback_event(
    ctx: &ReducerContext,
    player_id: &str,
    timeback_id: &str,
    email: &str,
    duration_minutes: f32,
    xp_earned: f32,
    raid_id: u64,
    problems_answered: u32,
    correct_answers: u32,
    mastery_delta: i32,
    grade: u8,  // Player's grade for routing to correct course
) {
    // Log TimeBack event creation (without sensitive data)
    // TimeBack event creation is logged by [XP] above - no need for duplicate
    
    // Create the JSON payload
    // Format timestamp for TimeBack (exactly 3 decimal places, Z suffix)
    let timestamp = ctx.timestamp.to_rfc3339().unwrap();
    let formatted_timestamp = {
        // Find the dot for milliseconds
        if let Some(dot_pos) = timestamp.find('.') {
            // Take up to 3 digits after the dot
            let mut end_pos = dot_pos + 4; // dot + 3 digits
            
            // Find where the timezone starts (+, -, or Z)
            for (i, ch) in timestamp[dot_pos..].chars().enumerate() {
                if ch == '+' || ch == '-' || ch == 'Z' {
                    end_pos = dot_pos + i;
                    break;
                }
            }
            
            // Ensure we have exactly 3 decimal places
            let decimal_part = &timestamp[dot_pos+1..end_pos];
            let padded_decimals = format!("{:0<3}", decimal_part); // Pad with zeros if needed
            format!("{}.{}Z", &timestamp[..dot_pos], &padded_decimals[..3])
        } else {
            // No decimal part, add .000Z
            let base = timestamp.trim_end_matches(|c: char| c == 'Z' || c == '+' || c == '-' || c.is_numeric() || c == ':');
            format!("{}.000Z", base)
        }
    };
    
    // Construct grade-specific resource ID
    let resource_id = format!("math-raiders-grade-{}-component-resource", grade);
    
    let payload = serde_json::json!({
        "timebackId": timeback_id,
        "email": email,
        "grade": grade,  // Include grade for worker to route correctly
        "resourceId": resource_id,
        "raidEndTime": formatted_timestamp,
        "raidDurationMinutes": duration_minutes,
        "xpEarned": xp_earned,
        "totalQuestions": problems_answered,
        "correctQuestions": correct_answers,
        "masteredUnits": mastery_delta,  // Delta (can be negative)
        "process": true,  // Required for XP to display in dashboard
        "attempt": raid_id  // Each raid = unique assessment (prevents overwriting)
    });
    
    // Insert into the queue
    ctx.db.timeback_event_queue().insert(TimebackEventQueue {
        id: 0, // auto_inc
        player_id: player_id.to_string(),
        payload: payload.to_string(),
        created_at: ctx.timestamp,
        sent: false,
        attempts: 0,
        next_retry_at: None, // Ready to send immediately
        last_error: None,
        sent_at: None,
    });
}

/// Test reducer to create a TimeBack event (for testing only)
/// Protected by authorization check - only authorized workers can call this
#[reducer]
pub fn test_create_timeback_event(
    ctx: &ReducerContext,
    player_id: String,
    timeback_id: String,
    raid_id: u64,
    email: String,
    xp_earned: f32,
    level: u8,
    problems_answered: u32,
    correct_answers: u32,
) {
    // Authorization check: only authorized workers can create test events
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized test_create_timeback_event attempt by {}", ctx.sender);
        return;
    }
    
    // For test events, send total as delta (no baseline to compare)
    let mastery_delta = calculate_mastered_units_for_timeback(ctx, &player_id, level) as i32;
    
    let duration_minutes = xp_earned;
    
    create_timeback_event(
        ctx,
        &player_id,
        &timeback_id,
        &email,
        duration_minutes,
        xp_earned,
        raid_id,
        problems_answered,
        correct_answers,
        mastery_delta,
        level,
    );
    log::info!("🧪 Test TimeBack event created for player {} (grade {})", player_id, level);
}

/// Mark a TimeBack event as sent (called by worker)
/// Protected by authorization check - only authorized workers can call this
#[reducer]
pub fn mark_event_sent(ctx: &ReducerContext, event_id: u64, error: Option<String>) {
    // Authorization check: only authorized workers can mark events as sent
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized mark_event_sent attempt by {}", ctx.sender);
        return;
    }
    
    if let Some(mut event) = ctx.db.timeback_event_queue().id().find(&event_id) {
        if error.is_none() {
            // Success
            event.sent = true;
            event.sent_at = Some(ctx.timestamp);
            event.last_error = None;
            log::info!("✅ TimeBack event {} marked as sent", event_id);
        } else {
            // Failed - increment attempts and set retry time
            event.attempts = event.attempts.saturating_add(1);
            event.last_error = error;
            
            // Safety check: Don't retry forever (worker should handle this, but just in case)
            if event.attempts >= 5 {
                event.sent = true; // Remove from queue
                log::error!("🛑 TimeBack event {} exceeded max retries (5), marking as done", event_id);
            } else {
                // Exponential backoff: 1min, 2min, 4min, 8min, 16min
                let backoff_minutes = 1u64 << event.attempts.min(4);
                let backoff_micros = backoff_minutes * 60 * 1_000_000;
                let current_micros = ctx.timestamp.to_micros_since_unix_epoch();
                let next_retry_micros = current_micros + backoff_micros as i64;
                let next_retry = Timestamp::from_micros_since_unix_epoch(next_retry_micros);
                event.next_retry_at = Some(next_retry);
                
                log::warn!("❌ TimeBack event {} failed (attempt {}): {:?}", 
                    event_id, event.attempts, event.last_error);
            }
        }
        
        ctx.db.timeback_event_queue().id().update(event);
    } else {
        log::error!("mark_event_sent: Event {} not found", event_id);
    }
}

fn is_new_day(last: Timestamp, current: Timestamp) -> bool {
    // Reset at midnight PST (8am UTC)
    // This ensures US students see reset overnight, not during homework time
    const RESET_HOUR_UTC: u64 = 8; // midnight PST = 8am UTC
    
    let hour_in_micros = 60 * 60 * 1_000_000u64;
    let day_in_micros = 24 * hour_in_micros;
    
    // Offset timestamps by reset hour to make midnight PST the "start" of day
    let offset_micros = RESET_HOUR_UTC * hour_in_micros;
    let last_offset = (last.to_micros_since_unix_epoch() as u64).saturating_sub(offset_micros);
    let current_offset = (current.to_micros_since_unix_epoch() as u64).saturating_sub(offset_micros);
    
    // Now divide by day to get "day number" since reset time
    let last_day = last_offset / day_in_micros;
    let current_day = current_offset / day_in_micros;
    
    current_day > last_day
}

/// Calculate number of days between two timestamps (for streak tracking)
fn calculate_days_between(last: Timestamp, current: Timestamp) -> u64 {
    const RESET_HOUR_UTC: u64 = 8; // midnight PST = 8am UTC
    let hour_in_micros = 60 * 60 * 1_000_000u64;
    let day_in_micros = 24 * hour_in_micros;
    let offset_micros = RESET_HOUR_UTC * hour_in_micros;
    
    let last_offset = (last.to_micros_since_unix_epoch() as u64).saturating_sub(offset_micros);
    let current_offset = (current.to_micros_since_unix_epoch() as u64).saturating_sub(offset_micros);
    
    let last_day = last_offset / day_in_micros;
    let current_day = current_offset / day_in_micros;
    
    current_day.saturating_sub(last_day)
}

fn is_new_week(last: Timestamp, current: Timestamp) -> bool {
    // Reset weekly on Monday at midnight PST (8am UTC)
    const RESET_HOUR_UTC: u64 = 8; // midnight PST = 8am UTC
    
    let hour_in_micros = 60 * 60 * 1_000_000u64;
    let day_in_micros = 24 * hour_in_micros;
    let week_in_micros = 7 * day_in_micros;
    
    // Unix epoch was Thursday, we want Monday = 4 days offset
    // Plus 8 hours to align with midnight PST
    let days_offset = 4;
    let total_offset_micros = (days_offset * 24 + RESET_HOUR_UTC) * hour_in_micros;
    
    let last_offset = (last.to_micros_since_unix_epoch() as u64).saturating_sub(total_offset_micros);
    let current_offset = (current.to_micros_since_unix_epoch() as u64).saturating_sub(total_offset_micros);
    
    let last_week = last_offset / week_in_micros;
    let current_week = current_offset / week_in_micros;
    
    current_week > last_week
}

fn cleanup_raid_data(ctx: &ReducerContext, raid_id: u64) {
    // Cancel any pending scheduled reducers for this raid
    cancel_raid_timeout(ctx, raid_id);
    cancel_countdown_schedule(ctx, raid_id);
    
    // Clear all player references BEFORE deleting anything
    // This prevents dangling pointers if a player reconnects mid-cleanup
    let raid_players: Vec<_> = ctx.db.raid_player().raid_id().filter(&raid_id).collect();
    for rp in &raid_players {
        if let Some(mut player) = ctx.db.player().id().find(&rp.player_id) {
            if player.in_raid_id == Some(raid_id) {
                player.in_raid_id = None;
                ctx.db.player().id().update(player);
            }
        }
    }
    
    // Clean up all problems for this raid
    let problems: Vec<_> = ctx.db.problem().raid_id().filter(&raid_id).collect();
    for problem in problems {
        // Clean up answers for this problem
        let answers_to_delete: Vec<_> = ctx.db.player_answer()
            .problem_id()
            .filter(&problem.id)
            .collect();
        for answer in answers_to_delete {
            ctx.db.player_answer().id().delete(&answer.id);
        }
        ctx.db.problem().id().delete(&problem.id);
    }
    
    // Clean up raid players
    for rp in raid_players {
        ctx.db.raid_player().id().delete(&rp.id);
    }
    
    ctx.db.raid().id().delete(&raid_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_operation_compute() {
        // Test addition
        assert_eq!(Operation::Add.compute(5, 3), 8);
        assert_eq!(Operation::Add.compute(0, 0), 0);
        assert_eq!(Operation::Add.compute(12, 12), 24);
        
        // Test subtraction
        assert_eq!(Operation::Subtract.compute(5, 3), 2);
        assert_eq!(Operation::Subtract.compute(3, 5), -2);
        assert_eq!(Operation::Subtract.compute(10, 10), 0);
        
        // Test multiplication
        assert_eq!(Operation::Multiply.compute(5, 3), 15);
        assert_eq!(Operation::Multiply.compute(0, 10), 0);
        assert_eq!(Operation::Multiply.compute(12, 12), 144);
        
        // Test division
        assert_eq!(Operation::Divide.compute(10, 2), 5);
        assert_eq!(Operation::Divide.compute(9, 3), 3);
        assert_eq!(Operation::Divide.compute(5, 2), 2); // Integer division
        assert_eq!(Operation::Divide.compute(5, 0), 0); // Division by zero protection
    }
    
    #[test]
    fn test_operation_symbol() {
        assert_eq!(Operation::Add.symbol(), "+");
        assert_eq!(Operation::Subtract.symbol(), "-");
        assert_eq!(Operation::Multiply.symbol(), "×");
        assert_eq!(Operation::Divide.symbol(), "÷");
    }
    
    #[test]
    fn test_normalize_fact() {
        // Commutative operations - should normalize to smaller first
        assert_eq!(normalize_fact(5, 3, &Operation::Add), "3+5");
        assert_eq!(normalize_fact(3, 5, &Operation::Add), "3+5");
        assert_eq!(normalize_fact(7, 4, &Operation::Multiply), "4×7");
        assert_eq!(normalize_fact(4, 7, &Operation::Multiply), "4×7");
        
        // Non-commutative operations - should keep order
        assert_eq!(normalize_fact(5, 3, &Operation::Subtract), "5-3");
        assert_eq!(normalize_fact(3, 5, &Operation::Subtract), "3-5");
        assert_eq!(normalize_fact(10, 2, &Operation::Divide), "10÷2");
        assert_eq!(normalize_fact(2, 10, &Operation::Divide), "2÷10");
    }
}
