# Math Raiders TimeBack Worker

Processes TimeBack events from SpacetimeDB queue and sends them to TimeBack's Caliper API.

## Setup

1. Install dependencies:
```bash
bun install
```

2. **Environment files are pre-configured:**
   - `.env.dev` - Maincloud dev testing (has token)
   - `.env.staging` - Maincloud staging (has token)
   - `.env` - Production EC2 (needs token set on EC2)
   
   See `../docs/ENV_SETUP.md` for complete environment guide.

3. **Get SpacetimeDB token (if needed):**
```bash
spacetime login show --token
```

## Running

### Development (Maincloud):
```bash
bun run --env-file=.env.dev src/index.ts
```

### Staging (Maincloud):
```bash
bun run --env-file=.env.staging src/index.ts
```

### Production (EC2):
```bash
bun run src/index.ts  # Uses .env
```

## Testing the Flow

1. Start SpacetimeDB locally
2. Run the worker: `bun run dev`
3. Play a raid in Math Raiders with a test TimeBack ID
4. Watch the worker process the event

## What It Does

1. Connects to SpacetimeDB and subscribes to `timeback_event_queue WHERE sent = false`
2. For each event:
   - Transforms to Caliper format
   - Gets OAuth token (caches it)
   - Sends to TimeBack API
   - Calls `mark_event_sent` reducer with result
3. Handles retries with exponential backoff (1, 2, 4, 8, 16 minutes)
4. Stops retrying after 5 attempts

## Deploying to EC2

1. Copy the `worker` folder to your EC2 instance
2. Install Bun: `curl -fsSL https://bun.sh/install | bash`
3. Set up as systemd service (see `mathraiders-timeback.service`)
4. Use production TimeBack credentials

## Monitoring

- Check logs: `journalctl -u mathraiders-timeback -f`
- Check queue depth in SpacetimeDB:
  ```sql
  SELECT COUNT(*) FROM timeback_event_queue WHERE sent = false;
  ```










