/**
 * Get color class for level number based on title progression
 */
export function getLevelColor(level: number): string {
  // Progressive color system from cool → warm → legendary
  if (level >= 56) return "text-amber-400";     // Mythic (golden)
  if (level >= 51) return "text-purple-400";    // Legend (purple)
  if (level >= 46) return "text-pink-400";      // Hero (pink)
  if (level >= 41) return "text-red-400";       // Superstar (red)
  if (level >= 36) return "text-orange-400";    // Champion (orange)
  if (level >= 31) return "text-yellow-400";    // Genius (yellow)
  if (level >= 26) return "text-lime-400";      // Master (lime)
  if (level >= 21) return "text-emerald-400";   // Prodigy (emerald)
  if (level >= 16) return "text-teal-400";      // Ace (teal)
  if (level >= 11) return "text-cyan-400";      // Hotshot (cyan)
  if (level >= 6)  return "text-blue-400";      // Rising Star (blue)
  return "text-gray-400";                       // Rookie (gray)
}






