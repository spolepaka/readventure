#!/usr/bin/env bun
// Generate realistic test data for Math Raiders
// Usage: bun scripts/ops/seed-test-data.ts --env <local|staging|production> --players <count>

// Polyfill MUST run before SpacetimeDB SDK import
import '@ungap/compression-stream/poly';

import { DbConnection } from '../../client/src/spacetime';
import { getFactsForGrade } from '../../client/src/data/mathFacts';

const SERVERS = {
  local: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders' },
  staging: { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders-staging' },
  production: { uri: 'ws://18.224.110.93:3000', module: 'math-raiders' },
};

// Deterministic random (same seed = same data)
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Student names for realistic test data
const FIRST_NAMES = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas',
  'Mia', 'Oliver', 'Amelia', 'Elijah', 'Harper', 'James', 'Evelyn', 'Ben', 'Lily', 'Alex',
  'Sofia', 'Max', 'Ella', 'Jack', 'Grace', 'Leo', 'Chloe', 'Ryan', 'Zoe', 'Sam'];

// Generate one realistic player
function makePlayer(id: number, rand: () => number) {
  const name = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
  
  // Grade distribution: mostly 3-4 (pilot target), some 2 and 5
  const gradeRoll = rand();
  const grade = gradeRoll < 0.1 ? 2 :   // 10% grade 2
                gradeRoll < 0.4 ? 3 :   // 30% grade 3
                gradeRoll < 0.8 ? 4 :   // 40% grade 4
                5;                       // 20% grade 5
  
  // Experience levels: Most players are beginners/intermediate
  const experienceRoll = rand();
  const totalRaids = experienceRoll < 0.3 ? Math.floor(rand() * 5) :      // 30% new (0-5 raids)
                      experienceRoll < 0.7 ? 5 + Math.floor(rand() * 15) : // 40% active (5-20 raids)
                      20 + Math.floor(rand() * 30);                         // 30% experienced (20-50 raids)
  
  // AP roughly correlates with raids (~125 avg per raid with variance)
  const apPerRaid = 100 + Math.floor(rand() * 50); // 100-150 per raid
  const totalAp = totalRaids * apPerRaid;
  
  // Daily streak: Most have none or low, few have high streaks
  const streakRoll = rand();
  const dailyStreak = streakRoll < 0.6 ? 0 :              // 60% no streak
                       streakRoll < 0.85 ? 1 + Math.floor(rand() * 3) :  // 25% short streak (1-3)
                       4 + Math.floor(rand() * 10);        // 15% dedicated (4-14)
  
  // Daily/weekly raid progress
  const dailyRaids = Math.min(totalRaids > 0 ? Math.floor(rand() * 6) : 0, 6);
  const weeklyRaids = Math.min(totalRaids > 0 ? Math.floor(rand() * 25) : 0, 25);
  
  return {
    id: `test-player-${id}`,
    name,
    grade,
    totalRaids,
    totalAp,
    dailyStreak,
    dailyRaids,
    weeklyRaids,
  };
}

// Generate realistic fact mastery for a player
function makeFactsForPlayer(player: any, rand: () => number) {
  const gradeFacts = getFactsForGrade(player.grade);
  const factCount = gradeFacts.length;
  
  // How many facts has this player practiced?
  // Correlate with total raids: ~10-20 facts per raid
  const practicedFactCount = Math.min(
    Math.floor(player.totalRaids * (10 + rand() * 10)),
    factCount
  );
  
  // Shuffle and take subset
  const shuffled = [...gradeFacts].sort(() => rand() - 0.5);
  const practicedFacts = shuffled.slice(0, practicedFactCount);
  
  // Fast threshold for this grade
  const fastThreshold = player.grade === 0 ? 3000 :
                        player.grade <= 3 ? 2000 :
                        player.grade === 4 ? 1700 : 1500;
  
  return practicedFacts.map(mathFact => {
    // Generate proper fact key (matches server normalization)
    const symbol = mathFact.operation.tag === 'Add' ? '+' :
                   mathFact.operation.tag === 'Subtract' ? '-' :
                   mathFact.operation.tag === 'Multiply' ? '×' : '÷';
    
    // Commutative operations: normalize to smaller first
    let factKey: string;
    if (mathFact.operation.tag === 'Add' || mathFact.operation.tag === 'Multiply') {
      const min = Math.min(mathFact.left, mathFact.right);
      const max = Math.max(mathFact.left, mathFact.right);
      factKey = `${min}${symbol}${max}`;
    } else {
      // Non-commutative: keep order
      factKey = `${mathFact.left}${symbol}${mathFact.right}`;
    }
    
    // Mastery distribution: bell curve centered on level 2-3
    const masteryRoll = rand();
    const targetMasteryLevel = masteryRoll < 0.05 ? 0 :    // 5% struggling
                               masteryRoll < 0.2 ? 1 :     // 15% practicing
                               masteryRoll < 0.4 ? 2 :     // 20% learning
                               masteryRoll < 0.6 ? 3 :     // 20% developing
                               masteryRoll < 0.8 ? 4 :     // 20% strong
                               5;                           // 20% mastered
    
    // Generate recent attempts that justify this mastery level
    const recentAttempts = [];
    const attemptCount = 5; // Last 5 attempts determine mastery
    
    for (let i = 0; i < attemptCount; i++) {
      let correct: boolean;
      let responseTime: number;
      
      // Create attempts that match target mastery level
      if (targetMasteryLevel === 5) {
        // Mastered: 4-5/5 fast and correct
        correct = true;
        responseTime = Math.floor(800 + rand() * (fastThreshold - 800)); // Fast
      } else if (targetMasteryLevel === 4) {
        // Strong: Some fast answers, building speed
        const isFast = i < 3 || rand() < 0.5;
        correct = true;
        responseTime = isFast ? Math.floor(900 + rand() * (fastThreshold - 900)) :
                               Math.floor(fastThreshold + rand() * 1000);
      } else if (targetMasteryLevel === 3) {
        // Developing: Building toward threshold speed
        const isFast = i < 2 || rand() < 0.3;
        correct = rand() < 0.8;
        responseTime = isFast ? Math.floor(1000 + rand() * (fastThreshold - 1000)) :
                               Math.floor(fastThreshold + rand() * 1500);
      } else if (targetMasteryLevel === 2) {
        // Learning: 3+/5 correct but slow
        correct = i < 3 || rand() < 0.6;
        responseTime = Math.floor(fastThreshold + 500 + rand() * 1500);
      } else if (targetMasteryLevel === 1) {
        // Practicing: 1-2/5 correct
        correct = i === 0 || rand() < 0.2;
        responseTime = Math.floor(2000 + rand() * 2000);
      } else {
        // Struggling: mostly wrong
        correct = rand() < 0.2;
        responseTime = Math.floor(3000 + rand() * 2000);
      }
      
      recentAttempts.push({ correct, timeMs: responseTime });  // Use camelCase!
    }
    
    // Calculate aggregates
    const totalAttempts = attemptCount + Math.floor(rand() * 10); // 5-15 total attempts
    const correctCount = recentAttempts.filter(a => a.correct).length;
    const totalCorrect = Math.floor(correctCount * (totalAttempts / attemptCount));
    
    // Average response time from correct attempts (must not be null!)
    const correctAttempts = recentAttempts.filter(a => a.correct);
    const avgResponseMs = correctAttempts.length > 0 ?
      Math.floor(correctAttempts.reduce((sum, a) => sum + a.timeMs, 0) / correctAttempts.length) :
      2500;  // Default for facts with no correct attempts
    
    const fastestMs = correctAttempts.length > 0 ?
      Math.min(...correctAttempts.map(a => a.timeMs)) :
      (avgResponseMs || 4000);  // Use avgResponseMs or default
    
    return {
      factKey,
      masteryLevel: targetMasteryLevel,
      totalAttempts,
      totalCorrect,
      avgResponseMs,
      fastestMs,
      recentAttempts,
    };
  });
}

// Main seed function
async function seed(env: keyof typeof SERVERS, playerCount: number) {
  const config = SERVERS[env];
  const rand = makeRandom(42); // Deterministic seed
  
  console.log(`🌱 Generating ${playerCount} test players for ${env}...`);
  console.log(`📡 Connecting to ${config.uri} / ${config.module}...`);
  
  // Get owner token
  const ownerToken = process.env.SPACETIMEDB_OWNER_TOKEN;
  if (!ownerToken) {
    console.error('❌ SPACETIMEDB_OWNER_TOKEN not set!');
    console.error('   Run: export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token | tail -1)');
    process.exit(1);
  }
  
  const connection = await DbConnection.builder()
    .withUri(config.uri)
    .withModuleName(config.module)
    .withToken(ownerToken)
    .onConnect(async (ctx, identity, token) => {
      console.log('✅ Connected');
      
      // Wait for connection to be active (critical for reducers to work)
      while (!ctx.isActive) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Generate players
      const players = [];
      for (let i = 0; i < playerCount; i++) {
        players.push(makePlayer(i, rand));
      }
      
      console.log('');
      console.log('📊 Test data distribution:');
      const gradeDistribution = [0, 0, 0, 0, 0, 0];
      players.forEach(p => gradeDistribution[p.grade]++);
      gradeDistribution.forEach((count, grade) => {
        if (count > 0) console.log(`   Grade ${grade}: ${count} players`);
      });
      
      const avgRaids = Math.floor(players.reduce((sum, p) => sum + p.totalRaids, 0) / players.length);
      console.log(`   Average raids: ${avgRaids}`);
      console.log('');
      
      // Create players with their fact mastery data
      console.log('🎮 Preparing player data...');
      
      const allPlayersJson = [];
      const allFactsJson = [];
      
      for (let i = 0; i < players.length; i++) {
        const player = players[i];
        const facts = makeFactsForPlayer(player, rand);
        
        // Calculate rank from facts
        const masteredCount = facts.filter(f => f.masteryLevel >= 5).length;
        const totalFacts = getFactsForGrade(player.grade).length;
        const masteryPercent = (masteredCount / totalFacts) * 100;
        
        const rank = masteryPercent >= 90 ? 'legendary' :
                     masteryPercent >= 75 ? 'diamond' :
                     masteryPercent >= 50 ? 'gold' :
                     masteryPercent >= 25 ? 'silver' : 'bronze';
        
        // Prepare player JSON
        allPlayersJson.push({
          id: player.id,
          name: player.name,
          grade: player.grade,
          rank,
          totalProblems: facts.reduce((sum, f) => sum + f.totalAttempts, 0),
          totalCorrect: facts.reduce((sum, f) => sum + f.totalCorrect, 0),
          avgResponseMs: facts.length > 0 ? 
            Math.floor(facts.reduce((sum, f) => sum + f.avgResponseMs, 0) / facts.length) : 0,
          bestResponseMs: facts.length > 0 ?
            Math.min(...facts.map(f => f.fastestMs)) : 999999,
          totalRaids: player.totalRaids,
          quests: JSON.stringify({
            daily_raid_count: player.dailyRaids,
            daily_streak: player.dailyStreak,
          }),
          lastPlayed: { __timestamp_micros_since_unix_epoch__: (Date.now() * 1000).toString() },
          lastRaid: { __timestamp_micros_since_unix_epoch__: (Date.now() * 1000).toString() },
          lastWeeklyReset: { __timestamp_micros_since_unix_epoch__: (Date.now() * 1000).toString() },
          totalAp: player.totalAp,
          inRaidId: null,
          timebackId: null,
          email: null,
        });
        
        // Prepare fact mastery JSON
        facts.forEach((f, idx) => {
          allFactsJson.push({
            id: i * 1000 + idx + 1,  // Unique IDs
            playerId: player.id,
            factKey: f.factKey,
            totalAttempts: f.totalAttempts,
            totalCorrect: f.totalCorrect,
            lastSeen: { __timestamp_micros_since_unix_epoch__: (Date.now() * 1000).toString() },
            avgResponseMs: f.avgResponseMs,
            fastestMs: f.fastestMs,
          recentAttempts: f.recentAttempts.map(a => ({
            timeMs: a.timeMs,  // Already camelCase from recentAttempts array
            correct: a.correct,
            timestamp: { __timestamp_micros_since_unix_epoch__: (Date.now() * 1000).toString() },
          })),
            masteryLevel: f.masteryLevel,
          });
        });
      }
      
      console.log(`   Generated ${allPlayersJson.length} players with ${allFactsJson.length} facts`);
      console.log('');
      
      // Batch restore all at once
      console.log('💾 Restoring players...');
      try {
        await ctx.reducers.bulkRestorePlayer(JSON.stringify(allPlayersJson));
        console.log(`   ✅ ${allPlayersJson.length} players restored`);
      } catch (err) {
        console.error('❌ Failed to restore players:', err);
        process.exit(1);
      }
      
      console.log('💾 Restoring fact mastery...');
      
      // Batch facts to avoid payload size limits (500 facts per batch)
      const BATCH_SIZE = 500;
      const batches = [];
      for (let i = 0; i < allFactsJson.length; i += BATCH_SIZE) {
        batches.push(allFactsJson.slice(i, i + BATCH_SIZE));
      }
      
      for (let i = 0; i < batches.length; i++) {
        try {
          await ctx.reducers.bulkRestoreFactMastery(JSON.stringify(batches[i]));
          console.log(`   ✅ Batch ${i + 1}/${batches.length}: ${batches[i].length} facts`);
        } catch (err) {
          console.error(`❌ Failed to restore batch ${i + 1}:`, err);
          process.exit(1);
        }
      }
      
      // Wait for final batch to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`   ✅ Total: ${allFactsJson.length} fact mastery records`);
      
      
      // Count total facts created
      let totalFactsCreated = 0;
      const sampleRand = makeRandom(42);
      for (const p of players) {
        totalFactsCreated += makeFactsForPlayer(p, sampleRand).length;
      }
      
      console.log('');
      console.log('✅ Seed complete!');
      console.log(`   ${players.length} players created`);
      console.log(`   ~${totalFactsCreated} fact mastery records`);
      console.log('');
      console.log('📊 Sample players:');
      const displayRand = makeRandom(42);
      players.slice(0, 5).forEach(p => {
        const facts = makeFactsForPlayer(p, displayRand);
        const mastered = facts.filter(f => f.masteryLevel >= 5).length;
        console.log(`   ${p.name} (G${p.grade}): ${p.totalRaids} raids, ${mastered} mastered, ${p.dailyStreak}-day streak`);
      });
      
      process.exit(0);
    })
    .build();
}

// Parse CLI args
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const playersIndex = args.indexOf('--players');

if (envIndex === -1) {
  console.error('Usage: bun seed-test-data.ts --env <local|staging|production> [--players <count>]');
  console.error('Example: bun seed-test-data.ts --env local --players 50');
  process.exit(1);
}

const env = args[envIndex + 1] as keyof typeof SERVERS;
const playerCount = playersIndex !== -1 ? parseInt(args[playersIndex + 1]) : 50;

if (!SERVERS[env]) {
  console.error(`Invalid environment: ${env}`);
  console.error('Valid: local, staging, production');
  process.exit(1);
}

seed(env, playerCount);

