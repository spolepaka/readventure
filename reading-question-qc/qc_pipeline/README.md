# Unified Quality Control Pipeline

Comprehensive quality control system for reading comprehension assessment items (MCQ and MP question types).

## Quick Start

```bash
# Set up environment
export ANTHROPIC_API_KEY="your-claude-api-key"
export OPENAI_API_KEY="your-openai-api-key"  # Optional but recommended

# Run question QC
python pipeline.py --input questions.csv --output results/ --mode questions

# Run question + explanation QC
python pipeline.py --input data.csv --output results/ --mode both

# Include difficulty assessment (requires benchmark questions)
python pipeline.py \
  --input questions.csv \
  --output results/ \
  --examples benchmark_questions.csv
```

## Architecture

```
qc_pipeline/
├── config/
│   └── prompts.json          # All quality control prompts
├── modules/
│   ├── question_qc.py        # Question quality control
│   └── explanation_qc.py     # Explanation quality control
├── utils.py                  # Shared utilities
└── pipeline.py               # Main orchestration script
```

## Pipeline Flow

```
Input: CSV with questions (± explanations)
  ↓
┌──────────────────────────────────────┐
│ Question Quality Control             │
│                                      │
│ Distractor Checks (5-6):            │
│ • Grammatical Parallelism            │
│ • Plausibility                       │
│ • Homogeneity                        │
│ • Specificity Balance                │
│ • Too-Close Detection                │
│ • Length Balance (MCQ only)          │
│                                      │
│ Question Checks (5):                 │
│ • Standard Alignment                 │
│ • Clarity & Precision                │
│ • Single Correct Answer              │
│ • Passage Reference Accuracy         │
│ • Difficulty Assessment              │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ Explanation Quality Control          │
│ (if explanations present)            │
│                                      │
│ • Correctness checks (3)             │
│ • Distractor checks (6)              │
│ • Universal checks (3)               │
└──────────────────────────────────────┘
  ↓
Output: Comprehensive JSON results + Summary report
```

## Command-Line Arguments

### Required
- `--input`: Input CSV file path
- `--output`: Output directory for results

### Mode Selection
- `--mode`: `questions` | `explanations` | `both` (default: `questions`)

### Optional
- `--examples`: Benchmark questions CSV (enables difficulty assessment check)
- `--concurrency`: Max concurrent API calls (default: 5)
- `--limit`: Process only first N questions (0 = all)

## Input Data Format

### Question CSV

Required columns:
- `question_id` or `item_id`: Unique identifier
- `question`: Question text
- `passage` or `stimulus`: Reading passage
- `option_1`, `option_2`, `option_3`, `option_4`: Answer choices
- `correct_answer`: Correct option identifier
- `question_type`: "MCQ" or "MP" (default: "MCQ")

Optional columns:
- `grade`: Numeric grade level (required for difficulty assessment)
- `CCSS`: Common Core standard code
- `CCSS_description`: Standard description
- `DOK`: Depth of Knowledge level

### Explanation CSV

All question columns plus:
- `option_1_explanation`: Explanation for option 1
- `option_2_explanation`: Explanation for option 2
- `option_3_explanation`: Explanation for option 3
- `option_4_explanation`: Explanation for option 4

### Benchmark Questions CSV

Required columns:
- `question`: Question text
- `grade`: Numeric grade level
- `passage`: Reading passage
- `answer_A`, `answer_B`, `answer_C`, `answer_D`: Answer choices
- `correct_answer`: Correct answer text

## Output Files

### Question QC Results
`question_qc_YYYYMMDD_HHMMSS.json` - Per-question QC results with:
- Individual check scores and responses
- Overall quality score
- Total checks passed/run

### Explanation QC Results
`explanation_qc_YYYYMMDD_HHMMSS.json` - Per-explanation QC results

### Summary Report
`summary_report.json` - Consolidated statistics:
- Question QC pass rates
- Explanation QC pass rates
- Average scores

## Example Usage

### Basic Question QC
```bash
python pipeline.py \
  --input my_questions.csv \
  --output qc_results/ \
  --mode questions
```

### With Difficulty Assessment
```bash
python pipeline.py \
  --input questions.csv \
  --output results/ \
  --mode questions \
  --examples state_benchmarks.csv
```

### Full Pipeline
```bash
python pipeline.py \
  --input assessment_items.csv \
  --output full_qc/ \
  --mode both \
  --examples benchmarks.csv
```

### Test Run
```bash
python pipeline.py \
  --input questions.csv \
  --output test_results/ \
  --mode questions \
  --limit 5
```

## Quality Checks

### Question QC (10-11 checks)

**Distractor Checks (5-6):**
1. **Grammatical Parallelism** - Consistent grammatical structure across options
2. **Plausibility** - All incorrect options are believable distractors
3. **Homogeneity** - All options belong to same conceptual category
4. **Specificity Balance** - Similar detail levels across options
5. **Too-Close Detection** - No distractors semantically too similar to correct answer
6. **Length Balance** - Word counts appropriately balanced (MCQ only)

**Question Checks (5):**
7. **Standard Alignment** - Question assesses the assigned learning standard
8. **Clarity & Precision** - Clear, unambiguous wording
9. **Single Correct Answer** - Exactly one defensible correct answer
10. **Passage Reference Accuracy** - All passage references are valid
11. **Difficulty Assessment** - Appropriate for target grade level

### Explanation QC (9-12 checks)

**For Correct Answers (6 checks):**
- Correctness Explanation
- Textual Evidence
- Skill Reinforcement
- Tone
- Conciseness
- Grade Appropriateness

**For Distractors (9 checks):**
- Specific Error Identification
- Misconception Diagnosis
- Textual Refutation
- Correct Guidance
- Actionable Strategy
- Reasoning Model
- Tone
- Conciseness
- Grade Appropriateness

## API Requirements

**Anthropic Claude API:**
- Required for question QC
- Runs most checks (grammatical parallelism, plausibility, homogeneity, specificity, standard alignment, clarity, single correct answer, passage reference)

**OpenAI API:**
- Required for explanation QC
- Optional for question QC (enables too-close detection and difficulty assessment)

Set via environment variables:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."  # Required for questions
export OPENAI_API_KEY="sk-..."         # Required for explanations, optional for questions
```

**What runs:**
- Question QC with Anthropic key only: 8-9 checks (no too-close or difficulty)
- Question QC with both keys: 9-10 checks (adds too-close)
- Question QC with both keys + --examples: 10-11 checks (adds too-close and difficulty)

## Performance Notes

- **Question QC**: ~5-10 questions/minute
- **Explanation QC**: ~20-40 options/minute
- Sequential processing ensures consistency
- Use `--limit` for testing before full runs

## Troubleshooting

### "Missing environment variables"
Set required API keys based on mode.

### "No explanation columns found"
Ensure CSV has columns like `option_1_explanation` when using explanation mode.

### "Missing required columns"
Verify CSV has all required columns for the mode.

### "No benchmark questions for grade X"
Ensure benchmark CSV includes questions for all grades in your input data.

## Integration with Legacy Scripts

Original standalone scripts remain in parent directory:
- `quality_control.py` - Standalone question QC
- `explanation_pipeline.py` - Explanation generation + QC
- `analyze_too_close.py` - Standalone too-close analysis
- `check_too_hard.py` - Standalone difficulty assessment

The unified pipeline provides a simpler, integrated workflow.
