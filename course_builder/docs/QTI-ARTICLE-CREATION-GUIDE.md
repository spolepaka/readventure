# QTI Article Creation Guide for Alpha Read

This guide documents the complete QTI structure for Alpha Read articles and provides all the details needed to create new articles programmatically.

> **Reference Data**: See `outputs/qti_dumps/article_101001_complete_qti.json` for a complete example of an Alpha Read article's QTI structure.

---

## Table of Contents

1. [Overview](#overview)
2. [QTI Components Hierarchy](#qti-components-hierarchy)
3. [ID Naming Conventions](#id-naming-conventions)
4. [Creating Stimuli (Reading Passages)](#creating-stimuli-reading-passages)
5. [Creating Assessment Items (Questions)](#creating-assessment-items-questions)
6. [Creating Assessment Tests (Articles)](#creating-assessment-tests-articles)
7. [API Endpoints](#api-endpoints)
8. [Complete Example Payloads](#complete-example-payloads)

---

## Overview

An Alpha Read article consists of three QTI components:

| Component | Description | Count per Article |
|-----------|-------------|-------------------|
| **Assessment Test** | Top-level container representing the article | 1 |
| **Stimuli** | Reading passages for each story section | 4 (typical) |
| **Assessment Items** | Questions (guiding + quiz) | 8 (typical: 4 guiding + 4 quiz) |

### Article Structure Pattern

```
Assessment Test (article_XXXXXX)
├── Test Part (test_part_0)
│   ├── Section 1: "Guiding Questions" → 1 item + stimulus (Section 1 of story)
│   ├── Section 2: "Guiding Questions" → 1 item + stimulus (Section 2 of story)
│   ├── Section 3: "Guiding Questions" → 1 item + stimulus (Section 3 of story)
│   ├── Section 4: "Guiding Questions" → 1 item + stimulus (Section 4 of story)
│   └── Section 5: "Quiz" → 4 items (no stimulus, tests full article understanding)
```

---

## QTI Components Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│ ASSESSMENT TEST (article_101001)                                    │
│   - identifier: "article_101001"                                    │
│   - title: "Aladdin and the Wonderful Lamp, Part I"                 │
│   - qtiVersion: "3.0"                                               │
├─────────────────────────────────────────────────────────────────────┤
│ TEST PART (test_part_0)                                             │
│   - navigationMode: "linear"                                         │
│   - submissionMode: "individual"                                     │
├─────────────────────────────────────────────────────────────────────┤
│ SECTIONS                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ Section 1 (test_guiding_21014)                               │   │
│   │   - title: "Guiding Questions"                               │   │
│   │   - sequence: 1                                              │   │
│   │   └── Item: guiding_21014_302001 → Stimulus: guiding_21014   │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │ Section 2 (test_guiding_21015)                               │   │
│   │   - title: "Guiding Questions"                               │   │
│   │   - sequence: 2                                              │   │
│   │   └── Item: guiding_21015_302002 → Stimulus: guiding_21015   │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │ Section 3 (test_guiding_21016)                               │   │
│   │   - title: "Guiding Questions"                               │   │
│   │   - sequence: 3                                              │   │
│   │   └── Item: guiding_21016_302003 → Stimulus: guiding_21016   │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │ Section 4 (test_guiding_21017)                               │   │
│   │   - title: "Guiding Questions"                               │   │
│   │   - sequence: 4                                              │   │
│   │   └── Item: guiding_21017_302004 → Stimulus: guiding_21017   │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │ Section 5 (test_quiz)                                        │   │
│   │   - title: "Quiz"                                            │   │
│   │   - sequence: 5                                              │   │
│   │   └── Items: quiz_302005, quiz_302006, quiz_302007, quiz_302008│  │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ID Naming Conventions

### Article/Test ID
```
article_UUUMMM
```
- `UU` = Unit number (01-11)
- `MMM` = Article sequence within unit (001-999)
- Example: `article_101001` = Unit 1, Article 1

### Stimulus ID
```
guiding_NNNNN
```
- `NNNNN` = 5-digit unique identifier
- Example: `guiding_21014` = Section 1 stimulus for article 101001

### Section ID
```
test_guiding_NNNNN  (for guiding question sections)
test_quiz           (for quiz section)
```
- Example: `test_guiding_21014` = Section containing guiding question for stimulus 21014

### Assessment Item ID (Question)
```
guiding_NNNNN_QQQQQQ   (for guiding questions)
quiz_QQQQQQ            (for quiz questions)
```
- `NNNNN` = Stimulus ID reference
- `QQQQQQ` = 6-digit question ID
- Examples:
  - `guiding_21014_302001` = Guiding question for section 1 (stimulus 21014)
  - `quiz_302005` = Quiz question 5

### Answer Choice ID
```
answer_AAAAAA
```
- `AAAAAA` = 6-digit unique identifier
- Example: `answer_600101`, `answer_600102`, etc.

---

## Creating Stimuli (Reading Passages)

### API Endpoint
```
POST https://qti.alpha-1edtech.ai/api/stimuli
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifier` | string | Unique ID (e.g., `guiding_21014`) |
| `title` | string | Section title (e.g., "Section 1") |
| `content` | string | HTML content wrapped in `<qti-stimulus-body>` |
| `metadata` | object | Optional metadata (lexile_level, course, module, etc.) |

### Payload Structure

```json
{
  "format": "json",
  "identifier": "guiding_21014",
  "title": "Section 1",
  "content": "<qti-stimulus-body><div>\n    <div data-article-header=\"true\">\n        <h1>Aladdin and the Wonderful Lamp, Part I</h1>\n    </div>\n    <div>\n        <p>There once was a poor boy named Aladdin...</p>\n    </div>\n</div></qti-stimulus-body>",
  "metadata": {
    "lexile_level": 692,
    "course": "Core Knowledge Reading Grade 3/3",
    "module": "Classic Tales",
    "section_number": 1
  }
}
```

### HTML Content Guidelines

1. **Wrap in stimulus body tag**: `<qti-stimulus-body>...</qti-stimulus-body>`
2. **Article header**: Use `<div data-article-header="true"><h1>Title</h1></div>` for first section
3. **Paragraphs**: Use `<p>` tags for text
4. **Vocabulary highlighting**: Use `<b style="color: #1a6666;">word</b>` for key vocabulary

### Example Raw XML Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-stimulus 
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_stimulusv3p0p1_v1p0.xsd"
  identifier="guiding_21014"
  xml:lang="en"
  title="Section 1">
  <qti-stimulus-body>
    <div>
      <div data-article-header="true">
        <h1>Aladdin and the Wonderful Lamp, Part I</h1>
      </div>
      <div>
        <p>There once was a poor boy named Aladdin...</p>
      </div>
    </div>
  </qti-stimulus-body>
</qti-assessment-stimulus>
```

---

## Creating Assessment Items (Questions)

### API Endpoint
```
POST https://qti.alpha-1edtech.ai/api/assessment-items
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifier` | string | Unique ID (e.g., `guiding_21014_302001`) |
| `title` | string | Question title |
| `type` | string | `"choice"` for multiple choice |
| `interaction` | object | Question prompt and choices |
| `responseDeclarations` | array | Correct answer declaration |
| `stimulus` | object | Reference to stimulus (for guiding questions only) |
| `metadata` | object | DOK, difficulty, CCSS, etc. |

### Payload Structure for Guiding Question

```json
{
  "format": "json",
  "identifier": "guiding_21014_302001",
  "title": "Section 1 - Guiding Question",
  "type": "choice",
  "metadata": {
    "DOK": 1,
    "difficulty": "easy",
    "CCSS": "RL.3.1",
    "learningObjectiveSet": []
  },
  "stimulus": {
    "identifier": "guiding_21014"
  },
  "interaction": {
    "type": "choice",
    "responseIdentifier": "RESPONSE",
    "shuffle": false,
    "maxChoices": 1,
    "questionStructure": {
      "prompt": "Aladdin's father worked as a",
      "choices": [
        {
          "identifier": "answer_600101",
          "content": "tailor",
          "feedbackInline": "You successfully identified key details...",
          "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        },
        {
          "identifier": "answer_600102",
          "content": "baker",
          "feedbackInline": "You may have chosen baker because...",
          "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        },
        {
          "identifier": "answer_600103",
          "content": "farmer",
          "feedbackInline": "You may have guessed farmer...",
          "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        },
        {
          "identifier": "answer_600104",
          "content": "teacher",
          "feedbackInline": "You may have mixed up the job words...",
          "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        }
      ]
    }
  },
  "responseDeclarations": [
    {
      "identifier": "RESPONSE",
      "cardinality": "single",
      "baseType": "identifier",
      "correctResponse": {
        "value": ["answer_600101"]
      }
    }
  ],
  "outcomeDeclarations": [
    {"identifier": "FEEDBACK", "cardinality": "single", "baseType": "identifier"},
    {"identifier": "FEEDBACK-INLINE", "cardinality": "single", "baseType": "identifier"}
  ],
  "responseProcessing": {
    "templateType": "match_correct",
    "responseDeclarationIdentifier": "RESPONSE",
    "outcomeIdentifier": "FEEDBACK",
    "correctResponseIdentifier": "CORRECT",
    "incorrectResponseIdentifier": "INCORRECT"
  }
}
```

### Payload Structure for Quiz Question

Same as guiding question but **without** the `stimulus` field:

```json
{
  "format": "json",
  "identifier": "quiz_302005",
  "title": "Quiz Question",
  "type": "choice",
  "metadata": {
    "DOK": 2,
    "difficulty": "medium",
    "CCSS": "RL.3.4"
  },
  "interaction": {
    "type": "choice",
    "responseIdentifier": "RESPONSE",
    "shuffle": false,
    "maxChoices": 1,
    "questionStructure": {
      "prompt": "What does this phrase mean?",
      "choices": [...]
    }
  },
  "responseDeclarations": [...],
  "outcomeDeclarations": [...],
  "responseProcessing": {...}
}
```

### Metadata Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `DOK` | int | 1-4 | Depth of Knowledge level |
| `difficulty` | string | "easy", "medium", "hard" | Question difficulty |
| `CCSS` | string | e.g., "RL.3.1" | Common Core State Standard |
| `learningObjectiveSet` | array | CASE objective IDs | Learning objectives |

---

## Creating Assessment Tests (Articles)

### API Endpoint
```
POST https://qti.alpha-1edtech.ai/api/assessment-tests
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifier` | string | Article ID (e.g., `article_101001`) |
| `title` | string | Article title |
| `qtiVersion` | string | `"3.0"` |
| `qti-test-part` | array | Contains sections with item references |

### Payload Structure

```json
{
  "identifier": "article_101001",
  "title": "Aladdin and the Wonderful Lamp, Part I",
  "toolName": "playcademy-course-builder",
  "toolVersion": "1.0.0",
  "qtiVersion": "3.0",
  "metadata": {
    "grade": "3",
    "course": "Core Knowledge Reading Grade 3/3",
    "module": "Classic Tales"
  },
  "qti-test-part": [
    {
      "identifier": "test_part_0",
      "navigationMode": "linear",
      "submissionMode": "individual",
      "qti-assessment-section": [
        {
          "identifier": "test_guiding_21014",
          "title": "Guiding Questions",
          "visible": true,
          "required": true,
          "fixed": false,
          "sequence": 1,
          "qti-assessment-item-ref": [
            {"identifier": "guiding_21014_302001"}
          ]
        },
        {
          "identifier": "test_guiding_21015",
          "title": "Guiding Questions",
          "visible": true,
          "required": true,
          "fixed": false,
          "sequence": 2,
          "qti-assessment-item-ref": [
            {"identifier": "guiding_21015_302002"}
          ]
        },
        {
          "identifier": "test_guiding_21016",
          "title": "Guiding Questions",
          "visible": true,
          "required": true,
          "fixed": false,
          "sequence": 3,
          "qti-assessment-item-ref": [
            {"identifier": "guiding_21016_302003"}
          ]
        },
        {
          "identifier": "test_guiding_21017",
          "title": "Guiding Questions",
          "visible": true,
          "required": true,
          "fixed": false,
          "sequence": 4,
          "qti-assessment-item-ref": [
            {"identifier": "guiding_21017_302004"}
          ]
        },
        {
          "identifier": "test_quiz",
          "title": "Quiz",
          "visible": true,
          "required": true,
          "fixed": false,
          "sequence": 5,
          "qti-assessment-item-ref": [
            {"identifier": "quiz_302005"},
            {"identifier": "quiz_302006"},
            {"identifier": "quiz_302007"},
            {"identifier": "quiz_302008"}
          ]
        }
      ]
    }
  ],
  "qti-outcome-declaration": [
    {"identifier": "SCORE", "cardinality": "single", "baseType": "float"}
  ]
}
```

---

## API Endpoints

### Base URL
```
https://qti.alpha-1edtech.ai/api
```

### Authentication
All requests require OAuth 2.0 Bearer token:

```bash
# Get token
curl -X POST "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"

# Use token
curl "https://qti.alpha-1edtech.ai/api/assessment-tests/article_101001" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/stimuli/{identifier}` | Get stimulus by ID |
| `POST` | `/stimuli` | Create new stimulus |
| `PUT` | `/stimuli/{identifier}` | Update existing stimulus |
| `DELETE` | `/stimuli/{identifier}` | Delete stimulus |
| `GET` | `/assessment-items/{identifier}` | Get question by ID |
| `POST` | `/assessment-items` | Create new question |
| `PUT` | `/assessment-items/{identifier}` | Update existing question |
| `DELETE` | `/assessment-items/{identifier}` | Delete question |
| `GET` | `/assessment-tests/{identifier}` | Get test by ID |
| `POST` | `/assessment-tests` | Create new test |
| `PUT` | `/assessment-tests/{identifier}` | Update existing test |
| `DELETE` | `/assessment-tests/{identifier}` | Delete test |

---

## Complete Example Payloads

### Complete Article Creation Order

1. **Create stimuli first** (4 stimuli for 4 sections)
2. **Create assessment items** (4 guiding questions + 4 quiz questions)
3. **Create assessment test** (references all items)

### Order of Operations Script

```python
# 1. Create 4 stimuli
for section_num in [1, 2, 3, 4]:
    stimulus_id = f"guiding_{base_id + section_num - 1}"
    create_stimulus(stimulus_id, f"Section {section_num}", passage_content)

# 2. Create 4 guiding questions (with stimulus refs)
for section_num in [1, 2, 3, 4]:
    stimulus_id = f"guiding_{base_id + section_num - 1}"
    item_id = f"guiding_{base_id + section_num - 1}_{question_base + section_num}"
    create_assessment_item(item_id, question_data, stimulus_ref=stimulus_id)

# 3. Create 4 quiz questions (no stimulus refs)
for quiz_num in [1, 2, 3, 4]:
    item_id = f"quiz_{question_base + 4 + quiz_num}"
    create_assessment_item(item_id, question_data, stimulus_ref=None)

# 4. Create the assessment test
create_assessment_test(article_id, title, [
    {section_id: test_guiding_xxx, items: [guiding_xxx_yyy]},
    ...
    {section_id: test_quiz, items: [quiz_yyy, quiz_zzz, ...]}
])
```

---

## Validation Checklist

Before creating a new article, verify:

- [ ] All IDs are unique and follow naming conventions
- [ ] Each guiding question has a corresponding stimulus
- [ ] Correct answer identifier matches one of the choice identifiers
- [ ] All 4 answer choices have feedback
- [ ] Stimuli are created before items that reference them
- [ ] Items are created before the test that references them
- [ ] Metadata includes DOK, difficulty, and CCSS for each question

---

## Related Files

| File | Description |
|------|-------------|
| `outputs/qti_dumps/article_101001_complete_qti.json` | Complete example article dump |
| `fetch_article_qti.py` | Script to fetch article QTI structure |
| `build_course.py` | Script to create articles from question bank |
| `docs/COURSE-STRUCTURE-BREAKDOWN.md` | Overall course structure overview |
| `docs/Creating a new Alpha Read Article.md` | Original article creation documentation |

---

## External References

- [1EdTech QTI 3.0 Specification](https://www.1edtech.org/standards/qti)
- [QTI API Documentation](https://docs.playcademy.net/timeback/api-reference/qti)
- [QTI 3.0 Schema](https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/)
