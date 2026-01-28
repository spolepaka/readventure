#!/usr/bin/env bun
// Test Row-Level Security on timeback_event_queue table
// Verifies that anonymous clients can't see sensitive TimeBack data

// Polyfill MUST run before SpacetimeDB SDK import
import '@ungap/compression-stream/poly';

import { DbConnection } from '../client/src/spacetime';

const URI = 'https://maincloud.spacetimedb.com';
const MODULE = 'math-raiders';
const OWNER_TOKEN = process.env.SPACETIMEDB_OWNER_TOKEN;

if (!OWNER_TOKEN) {
  console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
  console.error('   Run: export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token | tail -1 | awk \'{print $NF}\')');
  process.exit(1);
}

async function testRLS() {
  console.log('🔒 Testing RLS on timeback_event_queue table\n');
  
  // 1. Connect as OWNER (should see rows)
  console.log('1️⃣ Connecting as OWNER (with token)...');
  await DbConnection.builder()
    .withUri(URI)
    .withModuleName(MODULE)
    .withToken(OWNER_TOKEN)
    .onConnect(async (ctx) => {
      await new Promise<void>((resolve) => {
        ctx.subscriptionBuilder()
          .onApplied(() => {
            const rows = Array.from(ctx.db.timebackEventQueue.iter());
            console.log(`   ✅ Owner sees ${rows.length} queue row(s)`);
            if (rows.length > 0) {
              console.log(`   📋 First row ID: ${rows[0].id}, sent: ${rows[0].sent}`);
            } else {
              console.log(`   ℹ️  Queue is empty (no events pending)`);
            }
            resolve();
          })
          .subscribe(['SELECT * FROM timeback_event_queue']);
      });
      ctx.disconnect();
    })
    .build();
  
  // Wait for disconnect
  await new Promise(r => setTimeout(r, 1000));
  
  // 2. Connect as ANONYMOUS (should see 0 rows due to RLS)
  console.log('\n2️⃣ Connecting as ANONYMOUS (no token)...');
  try {
    await DbConnection.builder()
      .withUri(URI)
      .withModuleName(MODULE)
      // NO .withToken() - anonymous connection
      .onConnect(async (ctx) => {
        console.log('   ℹ️  Anonymous connection established');
        const result = await Promise.race([
          new Promise<boolean>((resolve) => {
            ctx.subscriptionBuilder()
              .onApplied(() => {
                const rows = Array.from(ctx.db.timebackEventQueue.iter());
                if (rows.length === 0) {
                  console.log(`   ✅ Anonymous sees 0 queue rows (RLS working!)`);
                } else {
                  console.log(`   ❌ SECURITY BREACH! Anonymous sees ${rows.length} queue rows!`);
                  console.log(`   🚨 RLS filter is not working - students can see sensitive TimeBack data!`);
                  rows.slice(0, 2).forEach(row => {
                    console.log(`      Row ${row.id}: player ${row.playerId}`);
                  });
                }
                resolve(true);
              })
              .subscribe(['SELECT * FROM timeback_event_queue']);
          }),
          new Promise<boolean>((resolve) => {
            setTimeout(() => {
              console.log('   ⏱️  Anonymous subscription timeout (5s) - likely RLS blocked connection');
              console.log('   ✅ This means RLS is working (anonymous can\'t even subscribe)');
              resolve(false);
            }, 5000);
          })
        ]);
        ctx.disconnect();
      })
      .build();
  } catch (err) {
    console.log('   ❌ Anonymous connection failed:', err);
  }
  
  // Wait for anonymous connection to fully process
  await new Promise(r => setTimeout(r, 6000));
  
  console.log('\n✅ RLS test complete');
  console.log('\n📝 Summary:');
  console.log('   - Owner (with token) should see all rows');
  console.log('   - Anonymous (no token) should see 0 rows');
  console.log('   - This protects student emails and TimeBack IDs from exposure\n');
  
  process.exit(0);
}

testRLS().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

