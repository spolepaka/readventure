# Question Bank Extender Pipeline

Generates sibling questions for existing reading comprehension questions to expand the question bank.

## Purpose

- **4 siblings** per quiz question (by default)
- **1 sibling** per guiding question (when enabled)

Each sibling maintains the **same DOK, difficulty, CCSS, and passage/section** as the original while testing different aspects.

## Features

- **Quiz-only by default**: Only extends quiz questions unless guiding questions are explicitly enabled
- **🚀 CONCURRENT PROCESSING**: Process multiple articles in parallel using multiple API keys
- **Full LLM logging**: Every request and response is logged with timestamps for traceability
- **Auto-combine**: Automatically combines original and extended questions into a single timestamped output file
- **Timestamped outputs**: All output files include run timestamps for tracking multiple runs
- **Checkpointing**: Resume from where you left off if interrupted

## Files

| File | Description |
|------|-------------|
| `question_bank_extender.py` | Main script |
| `combine_questions.py` | Standalone combine script (legacy, auto-combine now built into main script) |
| `qb_extend prompts.json` | DOK-specific prompt templates (DOK 1, 2, 3) |
| `config.json` | Configuration file for default settings |
| `ck_gen - ccss.csv` | CCSS standard descriptions |
| `requirements.txt` | Python dependencies |
| `inputs/` | Place input CSV files here |
| `outputs/` | Generated questions, combined files, and logs |

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set API key(s):**

   **For sequential processing (single key):**
   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .env
   ```

   **For concurrent processing (multiple keys):**
   ```bash
   # Option 1: Comma-separated
   echo "ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3,sk-ant-key4,sk-ant-key5" > .env
   
   # Option 2: Numbered keys
   cat > .env << EOF
   ANTHROPIC_API_KEY_1=sk-ant-key1
   ANTHROPIC_API_KEY_2=sk-ant-key2
   ANTHROPIC_API_KEY_3=sk-ant-key3
   ANTHROPIC_API_KEY_4=sk-ant-key4
   ANTHROPIC_API_KEY_5=sk-ant-key5
   EOF
   ```

## Usage

### Default: Sequential Processing (Single Key)

```bash
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended.csv
```

### 🚀 Concurrent Processing (Multiple Keys)

Process multiple articles in parallel - each API key handles one article at a time:

```bash
# Use all available API keys
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended.csv \
    --concurrent

# Limit to 3 concurrent workers
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended.csv \
    --concurrent \
    --max-workers 3
```

**How it works:**
- 5 API keys = 5 articles processed in parallel
- Each worker uses its own API key (avoids rate limits)
- Articles are distributed round-robin to workers
- Thread-safe checkpointing and output writing

This generates:
- `outputs/extended_20241211_143052.csv` - Extended questions only
- `outputs/combined_20241211_143052.csv` - Original + extended questions (final output)
- `outputs/llm_logs/llm_logs_20241211_143052.jsonl` - Detailed LLM communication logs
- `outputs/llm_logs/llm_summary_20241211_143052.txt` - Human-readable log summary

### Include Guiding Questions

```bash
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended.csv \
    --include-guiding
```

### Only Guiding Questions

```bash
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended.csv \
    --only-guiding
```

### Arguments

| Argument | Description | Required | Default |
|----------|-------------|----------|---------|
| `--input`, `-i` | Input CSV with existing questions | Yes | - |
| `--output`, `-o` | Base output CSV name (timestamp added) | Yes | - |
| `--checkpoint`, `-c` | Directory for checkpoint files | No | `checkpoints/` |
| `--limit`, `-l` | Limit articles to process (0 = all) | No | 0 |
| `--api-key` | Anthropic API key | No | Uses env var |
| `--include-guiding` | Also extend guiding questions | No | false |
| `--only-guiding` | Only extend guiding questions | No | false |
| `--log-dir` | Directory for LLM logs | No | `outputs/llm_logs` |
| `--config` | Path to config file | No | `config.json` |
| `--concurrent` | Enable concurrent processing | No | false |
| `--max-workers` | Max concurrent workers (cap: 10) | No | Number of API keys |

## Configuration File

You can set defaults in `config.json`:

```json
{
  "include_guiding": false,
  "only_guiding": false,
  "log_dir": "outputs/llm_logs",
  "concurrent": false,
  "max_workers": 5
}
```

CLI arguments override config file settings.

## Concurrent Processing Details

### API Key Setup

The system looks for API keys in this order:

1. **Comma-separated**: `ANTHROPIC_API_KEYS=key1,key2,key3`
2. **Numbered**: `ANTHROPIC_API_KEY_1`, `ANTHROPIC_API_KEY_2`, etc.
3. **Single key** (fallback): `ANTHROPIC_API_KEY`

### How Workers Operate

```
Worker 0 (Key 1): Article A → Article F → Article K → ...
Worker 1 (Key 2): Article B → Article G → Article L → ...
Worker 2 (Key 3): Article C → Article H → Article M → ...
Worker 3 (Key 4): Article D → Article I → Article N → ...
Worker 4 (Key 5): Article E → Article J → Article O → ...
```

- Each worker processes articles **sequentially** using its own API key
- Multiple workers run **in parallel**
- This avoids rate limits since each key has its own quota
- Checkpoints are saved after each article (thread-safe)
- Output is written safely with locks

### Performance

With 5 API keys processing ~100 articles:
- **Sequential**: ~100 API calls, one at a time
- **Concurrent (5 workers)**: ~100 API calls, 5 at a time → **~5x faster**

## LLM Communication Logs

Every LLM call is logged with:
- **Timestamp**: When the request was made
- **Request ID**: Unique identifier for tracing
- **Full prompt**: The complete prompt sent to the LLM
- **Headers**: API headers including beta features
- **Extra body**: JSON schema and other parameters
- **Response**: Full LLM response
- **Duration**: How long the request took
- **Success/Error**: Whether the request succeeded

### Log Files

1. **JSONL file** (`llm_logs_YYYYMMDD_HHMMSS.jsonl`): Machine-readable log with complete data
2. **Summary file** (`llm_summary_YYYYMMDD_HHMMSS.txt`): Human-readable overview

### Example Log Entry

```json
{
  "timestamp": "2024-12-11T14:30:52.123456",
  "type": "request",
  "request_id": "20241211_143052_0001",
  "article_id": "article_123",
  "question_category": "quiz",
  "question_type": "MCQ",
  "model": "claude-sonnet-4-5-20250929",
  "headers": {"anthropic-beta": "structured-outputs-2025-11-13"},
  "prompt": "You are generating sibling questions...",
  "prompt_length": 5432
}
```

## Input Format

The input CSV must have these columns:

| Column | Description |
|--------|-------------|
| `article_id` | Unique article identifier |
| `question_id` | Unique question identifier |
| `question_category` | `guiding` or `quiz` |
| `passage_text` | The text passage |
| `question` | Question text |
| `option_1` - `option_4` | Answer choices |
| `correct_answer` | Correct answer (A/B/C/D) |
| `option_1_explanation` - `option_4_explanation` | Feedback for each choice |
| `DOK` | Depth of Knowledge (1, 2, or 3) |
| `difficulty` | Difficulty level |
| `CCSS` | Common Core standard code |

## Output

### Combined Output (Final)

The combined CSV includes:
- All original questions that were extended
- All generated sibling questions
- `question_source` column: `original` or `extended`
- `parent_question_id` linking siblings to originals
- Sorted by article, section, and question ID

### Timestamped Filenames

All outputs include timestamps for tracking multiple runs:
- `extended_20241211_143052.csv`
- `combined_20241211_143052.csv`
- `llm_logs_20241211_143052.jsonl`

## DOK-Specific Prompts

The system uses different prompts for each DOK level:

| DOK | Focus |
|-----|-------|
| DOK 1 | Recall and reproduction - test different facts/details |
| DOK 2 | Skills and concepts - test different inferences/connections |
| DOK 3 | Strategic thinking - test different analysis/synthesis |

## Checkpointing

The system saves progress after each article. If interrupted, it will resume from where it left off.

## Model

Uses **Claude Sonnet 4.5** (`claude-sonnet-4-5-20250929`) with structured outputs for reliable JSON generation.

## Standalone Combine Script

If you need to combine files separately (e.g., re-combine after manual edits):

```bash
python combine_questions.py \
    --extended outputs/extended_20241211_143052.csv \
    --original inputs/qti_existing_questions.csv \
    --output outputs/combined_manual.csv
```
