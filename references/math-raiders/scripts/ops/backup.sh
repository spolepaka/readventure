#!/bin/bash
# Unified Backup Script for Math Raiders
# Usage: ./backup.sh <environment>
#
# Environments:
#   local       - Backup maincloud/math-raiders
#   staging     - Backup maincloud/math-raiders-staging
#   production  - Backup EC2

set -e  # Exit on error

# Always run from project root (so relative paths work)
cd "$(dirname "$0")/../.."

ENV=${1:-}

if [ -z "$ENV" ]; then
    echo "Usage: ./backup.sh <local|staging|production>"
    exit 1
fi

# Validate environment
if [[ ! "$ENV" =~ ^(local|staging|production)$ ]]; then
    echo "❌ Invalid environment: $ENV"
    echo "   Valid: local, staging, production"
    exit 1
fi

# Setup paths
BACKUP_ROOT_LOCAL="$HOME/Desktop/MathRaiders-Backups"
BACKUP_ROOT_OFFSITE="$HOME/Library/CloudStorage/Box-Box/MathRaiders-Backups"
ENV_DIR_LOCAL="$BACKUP_ROOT_LOCAL/$ENV"
ENV_DIR_OFFSITE="$BACKUP_ROOT_OFFSITE/$ENV"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
BACKUP_FILE="${ENV}_${TIMESTAMP}.json"
BACKUP_PATH_LOCAL="$ENV_DIR_LOCAL/$BACKUP_FILE"
BACKUP_PATH_OFFSITE="$ENV_DIR_OFFSITE/$BACKUP_FILE"

# Create directories
mkdir -p "$ENV_DIR_LOCAL"
mkdir -p "$ENV_DIR_OFFSITE"

echo "🔄 Starting backup of $ENV environment..."
echo "📁 Local: $BACKUP_PATH_LOCAL"
echo "☁️  Off-site: $BACKUP_PATH_OFFSITE"

# Get owner token for authentication
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

# Run automated export via TypeScript (to local first)
bun run scripts/ops/export-backup.ts --env "$ENV" --output "$BACKUP_PATH_LOCAL"

# Verify backup exists and isn't empty
if [ ! -s "$BACKUP_PATH_LOCAL" ]; then
    echo "❌ Backup failed: file not found or empty"
    exit 1
fi

# Verify backup has reasonable size (catch corrupted/empty exports)
FILE_SIZE=$(stat -f%z "$BACKUP_PATH_LOCAL" 2>/dev/null || stat -c%s "$BACKUP_PATH_LOCAL")
MIN_SIZE=500  # 500 bytes minimum (allows test DBs with minimal data)

if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
    echo "❌ Backup suspiciously small: ${FILE_SIZE} bytes (expected at least ${MIN_SIZE})"
    echo "   This likely indicates a failed or corrupted export"
    rm "$BACKUP_PATH_LOCAL"  # Remove bad backup
    exit 1
fi

# Validate JSON is parseable (catches corruption)
if ! bun -e "JSON.parse(await Bun.file('$BACKUP_PATH_LOCAL').text())" >/dev/null 2>&1; then
    echo "❌ Backup failed: corrupted JSON"
    rm "$BACKUP_PATH_LOCAL"
    exit 1
fi

echo "✅ Local backup verified: $BACKUP_PATH_LOCAL"

# Copy to off-site (Box sync) - both JSON and SQLite
echo "☁️  Copying to Box (off-site backup)..."
if ! cp "$BACKUP_PATH_LOCAL" "$BACKUP_PATH_OFFSITE"; then
    echo "⚠️  Off-site JSON copy failed (Box may not be mounted)"
    echo "   Local backup is safe: $BACKUP_PATH_LOCAL"
else
    # Also copy SQLite if it exists
    SQLITE_LOCAL="${BACKUP_PATH_LOCAL%.json}.sqlite"
    SQLITE_OFFSITE="${BACKUP_PATH_OFFSITE%.json}.sqlite"
    if [ -f "$SQLITE_LOCAL" ]; then
        cp "$SQLITE_LOCAL" "$SQLITE_OFFSITE" 2>/dev/null || echo "⚠️  SQLite off-site copy failed"
        echo "✅ Off-site backup saved (JSON + SQLite, Box will sync)"
    else
        echo "✅ Off-site backup saved (JSON only)"
    fi
fi

# Show backup sizes
echo ""
echo "📊 Backup sizes:"
du -h "$BACKUP_PATH_LOCAL"
[ -f "$SQLITE_LOCAL" ] && du -h "$SQLITE_LOCAL"

# Cleanup old backups (keep last 7 days) - both formats
echo ""
echo "🧹 Cleaning up old backups..."
find "$ENV_DIR_LOCAL" -name "${ENV}_*.json" -mtime +7 -delete
find "$ENV_DIR_LOCAL" -name "${ENV}_*.sqlite" -mtime +7 -delete
find "$ENV_DIR_OFFSITE" -name "${ENV}_*.json" -mtime +7 -delete 2>/dev/null
find "$ENV_DIR_OFFSITE" -name "${ENV}_*.sqlite" -mtime +7 -delete 2>/dev/null

echo ""
echo "📊 Current backups for $ENV:"
ls -lh "$ENV_DIR_LOCAL"/${ENV}_* 2>/dev/null | tail -10 || echo "  (only this one)"
