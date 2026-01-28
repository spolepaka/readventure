import type { TimebackConfig } from 'timeback/config'

export default {
	name: 'Math Raiders',
	sensors: [
		'https://mathraiders.com',
	],
	courses: [
		{
			ids: { production: 'math-raiders-grade-0' },
			subject: 'FastMath',
			grade: 0,
			courseCode: 'MR-GK',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 5 },
				metrics: { totalXp: 168, totalLessons: 42 },
			},
		},
		{
			ids: { production: 'math-raiders-grade-1' },
			subject: 'FastMath',
			grade: 1,
			courseCode: 'MR-G1',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 10 },
				metrics: { totalXp: 264, totalLessons: 66 },
			},
		},
		{
			ids: { production: 'math-raiders-grade-2' },
			subject: 'FastMath',
			grade: 2,
			courseCode: 'MR-G2',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 10 },
				metrics: { totalXp: 796, totalLessons: 265 },
			},
		},
		{
			ids: { production: 'math-raiders-grade-3' },
			subject: 'FastMath',
			grade: 3,
			courseCode: 'MR-G3',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 10 },
				metrics: { totalXp: 1188, totalLessons: 562 },
			},
		},
		{
			ids: { production: 'math-raiders-grade-4' },
			subject: 'FastMath',
			grade: 4,
			courseCode: 'MR-G4',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 4 },
				metrics: { totalXp: 916, totalLessons: 313 },
			},
		},
		{
			ids: { production: 'math-raiders-grade-5' },
			subject: 'FastMath',
			grade: 5,
			courseCode: 'MR-G5',
			metadata: {
				publishStatus: 'testing',
				primaryApp: 'fast_math',
				goals: { dailyXp: 10, dailyLessons: 5, dailyAccuracy: 80, dailyActiveMinutes: 10, dailyMasteredUnits: 7 },
				metrics: { totalXp: 706, totalLessons: 775 },
			},
		},
	],
} satisfies TimebackConfig
