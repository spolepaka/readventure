# Fix Pipeline - Complete Analysis

## Overview

The fix_pipeline automatically repairs failed QC questions without regenerating everything. It uses the **exact failure reasons** from QC to guide targeted fixes.

---

## Module Structure

```
fix_pipeline/
├── fix_pipeline.py       # Main orchestrator (QuestionFixPipeline class)
├── failure_analyzer.py   # Analyzes failures, determines fix strategy
├── context_gatherer.py   # Collects question data, passage, existing questions
├── question_fixer.py     # LLM prompts and API calls (OpenRouter)
├── output_updater.py     # Updates CSV and QC files
├── comparison_tracker.py # Tracks before/after for reporting
└── DESIGN.md            # Design documentation
```

---

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. LOAD DATA                                                   │
│     • Load QC results (question_qc_merged.json)                 │
│     • Load questions CSV (qb_extended_combined.csv)             │
│     • Filter to failed extended questions (score < 0.8)         │
│     • Optionally filter by article_ids                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. BACKUP FILES                                                │
│     • Copy CSV → fix_run_YYYYMMDD_HHMMSS/backup/                │
│     • Copy QC JSON → backup/                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. FOR EACH FAILED QUESTION (one at a time):                   │
│                                                                 │
│     a) ANALYZE FAILURE (failure_analyzer.py)                    │
│        • Extract failed checks with reasoning                   │
│        • Determine fix strategy                                 │
│                                                                 │
│     b) GATHER CONTEXT (context_gatherer.py)                     │
│        • Get question data from CSV                             │
│        • Get passage text                                       │
│        • Get existing questions for uniqueness                  │
│                                                                 │
│     c) FIX QUESTION (question_fixer.py)                         │
│        • Build prompt with failure reasoning                    │
│        • Call OpenRouter (Claude) to generate fix               │
│                                                                 │
│     d) UPDATE CSV IMMEDIATELY                                   │
│        • Replace question/options in CSV                        │
│        • Add fix_timestamp, fix_strategy columns                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. RUN QC ON ALL FIXED QUESTIONS                               │
│     • Uses V2 pipeline with OpenRouter                          │
│     • Gets new scores for each fixed question                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  5. UPDATE QC FILES                                             │
│     • Replace entries in question_qc_merged.json                │
│     • Regenerate question_qc_merged_summary.csv                 │
│     • Regenerate summary_report.json                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  6. GENERATE COMPARISON REPORT                                  │
│     • Before/after scores                                       │
│     • Which checks improved                                     │
│     • Overall improvement rate                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fix Strategy Logic

The strategy is determined in `failure_analyzer.py`:

```python
CRITICAL_CHECKS = {
    'single_correct_answer',  # Multiple correct answers
    'passage_reference',      # References non-existent content
    'standard_alignment'      # Tests wrong skill
}

DISTRACTOR_CHECKS = {
    'grammatical_parallel', 'plausibility', 'homogeneity',
    'specificity_balance', 'too_close', 'length_check'
}

QUESTION_CLARITY_CHECKS = {
    'clarity_precision',      # Ambiguous wording
    'difficulty_assessment'   # Wrong difficulty level
}
```

**Decision Tree:**

| Condition | Strategy |
|-----------|----------|
| Any CRITICAL check failed | `full_regeneration` |
| `clarity_precision` failed | `full_regeneration` |
| 3+ DISTRACTOR checks failed | `full_regeneration` |
| 1-2 DISTRACTOR checks failed | `distractor_fix` |

---

## The Two Prompts

### 1. Distractor Fix Prompt (`build_distractor_fix_prompt`)

Used when only 1-2 distractor checks failed. **Keeps the question stem, regenerates only wrong options.**

```
You are fixing the distractors for a reading comprehension question.

## Passage: [passage_text]
## Question: [question_text]
## Correct Answer: [letter]) [text]
## Current Options: A) ... B) ... C) ... D) ...

## QC FAILURE ANALYSIS:
### plausibility - FAILED
Option D has no connection to passage content...

### homogeneity - FAILED  
Options span different conceptual categories...

## Your Task:
Generate 3 NEW distractors that FIX the issues above.
```

### 2. Full Regeneration Prompt (`build_full_regeneration_prompt`)

Used when question is fundamentally flawed. **Generates completely new question.**

```
You are regenerating a failed reading comprehension question.

## Passage: [passage_text]
## FAILED Question (DO NOT reuse): [original question + options]

## QC FAILURE ANALYSIS:
### single_correct_answer - FAILED
Options B and C are both defensible...

## EXISTING Questions (must be DIFFERENT from all):
1. [DOK 2] [RL.3.1] What did the character...
2. [DOK 2] [RL.3.1] Why did the author...

## Requirements: CCSS, DOK, Grade

## Your Task:
Generate a COMPLETELY NEW question that:
1. Addresses ALL the issues mentioned in the failure analysis
2. Is DIFFERENT from all existing questions listed above
3. Properly assesses the CCSS standard
4. Matches DOK level
5. Has clear, unambiguous wording
6. Has exactly ONE correct answer
7. Has plausible, well-crafted distractors
8. All options follow the same grammatical pattern and are similar in length
9. ONLY references events, characters, and details EXPLICITLY STATED in the passage
```

---

## Output Structure

```
outputs/fix_results/
└── fix_run_20251220_142006/
    ├── config.json              # Run settings
    ├── before_state.json        # Snapshot before fixes
    ├── fix_log.jsonl           # Per-question fix log
    ├── after_qc.json           # New QC results
    ├── comparison_report.json  # Before/after comparison
    └── backup/
        ├── qb_extended_combined.csv
        └── question_qc_merged.json
```

---

## How to Run

```bash
cd qb_extend_pipeline

# Fix all failed extended questions
python -m fix_pipeline.fix_pipeline \
    --qc-results outputs/qc_results/question_qc_merged.json \
    --questions outputs/qb_extended_combined.csv \
    --output outputs/fix_results

# Fix only specific articles
python -m fix_pipeline.fix_pipeline \
    --qc-results outputs/qc_results/question_qc_merged.json \
    --questions outputs/qb_extended_combined.csv \
    --output outputs/fix_results \
    --article-ids article_101006,article_101007
```

---

## Key Insight: Using QC Failure Reasoning

The pipeline uses the **exact QC failure reasoning** in the fix prompt. For example:

```json
{
  "plausibility": {
    "score": 0,
    "response": "Option D 'The rabbit wanted to sleep' is implausible 
                 because the passage never mentions the rabbit being tired"
  }
}
```

This reasoning is included **verbatim** in the prompt, so the LLM knows exactly what to fix.

---

## Note on `difficulty_assessment`

Looking at `failure_analyzer.py`:

```python
QUESTION_CLARITY_CHECKS = {
    'clarity_precision',
    'difficulty_assessment'   # In clarity checks, but NOT triggering full_regeneration!
}
```

Currently, `difficulty_assessment` failures alone will result in `distractor_fix` strategy (not `full_regeneration`), because only `clarity_precision` explicitly triggers regeneration. 

This might be intentional since difficulty issues are often about inference complexity, not the question structure itself. However, if `difficulty_assessment` failures need full regeneration, the logic in `determine_fix_strategy()` would need to be updated.

---

## Files Modified by Fix Pipeline

### Updated In-Place:

| File | What Changes |
|------|--------------|
| `outputs/qb_extended_combined.csv` | Question text, options, explanations |
| `outputs/qc_results/question_qc_merged.json` | QC results for fixed questions |
| `outputs/qc_results/question_qc_merged_summary.csv` | Regenerated from merged JSON |
| `outputs/qc_results/summary_report.json` | Regenerated with new stats |

### New Columns Added to CSV for Fixed Questions:

- `fix_timestamp` - When the fix was applied
- `fix_strategy` - 'distractor_fix' or 'full_regeneration'
- `fix_run_id` - Which fix run made the change
- `original_question` - (for full regeneration) stores the original question text

---

## Comparison Report Format

After each run, a `comparison_report.json` is generated:

```json
{
  "run_id": "fix_run_20251220_142006",
  "summary": {
    "total_failed_extended": 37,
    "distractor_fixes_attempted": 25,
    "full_regenerations_attempted": 12,
    "now_passing": 30,
    "still_failing": 7,
    "improvement_rate": "81.1%",
    "avg_score_before": 0.65,
    "avg_score_after": 0.84
  },
  "by_check_improvement": {
    "plausibility": {"before_failures": 15, "after_failures": 3, "fixed": 12},
    "homogeneity": {"before_failures": 12, "after_failures": 2, "fixed": 10}
  },
  "questions": [
    {
      "question_id": "quiz_302048_sibling_1",
      "fix_strategy": "distractor_fix",
      "before": {"score": 0.67, "failed_checks": ["plausibility", "homogeneity"]},
      "after": {"score": 0.89, "failed_checks": ["length_check"]},
      "improved": true,
      "score_delta": 0.22
    }
  ]
}
```

---

## Related Documentation

- [DESIGN.md](../fix_pipeline/DESIGN.md) - Original design document
- [DIFFICULTY-ASSESSMENT-ANALYSIS.md](./DIFFICULTY-ASSESSMENT-ANALYSIS.md) - Analysis of difficulty check failures

