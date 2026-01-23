# QTI Extractor Analysis

> Analysis of the `course_builder/reference/qti-extractor` tool

## Overview

The `qti-extractor` is a Python-based data extraction tool that queries the **QTI API** (`https://qti.alpha-1edtech.ai/api`) to pull comprehensive reading assessment data. It extracts:

1. **Assessment tests** (articles/stories) organized by grade level (3-12)
2. **Reading passages** (stimuli) with their text content
3. **Questions** with multiple choice options
4. **Feedback** for each answer option
5. **Metadata** (CCSS standards, DOK levels, Lexile levels, difficulty)

---

## How It Works

### Architecture

```
CSV Input (article_ids) → API Calls → XML Parsing → JSON Output
```

### Step-by-Step Flow

1. **Input**: Reads `article_ids - Sheet1 (1).csv` containing course, title, and article IDs
2. **Grade filtering**: Can filter by grade level (3-12) via `--grade` flag
3. **API calls**: For each article ID:
   - Fetches assessment test: `GET /api/assessment-tests/{article_id}`
   - Fetches items (questions): `GET /api/assessment-items/{item_id}`
   - Fetches stimuli (passages): `GET /api/stimuli/{stimulus_id}`
4. **XML parsing**: Extracts data from `rawXml` fields using ElementTree
5. **Output**: Produces hierarchical JSON files like `qti_grade_3_data.json`

### Key Features

- **Resume capability** - Saves state in `extraction_state.json`, can resume on failure
- **Validation** - Validates data completeness before marking as done
- **Logging** - Detailed logs in `extraction.log`
- **Rate limiting** - 0.1s between items, 0.5s between tests

---

## Data Captured

| Data Element | Captured | Location in Output |
|-------------|----------|-------------------|
| Article identifier | ✅ | `assessment.identifier` |
| Article title | ✅ | `assessment.title` |
| QTI version | ✅ | `assessment.qtiVersion` |
| Course/grade metadata | ✅ | `assessment.csv_metadata` |
| Test parts structure | ✅ | `assessment.test_parts[]` |
| Sections | ✅ | `test_parts[].sections[]` |
| Section sequence | ✅ | `section.sequence` |
| Item identifiers | ✅ | `item.identifier` |
| **Question prompts** | ✅ | `item.prompt` |
| **Answer choices** | ✅ | `item.choices[]` |
| **Choice text** | ✅ | `choice.text` |
| **Choice feedback** | ✅ | `choice.feedback` |
| **Correct answer flags** | ✅ | `choice.is_correct` |
| **Correct answer IDs** | ✅ | `item.correct_answers[]` |
| **Stimulus HTML** | ✅ | `item.stimulus.content_html` |
| **Stimulus plain text** | ✅ | `item.stimulus.content_text` |
| **Lexile level** | ✅ | `item.stimulus.metadata.lexile_level` |
| **CCSS standards** | ✅ | `item.metadata.CCSS` |
| **DOK level** | ✅ | `item.metadata.DOK` |
| **Difficulty** | ✅ | `item.metadata.difficulty` |
| **Similar questions** | ✅ | `item.metadata.similar_questions` |
| Stimulus reference | ✅ | `item.stimulus_ref` |
| Interaction type | ✅ | `item.interaction_type` |
| Learning objective IDs | ✅ | `item.metadata.learningObjectiveSet` |

---

## Potential Gaps / Missing Data

### 1. Other Interaction Types May Be Incomplete

The parser handles three interaction types:

- `qti-choice-interaction` (multiple choice) ✅ **Well handled**
- `qti-text-entry-interaction` (fill-in-blank) ⚠️ **Basic handling** - only extracts prompt
- `qti-extended-text-interaction` (essay) ⚠️ **Basic handling** - only extracts prompt

**Missing for text/extended interactions:**
- Response constraints (max length, expected format)
- Rubrics for essay scoring
- Pattern matching for text entry validation

### 2. Response Processing Rules

From `parse_item_from_xml()`, the code extracts `correct_answers` but:

- Does **not** extract `qti-response-processing` rules (how to score)
- Does **not** extract `qti-outcome-declaration` (score variables, weights)
- Does **not** extract `mapping` or `areaMapping` for partial credit

### 3. Media/Asset References

The stimulus content is captured as HTML, but:

- **Images** embedded in `<img>` tags aren't downloaded
- **Audio** clips (if any) aren't captured
- **Video** content isn't extracted
- External media URLs may break if API changes

### 4. Item-Level Metadata Fields

There may be additional metadata not captured:

- `templateDeclarations` (if questions use templates)
- `styleDeclarations` or `stylesheet` references
- `toolName` and `toolVersion` used to create the item
- `timeLimits` (if time constraints exist)

### 5. Assessment-Level Data

At the test level, potentially missing:

- `qti-time-limits` (test duration constraints)
- `qti-pre-conditions` / `qti-branch-rules` (adaptive testing rules)
- `qti-item-session-control` (attempt limits, feedback timing)
- `qti-selection` (item randomization/selection rules)
- `qti-ordering` (shuffle settings)

### 6. Inline Feedback Completeness

The parser extracts `qti-feedback-inline` but might miss:

- `qti-modal-feedback` (popup feedback)
- `qti-feedback-block` (block-level feedback)
- Feedback conditions/triggers

### 7. Vocabulary/Glossary Terms

The HTML content includes bolded vocabulary terms like:

```html
<b style="color: #1a6666;">tailor</b>
```

These are **highlighted inline** but not extracted as structured vocabulary data. Could be parsed separately.

---

## Assessment for Reading Comprehension Game

### What You Need vs. What's Captured

| Requirement | Status |
|-------------|--------|
| Reading passages | ✅ Complete |
| Questions | ✅ Complete |
| Answer choices | ✅ Complete |
| Correct answers | ✅ Complete |
| Feedback for learning | ✅ Complete |
| Standards alignment (CCSS) | ✅ Complete |
| Lexile/difficulty metadata | ✅ Complete |
| Similar questions for practice | ✅ Complete |

### What's Missing But Probably Not Needed

- Advanced QTI features (adaptive testing, partial credit, essay rubrics)
- Response processing logic (you're handling scoring in your game)
- Asset downloads (HTML includes inline content)

### Nice-to-Have Improvements

1. **Extract vocabulary terms** - Parse the `<b style="color: #1a6666;">` elements to create a structured vocabulary list per passage
2. **Download embedded images** - If any passages have images, cache them locally
3. **Handle text entry questions fully** - Extract expected answer patterns/correct values

---

## Output File Structure

```json
{
  "metadata": {
    "total_tests": 131,
    "extraction_date": "2025-11-20 18:49:35",
    "api_base_url": "https://qti.alpha-1edtech.ai/api",
    "grade_filter": 3
  },
  "assessments": [
    {
      "identifier": "article_101001",
      "title": "Aladdin and the Wonderful Lamp, Part I",
      "qtiVersion": "3.0",
      "csv_metadata": {
        "course": "Core Knowledge Grade 3/3",
        "title": "Aladdin and the Wonderful Lamp, Part I",
        "grade": 3
      },
      "test_parts": [
        {
          "identifier": "test_part_0",
          "navigationMode": "linear",
          "submissionMode": "individual",
          "sections": [
            {
              "identifier": "test_guiding_21014",
              "title": "Guiding Questions",
              "sequence": 1,
              "items": [
                {
                  "identifier": "guiding_21014_302001",
                  "title": "Section 1 - Guiding Question",
                  "type": "choice",
                  "metadata": {
                    "DOK": 1,
                    "difficulty": "easy",
                    "CCSS": "RL.3.1",
                    "learningObjectiveSet": [...],
                    "similar_questions": [...]
                  },
                  "stimulus": {
                    "identifier": "guiding_21014",
                    "title": "Section 1",
                    "metadata": {
                      "lexile_level": 692,
                      "course": "Core Knowledge Reading Grade 3/3",
                      "module": "Classic Tales",
                      "section_number": 1
                    },
                    "content_html": "<qti-stimulus-body>...</qti-stimulus-body>",
                    "content_text": "There once was a poor boy named Aladdin..."
                  },
                  "prompt": "Aladdin's father worked as a",
                  "interaction_type": "choice",
                  "choices": [
                    {
                      "identifier": "answer_600102",
                      "text": "baker",
                      "feedback": "You may have chosen baker because...",
                      "is_correct": false
                    },
                    {
                      "identifier": "answer_600101",
                      "text": "tailor",
                      "feedback": "You successfully identified...",
                      "is_correct": true
                    }
                  ],
                  "correct_answers": ["answer_600101"]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Available Grades

| Grade | Assessments | Curriculum |
|-------|-------------|------------|
| 3 | 131 | Core Knowledge |
| 4 | 97 | Core Knowledge |
| 5 | 109 | Core Knowledge |
| 6 | 118 | Core Knowledge |
| 7 | 126 | Core Knowledge |
| 8 | 134 | Core Knowledge |
| 9 | 131 | High School Reading |
| 10 | 150 | High School Reading |
| 11 | 233 | High School Reading |
| 12 | 221 | High School Reading |

**Total: 1,450 assessments**

---

## Usage

```bash
# Test with first 5 assessments
python3 extract_qti_assessments.py --limit 5

# Extract all Grade 3 assessments
python3 extract_qti_assessments.py --grade 3 --all

# Extract all grades
./extract_all_grades.sh
```

---

## Verdict

The extractor **captures all essential information** needed for a reading comprehension game:

- ✅ Reading passages with text and HTML
- ✅ Questions with full answer options
- ✅ Detailed feedback for each choice
- ✅ Correct answer identification
- ✅ Rich metadata (CCSS, DOK, Lexile, difficulty)
- ✅ Similar questions for practice

The main gaps are around advanced QTI features (essay rubrics, adaptive testing rules) that either don't exist in this dataset or aren't needed for the game.

---

## Related Files

- **Original extractor**: `course_builder/reference/qti-extractor/extract_qti_assessments.py` (CSV-based)
- **Generic extractor**: `course_builder/extract_course_qti.py` (Course ID-based)
- **Output data**: `course_builder/reference/qti_grade_3_data.json`
- **Game parser**: `qti-parser.js`
- **Parser guide**: `docs/QTI-PARSER-GUIDE.md`

---

# Generic Course Extractor

A newer, more generic extractor is available at `course_builder/extract_course_qti.py`. This version:

1. **Takes a course ID** instead of relying on a pre-defined CSV
2. **Uses the OneRoster API** to fetch the course structure
3. **Extracts all content hierarchically** (Course → Units → Lessons → Activities)
4. **Supports limiting** the number of lessons and activities extracted

## Usage

```bash
# List all available courses
python extract_course_qti.py --list-courses

# Extract all content from a course
python extract_course_qti.py --course-id <course_id>

# Extract with limits (for testing)
python extract_course_qti.py --course-id <course_id> --limit-lessons 5 --limit-activities 3

# Custom output file
python extract_course_qti.py --course-id <course_id> --output my_data.json
```

## API Endpoints Used

| API | Endpoint | Purpose |
|-----|----------|---------|
| **OneRoster** | `GET /ims/oneroster/rostering/v1p2/courses` | List available courses |
| **OneRoster** | `GET /ims/oneroster/rostering/v1p2/courses/{id}` | Get course details |
| **PowerPath** | `GET /powerpath/syllabus/{courseId}` | Get full course structure |
| **QTI** | `GET /api/assessment-tests/{id}` | Get assessment tests |
| **QTI** | `GET /api/assessment-items/{id}` | Get individual questions |
| **QTI** | `GET /api/stimuli/{id}` | Get reading passages |

## Output Structure

```json
{
  "metadata": {
    "course_id": "my-course-id",
    "course_title": "Course Title",
    "extraction_date": "2026-01-22T...",
    "statistics": {
      "total_units": 5,
      "total_lessons": 20,
      "total_activities": 100,
      "total_qti_assessments": 50
    }
  },
  "course": { /* OneRoster course object */ },
  "units": [
    {
      "sourcedId": "unit-1",
      "title": "Unit 1",
      "lessons": [
        {
          "sourcedId": "lesson-1",
          "title": "Lesson 1",
          "activities": [
            {
              "sourcedId": "activity-1",
              "title": "Activity 1",
              "lessonType": "quiz",
              "resource": { /* OneRoster resource */ },
              "qti_content": {
                /* Full QTI assessment test with items and stimuli */
              }
            }
          ]
        }
      ]
    }
  ]
}
```

## Comparison: Original vs Generic Extractor

| Feature | Original (`extract_qti_assessments.py`) | Generic (`extract_course_qti.py`) |
|---------|----------------------------------------|-----------------------------------|
| **Input** | Pre-defined CSV with article IDs | Course ID via API |
| **Course Discovery** | Manual (CSV required) | Automatic via `--list-courses` |
| **Structure** | Flat (assessments only) | Hierarchical (Course → Units → Lessons → Activities) |
| **Grade Filtering** | Via `--grade` flag | Via course selection |
| **Limiting** | `--limit` flag | `--limit-lessons` and `--limit-activities` |
| **Resume** | Yes (state file) | Not yet implemented |
| **Use Case** | Bulk extraction by grade | Single course extraction |

---

*Last updated: January 2026*
