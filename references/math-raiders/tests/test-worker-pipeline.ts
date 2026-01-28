// Test the worker pipeline by inserting a test event
import { DbConnection } from './client/src/spacetime';

console.log('🧪 Testing TimeBack Worker Pipeline...\n');

async function insertTestEvent() {
  const connection = await DbConnection.builder()
    .withUri('ws://localhost:3000')
    .withModuleName('math-raiders')
    .onConnect(async (ctx) => {
    console.log('✅ Connected to SpacetimeDB');
    
    // Create a test payload
    const testPayload = {
      timebackId: process.env.TEST_TIMEBACK_ID || "",
      email: process.env.TEST_EMAIL || "",
      resourceId: "f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f",
      raidEndTime: new Date().toISOString(),
      raidDurationMinutes: 2.5,
      xpEarned: 3,
      process: true
    };
    
    console.log('📝 Test payload:', JSON.stringify(testPayload, null, 2));
    
    // We can't insert directly, we need to call a reducer
    // Let's check if we can find a player with TimeBack ID
    const players = Array.from(ctx.db.player.iter());
    const playerWithTimeBack = players.find(p => p.timebackId);
    
    if (playerWithTimeBack) {
      console.log(`\n✅ Found player with TimeBack ID: ${playerWithTimeBack.name}`);
      console.log(`   TimeBack ID: ${playerWithTimeBack.timebackId}`);
      console.log(`   Email: ${playerWithTimeBack.email}`);
    } else {
      console.log('\n❌ No players with TimeBack IDs found');
      console.log('   You need to reconnect the game to get TimeBack credentials');
    }
    
    // Check existing events
    const events = Array.from(ctx.db.timebackEventQueue.iter());
    console.log(`\n📊 Current queue: ${events.length} events`);
    
    if (events.length > 0) {
      console.log('\nExisting events:');
      events.forEach(e => {
        console.log(`  - Event ${e.id}: sent=${e.sent}, attempts=${e.attempts}`);
      });
    }
    
    console.log('\n💡 To create a test event:');
    console.log('   1. Make sure you have a player with TimeBack credentials');
    console.log('   2. Play and complete a raid');
    console.log('   3. The worker should process it immediately');
    
    // Disconnect
    setTimeout(() => {
      console.log('\nDisconnecting...');
      process.exit(0);
    }, 1000);
  })
  .build();
}

insertTestEvent().catch(console.error);
