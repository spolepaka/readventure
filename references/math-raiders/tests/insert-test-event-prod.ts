// Insert a test TimeBack event to PRODUCTION
import { DbConnection } from '../client/src/spacetime';

console.log('🧪 Inserting test TimeBack event to PRODUCTION...\n');

// Get owner token from env (test reducer requires authorization)
const ownerToken = process.env.SPACETIMEDB_OWNER_TOKEN;
if (!ownerToken) {
  console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
  console.error('Set: export SPACETIMEDB_OWNER_TOKEN=$(ssh math-raiders "grep SPACETIMEDB_TOKEN /home/ubuntu/mathraiders-worker/.env | cut -d\'=\' -f2")');
  process.exit(1);
}

async function insertTest() {
  await DbConnection.builder()
    .withUri('ws://18.224.110.93:3000')  // PRODUCTION
    .withModuleName('math-raiders')
    .withToken(ownerToken)
    .onConnect(async (ctx) => {
      console.log('✅ Connected to PRODUCTION SpacetimeDB');
      
      // Call the test reducer with sample data
      console.log('📤 Calling test_create_timeback_event reducer...');
      ctx.reducers.testCreateTimebackEvent(
        'campbell-test',                                    // player_id
        'b9a646b7-990c-4876-8568-de6b4da6e28b',            // timeback_id (Campbell's real ID)
        BigInt(999),                                        // raid_id
        'campbell.cao@superbuilders.school',               // email (Campbell's real email)
        10.0,                                               // xp_earned (10 XP to test visibility)
        4,                                                  // level (grade 4)
        20,                                                 // problems_answered
        18                                                  // correct_answers
      );
      
      // Wait a bit to let it process
      setTimeout(() => {
        console.log('\n✅ Test event should be created in production!');
        console.log('👀 Check the worker logs: ssh math-raiders "pm2 logs timeback-worker --lines 10"');
        process.exit(0);
      }, 1000);
    })
    .build();
}

insertTest().catch(console.error);






