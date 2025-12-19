# Unified Quality Control Pipeline

Comprehensive quality control system for reading comprehension assessment items (MCQ and MP question types).

## Pipeline Versions

| Version | File | Description | Best For |
|---------|------|-------------|----------|
| V1 | `pipeline.py` | Sequential API calls | Testing, small batches |
| V2 | `pipeline_v2.py` | Optimized concurrent calls (2 API calls/question) | Real-time, medium batches |
| **V3** | `pipeline_v3_batch.py` | **Batch API with 50% cost reduction** | **Large-scale QC** |

## Quick Start

```bash
# Set up environment
export ANTHROPIC_API_KEY="your-claude-api-key"
export OPENAI_API_KEY="your-openai-api-key"  # Optional but recommended

# Typical usage with the extended question bank output
cd qb_extend_pipeline

# V2: Optimized real-time QC with checkpointing
python qc_pipeline/pipeline_v2.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/ \
  --mode questions \
  --skip-openai

# V3: Batch processing (50% cost, high throughput)
python qc_pipeline/pipeline_v3_batch.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/
```

## Concurrent Processing (V2 Only)

V2 supports parallel processing with multiple API keys for dramatically faster throughput:

### Setup (.env file)
```bash
# Anthropic keys (comma-separated or numbered)
ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3
# OR
ANTHROPIC_API_KEY_1=sk-ant-key1
ANTHROPIC_API_KEY_2=sk-ant-key2
ANTHROPIC_API_KEY_3=sk-ant-key3

# OpenAI keys (same format)
OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3
# OR
OPENAI_API_KEY_1=sk-key1
OPENAI_API_KEY_2=sk-key2
```

### Usage
```bash
# Concurrent mode - uses all available API keys
python qc_pipeline/pipeline_v2.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/ \
  --concurrent

# Limit number of workers
python qc_pipeline/pipeline_v2.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/ \
  --concurrent \
  --max-workers 3

# Concurrent without OpenAI (Claude-only checks)
python qc_pipeline/pipeline_v2.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/ \
  --concurrent \
  --skip-openai
```

### Benefits
- **N× throughput**: 5 API keys = 5× faster processing
- **Same checkpointing**: Resume from where you left off
- **Automatic load balancing**: Questions distributed evenly

### Why V3 Doesn't Need Concurrency
V3 uses Claude's **Batch API** which processes all requests server-side asynchronously. Multiple API keys don't help since you submit one batch and wait for completion.

---

## Checkpointing (Auto-Resume)

Both V2 and V3 pipelines automatically detect completed questions and resume from where they left off:

### How It Works
1. **On startup**, the pipeline checks the output folder for existing results
2. **Questions with complete results** (all checks finished) are skipped
3. **Partially completed questions** are rerun to ensure data integrity
4. **Progress is saved incrementally** after each batch

### Benefits
- **Interrupt-safe**: Stop and restart anytime without losing progress
- **Efficient**: Only processes questions that need work
- **Incremental**: Results are saved after each batch (configurable with `--batch-size`)

### Example Workflow
```bash
# First run - process 1000 questions
python qc_pipeline/pipeline_v2.py --input questions.csv --output results/
# Ctrl+C after 500 questions

# Second run - automatically resumes from question 501
python qc_pipeline/pipeline_v2.py --input questions.csv --output results/
# Output: "Already completed: 500, To process: 500"
```

### Results Files
- `question_qc_v2_results.json` - Incremental results (updated per batch)
- `question_qc_v2_TIMESTAMP.json` - Final timestamped copy
- `question_qc_v2_TIMESTAMP_summary.csv` - Human-readable summary

## V3 Batch Processing (Recommended for Large Datasets)

The V3 pipeline uses Claude's [Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing) for maximum efficiency:

### Benefits
- **50% cost reduction** on all API calls
- **Higher throughput** for large-scale processing
- **Prompt caching** - article text shared across questions
- **Resume capability** - recover from interruptions
- **Checkpointing** - auto-resume from output folder

### Usage
```bash
# Process large question bank (with checkpointing)
python qc_pipeline/pipeline_v3_batch.py \
  --input outputs/qb_extended_combined.csv \
  --output outputs/qc_results/

# Resume interrupted API batch
python qc_pipeline/pipeline_v3_batch.py \
  --resume \
  --batch-id msgbatch_01abc123... \
  --input questions.csv \
  --output results/
```

## Input Data Format

### Question CSV

Required columns:
- `question_id` or `item_id`: Unique identifier
- `question`: Question text
- `passage`, `passage_text`, or `stimulus`: Reading passage
- `option_1`, `option_2`, `option_3`, `option_4`: Answer choices
- `correct_answer`: Correct option identifier (A, B, C, or D)

Optional columns:
- `grade`: Numeric grade level
- `CCSS`: Common Core standard code
- `CCSS_description`: Standard description
- `DOK`: Depth of Knowledge level
- `article_id`: For grouping by article (V3 cache optimization)

### Example CSV Structure
```csv
question_id,question,passage_text,option_1,option_2,option_3,option_4,correct_answer,CCSS,DOK,grade
Q1,"What is the main idea?","The fox jumped...",Theme,Setting,Character,Plot,A,RL.3.2,2,3
```

## Output Files

- `question_qc_*_results.json` - Incremental results (for checkpointing)
- `question_qc_*.json` - Detailed QC results (timestamped)
- `question_qc_*_summary.csv` - Summary spreadsheet
- `summary_report.json` - Overall statistics

## Command Line Arguments

### V2 Pipeline
```
--input         Input CSV file (required)
--output        Output directory (required)
--mode          questions, explanations, or both (default: questions)
--concurrency   Max concurrent API calls per worker (default: 5)
--limit         Process only first N questions (0 = all)
--batch-size    Questions per batch for incremental saves (default: 50)
--skip-openai   Skip OpenAI checks (Claude-only mode)
--examples      CSV with benchmark questions for difficulty check
--concurrent    Enable concurrent processing with multiple API keys
--max-workers   Maximum number of concurrent workers (default: num keys)
```

### V3 Pipeline
```
--input         Input CSV file (required)
--output        Output directory (required)
--limit         Process only first N questions (0 = all)
--claude-model  Model to use (default: claude-sonnet-4-5-20250929)
--resume        Resume a previously submitted batch
--batch-id      Batch ID to resume (use with --resume)
```

## Performance Comparison

| Version | Questions/Minute | Cost | Checkpointing | Multi-Key | Use Case |
|---------|-----------------|------|---------------|-----------|----------|
| V1 | ~5-10 | Baseline | ❌ | ❌ | Testing |
| V2 | ~30-40 | Baseline | ✅ | ❌ | Real-time |
| **V2 Concurrent** | **N × 30-40** | Baseline | ✅ | ✅ | **Fast batch** |
| **V3** | **Unlimited*** | **50% of baseline** | ✅ | N/A | **Large-scale** |

*V3 throughput limited only by batch API capacity (100K requests/batch)
*N = number of API keys in concurrent mode

## Quality Checks Performed

### Question Checks (8 Claude + 2 OpenAI)
1. **grammatical_parallel** - Consistent grammatical structure
2. **plausibility** - Believable distractors
3. **homogeneity** - Same conceptual category
4. **specificity_balance** - Similar detail levels
5. **standard_alignment** - Matches learning standard
6. **clarity_precision** - Clear and unambiguous
7. **single_correct_answer** - Exactly one correct
8. **passage_reference** - Accurate references
9. **too_close** (OpenAI) - No semantically similar options
10. **difficulty_assessment** (OpenAI) - Grade appropriate

### Local Checks (no API)
- **length_check** - Balanced word counts
