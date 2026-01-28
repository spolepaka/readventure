# Authentication & Deployment Guide

## Token Architecture

Math Raiders uses SpacetimeDB owner tokens for admin operations across three components:

| Component | Needs Token? | Why | Source |
|-----------|-------------|-----|--------|
| **Client (Students)** | NO | Anonymous gameplay | N/A |
| **Client (Dev/Admin)** | YES (optional) | Test admin features locally | `spacetime login` |
| **Worker** | YES | Access `timeback_event_queue` (RLS) | `spacetime login` |
| **Admin Panel** | YES | Call `set_grade`, backup/restore | `spacetime login` |
| **Backup Scripts** | YES | Read all tables, call restore reducers | `spacetime login` |

## Environment Setup

### 1. Local Development (Maincloud)

**SpacetimeDB:**
```bash
spacetime login  # One-time setup
```

**Client:**
```bash
cd client
cp .env.example .env.local
# Set VITE_ADMIN_MODE=true for testing admin features
# Add VITE_SPACETIMEDB_TOKEN=$(spacetime login show --token | tail -1)
```

**Worker:**
```bash
cd worker
cp .env.example .env.dev
# Add SPACETIMEDB_TOKEN=$(spacetime login show --token | tail -1)
```

**Admin Panel:**
```bash
cd admin
cp .env.example .env.local
# Add VITE_SPACETIMEDB_TOKEN=$(spacetime login show --token | tail -1)
```

### 2. Production (EC2)

**On EC2 (one-time setup):**
```bash
ssh math-raiders
spacetime login  # Creates token on EC2
cd ~/mathraiders-worker
cp .env.example .env
# Edit .env and add:
# SPACETIMEDB_TOKEN=$(spacetime login show --token | tail -1)
# SPACETIMEDB_URI=ws://localhost:3000
# (production TimeBack credentials)
pm2 restart timeback-worker
```

**Locally (for admin/backup):**
```bash
# Get EC2 token for admin panel
ssh math-raiders "grep SPACETIMEDB_TOKEN /home/ubuntu/mathraiders-worker/.env | cut -d'=' -f2"
# Add to admin/.env.local as VITE_SPACETIMEDB_TOKEN_EC2=<paste>
```

## Deploy Commands

### Deploy Server Module

**Local/Staging (Maincloud):**
```bash
./scripts/ops/deploy.sh local         # Safe deploy, keeps data
./scripts/ops/deploy.sh staging       # Safe deploy, keeps data
./scripts/ops/deploy.sh local --breaking  # Wipes data (auto-backup)
```
- Uses: Your `spacetime login` credentials (implicit)
- No token needed in script (SpacetimeDB CLI handles it)

**Production (EC2):**
```bash
./scripts/ops/deploy.sh production         # Safe deploy
./scripts/ops/deploy.sh production --breaking  # Wipes data (auto-backup)
```
- Uses: EC2's `spacetime login` credentials (via SSH)
- No token needed in script (runs on EC2 box)

### Deploy Client

**Build:**
```bash
cd client
cp .env.example .env.production
# Edit .env.production:
# - VITE_SPACETIMEDB_HOST=<cloudflare-tunnel-url>
# - VITE_ADMIN_MODE=false (CRITICAL: no student auth!)
# - TimeBack credentials
npm run build
```

**Upload to Playcademy:**
```bash
cd dist
zip -r ../mathraiders-production-$(date +%Y%m%d-%H%M%S).zip .
# Upload zip to Playcademy arcade
```

### Deploy Worker

**Worker is automatically updated during production server deploy.**

The `deploy.sh production` script automatically:
- Regenerates TypeScript SDK on EC2 (ensures schema sync)
- Restarts worker via pm2 (graceful, stateless)
- Shows worker logs for verification

**Manual worker code update (if worker logic changed):**
```bash
# 1. Copy code
scp -r worker/* math-raiders:~/mathraiders-worker/

# 2. Ensure .env has correct token
ssh math-raiders "cd ~/mathraiders-worker && grep SPACETIMEDB_TOKEN .env"

# 3. Restart worker
ssh math-raiders "pm2 restart timeback-worker"
ssh math-raiders "pm2 logs timeback-worker --lines 20"
```

## Backup/Restore

**Uses owner tokens automatically:**
```bash
# Backup
./scripts/ops/backup.sh local       # Uses: spacetime login show --token
./scripts/ops/backup.sh production  # Uses: SSH to get EC2 worker's token

# Restore  
./scripts/ops/restore.sh local latest       # Uses: spacetime login show --token
./scripts/ops/restore.sh production latest  # Uses: SSH to get EC2 worker's token
```

## Security Checklist

Before production deploy:
- [ ] Client `.env.production` has `VITE_ADMIN_MODE=false`
- [ ] Client `.env.production` has correct cloudflare tunnel URL
- [ ] EC2 worker `.env` has `SPACETIMEDB_TOKEN` set
- [ ] EC2 worker is running: `pm2 status timeback-worker`
- [ ] Admin panel `.env.local` has EC2 token for remote management
- [ ] Never commit actual `.env` files (only `.env.example`)

## Troubleshooting

**"Unauthorized" errors in worker logs:**
- Check worker `.env` has `SPACETIMEDB_TOKEN` set
- Verify token: `ssh math-raiders "spacetime login show --token"`
- Restart worker: `pm2 restart timeback-worker`

**Backup/restore fails:**
- Ensure you're logged in: `spacetime login show`
- For production: Check EC2 token accessible via SSH

**Admin panel can't connect to EC2:**
- Get token: `ssh math-raiders "grep SPACETIMEDB_TOKEN /home/ubuntu/mathraiders-worker/.env | cut -d'=' -f2"`
- Add to `admin/.env.local` as `VITE_SPACETIMEDB_TOKEN_EC2=<token>`
