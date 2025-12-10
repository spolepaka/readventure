# User Guide: Reading Question QC System

A practical guide to using the Reading Question Quality Control system for generating and validating reading comprehension assessments.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Quick Start Examples](#quick-start-examples)
3. [Preparing Input Data](#preparing-input-data)
4. [Generating Questions](#generating-questions)
5. [Running Quality Control](#running-quality-control)
6. [Understanding Output](#understanding-output)
7. [Best Practices](#best-practices)
8. [Common Workflows](#common-workflows)

---

## Getting Started

### Prerequisites

- Python 3.8 or higher
- Anthropic API key (for question generation and most QC checks)
- OpenAI API key (optional, for advanced QC checks)

### Installation

```bash
# Navigate to the directory
cd reading-question-qc

# Install dependencies
pip install pandas anthropic openai python-dotenv

# Or create a requirements.txt
pip install -r requirements.txt
```

### Environment Setup

Create a `.env` file in the project root:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Optional (enables additional QC checks)
OPENAI_API_KEY=sk-your-openai-key-here
```

### Required Data Files

Ensure these files are present in the directory:

| File | Purpose |
|------|---------|
| `ck_gen - prompts.json` | Generation and QC prompts |
| `ck_gen - ccss.csv` | Common Core standards database |
| `ck_gen - examples.csv` | Template questions for generation |

---

## Quick Start Examples

### Generate 5 Questions

```bash
python question_generator.py --start 0 --batch-size 5
```

### Bulk Generate with QC

```bash
python bulk_question_generator.py my_questions.csv --max-workers 5
```

### Run QC on Existing Questions

```bash
cd qc_pipeline
python pipeline.py --input ../questions.csv --output ../results/ --mode questions
```

---

## Preparing Input Data

### Input CSV Format

Your input CSV must include these columns:

```csv
passage_id,question_id,passage_text,DOK,CCSS,question_type
G3-U1-P01,G3-U1-P01-Q01,"Once upon a time...",2,RL.3.1,MCQ
```

#### Required Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `passage_id` | string | Unique passage identifier | `G3-U1-P01` |
| `question_id` | string | Unique question identifier | `G3-U1-P01-Q01` |
| `passage_text` | string | Full reading passage | `"Once upon a time..."` |
| `DOK` | int | Depth of Knowledge (1-4) | `2` |
| `CCSS` | string | Common Core standard code | `RL.3.1` |
| `question_type` | string | MCQ, SR, or MP | `MCQ` |

#### Optional Columns

| Column | Type | Description |
|--------|------|-------------|
| `passage_title` | string | Title of the passage |
| `CCSS_description` | string | Full standard description |
| `difficulty` | string | Low, Medium, or High |
| `grade` | int | Grade level (3-12) |

### Example Input

```csv
passage_id,question_id,passage_text,DOK,CCSS,CCSS_description,difficulty,question_type,grade
G3-U1-P01,G3-U1-P01-Q01,"The sun rose slowly over the mountains. Maria watched from her window, wondering what adventures the day would bring. Her dog, Max, wagged his tail excitedly.",2,RL.3.3,"Describe characters in a story and explain how their actions contribute to the sequence of events.",Medium,MCQ,3
G3-U1-P01,G3-U1-P01-Q02,"The sun rose slowly over the mountains. Maria watched from her window, wondering what adventures the day would bring. Her dog, Max, wagged his tail excitedly.",1,RL.3.1,"Ask and answer questions to demonstrate understanding of a text.",Low,MCQ,3
```

### Passage Guidelines

For best results, passages should:

- Be **200-800 words** for grade-appropriate questions
- Contain **clear narrative or informational structure**
- Include **details supporting multiple question types**
- Avoid **copyrighted content** without permission

---

## Generating Questions

### Method 1: Single Batch Generator

Best for: Small batches, testing, debugging

```bash
# Generate questions 0-9 (10 questions)
python question_generator.py --start 0 --batch-size 10

# Generate questions 10-24 with custom output
python question_generator.py --start 10 --batch-size 15 --output my_batch.json
```

**Output**: JSON file with generated questions

### Method 2: Bulk Generator

Best for: Large datasets, production runs

```bash
# Basic usage
python bulk_question_generator.py input.csv

# With custom output and more workers
python bulk_question_generator.py input.csv --output generated.csv --max-workers 8
```

**Output**: CSV file with questions and QC scores

### Generation Parameters

| Parameter | Default | Recommended | Description |
|-----------|---------|-------------|-------------|
| `--max-workers` | 5 | 3-8 | Parallel workers |
| `--batch-size` | 10 | 10-20 | Questions per batch |
| `--start` | 0 | varies | Starting row index |

### Question Types

#### MCQ (Multiple Choice)
- Supported DOK: 1, 2, 3
- Output: Question + 4 choices + correct answer

#### SR (Short Response)
- Supported DOK: 1, 2, 3, 4
- Output: Question + expected response + scoring notes

#### MP (Multipart)
- Supported DOK: 2, 3
- Output: Part A question + Part B question (both with choices)

---

## Running Quality Control

### QC Pipeline

For comprehensive quality control on existing questions:

```bash
cd qc_pipeline

# Question QC only
python pipeline.py --input questions.csv --output results/ --mode questions

# Full QC with explanations
python pipeline.py --input questions.csv --output results/ --mode both

# With difficulty assessment
python pipeline.py --input questions.csv --output results/ \
    --mode questions --examples benchmarks.csv
```

### QC Modes

| Mode | What it checks | API Requirements |
|------|----------------|------------------|
| `questions` | Question quality (10-11 checks) | Anthropic (+ OpenAI optional) |
| `explanations` | Explanation quality (9-12 checks) | OpenAI |
| `both` | Both question and explanation QC | Both APIs |

### Pipeline Options

```bash
python pipeline.py \
    --input input.csv \           # Required: input file
    --output results/ \           # Required: output directory
    --mode questions \            # Optional: questions/explanations/both
    --examples benchmarks.csv \   # Optional: for difficulty assessment
    --concurrency 5 \             # Optional: max parallel API calls
    --limit 10                    # Optional: process only first N rows
```

---

## Understanding Output

### Generated Questions CSV

The bulk generator outputs a CSV with these columns:

| Column | Description |
|--------|-------------|
| `question_text` | Generated question |
| `option_a/b/c/d` | Answer choices |
| `correct_answer` | Full text of correct answer |
| `qc_passed_checks` | Number of QC checks passed |
| `qc_total_checks` | Total QC checks run |
| `qc_failed_checks` | Names of failed checks (semicolon-separated) |

### QC Results JSON

```json
{
  "question_id": "G3-U1-P01-Q01",
  "question_type": "MCQ",
  "overall_score": 0.9,
  "total_checks_passed": 9,
  "total_checks_run": 10,
  "checks": {
    "grammatical_parallel": {
      "score": 1,
      "response": "All choices follow noun phrase structure",
      "category": "distractor"
    },
    "plausibility": {
      "score": 1,
      "response": "All distractors are believable",
      "category": "distractor"
    },
    "length_check": {
      "score": 0,
      "response": "Correct answer is 15% longer than longest distractor",
      "category": "distractor"
    }
  },
  "timestamp": "2024-12-15T14:30:22"
}
```

### Summary Report

```json
{
  "timestamp": "2024-12-15T14:30:22",
  "input_file": "questions.csv",
  "mode": "questions",
  "question_qc": {
    "total": 100,
    "passed": 85,
    "failed": 15,
    "pass_rate": 0.85,
    "average_score": 0.87
  }
}
```

### Interpreting Scores

| Score | Interpretation |
|-------|----------------|
| ≥ 0.8 | **Passed** - Question meets quality standards |
| 0.6-0.79 | **Marginal** - Review failed checks |
| < 0.6 | **Failed** - Significant quality issues |

### Common Failed Checks

| Check | Common Causes | Fix |
|-------|---------------|-----|
| `length_check` | Correct answer too long/short | Rebalance choice lengths |
| `grammatical_parallel` | Mixed grammatical structures | Standardize choice format |
| `plausibility` | Obvious wrong answers | Make distractors believable |
| `single_correct_answer` | Multiple valid answers | Clarify question or choices |

---

## Best Practices

### Input Data Quality

1. **Passage Selection**
   - Choose passages with rich, analyzable content
   - Ensure passages support the target standard
   - Include varied text structures

2. **Standard Alignment**
   - Match passages to appropriate standards
   - Verify DOK level matches passage complexity
   - Check grade-level appropriateness

3. **Question Distribution**
   - Balance question types across passages
   - Vary DOK levels within a passage
   - Avoid duplicate questions per passage

### Generation Settings

```python
# Recommended settings for production
max_workers = 5          # Balance speed vs rate limits
temperature = 0.4        # Generation creativity
max_retries = 3          # Retry failed generations
```

### QC Thresholds

```python
# Recommended pass thresholds
question_pass_threshold = 0.8    # 80% of checks must pass
explanation_pass_threshold = 0.8 # 80% of checks must pass
```

### Handling Failures

1. **Review Failed Checks**
   - Examine specific failed checks
   - Identify patterns across failures
   - Adjust input data or prompts

2. **Retry Strategy**
   - System auto-retries up to 3 times
   - Different examples may be selected on retry
   - Manual regeneration if still failing

3. **Manual Intervention**
   - Edit generated questions directly
   - Adjust answer choice lengths
   - Improve distractor quality

---

## Common Workflows

### Workflow 1: Generate New Assessment

```bash
# Step 1: Prepare input CSV with passages and metadata
# (Create my_passages.csv with required columns)

# Step 2: Generate questions in bulk
python bulk_question_generator.py my_passages.csv --output assessment.csv --max-workers 5

# Step 3: Review results
# Check assessment.csv for QC scores
# Filter questions with qc_passed_checks == qc_total_checks
```

### Workflow 2: QC Existing Questions

```bash
# Step 1: Prepare questions CSV
# (Ensure columns: question, option_1-4, correct_answer, passage)

# Step 2: Run QC pipeline
cd qc_pipeline
python pipeline.py --input ../existing_questions.csv --output ../qc_results/ --mode questions

# Step 3: Analyze results
# Review qc_results/question_qc_*.json
# Check summary_report.json for pass rates
```

### Workflow 3: Generate with Difficulty Calibration

```bash
# Step 1: Prepare benchmark questions CSV
# (Questions validated for each target grade)

# Step 2: Run QC with difficulty assessment
cd qc_pipeline
python pipeline.py \
    --input ../questions.csv \
    --output ../results/ \
    --mode questions \
    --examples ../benchmark_questions.csv

# Step 3: Review difficulty assessments
# Check difficulty_assessment scores in results
```

### Workflow 4: Iterative Improvement

```bash
# Step 1: Initial generation
python bulk_question_generator.py input.csv --output round1.csv

# Step 2: Identify failures
# Filter round1.csv for qc_failed_checks != ""

# Step 3: Analyze failure patterns
# Group by qc_failed_checks to find common issues

# Step 4: Regenerate failures
# Create input CSV with only failed question rows
python bulk_question_generator.py failed_questions.csv --output round2.csv

# Step 5: Merge results
# Combine passing questions from both rounds
```

### Workflow 5: Batch Processing Large Datasets

```bash
# For very large datasets (1000+ questions)

# Step 1: Split input into batches
split -l 200 large_input.csv batch_

# Step 2: Process each batch
for file in batch_*.csv; do
    python bulk_question_generator.py "$file" --output "output_${file}" --max-workers 3
done

# Step 3: Combine results
head -1 output_batch_aa.csv > combined_output.csv
for file in output_batch_*.csv; do
    tail -n +2 "$file" >> combined_output.csv
done
```

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| API rate limits | Reduce `--max-workers` to 3 |
| Memory issues | Process in smaller batches |
| Parsing errors | Check passage for special characters |
| Low QC scores | Review failed checks, improve input |
| Missing examples | Add templates to examples CSV |
| Slow processing | Increase workers (watch rate limits) |

---

## Next Steps

- Review [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md) for architecture details
- Check [API-REFERENCE.md](./API-REFERENCE.md) for method documentation
- Examine prompt files for customization options



