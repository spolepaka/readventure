# Environment Setup Guide

## Quick Reference

### Worker Environments

```bash
# Dev (local development)
cd worker && bun run dev

# Staging (Maincloud)
cd worker && bun run dev:staging

# Production (EC2)
cd worker && bun run start
```

### Client Modes

```bash
# Admin/Dev Mode (with owner token)
# Keep VITE_SPACETIMEDB_TOKEN in client/.env.local
cd client && bun run dev

# Student Testing Mode (multi-tab)
# Comment out VITE_SPACETIMEDB_TOKEN in client/.env.local
# Restart dev server, open 2+ tabs
cd client && bun run dev
```

## Environment Files

### Worker Files

**`worker/.env.dev`** - Maincloud dev testing
- URI: `wss://maincloud.spacetimedb.com`
- Module: `math-raiders` (shared Maincloud database)
- Has token for owner auth

**`worker/.env.staging`** - Maincloud staging (same as dev)
- URI: `wss://maincloud.spacetimedb.com`
- Module: `math-raiders` (shared Maincloud database)
- Has token for owner auth

**`worker/.env`** - Production EC2
- URI: `ws://18.224.110.93:3000`
- Module: `math-raiders`
- ⚠️ Token needs to be set ON EC2 instance

### Client Files

**`client/.env.local`** - Local dev/staging (gitignored)
- Points to Maincloud by default
- Has owner token always present
- Toggle `VITE_ADMIN_MODE=true/false` to switch modes (no restart needed!)

**Production** - Vercel deployment
- NO `.env.local` file (not deployed)
- Uses Vercel env vars (no token)
- All clients are students

## Testing Workflow

### 1. Test on Maincloud Dev

```bash
# Build and publish server
cd server
spacetime build --project-path .
spacetime publish --delete-data --project-path . --server maincloud -y math-raiders

# Start worker
cd ../worker
bun run --env-file=.env.dev src/index.ts

# Start client (admin mode)
cd ../client
bun run dev
# Visit http://localhost:5173
```

### 2. Test Student Mode (Multi-tab)

```bash
# Edit client/.env.local - set admin mode to false:
VITE_ADMIN_MODE=false

# Just refresh browser (no restart needed!)
# Or restart dev server if you prefer:
cd client
bun run dev

# Open multiple tabs - each gets unique anonymous identity
# Test that they can raid together but can't access admin functions
```

### 3. Deploy to Production

```bash
# On EC2, update worker/.env with EC2 token:
ssh your-ec2-instance
cd /path/to/worker
spacetime login show --token  # Get token ON EC2
# Edit .env and paste the token

# Restart worker service
pm2 restart timeback-worker

# Vercel client automatically uses no token (students only)
```

## Security Model

| Context | Token? | Identity | Can Do |
|---------|--------|----------|--------|
| Worker (any env) | ✅ Yes | Module Owner | Process events, call admin reducers |
| Admin/Dev Client | ✅ Yes | Module Owner | Change grades, see all data |
| Student Client | ❌ No | Anonymous | Play game, can't access admin functions |
| Production Client | ❌ No | Anonymous | Play game only |

## Troubleshooting

**Worker can't connect:**
- Check `SPACETIMEDB_TOKEN` is set
- Run `spacetime login show --token` to verify

**Client shows "Unauthorized":**
- Admin mode: Check `VITE_SPACETIMEDB_TOKEN` in `.env.local`
- Student mode: This is expected! They can't call admin reducers.

**Multi-tab testing not working:**
- Make sure `VITE_SPACETIMEDB_TOKEN` is commented out
- Restart dev server after changing `.env.local`
- Each tab should show different identity in console

**RLS not working:**
- Make sure you published with `--clear-database`
- Check server logs for RLS filter errors
- Verify `AuthorizedWorker` table exists in DB

