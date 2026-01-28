# Math Raiders Academic Dashboard

Read-only dashboard for academic admins to track student progress in Math Raiders.

## Local Development

```bash
bun install
bun dev
```

In dev mode, auth is bypassed for easy testing.

## Deploy to Vercel

```bash
cd academic-dashboard
vercel --prod
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `ALLOWED_EMAILS` | Comma-separated list of authorized Google emails |
| `VITE_SPACETIMEDB_TOKEN_EC2` | SpacetimeDB admin token |

### Google OAuth Setup

1. Create OAuth Client ID in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add authorized JavaScript origins:
   - `https://mathraiders-dashboard.vercel.app`
   - `http://localhost:5173` (for local dev)
3. Set `VITE_GOOGLE_CLIENT_ID` in Vercel

### Updating Access

Update `ALLOWED_EMAILS` env var in Vercel:
```bash
vercel env rm ALLOWED_EMAILS production -y
printf 'email1@school.com,email2@school.com' | vercel env add ALLOWED_EMAILS production
vercel --prod
```

## Updating Pilot Students

Edit `PILOT_STUDENTS` array in `src/App.tsx`:

```typescript
const PILOT_STUDENTS = [
  'student1@alpha.school',
  'student2@alpha.school',
  // Add new student emails here
];
```

Students only appear after they log in and play at least one raid.

## Dashboard Columns

Edit `src/components/StudentProgress.tsx` to modify displayed metrics. Available data per student:

| Field | Description |
|-------|-------------|
| `name` | Student name |
| `grade` | Current grade level (0-5, where 0=K) |
| `track` | Current operation track (Add, Sub, Mult, Div) |
| `activeDays` | Number of days with activity |
| `totalMinutes` | Total play time |
| `minPerDay` | Average minutes per active day |
| `accuracy` | Correct / Total answers |
| `avgCqpm` | Average CQPM (raids >= 90s only) |
| `peakCqpm` | Best CQPM (raids >= 90s only) |
| `totalXP` | Total XP earned |
| `xpPerDay` | Average XP per active day |
| `lastPlayed` | Timestamp of last session |

## Architecture

- **Frontend**: React + Vite + Tailwind
- **Auth**: Google OAuth (via Google Identity Services)
- **Data**: SpacetimeDB (real-time WebSocket connection)
- **Hosting**: Vercel
