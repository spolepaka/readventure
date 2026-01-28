// Boss dialogue constants - easy to find and edit
export const BOSS_DIALOGUE = {
  // Raid start - Boss taunts (shown after countdown)
  RAID_START: [
    "You can't beat me!",
    "This will be easy!",
    "Bring it on!",
    "Let's do this!",
    "Ready to lose?",
  ],
  
  // Breaking combo from being too slow
  COMBO_BREAK_SLOW: ["TOO SLOW!", "LOST IT!", "WAKE UP!", "SLOWING DOWN?", "WHAT HAPPENED?"],
  
  // Wrong answers - Quick feedback
  WRONG_ANSWER: ["NOPE!", "WRONG!", "TRY AGAIN!", "MISS!", "WHEW!", "SAFE!", "CLOSE ONE!"],
  
  // Speed milestones - Progressive reactions
  COMBO_LOW: ["SO FAST!", "QUICK!", "SPEEDY!", "LIGHTNING!", "ZOOMING!", "WHOA!", "IMPRESSIVE!"],  // 3-5 fast
  COMBO_MID: ["TOO FAST!", "SLOW DOWN!", "WAIT!", "STOP THAT!", "NOT FAIR!", "EASE UP!", "MERCY!"],  // 10+ fast
  COMBO_HIGH: ["IMPOSSIBLE!", "NO WAY!", "HOW?!", "UNREAL!", "STOP IT!", "INSANE!", "ARE YOU HUMAN?!", "THIS CAN'T BE!"],  // 20+ fast
} as const;

// Captain Nova - Growth Mindset Mentor (bossLevel 7 / 107)
// Dweck's rules: Praise EFFORT, STRATEGY, PERSISTENCE — not talent or outcome.
// ALSO: Must be CHANTABLE. Kids repeat these on the playground.
// Rule: 1-3 syllables per word, punchy, exclamation-worthy.
export const NOVA_DIALOGUE = {
  // Raid start - Sets the mentor tone (shown after countdown)
  RAID_START: [
    "Show me what you've got!",
    "Let's see your skills!",
    "Ready when you are!",
    "Time to prove yourself!",
    "Give it your all!",
  ],
  
  // Wrong answers - Quick, supportive, not preachy (15 phrases)
  WRONG_ANSWER: [
    "Not yet!",
    "Try again!",
    "Almost!",
    "So close!",
    "Again!",
    "Go go go!",
    "Next one!",
    "Shake it off!",
    "You got this!",
    "One more!",
    "Keep going!",
    "Oops!",
    "It's okay!",
    "Learn from it!",
    "Come back!",
  ],
  
  // Breaking combo - Hype them back up, not shame (12 phrases)
  COMBO_BREAK_SLOW: [
    "Let's GO!",
    "Reset!",
    "New streak!",
    "Fresh start!",
    "Here we go!",
    "Stay sharp!",
    "Back at it!",
    "Focus up!",
    "Again again!",
    "Don't stop!",
    "Keep moving!",
    "Get back!",
  ],
  
  // Small combo (3-5) - Quick hype, Nova's voice (12 phrases)
  COMBO_LOW: [
    "Nice!",
    "Yes!",
    "That's it!",
    "There you go!",
    "On a roll!",
    "Solid!",
    "Smooth!",
    "Clean!",
    "Sharp!",
    "Oooh!",
    "Good!",
    "Quick!",
  ],
  
  // Medium combo (10+) - Building to scream-worthy (12 phrases)
  COMBO_MID: [
    "Locked in!",
    "On FIRE!",
    "In the zone!",
    "LET'S GO!",
    "Crushing it!",
    "Look at you!",
    "WHOA!",
    "Dialed in!",
    "So good!",
    "Keep going!",
    "SUPERNOVA!",
    "STELLAR!",
  ],
  
  // High combo (20+) - Maximum hype, effort credit (15 phrases)
  COMBO_HIGH: [
    "INCREDIBLE!",
    "UNSTOPPABLE!",
    "OUTSTANDING!",
    "Earned it!",
    "All YOU!",
    "Never quit!",
    "UNREAL!",
    "REMARKABLE!",
    "NO WAY!",
    "HOW?!",
    "SUPERNOVA!",
    "Your work!",
    "You did it!",
    "This is YOU!",
    "AMAZING!",
  ],
} as const;

export type BossReactionType = 'laugh' | 'sweat';

export interface BossReaction {
  type: BossReactionType;
  text: string;
}

// Helper to get random dialogue
export function getRandomDialogue(dialogues: readonly string[]): string {
  return dialogues[Math.floor(Math.random() * dialogues.length)];
}

// Helper to create boss reaction
export function createBossReaction(
  type: BossReactionType, 
  dialogues: readonly string[]
): BossReaction {
  return {
    type,
    text: getRandomDialogue(dialogues)
  };
}
