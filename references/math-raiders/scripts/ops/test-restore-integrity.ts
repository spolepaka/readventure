#!/usr/bin/env bun
// Test backup/restore integrity: ensures restore preserves exact data
// Usage: bun scripts/ops/test-restore-integrity.ts --env <local|staging|production>
// WARNING: This will wipe and restore your database!

import '@ungap/compression-stream/poly';
import { DbConnection } from '../../client/src/spacetime';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';

const SERVERS = {
  local: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders' },
  staging: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders-staging' },
  production: { uri: 'ws://18.224.110.93:3000', module: 'math-raiders' },
};

// Parse CLI args
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');

if (envIndex === -1) {
  console.error('Usage: bun scripts/ops/test-restore-integrity.ts --env <local|staging|production>');
  process.exit(1);
}

const env = args[envIndex + 1] as keyof typeof SERVERS;
if (!SERVERS[env]) {
  console.error(`Invalid environment: ${env}`);
  console.error('Valid: local, staging, production');
  process.exit(1);
}

const config = SERVERS[env];

// Get owner token (extract just the token value if it includes description)
let ownerToken = process.env.SPACETIMEDB_OWNER_TOKEN;
if (!ownerToken) {
  console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
  console.error('   Run: export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token 2>/dev/null | tail -1 | awk \'{print $NF}\')');
  process.exit(1);
}

// Clean token if it includes description text
if (ownerToken.includes('Your auth token')) {
  ownerToken = ownerToken.split(/\s+/).pop() || ownerToken;
}

// Temp backup file
const tempBackup = join('/tmp', `test-restore-${Date.now()}.json`);

console.log('🧪 Testing backup/restore integrity...');
console.log(`📦 Environment: ${env}`);
console.log(`🔗 Module: ${config.module}`);
console.log('');
console.log('⚠️  WARNING: This will wipe your database!');
console.log('   Make sure you have a backup if needed.');
console.log('');

// Helper to wipe database (like restore.sh does)
async function wipeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('Step 1.5/3: Wiping database (like restore.sh does)...');
    
    const moduleName = env === 'staging' ? 'math-raiders-staging' : 'math-raiders';
    const server = env === 'production' ? 'local' : 'maincloud';
    
    let cmd: string[];
    if (env === 'production') {
      // Production: SSH to EC2 and run spacetime publish there
      console.log('   (Production restore requires SSH - skipping wipe step)');
      console.log('   (Assuming DB is already clean or use restore.sh)');
      resolve();
      return;
    } else {
      // Local/Staging: Run spacetime publish locally with -y flag to auto-confirm
      cmd = ['spacetime', 'publish', moduleName, '-s', server, '-c', '-y'];
    }
    
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: 'inherit',
      cwd: join(process.cwd(), 'server'),
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Database wiped');
        console.log('');
        resolve();
      } else {
        reject(new Error(`spacetime publish failed with code ${code}`));
      }
    });
    
    child.on('error', (err) => {
      reject(new Error(`Failed to spawn spacetime publish: ${err.message}`));
    });
  });
}

// Helper to backup current state
async function backup(): Promise<any> {
  return new Promise((resolve, reject) => {
    const connection = DbConnection.builder()
      .withUri(config.uri)
      .withModuleName(config.module)
      .withToken(ownerToken!)
      .onConnect(async (ctx, identity) => {
        try {
          while (!ctx.isActive) {
            await new Promise(r => setTimeout(r, 50));
          }
          
          await new Promise<void>((res, rej) => {
            ctx.subscriptionBuilder()
              .onError((error) => {
                rej(error);
              })
              .onApplied(() => {
                const players = Array.from(ctx.db.player.iter());
                const factMasteries = Array.from(ctx.db.factMastery.iter());
                const snapshots = Array.from(ctx.db.performanceSnapshot.iter());
                
                const backup = {
                  version: '1.0',
                  timestamp: new Date().toISOString(),
                  environment: env,
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
                
                res();
                resolve(backup);
              })
              .subscribe([
                'SELECT * FROM player',
                'SELECT * FROM fact_mastery',
                'SELECT * FROM performance_snapshot',
              ]);
          });
        } catch (err) {
          reject(err);
        }
      })
      .onDisconnect((ctx, error) => {
        if (error) {
          reject(error);
        }
      })
      .build();
      
    // Timeout after 30 seconds
    setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 30000);
  });
}

// Helper to restore
async function restore(backup: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = DbConnection.builder()
      .withUri(config.uri)
      .withModuleName(config.module)
      .withToken(ownerToken!)
      .onConnect(async (ctx, identity) => {
        try {
          while (!ctx.isActive) {
            await new Promise(r => setTimeout(r, 50));
          }
          
          // Restore all tables
          await ctx.reducers.bulkRestorePlayer(JSON.stringify(backup.tables.player, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          ));
          
          // Batch fact mastery (may be large)
          const BATCH_SIZE = 1000;
          const factBatches = [];
          for (let i = 0; i < backup.tables.fact_mastery.length; i += BATCH_SIZE) {
            factBatches.push(backup.tables.fact_mastery.slice(i, i + BATCH_SIZE));
          }
          
          for (const batch of factBatches) {
            await ctx.reducers.bulkRestoreFactMastery(JSON.stringify(batch, (key, value) =>
              typeof value === 'bigint' ? value.toString() : value
            ));
          }
          
          await ctx.reducers.bulkRestorePerformanceSnapshot(JSON.stringify(backup.tables.performance_snapshot, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          ));
          
          resolve();
        } catch (err) {
          reject(err);
        }
      })
      .onDisconnect((ctx, error) => {
        if (error) {
          reject(error);
        }
      })
      .build();
      
    // Timeout after 30 seconds
    setTimeout(() => {
      reject(new Error('Restore timeout'));
    }, 30000);
  });
}

// Normalize data for comparison (sort arrays, remove timestamps from metadata)
function normalize(backup: any): any {
  const normalize = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(normalize).sort((a, b) => {
        // Sort by ID if available
        if (a.id && b.id) return String(a.id).localeCompare(String(b.id));
        if (a.playerId && b.playerId) {
          const cmp = a.playerId.localeCompare(b.playerId);
          if (cmp !== 0) return cmp;
          return (a.factKey || '').localeCompare(b.factKey || '');
        }
        return JSON.stringify(a, (k, v) => typeof v === 'bigint' ? v.toString() : v).localeCompare(
          JSON.stringify(b, (k, v) => typeof v === 'bigint' ? v.toString() : v)
        );
      });
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'timestamp' && typeof v === 'string') {
          // Keep timestamp but normalize format
          result[k] = v;
        } else {
          result[k] = normalize(v);
        }
      }
      return result;
    }
    if (typeof obj === 'bigint') {
      return obj.toString();
    }
    return obj;
  };
  
  return {
    ...backup,
    timestamp: undefined, // Remove timestamp from comparison
    tables: {
      player: normalize(backup.tables.player),
      fact_mastery: normalize(backup.tables.fact_mastery),
      performance_snapshot: normalize(backup.tables.performance_snapshot),
    },
  };
}

// Deep compare two backups
function compare(backupA: any, backupB: any): { match: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Compare counts
  if (backupA.counts.player !== backupB.counts.player) {
    errors.push(`Player count mismatch: ${backupA.counts.player} vs ${backupB.counts.player}`);
  }
  if (backupA.counts.fact_mastery !== backupB.counts.fact_mastery) {
    errors.push(`Fact mastery count mismatch: ${backupA.counts.fact_mastery} vs ${backupB.counts.fact_mastery}`);
  }
  if (backupA.counts.performance_snapshot !== backupB.counts.performance_snapshot) {
    errors.push(`Snapshot count mismatch: ${backupA.counts.performance_snapshot} vs ${backupB.counts.performance_snapshot}`);
  }
  
  // Normalize and compare
  const normA = normalize(backupA);
  const normB = normalize(backupB);
  
  // Deep equality check
  const strA = JSON.stringify(normA, null, 2);
  const strB = JSON.stringify(normB, null, 2);
  
  if (strA !== strB) {
    errors.push('Data mismatch detected after normalization');
    
    // Find specific differences
    const playersA = new Map(normA.tables.player.map((p: any) => [p.id, p]));
    const playersB = new Map(normB.tables.player.map((p: any) => [p.id, p]));
    
    for (const [id, pA] of playersA) {
      const pB = playersB.get(id);
      if (!pB) {
        errors.push(`Player ${id} missing in restored backup`);
        continue;
      }
      const pAStr = JSON.stringify(pA);
      const pBStr = JSON.stringify(pB);
      if (pAStr !== pBStr) {
        errors.push(`Player ${id} data mismatch`);
      }
    }
    
    for (const [id] of playersB) {
      if (!playersA.has(id)) {
        errors.push(`Player ${id} extra in restored backup`);
      }
    }
    
    // Check fact mastery
    const factsA = new Map(normA.tables.fact_mastery.map((f: any) => [`${f.playerId}:${f.factKey}`, f]));
    const factsB = new Map(normB.tables.fact_mastery.map((f: any) => [`${f.playerId}:${f.factKey}`, f]));
    
    for (const [key, fA] of factsA) {
      const fB = factsB.get(key);
      if (!fB) {
        errors.push(`Fact mastery ${key} missing in restored backup`);
        continue;
      }
      const fAStr = JSON.stringify(fA);
      const fBStr = JSON.stringify(fB);
      if (fAStr !== fBStr) {
        errors.push(`Fact mastery ${key} data mismatch`);
      }
    }
  }
  
  return { match: errors.length === 0, errors };
}

// Main test
async function runTest() {
  try {
    console.log('Step 1/3: Taking initial backup...');
    console.log(`   Connecting to: ${config.uri}`);
    console.log(`   Token present: ${ownerToken ? 'Yes' : 'No'}`);
    const backupBefore = await backup();
    console.log(`✅ Backed up: ${backupBefore.counts.player} players, ${backupBefore.counts.fact_mastery} facts, ${backupBefore.counts.performance_snapshot} snapshots`);
    console.log('');
    
    // Wipe database before restore (like restore.sh does)
    await wipeDatabase();
    
    console.log('Step 2/3: Restoring backup...');
    await restore(backupBefore);
    console.log('✅ Restore complete');
    console.log('');
    
    // Wait a bit for restore to settle
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Step 3/3: Taking final backup...');
    const backupAfter = await backup();
    console.log(`✅ Backed up: ${backupAfter.counts.player} players, ${backupAfter.counts.fact_mastery} facts, ${backupAfter.counts.performance_snapshot} snapshots`);
    console.log('');
    
    console.log('🔍 Comparing backups...');
    const { match, errors } = compare(backupBefore, backupAfter);
    
    if (match) {
      console.log('✅ SUCCESS: Backup → Restore → Backup produces identical data!');
      console.log('   Kids won\'t lose progress.');
      process.exit(0);
    } else {
      console.error('❌ FAILED: Data mismatch detected!');
      console.error(`   Found ${errors.length} difference(s):`);
      errors.slice(0, 10).forEach(err => console.error(`   - ${err}`));
      if (errors.length > 10) {
        console.error(`   ... and ${errors.length - 10} more`);
      }
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTest();

