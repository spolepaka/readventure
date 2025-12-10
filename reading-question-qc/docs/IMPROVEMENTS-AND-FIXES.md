# QC Pipeline Improvements and Fixes

This document captures all the improvements, fixes, and learnings made to the QC pipeline to improve reliability, avoid rate limits, and enhance usability.

---

## Table of Contents

1. [Rate Limit Handling](#rate-limit-handling)
2. [Skip OpenAI Flag](#skip-openai-flag)
3. [CSV Output Generation](#csv-output-generation)
4. [QTI to CSV Converter](#qti-to-csv-converter)
5. [Recommended Settings](#recommended-settings)
6. [Troubleshooting](#troubleshooting)

---

## Rate Limit Handling

### Problem

Both Anthropic (Claude) and OpenAI APIs have rate limits that can cause failures when making too many concurrent requests:

- **Anthropic**: "Number of concurrent connections has exceeded your rate limit"
- **OpenAI**: "You exceeded your current quota" or rate limit errors

### Solution

Added comprehensive rate limiting and retry logic to `qc_pipeline/modules/question_qc.py`:

#### 1. Rate Limiter Class

```python
class RateLimiter:
    """Simple rate limiter to prevent hitting API rate limits."""
    
    def __init__(self, min_interval: float = 0.3):
        self.min_interval = min_interval  # 300ms between requests
        self.last_request_time = 0
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        async with self._lock:
            now = time.time()
            time_since_last = now - self.last_request_time
            if time_since_last < self.min_interval:
                await asyncio.sleep(self.min_interval - time_since_last)
            self.last_request_time = time.time()
```

#### 2. Retry Logic with Exponential Backoff

```python
# Configuration
MAX_RETRIES = 5
BASE_DELAY = 1.0  # seconds
MAX_DELAY = 30.0  # seconds

# Retry loop
for attempt in range(MAX_RETRIES):
    try:
        await self.rate_limiter.acquire()
        response = await self.claude_client.messages.create(...)
        return score, reasoning
    except anthropic.RateLimitError as e:
        delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
        logger.warning(f"Rate limit hit, retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})")
        await asyncio.sleep(delay)
```

#### 3. Key Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `MIN_REQUEST_INTERVAL` | 0.3s | Minimum time between API requests |
| `BETWEEN_CHECK_DELAY` | 0.5s | Delay between different QC checks |
| `MAX_RETRIES` | 5 | Maximum retry attempts |
| `BASE_DELAY` | 1.0s | Starting delay for exponential backoff |
| `MAX_DELAY` | 30.0s | Maximum delay between retries |

---

## Skip OpenAI Flag

### Problem

OpenAI API may be unavailable (quota exceeded, no API key, etc.) but we still want to run Claude-based checks.

### Solution

Added `--skip-openai` command-line flag to the pipeline.

#### Usage

```bash
python3 qc_pipeline/pipeline.py \
  --input questions.csv \
  --output qc_results/ \
  --mode questions \
  --skip-openai
```

#### What It Does

1. **Skips OpenAI checks**: `too_close`, `difficulty_assessment`
2. **Skips Explanation QC**: Requires OpenAI
3. **Only requires Anthropic API key**: No need for `OPENAI_API_KEY` in `.env`

#### Checks Affected

| Check | API | With --skip-openai |
|-------|-----|-------------------|
| `grammatical_parallel` | Claude | ✅ Runs |
| `plausibility` | Claude | ✅ Runs |
| `homogeneity` | Claude | ✅ Runs |
| `specificity_balance` | Claude | ✅ Runs |
| `standard_alignment` | Claude | ✅ Runs |
| `clarity_precision` | Claude | ✅ Runs |
| `single_correct_answer` | Claude | ✅ Runs |
| `passage_reference` | Claude | ✅ Runs |
| `length_check` | Local | ✅ Runs |
| `too_close` | **OpenAI** | ❌ Skipped |
| `difficulty_assessment` | **OpenAI** | ❌ Skipped |

---

## CSV Output Generation

### Problem

JSON output files are hard to read and analyze. Users need a spreadsheet-friendly format.

### Solution

Added automatic CSV generation after each QC run.

#### Output Files

For each QC run, three files are generated in `qc_results/`:

```
qc_results/
├── question_qc_20251209_160232.json      # Raw JSON results
├── question_qc_20251209_160232_readable.csv  # Detailed CSV
└── question_qc_20251209_160232_summary.csv   # Quick summary
```

#### Summary CSV Format

```csv
question_id,score,status,clarity_precision,grammatical_parallel,plausibility,...
guiding_21014_302001,100%,✅,✅,✅,✅,...
guiding_21015_302002,100%,✅,✅,✅,✅,...
guiding_21016_302003,78%,✅,✅,✅,❌,...
```

#### Detailed CSV Columns

| Column | Description |
|--------|-------------|
| `question_id` | Unique question identifier |
| `status` | ✅ PASSED or ❌ FAILED |
| `score` | Overall score (e.g., 78%) |
| `checks_passed` | Number of checks passed |
| `checks_total` | Total checks run |
| `question_text` | The question text |
| `option_A` - `option_D` | Answer choices |
| `correct_answer` | Correct answer letter |
| `CCSS` | Common Core standard |
| `DOK` | Depth of Knowledge level |
| `{check}_status` | ✅ or ❌ for each check |
| `{check}_reason` | Reasoning for pass/fail |

#### Standalone Script

You can also convert existing JSON results:

```bash
# Convert latest results
python3 qc_results_to_csv.py

# Convert specific file
python3 qc_results_to_csv.py --input qc_results/question_qc_*.json

# Summary only
python3 qc_results_to_csv.py --summary-only
```

---

## QTI to CSV Converter

### Problem

QTI JSON data (from `texts/qti_grade_3_data.json`) needs to be converted to CSV format for the QC pipeline.

### Solution

Created `qti_to_csv.py` script with the following features:

#### Usage

```bash
# List available articles
python3 qti_to_csv.py --input ../texts/qti_grade_3_data.json --list-articles

# Convert first 5 articles
python3 qti_to_csv.py --input ../texts/qti_grade_3_data.json --output questions.csv --num-articles 5

# Start from specific article
python3 qti_to_csv.py --input ../texts/qti_grade_3_data.json --output batch.csv --start-article article_101005 --num-articles 10

# Start from index
python3 qti_to_csv.py --input ../texts/qti_grade_3_data.json --output batch.csv --start-index 20 --num-articles 5
```

#### Key Fix: Combined Passages for Quiz Questions

**Problem**: Quiz questions in QTI don't have their own `stimulus` field - they reference the entire article.

**Solution**: The script now:
1. Collects all passages from guiding questions
2. Combines them for quiz questions that have no inline stimulus

```python
# First pass: collect all passages
all_passages = []
for item in items:
    if item.get('stimulus'):
        all_passages.append(stimulus_text)

combined_passage = "\n\n".join(all_passages)

# Second pass: use combined passage for questions without stimulus
if not passage_text:
    passage_text = combined_passage
```

#### Output CSV Columns

Only columns needed by QC pipeline:

```
question_id, question, question_type, option_1, option_2, option_3, option_4,
correct_answer, passage, CCSS, DOK, grade,
option_1_explanation, option_2_explanation, option_3_explanation, option_4_explanation
```

---

## Recommended Settings

### Optimal Command

```bash
python3 qc_pipeline/pipeline.py \
  --input qti_sample_1_article.csv \
  --output qc_results/ \
  --mode questions \
  --concurrency 2 \
  --claude-model claude-sonnet-4-20250514 \
  --skip-openai
```

### Concurrency Guidelines

| Concurrency | Rate Limits | Speed | Recommendation |
|-------------|-------------|-------|----------------|
| 1 | None | Slow | Use for debugging |
| **2** | **None** | **Good** | **Recommended** |
| 3 | Some retries | Faster | Use with caution |
| 5+ | Many retries | Fastest | Not recommended |

### Environment Variables

Create a `.env` file:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional (only needed without --skip-openai)
OPENAI_API_KEY=sk-proj-...
```

---

## Troubleshooting

### Rate Limit Errors

**Symptom**: 
```
Rate limit hit for 'check_name', retrying in X.Xs
```

**Solution**:
1. Reduce concurrency: `--concurrency 2` or `--concurrency 1`
2. The retry logic will handle occasional rate limits automatically

### OpenAI Quota Exceeded

**Symptom**:
```
Error: You exceeded your current quota
```

**Solution**:
1. Use `--skip-openai` flag to skip OpenAI checks
2. Or add credits to your OpenAI account

### Missing Passages

**Symptom**:
```
passage shows as "nan" in QC results
single_correct_answer check fails with "No passage provided"
```

**Solution**:
1. Regenerate CSV with updated `qti_to_csv.py` script
2. Quiz questions now get combined passages from all sections

### All Checks Failing

**Symptom**:
```
All 8 questions failed, average score 0.1
```

**Likely Cause**: Rate limits causing errors that are counted as failures

**Solution**:
1. Reduce concurrency to 2
2. Check the `{check}_reason` columns for "Error: Rate limit" messages
3. Re-run with lower concurrency

---

## Files Changed

| File | Changes |
|------|---------|
| `qc_pipeline/modules/question_qc.py` | Added RateLimiter, retry logic, skip_openai support |
| `qc_pipeline/pipeline.py` | Added --skip-openai flag, auto CSV generation |
| `qti_to_csv.py` | Created for QTI→CSV conversion with combined passages |
| `qc_results_to_csv.py` | Created for JSON→CSV conversion |

---

## Version History

| Date | Change |
|------|--------|
| 2025-12-09 | Added rate limiter with 300ms minimum interval |
| 2025-12-09 | Added retry logic with exponential backoff (5 retries, 1-30s delays) |
| 2025-12-09 | Added --skip-openai flag |
| 2025-12-09 | Added automatic CSV generation after QC runs |
| 2025-12-09 | Fixed quiz question passages (combined from all sections) |
| 2025-12-09 | Created qti_to_csv.py converter script |
| 2025-12-09 | Created qc_results_to_csv.py for readable output |


