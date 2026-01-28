// Insert a test TimeBack event
import { DbConnection } from './worker/src/spacetimedb';

console.log('🧪 Inserting test TimeBack event...\n');

async function insertTest() {
  await DbConnection.builder()
    .withUri('ws://localhost:3000')
    .withModuleName('math-raiders')
    .onConnect(async (ctx) => {
      console.log('✅ Connected to SpacetimeDB');
      
      // Call the test reducer
      console.log('📤 Calling test_create_timeback_event reducer...');
      ctx.reducers.testCreateTimebackEvent();
      
      // Wait a bit to let it process
      setTimeout(() => {
        console.log('\n✅ Test event should be created!');
        console.log('👀 Check the worker logs - it should process the event');
        process.exit(0);
      }, 1000);
    })
    .build();
}

insertTest().catch(console.error);









