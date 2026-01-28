#!/usr/bin/env bun
// Automated backup export for Math Raiders
// Usage: bun run scripts/export-backup.ts --env <local|staging|production> --output <file>
// Exports both JSON (for quick restore/diffs) and SQLite (for inspection/migrations)

// Polyfill MUST run before SpacetimeDB SDK import
import '@ungap/compression-stream/poly';

import { DbConnection } from '../../client/src/spacetime';
import { writeFileSync, readFileSync } from 'fs';
import { Database } from 'bun:sqlite';

const SERVERS = {
  local: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders' },
  staging: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders-staging' },
  production: { uri: 'ws://18.224.110.93:3000', module: 'math-raiders' },
};

// Write data to SQLite for inspection and migrations
function writeToSQLite(path: string, data: { players: any[], factMasteries: any[], snapshots: any[], backup: any }) {
  // Remove existing file if present (fresh export each time)
  if (require('fs').existsSync(path)) {
    require('fs').unlinkSync(path);
  }
  
  const db = new Database(path);
  
  // Single transaction for all writes (fast)
  db.run('BEGIN');
  
  // Metadata table
  db.run(`CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run('INSERT INTO meta VALUES (?, ?)', 'version', data.backup.version);
  db.run('INSERT INTO meta VALUES (?, ?)', 'environment', data.backup.environment);
  db.run('INSERT INTO meta VALUES (?, ?)', 'timestamp', data.backup.timestamp);
  db.run('INSERT INTO meta VALUES (?, ?)', 'module', data.backup.module);
  
  // Player table
  db.run(`CREATE TABLE player (
    id TEXT PRIMARY KEY,
    name TEXT,
    grade INTEGER,
    rank TEXT,
    total_problems INTEGER,
    total_correct INTEGER,
    avg_response_ms INTEGER,
    best_response_ms INTEGER,
    total_raids INTEGER,
    quests TEXT,
    last_played INTEGER,
    last_raid INTEGER,
    last_weekly_reset INTEGER,
    total_ap INTEGER,
    in_raid_id INTEGER,
    timeback_id TEXT,
    email TEXT
  )`);
  
  // Helper to extract timestamp value
  const toTimestamp = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'bigint') return Number(val);
    if (val && typeof val === 'object' && '__timestamp_micros_since_unix_epoch__' in val) {
      return Number(val.__timestamp_micros_since_unix_epoch__);
    }
    return 0;
  };
  
  const insertPlayer = db.prepare(`INSERT INTO player VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of data.players) {
    insertPlayer.run(
      p.id, p.name, p.grade, p.rank || null,
      p.totalProblems, p.totalCorrect, p.avgResponseMs, p.bestResponseMs,
      p.totalRaids, p.quests || null,
      toTimestamp(p.lastPlayed), toTimestamp(p.lastRaid), toTimestamp(p.lastWeeklyReset),
      p.totalAp, p.inRaidId || null, p.timebackId || null, p.email || null
    );
  }
  
  // Fact mastery table
  db.run(`CREATE TABLE fact_mastery (
    id TEXT PRIMARY KEY,
    player_id TEXT,
    fact_key TEXT,
    total_attempts INTEGER,
    total_correct INTEGER,
    last_seen INTEGER,
    avg_response_ms INTEGER,
    fastest_ms INTEGER,
    recent_attempts TEXT,
    mastery_level INTEGER,
    FOREIGN KEY(player_id) REFERENCES player(id)
  )`);
  db.run('CREATE INDEX idx_fact_mastery_player ON fact_mastery(player_id)');
  
  const insertFact = db.prepare('INSERT INTO fact_mastery VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const fm of data.factMasteries) {
    insertFact.run(
      fm.id, fm.playerId, fm.factKey,
      fm.totalAttempts, fm.totalCorrect, toTimestamp(fm.lastSeen),
      fm.avgResponseMs, fm.fastestMs,
      JSON.stringify(fm.recentAttempts, (k, v) => typeof v === 'bigint' ? v.toString() : v),
      fm.masteryLevel
    );
  }
  
  // Performance snapshot table
  db.run(`CREATE TABLE performance_snapshot (
    id TEXT PRIMARY KEY,
    player_id TEXT,
    timestamp INTEGER,
    grade INTEGER,
    track TEXT,
    rank TEXT,
    division TEXT,
    facts_mastered_at_snapshot INTEGER,
    timeback_units_at_snapshot INTEGER,
    problems_attempted INTEGER,
    problems_correct INTEGER,
    session_seconds INTEGER,
    damage_dealt INTEGER,
    raid_type TEXT,
    boss_level INTEGER,
    victory INTEGER,
    FOREIGN KEY(player_id) REFERENCES player(id)
  )`);
  db.run('CREATE INDEX idx_snapshot_player ON performance_snapshot(player_id)');
  
  const insertSnapshot = db.prepare('INSERT INTO performance_snapshot VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const s of data.snapshots) {
    insertSnapshot.run(
      s.id, s.playerId, toTimestamp(s.timestamp),
      s.grade, s.track || null, s.rank || null, s.division || null,
      s.factsMasteredAtSnapshot, s.timebackUnitsAtSnapshot || 0, s.problemsAttempted, s.problemsCorrect,
      s.sessionSeconds, s.damageDealt, s.raidType || null,
      s.bossLevel || 0, s.victory === true ? 1 : (s.victory === false ? 0 : null)
    );
  }
  
  db.run('COMMIT');
  db.close();
}

// Parse CLI args
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const outputIndex = args.indexOf('--output');

if (envIndex === -1 || outputIndex === -1) {
  console.error('Usage: bun run scripts/export-backup.ts --env <local|staging|production> --output <file>');
  process.exit(1);
}

const env = args[envIndex + 1] as keyof typeof SERVERS;
const outputPath = args[outputIndex + 1];

if (!SERVERS[env]) {
  console.error(`Invalid environment: ${env}`);
  console.error('Valid: local, staging, production');
  process.exit(1);
}

const config = SERVERS[env];

console.log(`🔄 Connecting to ${env} (${config.uri} / ${config.module})...`);

// Get owner token from environment (backup/restore requires admin access)
const ownerToken = process.env.SPACETIMEDB_OWNER_TOKEN;
if (!ownerToken) {
  console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
  console.error('   Backup requires owner authentication to access all tables.');
  console.error('   Run: export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token | tail -1)');
  process.exit(1);
}

// Connect and export
try {
  await DbConnection.builder()
    .withUri(config.uri)
    .withModuleName(config.module)
    .withToken(ownerToken)
    .onConnect(async (ctx, identity, token) => {
      console.log('✅ Connected as:', identity.toHexString());
      
      // Wait for connection to be active
      while (!ctx.isActive) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Subscribe to all tables
      await new Promise<void>((resolve) => {
        ctx.subscriptionBuilder()
          .onApplied(() => {
            console.log('📡 Subscriptions active');
            
            // Export data
            console.log('📥 Exporting tables...');
            const players = Array.from(ctx.db.player.iter());
            const factMasteries = Array.from(ctx.db.factMastery.iter());
            const snapshots = Array.from(ctx.db.performanceSnapshot.iter());
            
            console.log(`   - ${players.length} players`);
            console.log(`   - ${factMasteries.length} fact mastery records`);
            console.log(`   - ${snapshots.length} performance snapshots`);
            
            // Create backup object
            const backup = {
              version: '1.0',
              timestamp: new Date().toISOString(),
              environment: env,
              server: config.uri,
              module: config.module,
              tables: {
                player: players,
                fact_mastery: factMasteries,
                performance_snapshot: snapshots,
              },
              counts: {
                player: players.length,
                fact_mastery: factMasteries.length,
                performance_snapshot: snapshots.length,
              }
            };
            
            // Serialize (handle BigInt)
            const jsonString = JSON.stringify(backup, (key, value) =>
              typeof value === 'bigint' ? value.toString() : value
            , 2);
            
            // Atomic write: write to temp file, then rename (prevents corruption if interrupted)
            const tempPath = `${outputPath}.tmp`;
            writeFileSync(tempPath, jsonString);
            
            // Validate written JSON can be parsed
            try {
              JSON.parse(readFileSync(tempPath, 'utf-8'));
            } catch (err) {
              console.error('❌ Backup validation failed - written file is not valid JSON!');
              throw err;
            }
            
            // Rename is atomic on POSIX
            require('fs').renameSync(tempPath, outputPath);
            console.log(`✅ JSON backup saved: ${outputPath}`);
            console.log(`📊 Size: ${Math.round(jsonString.length / 1024)} KB`);
            
            // Write SQLite for inspection/migrations
            const sqlitePath = outputPath.replace('.json', '.sqlite');
            writeToSQLite(sqlitePath, { players, factMasteries, snapshots, backup });
            console.log(`✅ SQLite backup saved: ${sqlitePath}`);
            
            resolve();
            process.exit(0);
          })
          .subscribe([
            'SELECT * FROM player',
            'SELECT * FROM fact_mastery',
            'SELECT * FROM performance_snapshot',
          ]);
      });
    })
    .build();
    
} catch (error) {
  console.error('❌ Backup failed:', error);
  process.exit(1);
}

