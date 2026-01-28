// Bulk restore reducers for disaster recovery
// Accept JSON arrays exported from admin panel (TypeScript SDK format)

use spacetimedb::{reducer, ReducerContext, Timestamp, log, Table};
use crate::{Player, FactMastery, PerformanceSnapshot, AttemptRecord, authorized_worker};
use crate::{player, fact_mastery, performance_snapshot};
use serde_json::Value;

/// Parse Timestamp from SDK JSON format: {"__timestamp_micros_since_unix_epoch__": "123456"}
fn parse_timestamp_json(val: &Value) -> Result<Timestamp, String> {
    let micros_str = val.get("__timestamp_micros_since_unix_epoch__")
        .and_then(|v| v.as_str())
        .ok_or("Missing or invalid timestamp field")?;
    
    let micros: i64 = micros_str.parse()
        .map_err(|e| format!("Invalid timestamp micros: {}", e))?;
    
    Ok(Timestamp::from_micros_since_unix_epoch(micros))
}

/// Parse AttemptRecord from SDK JSON
fn parse_attempt_record(val: &Value) -> Result<AttemptRecord, String> {
    Ok(AttemptRecord {
        time_ms: val.get("timeMs")
            .and_then(|v| v.as_u64())
            .ok_or("Missing timeMs")? as u32,
        correct: val.get("correct")
            .and_then(|v| v.as_bool())
            .ok_or("Missing correct")?,
        timestamp: parse_timestamp_json(val.get("timestamp").ok_or("Missing timestamp")?)?,
    })
}

/// Bulk restore player table from JSON array
/// Protected by authorization check - only authorized workers can call this
#[reducer]
pub fn bulk_restore_player(ctx: &ReducerContext, json_data: String) -> Result<(), String> {
    // Authorization check: only authorized workers can restore data
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized bulk_restore_player attempt by {}", ctx.sender);
        return Err("Unauthorized".to_string());
    }
    
    let data: Value = serde_json::from_str(&json_data)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    let players = data.as_array()
        .ok_or("Expected JSON array of players")?;
    
    let mut count = 0;
    for (i, p) in players.iter().enumerate() {
        let player = Player {
            id: p.get("id").and_then(|v| v.as_str()).ok_or(format!("Player {}: missing id", i))?.to_string(),
            name: p.get("name").and_then(|v| v.as_str()).ok_or(format!("Player {}: missing name", i))?.to_string(),
            grade: p.get("grade").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing grade", i))? as u8,
            rank: p.get("rank").and_then(|v| v.as_str()).map(|s| s.to_string()),
            total_problems: p.get("totalProblems").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing totalProblems", i))? as u32,
            total_correct: p.get("totalCorrect").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing totalCorrect", i))? as u32,
            avg_response_ms: p.get("avgResponseMs").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing avgResponseMs", i))? as u32,
            best_response_ms: p.get("bestResponseMs").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing bestResponseMs", i))? as u32,
            total_raids: p.get("totalRaids").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing totalRaids", i))? as u32,
            quests: p.get("quests").and_then(|v| v.as_str()).map(|s| s.to_string()),
            last_played: parse_timestamp_json(p.get("lastPlayed").ok_or(format!("Player {}: missing lastPlayed", i))?)?,
            last_raid: p.get("lastRaid").and_then(|v| parse_timestamp_json(v).ok())
                .unwrap_or_else(|| parse_timestamp_json(p.get("lastPlayed").unwrap()).unwrap()),  // Default to last_played for old backups
            last_weekly_reset: parse_timestamp_json(p.get("lastWeeklyReset").ok_or(format!("Player {}: missing lastWeeklyReset", i))?)?,
            total_ap: p.get("totalAp").and_then(|v| v.as_u64()).ok_or(format!("Player {}: missing totalAp", i))? as u32,
            in_raid_id: p.get("inRaidId").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()),
            timeback_id: p.get("timebackId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            email: p.get("email").and_then(|v| v.as_str()).map(|s| s.to_string()),
        };
        
        ctx.db.player().insert(player);
        count += 1;
    }
    
    log::info!("✅ Restored {} player records", count);
    Ok(())
}

/// Bulk restore fact_mastery table from JSON array
/// Protected by authorization check - only authorized workers can call this
#[reducer]
pub fn bulk_restore_fact_mastery(ctx: &ReducerContext, json_data: String) -> Result<(), String> {
    // Authorization check: only authorized workers can restore data
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized bulk_restore_fact_mastery attempt by {}", ctx.sender);
        return Err("Unauthorized".to_string());
    }
    
    let data: Value = serde_json::from_str(&json_data)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    let facts = data.as_array()
        .ok_or("Expected JSON array of fact_mastery records")?;
    
    let mut count = 0;
    for (i, f) in facts.iter().enumerate() {
        // Parse recent_attempts array
        let recent_attempts_json = f.get("recentAttempts")
            .and_then(|v| v.as_array())
            .ok_or(format!("Fact {}: missing or invalid recentAttempts", i))?;
        
        let recent_attempts: Vec<AttemptRecord> = recent_attempts_json.iter()
            .map(|a| parse_attempt_record(a))
            .collect::<Result<Vec<_>, _>>()?;
        
        let fact = FactMastery {
            id: 0, // auto_inc
            player_id: f.get("playerId").and_then(|v| v.as_str()).ok_or(format!("Fact {}: missing playerId", i))?.to_string(),
            fact_key: f.get("factKey").and_then(|v| v.as_str()).ok_or(format!("Fact {}: missing factKey", i))?.to_string(),
            total_attempts: f.get("totalAttempts").and_then(|v| v.as_u64()).ok_or(format!("Fact {}: missing totalAttempts", i))? as u32,
            total_correct: f.get("totalCorrect").and_then(|v| v.as_u64()).ok_or(format!("Fact {}: missing totalCorrect", i))? as u32,
            last_seen: parse_timestamp_json(f.get("lastSeen").ok_or(format!("Fact {}: missing lastSeen", i))?)?,
            avg_response_ms: f.get("avgResponseMs").and_then(|v| v.as_u64()).ok_or(format!("Fact {}: missing avgResponseMs", i))? as u32,
            fastest_ms: f.get("fastestMs").and_then(|v| v.as_u64()).ok_or(format!("Fact {}: missing fastestMs", i))? as u32,
            recent_attempts,
            mastery_level: f.get("masteryLevel").and_then(|v| v.as_u64()).ok_or(format!("Fact {}: missing masteryLevel", i))? as u8,
        };
        
        ctx.db.fact_mastery().insert(fact);
        count += 1;
    }
    
    log::info!("✅ Restored {} fact_mastery records", count);
    Ok(())
}

/// Bulk restore performance_snapshot table from JSON array
/// Protected by authorization check - only authorized workers can call this
#[reducer]
pub fn bulk_restore_performance_snapshot(ctx: &ReducerContext, json_data: String) -> Result<(), String> {
    // Authorization check: only authorized workers can restore data
    if ctx.db.authorized_worker().identity().find(&ctx.sender).is_none() {
        log::warn!("Unauthorized bulk_restore_performance_snapshot attempt by {}", ctx.sender);
        return Err("Unauthorized".to_string());
    }
    
    let data: Value = serde_json::from_str(&json_data)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    let snapshots = data.as_array()
        .ok_or("Expected JSON array of performance_snapshot records")?;
    
    let mut count = 0;
    for (i, s) in snapshots.iter().enumerate() {
        let snapshot = PerformanceSnapshot {
            id: 0, // auto_inc
            player_id: s.get("playerId").and_then(|v| v.as_str()).ok_or(format!("Snapshot {}: missing playerId", i))?.to_string(),
            timestamp: parse_timestamp_json(s.get("timestamp").ok_or(format!("Snapshot {}: missing timestamp", i))?)?,
            grade: s.get("grade").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing grade", i))? as u8,
            track: s.get("track").and_then(|v| v.as_str()).map(|s| s.to_string()),
            rank: s.get("rank").and_then(|v| v.as_str()).map(|s| s.to_string()),
            division: s.get("division").and_then(|v| v.as_str()).map(|s| s.to_string()),
            facts_mastered_at_snapshot: s.get("factsMasteredAtSnapshot").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing factsMasteredAtSnapshot", i))? as u32,
            problems_attempted: s.get("problemsAttempted").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing problemsAttempted", i))? as u32,
            problems_correct: s.get("problemsCorrect").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing problemsCorrect", i))? as u32,
            session_seconds: s.get("sessionSeconds").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing sessionSeconds", i))? as u32,
            damage_dealt: s.get("damageDealt").and_then(|v| v.as_u64()).ok_or(format!("Snapshot {}: missing damageDealt", i))? as u32,
            raid_type: s.get("raidType").and_then(|v| v.as_str()).map(|s| s.to_string()),
            timeback_units_at_snapshot: s.get("timebackUnitsAtSnapshot").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            boss_level: s.get("bossLevel").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
            victory: s.get("victory").and_then(|v| v.as_bool()),
        };
        
        ctx.db.performance_snapshot().insert(snapshot);
        count += 1;
    }
    
    log::info!("✅ Restored {} performance_snapshot records", count);
    Ok(())
}
