# Question Fix Pipeline - Design Document

## Overview

The Question Fix Pipeline automatically fixes failed QC questions by:
1. Analyzing the **detailed QC failure reasons** from each check
2. Determining the appropriate fix strategy (distractor-only vs full regeneration)
3. Generating fixed questions using the failure reasoning as context
4. Running QC on the fixed questions
5. Storing before/after comparison for analysis

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Iterations | **1 run only** | Keep it simple, avoid infinite loops |
| Retry on failure | **No** | Accept result, flag for manual review if still failing |
| Which questions | **Extended only** | Original questions may have passage issues; focus on generated siblings |
| Processing | **One at a time** | Ensures uniqueness context is always current |

---

## Core Insight: Using QC Failure Reasoning

The QC pipeline stores **detailed reasoning** for each check. For example:

```json
{
  "question_id": "quiz_302048_sibling_1",
  "checks": {
    "plausibility": {
      "score": 0,
      "response": "Option D 'The rabbit wanted to sleep' is implausible because the passage never mentions the rabbit being tired or wanting to rest. This distractor has no connection to the passage content."
    },
    "homogeneity": {
      "score": 0,
      "response": "Options A and B describe actions (running, jumping) while options C and D describe states (being lost, wanting sleep). The choices span different conceptual categories."
    },
    "length_check": {
      "score": 1,
      "response": "All choices are balanced in length (3-5 words each)."
    }
  }
}
```

**This reasoning is the key to effective fixing.** Instead of just knowing "plausibility failed", we know exactly WHY it failed and can address that specific issue.

---

## Fix Strategy Logic

### Step 1: Identify Failed Checks

```python
CRITICAL_CHECKS = {
    'single_correct_answer',  # Multiple answers could be correct
    'passage_reference',      # References non-existent content
    'standard_alignment'      # Tests wrong skill
}

DISTRACTOR_CHECKS = {
    'grammatical_parallel',   # Grammar mismatch
    'plausibility',           # Implausible distractor
    'homogeneity',            # Mixed categories
    'specificity_balance',    # Uneven detail levels
    'too_close',              # Distractor too similar to correct
    'length_check'            # Length imbalance
}

QUESTION_CLARITY_CHECKS = {
    'clarity_precision',      # Ambiguous wording
    'difficulty_assessment'   # Wrong difficulty level
}
```

### Step 2: Determine Strategy

```
IF any CRITICAL_CHECKS failed:
    → FULL REGENERATION (question is fundamentally flawed)

ELIF only DISTRACTOR_CHECKS failed AND count ≤ 2:
    → DISTRACTOR FIX (question is fine, options need work)

ELIF clarity_precision failed:
    → FULL REGENERATION (question wording is problematic)

ELSE (≥3 distractor issues):
    → FULL REGENERATION (too many issues to patch)
```

---

## Detailed Flow

### 1. Load Failed Extended Questions

```python
# Filter to only extended questions that failed
failed_extended = [
    q for q in qc_results 
    if '_sibling_' in q['question_id'] 
    and q['overall_score'] < 0.8
]
# Expected: 37 questions based on current data
```

### 2. For Each Failed Question

```
┌─────────────────────────────────────────────────────────────┐
│  FOR each failed_question:                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. EXTRACT failure details                                 │
│     - Get list of failed check names                        │
│     - Get detailed reasoning for EACH failed check          │
│                                                             │
│  2. DETERMINE fix strategy                                  │
│     - 'distractor_fix' or 'full_regeneration'               │
│                                                             │
│  3. GATHER context                                          │
│     - Original question data (from CSV)                     │
│     - Passage text                                          │
│     - For full regen: existing questions for article/DOK    │
│                                                             │
│  4. BUILD prompt with failure reasoning                     │
│     - Include EXACT failure reasons from QC                 │
│     - Be specific about what to fix                         │
│                                                             │
│  5. CALL LLM to generate fix                                │
│     - OpenRouter (Claude) for generation                    │
│                                                             │
│  6. SAVE fixed question                                     │
│     - Update CSV with new content                           │
│     - Mark as 'fixed' with timestamp                        │
│                                                             │
│  7. RUN QC on fixed question                                │
│     - Use V2 pipeline with OpenRouter                       │
│                                                             │
│  8. RECORD comparison                                       │
│     - Before score, failed checks                           │
│     - After score, failed checks                            │
│     - Improved? Yes/No                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Prompts

### Distractor Fix Prompt

```
You are fixing the distractors (incorrect answer choices) for a reading comprehension question.

## Passage:
{passage_text}

## Question:
{question_text}

## Correct Answer: 
{correct_option_letter}) {correct_option_text}

## Current Distractors:
A) {option_A}
B) {option_B}  
C) {option_C}
D) {option_D}
(Correct answer is {correct_option_letter})

---

## QC FAILURE ANALYSIS - These are the EXACT issues found:

{for each failed distractor check:}
### {check_name} - FAILED
{detailed_reasoning_from_qc}

---

## Your Task:
Generate 3 NEW distractors that FIX the issues above.

Requirements:
1. Address EACH specific issue mentioned in the failure analysis
2. Keep distractors plausible but clearly incorrect
3. Match the grammatical structure of the correct answer
4. Keep similar length to the correct answer (within 20%)
5. Ensure all options belong to the same conceptual category
6. Make distractors distinct from each other AND from the correct answer

Return JSON:
{
  "option_A": "new distractor text" or null if A is correct,
  "option_B": "new distractor text" or null if B is correct,
  "option_C": "new distractor text" or null if C is correct,
  "option_D": "new distractor text" or null if D is correct,
  "fix_reasoning": "Brief explanation of how you addressed each issue"
}
```

### Full Regeneration Prompt

```
You are regenerating a failed reading comprehension question.

## Passage:
{passage_text}

## FAILED Question (DO NOT reuse this - it has quality issues):
Question: {original_question}
Options: A) {A}, B) {B}, C) {C}, D) {D}
Correct: {correct}

---

## QC FAILURE ANALYSIS - These are the EXACT issues found:

{for each failed check:}
### {check_name} - FAILED
{detailed_reasoning_from_qc}

---

## EXISTING Questions for this Article (must be DIFFERENT from all):
{for each existing question with same article_id and similar DOK/CCSS:}
- {question_text} (DOK {dok}, {ccss})

---

## Requirements:
- Standard: {CCSS} - {CCSS_description}
- DOK Level: {DOK}
- Grade Level: {grade}
- Parent Question ID: {parent_question_id}

## Your Task:
Generate a COMPLETELY NEW question that:
1. Addresses ALL the issues mentioned in the failure analysis
2. Is DIFFERENT from all existing questions listed above
3. Properly assesses the {CCSS} standard
4. Matches DOK level {DOK}
5. Has clear, unambiguous wording
6. Has exactly ONE correct answer
7. Has plausible, well-crafted distractors

Return JSON:
{
  "question": "New question text",
  "option_A": "Option A text",
  "option_B": "Option B text",
  "option_C": "Option C text", 
  "option_D": "Option D text",
  "correct_answer": "A" or "B" or "C" or "D",
  "option_A_explanation": "Why A is correct/incorrect",
  "option_B_explanation": "Why B is correct/incorrect",
  "option_C_explanation": "Why C is correct/incorrect",
  "option_D_explanation": "Why D is correct/incorrect",
  "fix_reasoning": "How this addresses the original failures"
}
```

---

## Output Structure

### Files That Get UPDATED (in-place)

These existing files are modified to reflect the fixed questions:

| File | What Changes |
|------|--------------|
| `outputs/qb_extended_combined.csv` | Question text, options, explanations updated for fixed questions |
| `outputs/qc_results/question_qc_merged.json` | QC results replaced for fixed questions |
| `outputs/qc_results/question_qc_merged_summary.csv` | Regenerated from merged JSON |
| `outputs/qc_results/summary_report.json` | Regenerated with new stats |

### CSV Columns Updated for Fixed Questions

For **distractor fix**:
- `option_1`, `option_2`, `option_3`, `option_4` (the 3 non-correct ones)
- `option_1_explanation`, `option_2_explanation`, `option_3_explanation`, `option_4_explanation`
- `fix_timestamp` (NEW column)
- `fix_strategy` (NEW column: 'distractor_fix')
- `fix_run_id` (NEW column)

For **full regeneration**:
- `question`
- `option_1`, `option_2`, `option_3`, `option_4`
- `correct_answer`
- `option_1_explanation`, `option_2_explanation`, `option_3_explanation`, `option_4_explanation`
- `fix_timestamp` (NEW column)
- `fix_strategy` (NEW column: 'full_regeneration')
- `fix_run_id` (NEW column)
- `original_question` (NEW column - stores the original question text for reference)

### Fix Run Directory (NEW)

Each fix run creates a new directory for tracking:

```
outputs/fix_results/
└── fix_run_{YYYYMMDD_HHMMSS}/
    ├── config.json                    # Run configuration
    ├── before_state.json              # Snapshot of failed questions + QC before fix
    ├── fix_log.jsonl                  # Per-question fix attempts (streaming log)
    ├── after_qc.json                  # New QC results for fixed questions
    ├── comparison_report.json         # Before/after comparison summary
    └── backup/
        ├── qb_extended_combined.csv   # Backup of original CSV before changes
        └── question_qc_merged.json    # Backup of original QC before changes
```

### Update Flow

```
1. BACKUP existing files
   └── Copy qb_extended_combined.csv → fix_run_xxx/backup/
   └── Copy question_qc_merged.json → fix_run_xxx/backup/

2. FIX each question
   └── Generate new question/options
   └── Update row in qb_extended_combined.csv
   └── Log to fix_log.jsonl

3. RUN QC on all fixed questions
   └── Get new QC results

4. UPDATE QC files
   └── Replace entries in question_qc_merged.json
   └── Regenerate question_qc_merged_summary.csv
   └── Regenerate summary_report.json
   └── Add new run to runs/ directory

5. GENERATE comparison report
   └── Before/after stats
   └── Per-question improvements
```

### comparison_report.json

```json
{
  "run_id": "fix_run_20251220_003000",
  "timestamp": "2024-12-20T00:30:00Z",
  "config": {
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-4",
    "questions_fixed": "extended_only"
  },
  
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
    "homogeneity": {"before_failures": 12, "after_failures": 2, "fixed": 10},
    "grammatical_parallel": {"before_failures": 8, "after_failures": 1, "fixed": 7},
    "specificity_balance": {"before_failures": 6, "after_failures": 2, "fixed": 4},
    "too_close": {"before_failures": 5, "after_failures": 1, "fixed": 4},
    "single_correct_answer": {"before_failures": 4, "after_failures": 2, "fixed": 2}
  },
  
  "questions": [
    {
      "question_id": "quiz_302048_sibling_1",
      "fix_strategy": "distractor_fix",
      "before": {
        "score": 0.67,
        "failed_checks": ["plausibility", "homogeneity", "too_close"],
        "failed_reasons": {
          "plausibility": "Option D has no connection to passage...",
          "homogeneity": "Options span different categories...",
          "too_close": "Option B is semantically similar to correct..."
        }
      },
      "after": {
        "score": 0.89,
        "failed_checks": ["length_check"],
        "failed_reasons": {
          "length_check": "Option C is 40% longer than others..."
        }
      },
      "improved": true,
      "score_delta": +0.22
    }
  ]
}
```

---

## CLI Interface

```bash
python -m fix_pipeline.fix_pipeline \
  --qc-results outputs/qc_results/question_qc_merged.json \
  --questions outputs/qb_extended_combined.csv \
  --output outputs/fix_results \
  --provider openrouter \
  [--article-ids article_101006,article_101007]  # Optional filter
```

---

## Code Modules

### 1. `failure_analyzer.py`
- `load_failed_extended_questions()` - Filter to failed extended questions
- `extract_failure_details(question_result)` - Get check names + reasoning
- `determine_fix_strategy(failed_checks)` - Return 'distractor_fix' or 'full_regeneration'

### 2. `context_gatherer.py`  
- `get_question_data(question_id, questions_df)` - Get full question row from CSV
- `get_existing_questions(article_id, dok, ccss, questions_df)` - For uniqueness check
- `format_failure_reasoning(checks)` - Format QC reasoning for prompt

### 3. `question_fixer.py`
- `fix_distractors(question_data, failure_details, client)` - Call LLM for distractor fix
- `regenerate_question(question_data, failure_details, existing_questions, client)` - Full regen
- Uses OpenRouter client (AsyncOpenAI with custom base_url)

### 4. `output_updater.py`
- `backup_files(output_dir)` - Create backups before modifying
- `update_questions_csv(question_id, new_data, csv_path)` - Update question in CSV
- `update_qc_merged(question_id, new_qc_result, json_path)` - Replace QC result in merged JSON
- `regenerate_summary_csv(merged_json_path, csv_path)` - Regenerate summary CSV from JSON
- `regenerate_summary_report(merged_json_path, report_path)` - Regenerate summary report

### 5. `fix_pipeline.py` (main orchestrator)
```python
def run():
    # 1. Load data
    qc_results = load_qc_results()
    questions_df = load_questions_csv()
    
    # 2. Backup files
    backup_files()
    
    # 3. Get failed extended questions
    failed = get_failed_extended_questions(qc_results)
    
    # 4. Process each question
    for question in failed:
        # Analyze failure
        failure_details = extract_failure_details(question)
        strategy = determine_fix_strategy(failure_details)
        
        # Get context
        question_data = get_question_data(question['question_id'])
        existing = get_existing_questions(question_data['article_id'])
        
        # Fix question
        if strategy == 'distractor_fix':
            fixed = fix_distractors(question_data, failure_details)
        else:
            fixed = regenerate_question(question_data, failure_details, existing)
        
        # Update CSV immediately
        update_questions_csv(question['question_id'], fixed)
        
        # Log
        save_fix_log(question['question_id'], fixed)
    
    # 5. Run QC on all fixed questions
    new_qc_results = run_qc_v2_openrouter(fixed_question_ids)
    
    # 6. Update QC files
    for result in new_qc_results:
        update_qc_merged(result['question_id'], result)
    
    regenerate_summary_csv()
    regenerate_summary_report()
    
    # 7. Generate comparison
    generate_comparison_report()
```

### 6. `comparison_tracker.py`
- `record_before_state(question_id, qc_result)` - Store original state
- `record_after_state(question_id, qc_result)` - Store new state
- `generate_comparison_report()` - Create before/after comparison
- `save_fix_log(question_id, fix_attempt)` - Streaming log

---

## Example: End-to-End Flow for One Question

```
Question: quiz_302048_sibling_1
Score: 0.67 (6/9 checks passed)

STEP 1: Extract failures
─────────────────────────
Failed checks:
  - plausibility: "Option D 'The rabbit wanted to sleep' is implausible..."
  - homogeneity: "Options A/B are actions, C/D are states..."  
  - too_close: "Option B 'The rabbit ran quickly' is too similar to correct 'The rabbit ran away'..."

STEP 2: Determine strategy
─────────────────────────
3 distractor checks failed → FULL REGENERATION
(Could be distractor_fix if only 2 failed)

STEP 3: Gather context
─────────────────────────
- Passage text from CSV
- Original question + options
- Existing questions for article_101003 with DOK 2

STEP 4: Build prompt
─────────────────────────
Include:
- Passage
- Failed question (as negative example)
- EXACT failure reasoning from QC
- Existing questions list
- Requirements (CCSS, DOK, grade)

STEP 5: Call LLM
─────────────────────────
→ OpenRouter Claude generates new question

STEP 6: Update CSV
─────────────────────────
- Replace question text
- Replace options
- Add fix_timestamp, fix_strategy columns

STEP 7: Run QC
─────────────────────────
→ V2 pipeline with OpenRouter on this one question

STEP 8: Record
─────────────────────────
Before: 0.67 (failed: plausibility, homogeneity, too_close)
After:  0.89 (failed: length_check)
Improved: YES (+0.22)
```

---

## Questions Resolved

| Question | Answer |
|----------|--------|
| Use QC reasoning in prompt? | **YES** - The detailed reasoning is included verbatim in the regeneration prompt |
| How to get existing questions? | Query CSV by article_id, optionally filter by DOK/CCSS |
| How to ensure uniqueness? | Include all existing questions in prompt, ask LLM to be different |
| How to track changes? | Before/after state stored in comparison_report.json |

---

## Next Steps

1. Implement `failure_analyzer.py`
2. Implement `context_gatherer.py`
3. Implement `question_fixer.py` (reuse OpenRouter client code)
4. Implement `fix_pipeline.py` orchestrator
5. Implement `comparison_tracker.py`
6. Test on a few questions
7. Run on all 37 failed extended questions

