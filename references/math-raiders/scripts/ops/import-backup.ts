#!/usr/bin/env bun
// Automated backup restore for Math Raiders
// Usage: bun run scripts/ops/import-backup.ts --env <local|staging|production> --file <backup.json>

// Polyfill MUST run before SpacetimeDB SDK import
import '@ungap/compression-stream/poly';

import { DbConnection } from '../../client/src/spacetime';
import { readFileSync } from 'fs';

const SERVERS = {
  local: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders' },
  staging: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders-staging' },
  production: { uri: 'ws://18.224.110.93:3000', module: 'math-raiders' },
};

// Parse CLI args
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const fileIndex = args.indexOf('--file');

if (envIndex === -1 || fileIndex === -1) {
  console.error('Usage: bun run scripts/ops/import-backup.ts --env <local|staging|production> --file <backup.json>');
  process.exit(1);
}

const env = args[envIndex + 1] as keyof typeof SERVERS;
const backupFile = args[fileIndex + 1];

if (!SERVERS[env]) {
  console.error(`Invalid environment: ${env}`);
  console.error('Valid: local, staging, production');
  process.exit(1);
}

const config = SERVERS[env];

// Read backup file
console.log(`📂 Reading backup: ${backupFile}...`);
let backup;
try {
  const fileContents = readFileSync(backupFile, 'utf-8');
  backup = JSON.parse(fileContents);
} catch (error) {
  console.error('❌ Failed to read backup file:', error);
  process.exit(1);
}

console.log(`📊 Backup info:`);
console.log(`   Version: ${backup.version}`);
console.log(`   Created: ${backup.timestamp}`);
console.log(`   Players: ${backup.counts.player}`);
console.log(`   Facts: ${backup.counts.fact_mastery}`);
console.log(`   Snapshots: ${backup.counts.performance_snapshot}`);
console.log('');

console.log(`🔄 Connecting to ${env} (${config.uri} / ${config.module})...`);

// Get owner token from environment (restore requires admin access to call bulkRestore* reducers)
const ownerToken = process.env.SPACETIMEDB_OWNER_TOKEN;
if (!ownerToken) {
  console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
  console.error('   Restore requires owner authentication to call admin reducers.');
  console.error('   Run: export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token | tail -1)');
  process.exit(1);
}

// Connect and restore
try {
  await DbConnection.builder()
    .withUri(config.uri)
    .withModuleName(config.module)
    .withToken(ownerToken)
    .onConnect(async (ctx, identity, token) => {
      console.log('✅ Connected');
      
      // Wait for connection to be active
      while (!ctx.isActive) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      console.log('📤 Calling restore reducers...');
      
      try {
        // Restore player table
        // Note: v1.11+ SDK uses object args format: { paramName: value }
        console.log('   - Restoring players...');
        await ctx.reducers.bulkRestorePlayer({ jsonData: JSON.stringify(backup.tables.player) });
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for commit
        console.log(`     ✅ ${backup.counts.player} players restored`);
        
        // Restore fact_mastery table (batched to avoid payload size limits)
        console.log('   - Restoring fact mastery...');
        const BATCH_SIZE = 500;
        const factBatches = [];
        for (let i = 0; i < backup.tables.fact_mastery.length; i += BATCH_SIZE) {
          factBatches.push(backup.tables.fact_mastery.slice(i, i + BATCH_SIZE));
        }
        
        for (let i = 0; i < factBatches.length; i++) {
          try {
            await ctx.reducers.bulkRestoreFactMastery({ jsonData: JSON.stringify(factBatches[i]) });
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait between batches
            console.log(`     Batch ${i + 1}/${factBatches.length}: ${factBatches[i].length} facts`);
          } catch (batchError) {
            console.error(`❌ Batch ${i + 1} failed:`, batchError);
            throw new Error(`Fact mastery restore failed at batch ${i + 1}/${factBatches.length}`);
          }
        }
        console.log(`     ✅ ${backup.counts.fact_mastery} facts restored`);
        
        // Restore performance_snapshot table
        console.log('   - Restoring performance snapshots...');
        await ctx.reducers.bulkRestorePerformanceSnapshot({ jsonData: JSON.stringify(backup.tables.performance_snapshot) });
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for commit
        console.log(`     ✅ ${backup.counts.performance_snapshot} snapshots restored`);
        
        console.log('');
        console.log('✅ Restore complete!');
        console.log('📊 Summary:');
        console.log(`   - ${backup.counts.player} players`);
        console.log(`   - ${backup.counts.fact_mastery} fact mastery records`);
        console.log(`   - ${backup.counts.performance_snapshot} performance snapshots`);
        
        // Wait for all transactions to commit before exiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        process.exit(0);
      } catch (error) {
        console.error('❌ Restore failed:', error);
        process.exit(1);
      }
    })
    .build();
    
} catch (error) {
  console.error('❌ Connection failed:', error);
  process.exit(1);
}

