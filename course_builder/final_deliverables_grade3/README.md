# Grade 3 Reading Comprehension Question Bank - Final Deliverables

**Generated:** January 22, 2026  
**Grade Level:** Grade 3  
**Total Questions:** 3,277  

---

## 📁 Files Included

### 1. `comprehensive_question_bank_grade3_3277_questions.csv` / `.json` ⭐ **RECOMMENDED FOR DATABASE UPLOAD**
**The complete question bank with BOTH guiding questions AND quiz questions, organized sequentially by article.**

| Metric | Value |
|--------|-------|
| **Total Questions** | **3,277** |
| Guiding Questions | 511 |
| Quiz Questions | 2,766 |
| - Original Quiz | 557 |
| - Extended (Siblings) | 2,209 |
| Articles Covered | 131 |

**Organization:**
- Questions are sorted by `article_id`, then `section_sequence`
- Each article has **guiding questions first** (sections 1-4), then **quiz questions** (section 5)
- Includes `global_sequence` (1-3277) and `article_question_sequence` (per-article order)

**Key columns:**
- `global_sequence` - Sequential number across all questions (1-3277)
- `article_question_sequence` - Sequential number within each article
- `question_id` - Unique identifier (guiding_* or quiz_*)
- `question_category` - "guiding" or "quiz"
- `article_id` - Source article
- `passage_text` - Reading passage
- `question` - Question text
- `option_1` through `option_4` - Answer choices
- `correct_answer` - Correct answer (A/B/C/D or 1-4)
- `option_1_explanation` through `option_4_explanation` - Grade 3-friendly explanations
- `CCSS` - Common Core State Standard
- `DOK` - Depth of Knowledge level
- `question_source` - "original" or "extended" (quiz only)

---

### 2. `question_bank_grade3_2766_questions.csv` (Quiz Only)
**Quiz questions only with Grade 3-friendly explanations.** Use if you only need quiz questions.

| Metric | Value |
|--------|-------|
| Total Questions | 2,766 |
| Original Questions | 557 |
| Generated (Sibling) Questions | 2,209 |
| Articles Covered | 131 |

---

### 3. `comprehensive_qb_summary.json`
**Summary statistics for the comprehensive question bank.**

```json
{
  "total_questions": 3277,
  "guiding_questions": 511,
  "quiz_questions": 2766,
  "quiz_original": 557,
  "quiz_extended": 2209,
  "total_articles": 131
}
```

---

### 5. `question_qc_results_grade3.json`
**Detailed QC results for each quiz question with LLM reasoning.**

- 2,766 question QC records
- 11 checks per question
- Includes LLM explanations for each check result
- Pass rate: 96.7%

---

### 6. `question_qc_summary_grade3.csv`
**Summary of QC results in spreadsheet format.**

Easy to open in Excel/Google Sheets for quick analysis.

---

### 7. `explanation_qc_results_grade3.json`
**QC results for all answer explanations.**

- 11,064 explanation QC records (4 per question × 2,766 questions)
- Checks: correctness, textual evidence, tone, conciseness, grade appropriateness

---

### 8. `qc_summary_report_grade3.json`
**Overall QC summary statistics.**

```json
{
  "pass_rate": "96.7%",
  "average_score": "89.9%",
  "total_questions": 2766,
  "passed": 2674,
  "failed": 92
}
```

---

## 📖 Typical Article Structure

Each article typically contains:

| Section | Question Type | Count | Description |
|---------|--------------|-------|-------------|
| Section 1 | Guiding | 1 | Reading check for paragraph 1 |
| Section 2 | Guiding | 1 | Reading check for paragraph 2 |
| Section 3 | Guiding | 1 | Reading check for paragraph 3 |
| Section 4 | Guiding | 1 | Reading check for paragraph 4 |
| Section 5 | Quiz | 20-25 | Comprehensive assessment (4-5 original + siblings) |

**Example: Article 101001 "Aladdin and the Wonderful Lamp, Part I"**
- Guiding questions: 4 (sections 1-4)
- Quiz questions: 20 (4 original + 16 siblings)
- Total: 24 questions

---

## 📊 Quality Metrics

| Metric | Value |
|--------|-------|
| **Overall Pass Rate** | 96.7% |
| **Average QC Score** | 89.9% |
| **Original Questions Pass Rate** | 83.5% |
| **Generated Questions Pass Rate** | 100% |

### QC Checks Performed:
1. `grammatical_parallel` - Grammar consistency across options
2. `plausibility` - Distractors are believable
3. `homogeneity` - Options from same category
4. `specificity_balance` - Similar detail levels
5. `standard_alignment` - Matches CCSS standard
6. `clarity_precision` - Clear, unambiguous wording
7. `single_correct_answer` - Only one correct answer
8. `passage_reference` - References actual content
9. `too_close` - Distractors distinct from correct
10. `difficulty_assessment` - Grade-appropriate
11. `length_check` - Balanced answer lengths

---

## 🔧 Generation Process

1. **Original Questions:** 557 questions from existing QTI content
2. **Question Extension:** Generated 4 sibling questions per original (2,209 total)
3. **Explanation Rewriting:** All explanations rewritten for Grade 3 reading level
4. **Quality Control:** 11-check QC pipeline with Claude and GPT-4o
5. **Fix Pipeline:** 6 rounds of automated fixes for failing questions

---

## 📝 Notes

- All generated questions have been QC'd and fixed to meet 80% quality threshold
- Explanations are written at Grade 3 reading level
- Questions align with Common Core State Standards for Grade 3
