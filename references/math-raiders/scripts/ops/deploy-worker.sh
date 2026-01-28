#!/bin/bash
# Deploy Worker to EC2
# Usage: ./deploy-worker.sh <staging|production> [--setup]
#
# Both environments: push code, install deps, restart PM2
# --setup flag: first-time staging setup (creates .env, PM2 config)

set -e

# Always run from project root
cd "$(dirname "$0")/../.."

ENV=${1:-}
SETUP=false
if [ "$2" = "--setup" ]; then
    SETUP=true
fi

if [[ ! "$ENV" =~ ^(staging|production)$ ]]; then
    echo "Usage: ./deploy-worker.sh <staging|production> [--setup]"
    echo ""
    echo "  --setup  First-time staging setup (creates .env, PM2 config)"
    exit 1
fi

echo "🚀 Deploying worker to $ENV..."

# Environment-specific config
case $ENV in
    staging)
        WORKER_DIR="mathraiders-worker-staging"
        PM2_NAME="timeback-worker-staging"
        ;;
    production)
        WORKER_DIR="mathraiders-worker"
        PM2_NAME="timeback-worker"
        ;;
esac

# === FIRST-TIME SETUP (staging --setup only) ===
if [ "$SETUP" = true ] && [ "$ENV" = "staging" ]; then
    echo "🔧 Running first-time setup..."
    
    # Get maincloud token from local spacetime CLI
    echo "🔑 Getting maincloud token..."
    STDB_TOKEN=$(spacetime login show --token 2>/dev/null | grep "Your auth token" | awk '{print $NF}')
    if [ -z "$STDB_TOKEN" ]; then
        echo "❌ Failed to get maincloud token. Run 'spacetime login' first."
        exit 1
    fi
    echo "   ✅ Got maincloud token"

    # Get TimeBack credentials from production worker
    echo "🔑 Getting TimeBack credentials from production worker..."
    TB_CLIENT_ID=$(ssh math-raiders "grep TIMEBACK_CLIENT_ID ~/mathraiders-worker/.env | cut -d'=' -f2")
    TB_CLIENT_SECRET=$(ssh math-raiders "grep TIMEBACK_CLIENT_SECRET ~/mathraiders-worker/.env | cut -d'=' -f2")
    if [ -z "$TB_CLIENT_ID" ] || [ -z "$TB_CLIENT_SECRET" ]; then
        echo "❌ Failed to get TimeBack credentials from production worker"
        exit 1
    fi
    echo "   ✅ Got TimeBack credentials"

    # Create staging worker directory
    echo "📁 Creating staging worker directory..."
    ssh math-raiders "mkdir -p ~/$WORKER_DIR"

    # Create start script
    echo "📜 Creating start script..."
    ssh math-raiders "cat > ~/$WORKER_DIR/start-worker.sh << 'SCRIPT'
#!/bin/bash
cd /home/ubuntu/mathraiders-worker-staging
exec /home/ubuntu/.bun/bin/bun run src/index.ts
SCRIPT"
    ssh math-raiders "chmod +x ~/$WORKER_DIR/start-worker.sh"

    # Create .env file
    echo "📝 Creating .env..."
    ssh math-raiders "cat > ~/$WORKER_DIR/.env << EOF
# Staging Worker Environment
NODE_ENV=staging
PORT=3003

# SpacetimeDB (maincloud staging)
SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
SPACETIMEDB_MODULE=math-raiders-staging
SPACETIMEDB_TOKEN=$STDB_TOKEN

# TimeBack API (same as production)
TIMEBACK_CLIENT_ID=$TB_CLIENT_ID
TIMEBACK_CLIENT_SECRET=$TB_CLIENT_SECRET
EOF"
    echo "   ✅ .env created"
fi

# === DEPLOY CODE ===
echo "📦 Copying worker code..."
cd worker
zip -r worker.zip src package.json bun.lock -x "*.env*" -x "*node_modules*"
scp worker.zip math-raiders:~/$WORKER_DIR/
ssh math-raiders "cd ~/$WORKER_DIR && unzip -o worker.zip && rm worker.zip"
rm worker.zip
cd ..

# === INSTALL & RESTART ===
echo "📦 Installing dependencies..."
ssh math-raiders "cd ~/$WORKER_DIR && /home/ubuntu/.bun/bin/bun install"

echo "🚀 Restarting worker..."
if [ "$SETUP" = true ] && [ "$ENV" = "staging" ]; then
    # First-time: register with PM2
    ssh math-raiders "pm2 delete $PM2_NAME 2>/dev/null || true"
    ssh math-raiders "cd ~/$WORKER_DIR && pm2 start start-worker.sh --name $PM2_NAME"
    ssh math-raiders "pm2 save"
else
    # Normal deploy: just restart
    ssh math-raiders "pm2 restart $PM2_NAME"
fi

# === VERIFY ===
sleep 2
echo ""
echo "📋 Logs:"
ssh math-raiders "pm2 logs $PM2_NAME --lines 8 --nostream"

echo ""
echo "✅ Worker deployed to $ENV!"

# === FIRST-TIME SETUP INSTRUCTIONS ===
if [ "$SETUP" = true ] && [ "$ENV" = "staging" ]; then
    echo ""
    echo "📋 Next steps (one-time):"
    echo ""
    echo "   1. Add nginx route:"
    echo "      ssh math-raiders 'sudo nano /etc/nginx/sites-available/combined'"
    echo ""
    echo "   2. Reload nginx:"
    echo "      ssh math-raiders 'sudo nginx -t && sudo systemctl reload nginx'"
fi
