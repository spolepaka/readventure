import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RankGem } from './RankGem';
import { useGameStore } from '../store/gameStore';
import { LeaderboardEntryRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type DBLeaderboardEntry = Infer<typeof LeaderboardEntryRow>;
import { createPortal } from 'react-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChartConfig,
  ChartContainer,
} from '@/components/ui/chart';

// Tooltip component using portal to escape stacking contexts
function InfoTooltip({ text }: { text: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);
  
  useEffect(() => {
    if (isHovered && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      });
    }
  }, [isHovered]);
  
  return (
    <>
      <span 
        ref={iconRef}
        className="inline-block ml-1 text-gray-500 hover:text-gray-300 cursor-help text-[10px]"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        ⓘ
      </span>
      {isHovered && createPortal(
        <div 
          className="fixed pointer-events-none transition-opacity duration-150"
          style={{
            left: position.x,
            top: position.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 99999
          }}
        >
          <div className="bg-slate-800 text-white text-xs px-3 py-2 rounded-lg shadow-xl border border-slate-600 whitespace-nowrap">
            {text}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800 -mt-px"></div>
        </div>,
        document.body
      )}
    </>
  );
}

interface LeaderboardEntry {
  playerId: string;
  name: string;
  grade: string; // "K", "1", "2", "3", "4", "5"
  rank: string; // "bronze", "silver", "gold", "diamond", "legendary"
  division: string; // "I", "II", "III", "IV", or "" for legendary
  masteryPercent: number; // 0-100
  speedScore: number; // 0-100
  isYou: boolean;
}

// Single source of truth for row styling
function LeaderboardRow({ entry, position }: { entry: LeaderboardEntry; position: number }) {
  const getRowClass = () => {
    const youHighlight = entry.isYou ? 'border-l-4 border-purple-400' : 'border-l-4 border-transparent';
    const youBg = entry.isYou ? 'bg-purple-500/20' : '';
    
    // Podium colors override
    if (position === 1) return `bg-yellow-500/10 ${youHighlight} pl-2`;
    if (position === 2) return `bg-gray-400/10 ${youHighlight} pl-2`;
    if (position === 3) return `bg-orange-500/10 ${youHighlight} pl-2`;
    
    // You, or zebra stripes for #4+
    if (entry.isYou) return `${youBg} ${youHighlight} pl-2`;
    const zebra = (position - 4) % 2 === 1 ? 'bg-gray-800/40' : '';
    return `${zebra} border-l-4 border-transparent pl-2`;
  };
  
  const getPositionClass = () => {
    if (position === 1) return 'text-yellow-400 font-bold';
    if (position === 2) return 'text-gray-100 font-bold';
    if (position === 3) return 'text-orange-400 font-bold';
    return 'text-gray-500';
  };
  
  return (
    <div className={`flex items-center gap-4 pr-3 py-2 text-xs ${getRowClass()}`}>
      <span className={`w-10 tabular-nums ${getPositionClass()}`}>#{position}</span>
      <span className={`flex-1 text-white ${entry.isYou ? 'font-bold' : ''}`}>{entry.name}</span>
      <span className="w-24 capitalize flex items-center gap-2">
        <RankGem rank={entry.rank as any} size="xs" animate={false} className="opacity-80" />
        <span className="text-white">{entry.rank}</span>
      </span>
      <span className="w-8 text-gray-400 text-center">{entry.division || '—'}</span>
      <span className="w-16 text-right text-gray-300 tabular-nums">{entry.masteryPercent}%</span>
      <span className="w-16 text-right text-gray-300 tabular-nums">{entry.speedScore}%</span>
    </div>
  );
}

// Mock data for testing UI - realistic math mastery distribution
const MOCK_DATA: LeaderboardEntry[] = [
  // Grade 3 students - 80 total, realistic bell curve
  
  // LEGENDARY (90-100%): 3 students (~4%)
  { playerId: '1', name: 'Emma', grade: '3', rank: 'legendary', division: '', masteryPercent: 98, speedScore: 92, isYou: false },
  { playerId: '2', name: 'Marcus', grade: '3', rank: 'legendary', division: '', masteryPercent: 94, speedScore: 88, isYou: false },
  { playerId: '3', name: 'Zara', grade: '3', rank: 'legendary', division: '', masteryPercent: 91, speedScore: 85, isYou: false },
  
  // DIAMOND (75-89%): 10 students (~12%)
  { playerId: '4', name: 'Sophie', grade: '3', rank: 'diamond', division: 'I', masteryPercent: 88, speedScore: 82, isYou: false },
  { playerId: '5', name: 'Jake', grade: '3', rank: 'diamond', division: 'I', masteryPercent: 86, speedScore: 80, isYou: false },
  { playerId: '6', name: 'Lily', grade: '3', rank: 'diamond', division: 'I', masteryPercent: 84, speedScore: 78, isYou: false },
  { playerId: '7', name: 'Noah', grade: '3', rank: 'diamond', division: 'II', masteryPercent: 82, speedScore: 75, isYou: false },
  { playerId: '8', name: 'Ava', grade: '3', rank: 'diamond', division: 'II', masteryPercent: 80, speedScore: 73, isYou: false },
  { playerId: '9', name: 'Ethan', grade: '3', rank: 'diamond', division: 'III', masteryPercent: 79, speedScore: 71, isYou: false },
  { playerId: '10', name: 'Mia', grade: '3', rank: 'diamond', division: 'III', masteryPercent: 77, speedScore: 69, isYou: false },
  { playerId: '11', name: 'Liam', grade: '3', rank: 'diamond', division: 'IV', masteryPercent: 76, speedScore: 67, isYou: false },
  { playerId: '12', name: 'Olivia', grade: '3', rank: 'diamond', division: 'IV', masteryPercent: 75, speedScore: 65, isYou: false },
  
  // GOLD (50-74%): 25 students (~31%) - PEAK
  ...Array.from({ length: 25 }, (_, i) => ({
    playerId: `gold-${i}`,
    name: `Student${13 + i}`,
    grade: '3',
    rank: 'gold',
    division: i < 6 ? 'I' : i < 12 ? 'II' : i < 19 ? 'III' : 'IV',
    masteryPercent: 74 - Math.floor(i * 0.96), // 74 down to 50
    speedScore: 64 - i,
    isYou: false,
  })) as LeaderboardEntry[],
  
  // SILVER (25-49%): 24 students (~30%)
  ...Array.from({ length: 24 }, (_, i) => ({
    playerId: `silver-${i}`,
    name: `Student${38 + i}`,
    grade: '3',
    rank: 'silver',
    division: i < 6 ? 'I' : i < 12 ? 'II' : i < 18 ? 'III' : 'IV',
    masteryPercent: 49 - Math.floor(i * 1.0), // 49 down to 25
    speedScore: 55 - i,
    isYou: i === 23, // "You!" at position #62 (Silver IV)
  })) as LeaderboardEntry[],
  
  // BRONZE (0-24%): 18 students (~23%)
  ...Array.from({ length: 18 }, (_, i) => ({
    playerId: `bronze-${i}`,
    name: `Student${62 + i}`,
    grade: '3',
    rank: 'bronze',
    division: i < 4 ? 'I' : i < 9 ? 'II' : i < 14 ? 'III' : 'IV',
    masteryPercent: 24 - Math.floor(i * 1.3), // 24 down to ~1
    speedScore: Math.max(20, 45 - i * 2),
    isYou: false,
  })) as LeaderboardEntry[],
  // Grade 2 students
  { playerId: '7', name: 'Alex', grade: '2', rank: 'gold', division: 'II', masteryPercent: 68, speedScore: 65, isYou: false },
  { playerId: '8', name: 'Chris', grade: '2', rank: 'gold', division: 'III', masteryPercent: 64, speedScore: 61, isYou: false },
  { playerId: '9', name: 'Taylor', grade: '2', rank: 'silver', division: 'I', masteryPercent: 48, speedScore: 52, isYou: false },
  // Grade 4 students
  { playerId: '10', name: 'Jordan', grade: '4', rank: 'silver', division: 'II', masteryPercent: 42, speedScore: 48, isYou: false },
  { playerId: '11', name: 'Casey', grade: '4', rank: 'silver', division: 'III', masteryPercent: 38, speedScore: 45, isYou: false },
  { playerId: '12', name: 'Riley', grade: '4', rank: 'bronze', division: 'I', masteryPercent: 22, speedScore: 38, isYou: false },
  // Grade 5 students
  { playerId: '13', name: 'Sam', grade: '5', rank: 'bronze', division: 'II', masteryPercent: 18, speedScore: 32, isYou: false },
  { playerId: '14', name: 'Morgan', grade: '5', rank: 'bronze', division: 'III', masteryPercent: 12, speedScore: 28, isYou: false },
  { playerId: '15', name: 'Dakota', grade: '5', rank: 'bronze', division: 'IV', masteryPercent: 8, speedScore: 22, isYou: false },
];

const chartConfig = {
  count: {
    label: "Students",
  },
  bronze: {
    label: "Bronze",
    color: "#B45309", // Matches RankGem yellow-700/amber tone
  },
  silver: {
    label: "Silver",
    color: "#D1D5DB", // Matches RankGem gray-300
  },
  gold: {
    label: "Gold",
    color: "#FBBF24", // Matches RankGem amber-400
  },
  diamond: {
    label: "Diamond",
    color: "#22D3EE", // Matches RankGem cyan-400
  },
  legendary: {
    label: "Legendary",
    color: "#EC4899", // Matches RankGem pink-400 (richer than purple)
  },
} satisfies ChartConfig;

export function LeaderboardPanel() {
  // Get current player's grade and connection
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const connection = useGameStore(state => 
    state.connectionState.tag === 'connected' ? state.connectionState.conn : null
  );
  
  // Grade filter - defaults to player's grade (convert number to string, K for grade 0)
  const [selectedGrade, setSelectedGrade] = useState(
    currentPlayer?.grade !== undefined 
      ? (currentPlayer.grade === 0 ? 'K' : String(currentPlayer.grade))
      : '3'
  );
  
  // Sync selectedGrade with currentPlayer.grade when it changes
  useEffect(() => {
    if (currentPlayer?.grade !== undefined) {
      setSelectedGrade(currentPlayer.grade === 0 ? 'K' : String(currentPlayer.grade));
    }
  }, [currentPlayer?.grade]);
  
  // Pagination (null = default hybrid view, number = full page)
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const ITEMS_PER_PAGE = 25;
  
  // Real data from subscription
  const [leaderboardEntries, setLeaderboardEntries] = useState<DBLeaderboardEntry[]>([]);
  
  // Dev: Toggle between mock and real data
  const [useMockData, setUseMockData] = useState(false);
  
  // Dev: Test different positions (null = default #62, or override)
  const [testPosition, setTestPosition] = useState<number | null>(null);
  const TEST_POSITIONS = [1, 2, 3, 5, 25, 26, 62, 79]; // All edge cases: podiums, top10, boundaries, gaps, last place
  
  // Subscribe to leaderboard for selected grade
  useEffect(() => {
    if (!useMockData && connection) {
      const gradeNum = selectedGrade === 'K' ? 0 : Number(selectedGrade);
      
      // Read leaderboard from cache (subscription already filters by grade)
      const updateFromCache = () => {
        const entries: DBLeaderboardEntry[] = Array.from(connection.db.leaderboardEntry.iter())
          .sort((a, b) => a.position - b.position);
        setLeaderboardEntries(entries);
      };
      
      // Subscribe to leaderboard for this grade
      const sub = connection.subscriptionBuilder()
        .onApplied(() => {
          // Server already keeps leaderboard fresh (updates on every raid end)
          // Just read from cache, don't trigger unnecessary rebuild
          updateFromCache();
        })
        .subscribe([`SELECT * FROM leaderboard_entry WHERE grade = ${gradeNum}`]);
      
      // Listen for changes (only fires for subscribed rows)
      connection.db.leaderboardEntry.onInsert(updateFromCache);
      connection.db.leaderboardEntry.onUpdate(updateFromCache);
      connection.db.leaderboardEntry.onDelete(updateFromCache);
      
      return () => {
        sub.unsubscribe();
        // Clean up listeners to prevent duplicates on remount
        connection.db.leaderboardEntry.removeOnInsert(updateFromCache);
        connection.db.leaderboardEntry.removeOnUpdate(updateFromCache);
        connection.db.leaderboardEntry.removeOnDelete(updateFromCache);
      };
    }
  }, [selectedGrade, useMockData, connection]);
  
  // Ref for auto-scroll on page change
  const tableRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to table top when page changes (not on initial mount)
  useEffect(() => {
    if (currentPage !== null) {
      tableRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [currentPage]);
  
  // Map subscription data to display format
  const realData: LeaderboardEntry[] = leaderboardEntries.map(entry => ({
    playerId: entry.playerId,
    name: entry.playerName,
    grade: entry.grade === 0 ? 'K' : String(entry.grade),
    rank: entry.rank,
    division: entry.division,
    masteryPercent: entry.masteryPercent,
    speedScore: entry.speedPercent,
    isYou: currentPlayer?.id === entry.playerId,
  }));
  
  // Use mock data in dev mode when toggled
  let allData = import.meta.env.DEV && useMockData ? MOCK_DATA : realData;
  
  // Dev: Override "You!" position for testing
  if (import.meta.env.DEV && testPosition !== null && useMockData) {
    allData = allData.map((entry, index) => {
      const isTestPosition = entry.grade === '3' && index === testPosition - 1;
      return {
        ...entry,
        isYou: isTestPosition,
        name: isTestPosition ? 'You!' : entry.name,
      };
    });
  }
  
  // Filter by selected grade
  const displayData = allData.filter(entry => entry.grade === selectedGrade);
  
  // Find your entry
  const yourEntry = displayData.find(entry => entry.isYou);
  const yourPosition = displayData.findIndex(entry => entry.isYou) + 1;
  
  // Calculate what to show in main view
  let mainViewData: LeaderboardEntry[];
  
  // Dynamic overview size: show all if ≤25, else show top 25
  const overviewSize = displayData.length <= 25 ? displayData.length : 25;
  
  if (currentPage === null) {
    // Default: Overview (all if ≤25, top 25 if larger)
    mainViewData = displayData.slice(0, overviewSize);
  } else {
    // Paginated: Show full page
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    mainViewData = displayData.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }
  
  // You & Nearby context (±2 around your position)
  // Show if you're not in main view (in overview mode only)
  const isYouInMainView = mainViewData.some(entry => entry.isYou);
  const shouldShowNearby = currentPage === null && !isYouInMainView && yourEntry;
  
  // Calculate nearby context, ensuring no overlap with main view
  let nearbyStart = Math.max(0, yourPosition - 3);
  if (currentPage === null) {
    // In overview mode, start after the overview ends to avoid duplicates
    nearbyStart = Math.max(nearbyStart, overviewSize);
  }
  
  const nearbyContext = shouldShowNearby
    ? displayData.slice(nearbyStart, yourPosition + 2)
    : [];
  
  // Gap exists if there's space between overview and nearby sections
  const hasGap = shouldShowNearby && nearbyStart > overviewSize;
  
  // Calculate total pages
  const totalPages = Math.ceil(displayData.length / ITEMS_PER_PAGE);
  
  // Calculate rank distribution for chart (percentages + counts)
  const distribution = useMemo(() => {
    const counts = {
      bronze: 0,
      silver: 0,
      gold: 0,
      diamond: 0,
      legendary: 0,
    };
    
    displayData.forEach(entry => {
      counts[entry.rank as keyof typeof counts]++;
    });
    
    const total = displayData.length || 1; // Avoid division by zero
    
    return [
      { rank: 'Bronze', percentage: (counts.bronze / total) * 100, count: counts.bronze, fill: chartConfig.bronze.color },
      { rank: 'Silver', percentage: (counts.silver / total) * 100, count: counts.silver, fill: chartConfig.silver.color },
      { rank: 'Gold', percentage: (counts.gold / total) * 100, count: counts.gold, fill: chartConfig.gold.color },
      { rank: 'Diamond', percentage: (counts.diamond / total) * 100, count: counts.diamond, fill: chartConfig.diamond.color },
      { rank: 'Legendary', percentage: (counts.legendary / total) * 100, count: counts.legendary, fill: chartConfig.legendary.color },
    ];
  }, [displayData]);
  
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-sm">Leaderboard</CardTitle>
          <div className="flex items-center gap-3">
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger className="w-32 h-8 text-xs bg-gray-800 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="K">Kindergarten</SelectItem>
                <SelectItem value="1">Grade 1</SelectItem>
                <SelectItem value="2">Grade 2</SelectItem>
                <SelectItem value="3">Grade 3</SelectItem>
                <SelectItem value="4">Grade 4</SelectItem>
                <SelectItem value="5">Grade 5</SelectItem>
              </SelectContent>
            </Select>
            {import.meta.env.DEV && (
              <>
                <button
                  onClick={() => setUseMockData(!useMockData)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {useMockData ? '📊 Mock' : '🔌 Real'}
                </button>
                {useMockData && (
                  <button
                    onClick={() => {
                      if (testPosition === null) {
                        setTestPosition(TEST_POSITIONS[0]);
                      } else {
                        const currentIdx = TEST_POSITIONS.indexOf(testPosition);
                        const nextIdx = (currentIdx + 1) % TEST_POSITIONS.length;
                        setTestPosition(TEST_POSITIONS[nextIdx]);
                      }
                    }}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    You: #{testPosition || 62}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {displayData.length === 0 ? (
          <p className="text-gray-400 text-xs">No students yet</p>
        ) : (
          <div className="border border-gray-700 rounded-lg overflow-visible">
            {/* Distribution Chart */}
            <div className="p-4 bg-gray-800/30 border-b border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Rank Distribution
                </h4>
                <p className="text-xs text-gray-500">
                  {displayData.length} students
                </p>
              </div>
              <ChartContainer config={chartConfig} className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution}>
                    <CartesianGrid 
                      strokeDasharray="3 3" 
                      vertical={false} 
                      stroke="#374151"
                    />
                    <XAxis 
                      dataKey="rank" 
                      tick={{ fill: '#9CA3AF', fontSize: 11 }}
                      axisLine={{ stroke: '#4B5563' }}
                      padding={{ left: 10, right: 10 }}
                      tickMargin={8}
                    />
                    <YAxis 
                      tick={{ fill: '#9CA3AF', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip
                      cursor={false}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-lg">
                            <p className="font-bold text-sm mb-1" style={{ color: data.fill }}>
                              {data.rank}
                            </p>
                            <p className="text-gray-300 text-xs">
                              Ratio: {data.percentage.toFixed(1)}%
                            </p>
                            <p className="text-gray-300 text-xs">
                              Students: {data.count}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="percentage" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
            
            {/* Main View (Top 10 or paginated) */}
            <div ref={tableRef} className="overflow-visible">
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-700 mb-2 overflow-visible">
                <span className="w-10">Place</span>
                <span className="flex-1">Name</span>
                <span className="w-24">Rank</span>
                <span className="w-8">Div</span>
                <span className="w-16 text-right">Mastery</span>
                <span className="w-16 text-right relative z-10">
                  Speed
                  <InfoTooltip text="How fast you answer (based on recent practice)" />
                </span>
              </div>
              
              {/* Rows */}
              <div className="space-y-1">
                {mainViewData.map((entry, index) => {
                  const position = currentPage === null 
                    ? index + 1 
                    : (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
                  return <LeaderboardRow key={entry.playerId} entry={entry} position={position} />;
                })}
              </div>
            </div>
            
            {/* Gap Indicator */}
            {hasGap && (
              <div className="text-center py-3 text-gray-500 text-xs">
                ... {nearbyStart - overviewSize} more students ...
              </div>
            )}
            
            {/* You & Nearby Section (sticky, always visible) */}
            {nearbyContext.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-700">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
                  Your Rank
                </h4>
                <div className="space-y-1">
                  {nearbyContext.map((entry, index) => {
                    const position = nearbyStart + index + 1;
                    return <LeaderboardRow key={entry.playerId} entry={entry} position={position} />;
                  })}
                </div>
              </div>
            )}
            
            {/* Percentile message - always visible */}
            {yourEntry && (() => {
              const percentile = Math.round((1 - (yourPosition - 1) / displayData.length) * 100);
              
              if (yourPosition <= 10) {
                return (
                  <p className="text-xs text-purple-400 font-semibold text-center mt-4 mb-6">
                    Top 10! You're crushing it!
                  </p>
                );
              } else if (yourPosition <= Math.ceil(displayData.length * 0.25)) {
                return (
                  <p className="text-xs text-cyan-400 font-semibold text-center mt-4 mb-6">
                    You're in the top {percentile}%! Keep it up!
                  </p>
                );
              } else if (yourPosition <= Math.ceil(displayData.length * 0.5)) {
                return (
                  <p className="text-xs text-gray-300 text-center mt-4 mb-6">
                    You're in the top {percentile}% — great progress!
                  </p>
                );
              } else {
                return (
                  <p className="text-xs text-gray-400 text-center mt-4 mb-6">
                    Top {percentile}% — master more facts to climb!
                  </p>
                );
              }
            })()}
            
            {/* Pagination - show if more players than overview shows */}
            {displayData.length > overviewSize && (
              <div className="py-4 flex justify-center items-center gap-2">
                {/* Previous arrow */}
                <button
                  onClick={() => setCurrentPage(prev => prev === null || prev === 2 ? null : prev - 1)}
                  disabled={currentPage === null}
                  className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:hover:bg-gray-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {/* Overview/Top 25 button */}
                <button
                  onClick={() => setCurrentPage(null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    currentPage === null
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {displayData.length <= 25 ? 'All' : 'Top 25'}
                </button>
                
                {/* Page numbers (skip page 1 since "Top 25" is page 1) */}
                {Array.from({ length: totalPages - 1 }, (_, i) => i + 2).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      currentPage === page
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                
                {/* Next arrow */}
                <button
                  onClick={() => setCurrentPage(prev => prev === null ? 2 : prev === totalPages ? prev : prev + 1)}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:hover:bg-gray-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

