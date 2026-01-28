import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { useGameStore } from '@/store/gameStore'
import { useMasteryStats } from '@/hooks/useMasteryStats'
import { useEtaPrediction } from '@/hooks/useEtaPrediction'
import { getRankColorClasses } from '@/utils/rankDivisions'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const chartConfig = {
  mastered: {
    label: "Facts Mastered",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig

interface MasteryProgressChartProps {
  testEtaState?: number | null;
}

export function MasteryProgressChart({ testEtaState }: MasteryProgressChartProps) {
  const performanceHistory = useGameStore(state => state.performanceHistory);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const [timeRange, setTimeRange] = React.useState("7d") // Default to 7 days
  
  // Get mastery stats (which includes the correct total facts for the grade)
  const masteryStats = useMasteryStats(currentPlayer);
  const gradeTarget = masteryStats.total;

  // Transform performance history into chart data
  const chartData = React.useMemo(() => {
    if (!performanceHistory.length) return [];

    // Filter to only show data from current grade
    const gradeFiltered = performanceHistory.filter(
      snapshot => snapshot.grade === currentPlayer?.grade
    );

    if (!gradeFiltered.length) return [];

    // Sort by timestamp
    const sorted = [...gradeFiltered].sort((a, b) => {
      const aMicros = a.timestamp.microsSinceUnixEpoch;
      const bMicros = b.timestamp.microsSinceUnixEpoch;
      if (aMicros < bMicros) return -1;
      if (aMicros > bMicros) return 1;
      return 0;
    });

    // Group by day and take the last value per day
    const byDay = new Map<string, typeof sorted[0]>();
    
    sorted.forEach(snapshot => {
      try {
        const date = snapshot.timestamp.toDate();
        const dayKey = date.toLocaleDateString('en-CA'); // YYYY-MM-DD in user's local time
        
        // Keep the last snapshot of each day
        byDay.set(dayKey, snapshot);
      } catch (err) {
        console.error('[Mastery] Error processing snapshot:', err, snapshot);
      }
    });
    
    // Convert to array and create chart data
    return Array.from(byDay.entries()).map(([dateStr, snapshot]) => {
      return {
        date: dateStr,
        dateTime: snapshot.timestamp.toDate(),
        mastered: snapshot.factsMasteredAtSnapshot ?? 0,
      };
    }).sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
  }, [performanceHistory, currentPlayer?.grade]);

  // Filter data based on time range
  const filteredData = React.useMemo(() => {
    if (timeRange === "all") return chartData;
    
    const now = new Date();
    const cutoffDate = new Date();
    
    if (timeRange === "7d") {
      cutoffDate.setDate(now.getDate() - 7);
    } else if (timeRange === "30d") {
      cutoffDate.setDate(now.getDate() - 30);
    }
    
    return chartData.filter(item => item.dateTime >= cutoffDate);
  }, [chartData, timeRange]);

  // Calculate summary stats
  const stats = React.useMemo(() => {
    if (!filteredData.length) return null;
    
    const first = filteredData[0];
    const last = filteredData[filteredData.length - 1];
    const gained = last.mastered - first.mastered;
    
    return {
      currentMastered: last.mastered,
      gained,
    };
  }, [filteredData]);

  // ETA prediction for upcoming milestones
  // Pass all grade data; hook will use last 30 days for velocity calculation
  const realEtaData = useEtaPrediction(
    chartData,
    currentPlayer?.rank,
    masteryStats.mastered,
    masteryStats.total
  );
  
  // Dev testing: override with synthetic data
  const etaData = React.useMemo(() => {
    // Use real data if testEtaState is not set (null/undefined)
    // Note: 0 is a valid test state, so we check typeof
    if (typeof testEtaState !== 'number') {
      return realEtaData;
    }
    
    // Synthetic test states (0-5)
    switch (testEtaState) {
      case 0: // Not enough data
        return { milestones: null, reason: 'not_enough_data' as const };
      
      case 1: // Stalled
        return { milestones: null, reason: 'stalled' as const };
      
      case 2: // Normal pace
        return {
          milestones: [
            { name: 'Bronze III', factsAway: 15, etaDays: 10, etaText: 'in ~10 days', isClose: false, isVeryClose: false },
            { name: 'Silver', factsAway: 40, etaDays: 27, etaText: 'in ~4 weeks', isClose: false, isVeryClose: false }
          ]
        };
      
      case 3: // Close (< 7 days)
        return {
          milestones: [
            { name: 'Silver I', factsAway: 8, etaDays: 3, etaText: 'in ~3 days', isClose: true, isVeryClose: false },
            { name: 'Gold', factsAway: 25, etaDays: 17, etaText: 'in ~2 weeks', isClose: false, isVeryClose: false }
          ]
        };
      
      case 4: // Very close (< 1 day)
        return {
          milestones: [
            { name: 'Silver II', factsAway: 3, etaDays: 0.8, etaText: 'very soon!', isClose: true, isVeryClose: true },
            { name: 'Silver I', factsAway: 8, etaDays: 3.5, etaText: 'in ~4 days', isClose: true, isVeryClose: false }
          ]
        };
      
      case 5: // Complete Mastery (100%)
        return { milestones: null, reason: 'legendary' as const };
      
      default:
        return realEtaData;
    }
  }, [testEtaState, realEtaData]);

  // No data for current grade (or no data at all)
  if (!chartData.length) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="py-8 text-center">
          <p className="text-gray-400">No progress data for Grade {currentPlayer?.grade || 0} yet.</p>
          <p className="text-sm text-gray-500 mt-2">Complete some raids to see your progress!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b border-gray-800 py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle className="text-white">Mastery Progress</CardTitle>
          <CardDescription className="text-gray-400">
            {stats ? (
              <span>
                {stats.currentMastered} / {gradeTarget} facts mastered
                <span 
                  className="inline-block ml-1 text-gray-500 cursor-help relative info-icon"
                  data-tooltip="Unique facts only (3 + 4 = 4 + 3 counts as one)"
                >
                  ⓘ
                </span>
                {stats.gained !== 0 && (
                  <span className={`ml-2 font-bold ${stats.gained > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ({stats.gained > 0 ? `+${stats.gained}` : stats.gained} this {
                      timeRange === '7d' ? 'week' : 
                      timeRange === '30d' ? 'month' : 
                      'period'
                    })
                  </span>
                )}
              </span>
            ) : 'Track student mastery progress over time'}
          </CardDescription>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger
            className="w-[160px] rounded-lg bg-gray-800 border-gray-700 text-white hover:bg-gray-700 transition-colors relative z-50"
            aria-label="Select time range"
          >
            <SelectValue placeholder="Last 7 days" />
          </SelectTrigger>
          <SelectContent className="rounded-xl bg-gray-800 border-gray-700 z-[100]">
            <SelectItem value="7d" className="rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer">
              Last 7 days
            </SelectItem>
            <SelectItem value="30d" className="rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer">
              Last 30 days
            </SelectItem>
            <SelectItem value="all" className="rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer">
              All time
            </SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full bg-gray-800/20 rounded"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={filteredData}
              margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
            >
              <defs>
              <linearGradient id="fillMastered" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(142, 71%, 45%)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(142, 71%, 45%)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid 
              vertical={false} 
              strokeDasharray="3 3"
              className="stroke-gray-800"
            />
            <XAxis
              dataKey="dateTime"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              tickFormatter={(value) => {
                // value is already a Date object, no parsing needed!
                return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }}
              interval={Math.ceil(filteredData.length / 7)} // Show max 7 ticks
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              domain={[0, 'dataMax + 5']}
              tickFormatter={(value) => Math.round(value).toString()}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: '#374151', strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <ChartTooltipContent
                  active={active}
                  payload={payload}
                  label={label?.toString()}
                  labelFormatter={(value) => {
                    // Recharts passes dateTime as a string, parse it back
                    const date = new Date(value);
                    return date.toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric',
                      year: 'numeric'
                    });
                  }}
                  formatter={(value, name) => {
                    if (name === 'mastered') return `${value} facts`;
                    return value;
                  }}
                  indicator="dot"
                />
              )}
            />
            <Area
              dataKey="mastered"
              type="monotone"
              fill="url(#fillMastered)"
              stroke="hsl(142, 71%, 45%)"
              strokeWidth={2}
            />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* ETA Predictions Panel */}
        {(() => {
          // Perfect Mastery celebration (100%)
          if (etaData.reason === 'legendary') {
            return (
              <div className="mt-4 p-4 bg-gray-900/80 rounded-lg border border-gray-800 text-center">
                <p className="text-xl font-bold text-amber-400 mb-2">
                  Complete Mastery! 💎
                </p>
                <p className="text-sm text-gray-400">
                  Every grade fact mastered!
                </p>
              </div>
            );
          }
          
          // Not enough data
          if (etaData.reason === 'not_enough_data') {
            return (
              <div className="mt-4 p-4 bg-gray-900/80 rounded-lg border border-gray-800 text-center">
                <p className="text-sm text-gray-400">
                  Come back tomorrow and
                  <br />
                  keep practicing!
                </p>
              </div>
            );
          }
          
          // Stalled (no progress)
          if (etaData.reason === 'stalled') {
            return (
              <div className="mt-4 p-4 bg-gray-900/80 rounded-lg border border-gray-800 text-center">
                <p className="text-sm text-gray-400">
                  Keep raiding to see your
                  <br />
                  path to the next rank
                </p>
              </div>
            );
          }
          
          // Happy path: show upcoming milestones
          if (etaData.milestones) {
            return (
              <div className="mt-4 p-4 bg-gray-900/80 rounded-lg border border-gray-800">
                <h3 className="text-sm uppercase tracking-wider font-semibold text-gray-500 mb-3">
                  Your Path Forward
                </h3>
                <div className="space-y-2.5">
                  {etaData.milestones.map((m, idx) => {
                    // Parse milestone name for rank coloring
                    // "Bronze III" → ["Bronze", "III"]
                    // "Silver" → ["Silver"]
                    // "Complete Mastery" → special amber styling
                    const isCompleteMastery = m.name === 'Complete Mastery';
                    const parts = m.name.split(' ');
                    const rankName = parts[0]?.toLowerCase();
                    const division = parts[1]; // undefined for ranks without division
                    const rankColors = getRankColorClasses(rankName);
                    
                    return (
                      <div key={m.name} className="flex items-baseline gap-3">
                        <span className="text-gray-500 text-sm flex-shrink-0">→</span>
                        <span
                          className={cn(
                            "text-lg font-medium",
                            isCompleteMastery ? "text-amber-400" : rankColors.text
                          )}
                        >
                          {parts[0]}
                          {!isCompleteMastery && division && (
                            <span className="text-white ml-1.5">
                              {division}
                            </span>
                          )}
                          {isCompleteMastery && parts[1] && (
                            <span className="text-amber-400 ml-1.5">
                              {parts[1]}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-gray-400">
                          {m.etaText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          
          return null;
        })()}
      </CardContent>
    </Card>
  )
}
