#!/usr/bin/env bun
// Verify that JSON and SQLite backups are 1:1 equivalent
// Usage: bun scripts/ops/verify-backup-equivalence.ts <backup-path-without-extension>
// Example: bun scripts/ops/verify-backup-equivalence.ts backups/production_2025-10-22

import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';

function verify(basePath: string) {
  console.log('🔍 Verifying backup equivalence...');
  console.log(`📁 JSON: ${basePath}.json`);
  console.log(`📁 SQLite: ${basePath}.sqlite`);
  console.log('');
  
  // Load both formats
  const json = JSON.parse(readFileSync(`${basePath}.json`, 'utf-8'));
  const db = new Database(`${basePath}.sqlite`);
  
  let errors = 0;
  
  // Helper to log errors
  const error = (msg: string) => {
    console.error(`❌ ${msg}`);
    errors++;
  };
  
  // Helper to log success
  const ok = (msg: string) => {
    console.log(`✓ ${msg}`);
  };
  
  // 1. TABLE COUNTS
  console.log('1️⃣  Checking table counts...');
  
  const tables = ['player', 'fact_mastery', 'performance_snapshot'];
  for (const table of tables) {
    const jsonCount = json.tables[table].length;
    const sqlCount = db.query(`SELECT COUNT(*) as n FROM ${table}`).get().n;
    
    if (jsonCount !== sqlCount) {
      error(`${table}: JSON has ${jsonCount}, SQLite has ${sqlCount}`);
    } else {
      ok(`${table}: ${jsonCount} records`);
    }
  }
  console.log('');
  
  // 2. PLAYER RECORDS
  console.log('2️⃣  Checking player records...');
  
  for (const jsonPlayer of json.tables.player) {
    const sqlPlayer = db.query('SELECT * FROM player WHERE id = ?').get(jsonPlayer.id);
    
    if (!sqlPlayer) {
      error(`Player ${jsonPlayer.id} exists in JSON but not SQLite`);
      continue;
    }
    
    // Check each field (handle type conversions)
    // Note: Timestamps in JSON are objects with __timestamp_micros_since_unix_epoch__
    const toNumber = (val: any) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'bigint') return Number(val);
      if (val && typeof val === 'object' && '__timestamp_micros_since_unix_epoch__' in val) {
        return Number(val.__timestamp_micros_since_unix_epoch__);
      }
      return val;
    };
    
    const checks = [
      { field: 'name', json: jsonPlayer.name, sql: sqlPlayer.name },
      { field: 'grade', json: jsonPlayer.grade, sql: sqlPlayer.grade },
      { field: 'rank', json: jsonPlayer.rank || null, sql: sqlPlayer.rank },
      { field: 'totalProblems', json: jsonPlayer.totalProblems, sql: sqlPlayer.total_problems },
      { field: 'totalCorrect', json: jsonPlayer.totalCorrect, sql: sqlPlayer.total_correct },
      { field: 'avgResponseMs', json: jsonPlayer.avgResponseMs, sql: sqlPlayer.avg_response_ms },
      { field: 'bestResponseMs', json: jsonPlayer.bestResponseMs, sql: sqlPlayer.best_response_ms },
      { field: 'totalRaids', json: jsonPlayer.totalRaids, sql: sqlPlayer.total_raids },
      { field: 'quests', json: jsonPlayer.quests || null, sql: sqlPlayer.quests },
      { field: 'lastPlayed', json: toNumber(jsonPlayer.lastPlayed), sql: sqlPlayer.last_played },
      { field: 'lastRaid', json: toNumber(jsonPlayer.lastRaid), sql: sqlPlayer.last_raid },
      { field: 'lastWeeklyReset', json: toNumber(jsonPlayer.lastWeeklyReset), sql: sqlPlayer.last_weekly_reset },
      { field: 'totalAp', json: jsonPlayer.totalAp, sql: sqlPlayer.total_ap },
      { field: 'inRaidId', json: jsonPlayer.inRaidId || null, sql: sqlPlayer.in_raid_id },
      { field: 'timebackId', json: jsonPlayer.timebackId || null, sql: sqlPlayer.timeback_id },
      { field: 'email', json: jsonPlayer.email || null, sql: sqlPlayer.email },
    ];
    
    for (const check of checks) {
      if (check.json !== check.sql) {
        error(`Player ${jsonPlayer.name}: ${check.field} mismatch (JSON: ${JSON.stringify(check.json)}, SQLite: ${JSON.stringify(check.sql)})`);
      }
    }
  }
  
  // Check reverse direction (SQLite → JSON)
  const sqlPlayerIds = db.query('SELECT id FROM player').all().map(p => p.id);
  for (const id of sqlPlayerIds) {
    if (!json.tables.player.find(p => p.id === id)) {
      error(`Player ${id} exists in SQLite but not JSON`);
    }
  }
  
  ok(`All ${json.tables.player.length} players match`);
  console.log('');
  
  // 3. FACT MASTERY RECORDS
  console.log('3️⃣  Checking fact mastery records...');
  
  for (const jsonFM of json.tables.fact_mastery) {
    const sqlFM = db.query('SELECT * FROM fact_mastery WHERE id = ?').get(jsonFM.id);
    
    if (!sqlFM) {
      error(`FactMastery ${jsonFM.id} exists in JSON but not SQLite`);
      continue;
    }
    
    // Check fields (use same toNumber helper)
    const toNumber = (val: any) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'bigint') return Number(val);
      if (val && typeof val === 'object' && '__timestamp_micros_since_unix_epoch__' in val) {
        return Number(val.__timestamp_micros_since_unix_epoch__);
      }
      return val;
    };
    
    if (jsonFM.playerId !== sqlFM.player_id ||
        jsonFM.factKey !== sqlFM.fact_key ||
        jsonFM.totalAttempts !== sqlFM.total_attempts ||
        jsonFM.totalCorrect !== sqlFM.total_correct ||
        toNumber(jsonFM.lastSeen) !== sqlFM.last_seen ||
        jsonFM.avgResponseMs !== sqlFM.avg_response_ms ||
        jsonFM.fastestMs !== sqlFM.fastest_ms ||
        jsonFM.masteryLevel !== sqlFM.mastery_level) {
      error(`FactMastery ${jsonFM.id}: field mismatch`);
    }
    
    // Deep check: recentAttempts (nested array)
    const jsonAttempts = JSON.stringify(jsonFM.recentAttempts, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    if (jsonAttempts !== sqlFM.recent_attempts) {
      error(`FactMastery ${jsonFM.id}: recentAttempts mismatch`);
    }
  }
  
  ok(`All ${json.tables.fact_mastery.length} fact mastery records match`);
  console.log('');
  
  // 4. PERFORMANCE SNAPSHOTS
  console.log('4️⃣  Checking performance snapshots...');
  
  for (const jsonSnap of json.tables.performance_snapshot) {
    const sqlSnap = db.query('SELECT * FROM performance_snapshot WHERE id = ?').get(jsonSnap.id);
    
    if (!sqlSnap) {
      error(`Snapshot ${jsonSnap.id} exists in JSON but not SQLite`);
      continue;
    }
    
    // Use same toNumber helper for timestamps
    const toNumber = (val: any) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'bigint') return Number(val);
      if (val && typeof val === 'object' && '__timestamp_micros_since_unix_epoch__' in val) {
        return Number(val.__timestamp_micros_since_unix_epoch__);
      }
      return val;
    };
    
    const checks = [
      { field: 'playerId', json: jsonSnap.playerId, sql: sqlSnap.player_id },
      { field: 'timestamp', json: toNumber(jsonSnap.timestamp), sql: sqlSnap.timestamp },
      { field: 'grade', json: jsonSnap.grade, sql: sqlSnap.grade },
      { field: 'track', json: jsonSnap.track || null, sql: sqlSnap.track },
      { field: 'rank', json: jsonSnap.rank || null, sql: sqlSnap.rank },
      { field: 'division', json: jsonSnap.division || null, sql: sqlSnap.division },
      { field: 'factsMasteredAtSnapshot', json: jsonSnap.factsMasteredAtSnapshot, sql: sqlSnap.facts_mastered_at_snapshot },
      { field: 'problemsAttempted', json: jsonSnap.problemsAttempted, sql: sqlSnap.problems_attempted },
      { field: 'problemsCorrect', json: jsonSnap.problemsCorrect, sql: sqlSnap.problems_correct },
      { field: 'sessionSeconds', json: jsonSnap.sessionSeconds, sql: sqlSnap.session_seconds },
      { field: 'damageDealt', json: jsonSnap.damageDealt, sql: sqlSnap.damage_dealt },
      { field: 'raidType', json: jsonSnap.raidType || null, sql: sqlSnap.raid_type },
    ];
    
    for (const check of checks) {
      if (check.json !== check.sql) {
        error(`Snapshot ${jsonSnap.id}: ${check.field} mismatch (JSON: ${JSON.stringify(check.json)}, SQLite: ${JSON.stringify(check.sql)})`);
      }
    }
  }
  
  ok(`All ${json.tables.performance_snapshot.length} snapshots match`);
  console.log('');
  
  // 5. METADATA
  console.log('5️⃣  Checking metadata...');
  const meta = db.query('SELECT key, value FROM meta').all();
  const metaObj = Object.fromEntries(meta.map(m => [m.key, m.value]));
  
  if (metaObj.version !== json.version) error(`Version mismatch: JSON=${json.version}, SQLite=${metaObj.version}`);
  if (metaObj.environment !== json.environment) error(`Environment mismatch`);
  if (metaObj.module !== json.module) error(`Module mismatch`);
  
  ok(`Metadata matches`);
  console.log('');
  
  // Close SQLite
  db.close();
  
  // Summary
  console.log('═'.repeat(50));
  if (errors === 0) {
    console.log('✅ VERIFIED: JSON and SQLite are 1:1 equivalent');
    console.log(`   ${json.counts.player} players, ${json.counts.fact_mastery} facts, ${json.counts.performance_snapshot} snapshots`);
    process.exit(0);
  } else {
    console.error(`❌ FAILED: Found ${errors} discrepancies`);
    process.exit(1);
  }
}

// CLI
const basePath = process.argv[2];
if (!basePath) {
  console.error('Usage: bun verify-backup-equivalence.ts <backup-path-without-extension>');
  console.error('Example: bun verify-backup-equivalence.ts backups/production_2025-10-22_14-41');
  process.exit(1);
}

verify(basePath);

