#!/bin/bash
# Unified Restore Script for Math Raiders
# Usage: ./restore.sh <environment> [backup-file|latest]
#
# Environments:
#   local       - Restore to maincloud/math-raiders
#   staging     - Restore to maincloud/math-raiders-staging
#   production  - Restore to EC2
#
# Examples:
#   ./restore.sh production latest
#   ./restore.sh staging production_2025-10-09_12-00.json

set -e  # Exit on error

ENV=${1:-}
BACKUP_ARG=${2:-}

if [ -z "$ENV" ]; then
    echo "Usage: ./restore.sh <local|staging|production> [backup-file|latest]"
    exit 1
fi

if [ -z "$BACKUP_ARG" ]; then
    BACKUP_ARG="latest"
fi

# Validate environment
if [[ ! "$ENV" =~ ^(local|staging|production)$ ]]; then
    echo "❌ Invalid environment: $ENV"
    echo "   Valid: local, staging, production"
    exit 1
fi

BACKUP_ROOT_LOCAL="$HOME/Desktop/MathRaiders-Backups"
BACKUP_ROOT_OFFSITE="$HOME/Library/CloudStorage/Box-Box/MathRaiders-Backups"
ENV_DIR_LOCAL="$BACKUP_ROOT_LOCAL/$ENV"
ENV_DIR_OFFSITE="$BACKUP_ROOT_OFFSITE/$ENV"

# Find backup file (check local first, then Box)
if [ "$BACKUP_ARG" = "latest" ]; then
    BACKUP_FILE=$(ls -t "$ENV_DIR_LOCAL"/${ENV}_*.json "$ENV_DIR_OFFSITE"/${ENV}_*.json 2>/dev/null | head -1)
    if [ -z "$BACKUP_FILE" ]; then
        echo "❌ No backups found for $ENV"
        echo "   Checked: $ENV_DIR_LOCAL"
        echo "   Checked: $ENV_DIR_OFFSITE"
        exit 1
    fi
else
    # Check if full path or just filename (try local first, then Box)
    if [ -f "$BACKUP_ARG" ]; then
        BACKUP_FILE="$BACKUP_ARG"
    elif [ -f "$ENV_DIR_LOCAL/$BACKUP_ARG" ]; then
        BACKUP_FILE="$ENV_DIR_LOCAL/$BACKUP_ARG"
    elif [ -f "$ENV_DIR_OFFSITE/$BACKUP_ARG" ]; then
        BACKUP_FILE="$ENV_DIR_OFFSITE/$BACKUP_ARG"
    else
        echo "❌ Backup file not found: $BACKUP_ARG"
        echo ""
        echo "Available backups for $ENV (local):"
        ls -lh "$ENV_DIR_LOCAL"/${ENV}_*.json 2>/dev/null || echo "  (none)"
        echo ""
        echo "Available backups for $ENV (Box):"
        ls -lh "$ENV_DIR_OFFSITE"/${ENV}_*.json 2>/dev/null || echo "  (none)"
        exit 1
    fi
fi

# Step 1: Validate backup file FIRST (before build, before confirmation)
echo "🔍 Validating backup file..."
if ! bun -e "JSON.parse(await Bun.file('$BACKUP_FILE').text())" >/dev/null 2>&1; then
    echo "❌ Backup file is not valid JSON!"
    echo "   File: $BACKUP_FILE"
    echo "   Cannot restore from corrupted backup"
    exit 1
fi

# Check backup has required fields
VALID_BACKUP=$(cat "$BACKUP_FILE" | bun -e "
  const data = JSON.parse(await Bun.stdin.text());
  const valid = data.tables && data.tables.player && data.tables.fact_mastery && data.tables.performance_snapshot;
  console.log(valid ? 'true' : 'false');
")

if [ "$VALID_BACKUP" != "true" ]; then
    echo "❌ Backup file missing required tables!"
    echo "   Expected: tables.player, tables.fact_mastery, tables.performance_snapshot"
    exit 1
fi

echo "✅ Backup file validated"
echo ""

# Step 2: Build (before confirmation, to catch build errors early)
echo "🔨 Building current server module..."
cd "$(dirname "$0")/../.."  # Go to project root
cd server
spacetime build || {
    echo "❌ Build failed! Cannot restore."
    exit 1
}
cd ..

echo ""
echo "⚠️  WARNING: RESTORE WILL WIPE ALL CURRENT DATA!"
echo "📦 Backup file: $(basename $BACKUP_FILE)"
echo "📅 Backup date: $(basename $BACKUP_FILE | cut -d'_' -f2-3)"
echo ""
echo "This restore will:"
echo "  1. WIPE all current data in $ENV"
echo "  2. Deploy current schema (with -c flag)"
echo "  3. Import data from backup file"
echo ""
echo "Type the environment name to confirm: $ENV"
read -p "> " confirm

if [ "$confirm" != "$ENV" ]; then
    echo "❌ Restore cancelled (typed '$confirm', expected '$ENV')"
    exit 1
fi

echo ""
echo "🔄 Restoring $ENV from backup..."
echo ""

# Step 2: Wipe DB and deploy schema
echo "Step 1/2: Wiping database and deploying current schema..."
cd server

case $ENV in
    local)
        # Manual confirmation for each SpacetimeDB prompt (check output to catch aborts)
        OUTPUT=$(spacetime publish math-raiders -s maincloud -c 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -q "Aborting"; then
            echo "❌ Database wipe aborted by user or failed confirmation!"
            exit 1
        fi
        if ! echo "$OUTPUT" | grep -q "Updated database"; then
            echo "❌ Database wipe failed!"
            exit 1
        fi
        ;;
    staging)
        OUTPUT=$(spacetime publish math-raiders-staging -s maincloud -c 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -q "Aborting"; then
            echo "❌ Database wipe aborted by user or failed confirmation!"
            exit 1
        fi
        if ! echo "$OUTPUT" | grep -q "Updated database"; then
            echo "❌ Database wipe failed!"
            exit 1
        fi
        ;;
    production)
        scp target/wasm32-unknown-unknown/release/spacetime_module.wasm math-raiders:~/
        OUTPUT=$(ssh math-raiders "/home/ubuntu/.local/bin/spacetime publish -s local --bin-path spacetime_module.wasm -c math-raiders" 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -q "Aborting"; then
            echo "❌ Database wipe aborted by user or failed confirmation!"
            exit 1
        fi
        if ! echo "$OUTPUT" | grep -q "Updated database"; then
            echo "❌ Database wipe failed!"
            exit 1
        fi
        ;;
esac

cd ..

echo "✅ Database wiped and fresh schema deployed"
echo ""

# Step 2: Import data from backup
echo "Step 2/2: Importing data from backup..."

# Get owner token for authentication (restore needs to call bulkRestore* reducers)
echo "🔑 Getting owner token..."
if [ "$ENV" = "production" ]; then
    # For EC2 production, get token from worker .env file on EC2
    export SPACETIMEDB_OWNER_TOKEN=$(ssh math-raiders "grep SPACETIMEDB_TOKEN /home/ubuntu/mathraiders-worker/.env | cut -d'=' -f2")
else
    # For maincloud (local/staging), use your local login (extract just the JWT)
    export SPACETIMEDB_OWNER_TOKEN=$(spacetime login show --token 2>/dev/null | tail -1 | awk '{print $NF}')
fi

if [ -z "$SPACETIMEDB_OWNER_TOKEN" ]; then
    echo "❌ Failed to get owner token."
    if [ "$ENV" = "production" ]; then
        echo "   Check EC2 worker .env file has SPACETIMEDB_TOKEN"
    else
        echo "   Run: spacetime login"
    fi
    exit 1
fi

bun run scripts/ops/import-backup.ts --env "$ENV" --file "$BACKUP_FILE"

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Restore failed!"
    echo "   Check error messages above"
    exit 1
fi

echo ""
echo "✅ Data imported successfully"
echo ""

# Verify restored data matches backup
echo "🔍 Verifying restored data..."

# Read expected counts from backup JSON
EXPECTED_PLAYERS=$(cat "$BACKUP_FILE" | bun -e "const data = JSON.parse(await Bun.stdin.text()); console.log(data.counts.player)")
EXPECTED_FACTS=$(cat "$BACKUP_FILE" | bun -e "const data = JSON.parse(await Bun.stdin.text()); console.log(data.counts.fact_mastery)")
EXPECTED_SNAPSHOTS=$(cat "$BACKUP_FILE" | bun -e "const data = JSON.parse(await Bun.stdin.text()); console.log(data.counts.performance_snapshot)")

# Query actual counts from database
case $ENV in
    local|staging)
        MODULE_NAME=$([ "$ENV" = "local" ] && echo "math-raiders" || echo "math-raiders-staging")
        ACTUAL_PLAYERS=$(spacetime sql $MODULE_NAME -s maincloud "SELECT COUNT(*) as n FROM player" 2>/dev/null | tail -1 | awk '{print $1}')
        ACTUAL_FACTS=$(spacetime sql $MODULE_NAME -s maincloud "SELECT COUNT(*) as n FROM fact_mastery" 2>/dev/null | tail -1 | awk '{print $1}')
        ACTUAL_SNAPSHOTS=$(spacetime sql $MODULE_NAME -s maincloud "SELECT COUNT(*) as n FROM performance_snapshot" 2>/dev/null | tail -1 | awk '{print $1}')
        ;;
    production)
        ACTUAL_PLAYERS=$(ssh math-raiders "/home/ubuntu/.local/bin/spacetime sql math-raiders -s local 'SELECT COUNT(*) as n FROM player'" 2>/dev/null | tail -1 | awk '{print $1}')
        ACTUAL_FACTS=$(ssh math-raiders "/home/ubuntu/.local/bin/spacetime sql math-raiders -s local 'SELECT COUNT(*) as n FROM fact_mastery'" 2>/dev/null | tail -1 | awk '{print $1}')
        ACTUAL_SNAPSHOTS=$(ssh math-raiders "/home/ubuntu/.local/bin/spacetime sql math-raiders -s local 'SELECT COUNT(*) as n FROM performance_snapshot'" 2>/dev/null | tail -1 | awk '{print $1}')
        ;;
esac

# Verify counts match
VERIFICATION_FAILED=false

if [ "$ACTUAL_PLAYERS" != "$EXPECTED_PLAYERS" ]; then
    echo "❌ Player count mismatch: expected $EXPECTED_PLAYERS, got $ACTUAL_PLAYERS"
    VERIFICATION_FAILED=true
else
    echo "✓ Players: $ACTUAL_PLAYERS"
fi

if [ "$ACTUAL_FACTS" != "$EXPECTED_FACTS" ]; then
    echo "❌ Fact mastery count mismatch: expected $EXPECTED_FACTS, got $ACTUAL_FACTS"
    VERIFICATION_FAILED=true
else
    echo "✓ Fact mastery: $ACTUAL_FACTS"
fi

if [ "$ACTUAL_SNAPSHOTS" != "$EXPECTED_SNAPSHOTS" ]; then
    echo "❌ Snapshot count mismatch: expected $EXPECTED_SNAPSHOTS, got $ACTUAL_SNAPSHOTS"
    VERIFICATION_FAILED=true
else
    echo "✓ Performance snapshots: $ACTUAL_SNAPSHOTS"
fi

echo ""

if [ "$VERIFICATION_FAILED" = true ]; then
    echo "❌ RESTORE VERIFICATION FAILED!"
    echo "   Data counts don't match backup file"
    echo "   Check for errors above or restore again"
    exit 1
fi

echo "✅ Restore complete and verified!"
echo ""
echo "📋 Next steps:"
echo "   - Test game functionality"
echo "   - Check leaderboard regenerates on first raid"
