import * as React from "react"

interface RaidDamageChartProps {
  raidPlayers: Array<{
    playerId: string
    playerName: string
    damageDealt: number
    problemsAnswered: number
    correctAnswers: number
    fastestAnswerMs: number
  }>
  currentPlayerId?: string
  animationsPaused?: boolean
  delay?: number
  raidDurationSeconds?: number
  useMockData?: boolean
}

export function RaidDamageChartCSS({ 
  raidPlayers, 
  currentPlayerId,
  animationsPaused = false,
  delay = 0,
  raidDurationSeconds
}: RaidDamageChartProps) {
  const [isAnimating, setIsAnimating] = React.useState(false)
  
  // Format time - speedrun style (15s or 1:23)
  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`
    }
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Sort and prepare data
  const chartData = React.useMemo(() => {
    const sorted = [...raidPlayers].sort((a, b) => {
      // Handle ties: sort alphabetically if damage identical
      if (b.damageDealt === a.damageDealt) {
        return a.playerName.localeCompare(b.playerName);
      }
      return b.damageDealt - a.damageDealt;
    })
    const maxDamage = sorted[0]?.damageDealt || 1
    const totalDamage = raidPlayers.reduce((sum, p) => sum + p.damageDealt, 0)
    
    return sorted.map((player, index) => ({
      rank: index + 1,
      name: player.playerName.slice(0, 20) + (player.playerName.length > 20 ? '...' : ''), // Truncate long names
      playerId: player.playerId,
      damage: player.damageDealt,
      percentage: totalDamage > 0 ? (player.damageDealt / totalDamage * 100).toFixed(1) : "0",
      barWidth: (player.damageDealt / maxDamage * 100).toFixed(1),
      isMe: player.playerId === currentPlayerId,
      displayName: player.playerName,
      // Format damage for display
      formattedDamage: formatDamage(player.damageDealt),
    }))
  }, [raidPlayers, currentPlayerId])
  
  // Format damage numbers - use full numbers for K-5 clarity
  function formatDamage(damage: number): string {
    // For K-5 students, always show the full number with commas
    // They're learning place value and reading large numbers!
    return damage.toLocaleString();
  }

  // Trigger animation on mount with delay
  React.useEffect(() => {
    if (animationsPaused) {
      setIsAnimating(true)
      return
    }
    const timer = setTimeout(() => setIsAnimating(true), delay * 1000 + 100)
    return () => clearTimeout(timer)
  }, [delay, animationsPaused])

  // If no data, show debug info
  if (!raidPlayers || raidPlayers.length === 0) {
    return (
      <div className="bg-gray-900/60 backdrop-blur-md rounded-xl p-4 sm:p-6 border border-amber-500/30">
        <h2 className="text-lg sm:text-xl font-bold text-white mb-4 text-center font-game">
          ⚔️ DAMAGE LEADERBOARD ⚔️
        </h2>
        <p className="text-white text-center">No raid data available</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-950/90 rounded-lg p-4 sm:p-6 border border-gray-700/50">
      <h2 className="text-xl font-semibold text-white mb-5 font-game">
        Damage Done
      </h2>
      
      {/* Custom bar visualization */}
      <div className="space-y-1">
        {chartData.map((player, idx) => {
          // Medal colors with subtle opacity for depth
          const barColor = idx === 0 ? "bg-[#FFD700]/90" :      // Gold with 90% opacity
                          idx === 1 ? "bg-[#C0C0C0]/90" :      // Silver with 90% opacity
                          idx === 2 ? "bg-[#CD7F32]/90" :      // Bronze with 90% opacity
                          "bg-blue-500/80";                      // Default blue with 80% opacity
          
          // RGB values for gradient - darker muted for Details! style
          const barColorRGB = idx === 0 ? "180, 150, 40" :      // Gold (dark muted)
                              idx === 1 ? "150, 150, 150" :     // Silver (dark muted)
                              idx === 2 ? "150, 100, 60" :      // Bronze (dark muted)
                              "25, 50, 155";                     // Navy (less radiant)
          
          return (
            <div key={player.playerId} className="relative">
                <div className="relative">
                  {/* Main bar container */}
                  <div className="relative h-8 bg-gray-900/80 overflow-hidden">
                    {/* Main bar */}
                    <div 
                      className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-out flex items-center ${idx === 0 && isAnimating ? 'animate-[gold-shimmer_3s_ease-in-out_infinite]' : ''}`}
                      style={{ 
                        width: isAnimating ? `${player.barWidth}%` : '0%',
                        transitionDelay: `${idx * 100}ms`,
                        background: `linear-gradient(to right, rgba(${barColorRGB}, 0.85) 0%, rgba(${barColorRGB}, 0.75) 100%)`
                      }}
                    />
                  </div>
                    
                    {/* Rank - white text on solid dark badge with shadow */}
                    <div className="absolute left-2 top-4 -translate-y-1/2 z-10">
                      <div className={`
                        w-6 h-6 rounded flex items-center justify-center
                        bg-gray-900/95 border border-gray-700/50
                        shadow-sm shadow-black/40
                        font-medium
                        text-xs text-white
                      `}>
                        {idx + 1}
                      </div>
                    </div>
                    
                    {/* Name */}
                    <div className={`absolute left-11 top-4 -translate-y-1/2 flex items-center font-normal text-base z-10 gap-2`}>
                      <span className="text-white">{player.displayName}</span>
                      {player.isMe && (
                        <span className="text-[10px] px-1.5 py-0 bg-gray-800/80 text-gray-300 rounded font-medium">
                          YOU
                        </span>
                      )}
                    </div>
                    
                    {/* Damage */}
                    <div className={`absolute right-3 top-4 -translate-y-1/2 flex items-center text-white font-normal text-base z-10`}
                      style={{
                        opacity: isAnimating ? 1 : 0,
                        transition: 'opacity 0.3s ease-out',
                        transitionDelay: `${idx * 100 + 600}ms`
                      }}
                    >
                    <span className="hidden sm:flex items-center gap-4">
                      <span className="tabular-nums min-w-[4rem] text-right">{player.formattedDamage}</span>
                      {raidPlayers.length > 1 && <span className="text-white/80 tabular-nums min-w-[3.5rem] text-right">{player.percentage}%</span>}
                    </span>
                    <span className="sm:hidden">
                      {player.formattedDamage}
                    </span>
                  </div>
                </div>
              </div>
          )
        })}
        
        {/* Total damage row */}
        {chartData.length > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <div className="relative h-8 flex items-center text-base">
              <span className="absolute left-2 text-gray-400">Total</span>
              <div className="absolute right-3 flex items-center gap-4">
                <span className="text-white font-medium tabular-nums min-w-[4rem] text-right">
                  {formatDamage(chartData.reduce((sum, p) => sum + p.damage, 0))}
                </span>
                {raidDurationSeconds !== undefined && (
                  <span className="text-gray-400 tabular-nums min-w-[3.5rem] text-right">
                    {formatTime(raidDurationSeconds)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Clear time - solo only */}
        {chartData.length === 1 && raidDurationSeconds !== undefined && (
          <div className="mt-3 pt-3 border-t border-gray-700/50 text-center">
            <span className="text-gray-400 text-sm">Clear Time: </span>
            <span className="text-white font-medium tabular-nums">
              {formatTime(raidDurationSeconds)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}


// Mock data for testing - realistic game damage (100-3000)
const mockRaidPlayers = [
  { playerId: "1", playerName: "DragonSlayer", damageDealt: 2834, problemsAnswered: 35, correctAnswers: 32, fastestAnswerMs: 1200 },
  { playerId: "2", playerName: "MathWizard", damageDealt: 2456, problemsAnswered: 32, correctAnswers: 28, fastestAnswerMs: 1400 },
  { playerId: "3", playerName: "SpeedDemon", damageDealt: 1923, problemsAnswered: 28, correctAnswers: 24, fastestAnswerMs: 900 },
  { playerId: "4", playerName: "BrainStorm", damageDealt: 1678, problemsAnswered: 25, correctAnswers: 21, fastestAnswerMs: 1600 },
  { playerId: "5", playerName: "QuickThink", damageDealt: 1245, problemsAnswered: 20, correctAnswers: 16, fastestAnswerMs: 1100 },
  { playerId: "6", playerName: "NumberNinja", damageDealt: 892, problemsAnswered: 15, correctAnswers: 11, fastestAnswerMs: 1300 },
  { playerId: "7", playerName: "CalcChamp", damageDealt: 456, problemsAnswered: 10, correctAnswers: 7, fastestAnswerMs: 1500 },
  { playerId: "8", playerName: "MathHero", damageDealt: 234, problemsAnswered: 8, correctAnswers: 5, fastestAnswerMs: 1700 },
]

// Export wrapper with mock data toggle
export function RaidDamageChart(props: RaidDamageChartProps) {
  // Use mock data if toggled
  const effectiveProps = props.useMockData 
    ? { ...props, raidPlayers: mockRaidPlayers, currentPlayerId: "3" } // Make SpeedDemon the current player
    : props
  
  return <RaidDamageChartCSS {...effectiveProps} />
}
