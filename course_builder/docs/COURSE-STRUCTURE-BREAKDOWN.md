# Complete Course Structure Breakdown

This document details the complete structure of Timeback/AlphaLearn courses, including how OneRoster course data connects to QTI assessment content.

> **Related Documents:**
> - [Creating a new Alpha Read Article.md](./Creating%20a%20new%20Alpha%20Read%20Article.md) - How to CREATE new Alpha Read articles (POST endpoints, ID conventions)
> - [TIMEBACK_QTI_POWERPATH_GUIDE.md](./TIMEBACK_QTI_POWERPATH_GUIDE.md) - How to CREATE generic assessments for PowerPath 100

## Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OneRoster API                                   │
│                        (api.alpha-1edtech.ai)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COURSE                                                                      │
│  ├── sourcedId: "80c8fa8d-744d-4df4-937b-2c93fb0cb93e"                      │
│  ├── title: "Core Knowledge Reading Grade 3/3"                              │
│  ├── grades: ["3"]                                                          │
│  └── metadata.totalLessons: 131                                             │
│       │                                                                      │
│       ▼                                                                      │
│  UNITS (subComponents) ────────────────────────────────────────────────────│
│  ├── Unit 1: "Classic Tales" (11 articles)                                  │
│  ├── Unit 2: "Rattenborough's Guide to Animals" (16 articles)              │
│  ├── Unit 3: "How Does Your Body Work?" (12 articles)                      │
│  ├── Unit 4: "Stories of Ancient Rome" (17 articles)                       │
│  ├── Unit 5: "Adventures in Light and Sound" (12 articles)                 │
│  ├── Unit 6: "Gods, Giants, and Dwarves" (8 articles)                      │
│  ├── Unit 7: "What's in Our Universe?" (15 articles)                       │
│  ├── Unit 8: "Native American Stories" (10 articles)                       │
│  ├── Unit 9: "The Age of Exploration" (11 articles)                        │
│  ├── Unit 10: "Living in Colonial America" (12 articles)                   │
│  └── Unit 11: "Introduction to Ecology" (9 articles)                       │
│       │                                                                      │
│       ▼                                                                      │
│  ARTICLES (componentResources) ────────────────────────────────────────────│
│  ├── sourcedId: "article_101001"                                            │
│  ├── title: "Aladdin and the Wonderful Lamp, Part I"                       │
│  ├── lessonType: "alpha-read-article"                                       │
│  ├── xp: 13                                                                 │
│  └── resource.type: "qti" ──────────────────┐                               │
│                                              │                               │
└──────────────────────────────────────────────┼───────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                QTI API                                       │
│                        (qti.alpha-1edtech.ai)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ASSESSMENT TEST ─────────────────────────────────────────────────────────│
│  ├── identifier: "article_101001"                                           │
│  ├── title: "Aladdin and the Wonderful Lamp, Part I"                       │
│  ├── qtiVersion: "3.0"                                                      │
│  └── test_parts: [1]                                                        │
│       │                                                                      │
│       ▼                                                                      │
│  TEST PART ───────────────────────────────────────────────────────────────│
│  ├── navigationMode: "linear"                                               │
│  ├── submissionMode: "individual"                                           │
│  └── sections: [5]                                                          │
│       │                                                                      │
│       ├──► SECTION 1: "Guiding Questions" (1 item) ──► STIMULUS: Section 1 │
│       ├──► SECTION 2: "Guiding Questions" (1 item) ──► STIMULUS: Section 2 │
│       ├──► SECTION 3: "Guiding Questions" (1 item) ──► STIMULUS: Section 3 │
│       ├──► SECTION 4: "Guiding Questions" (1 item) ──► STIMULUS: Section 4 │
│       └──► SECTION 5: "Quiz" (4 items) ──► No stimulus (tests full article)│
│                 │                                                            │
│                 ▼                                                            │
│  ASSESSMENT ITEM (Question) ──────────────────────────────────────────────│
│  ├── identifier: "quiz_302005"                                              │
│  ├── interaction_type: "choice"                                             │
│  ├── prompt: "What does this phrase mean?"                                  │
│  ├── correct_answers: ["answer_600117"]                                     │
│  ├── choices: [4 options with feedback]                                     │
│  └── stimulus_ref ───────────────────────────┐                              │
│                                              │                               │
│                                              ▼                               │
│  STIMULUS (Reading Passage) ──────────────────────────────────────────────│
│  ├── identifier: "guiding_21014"                                            │
│  ├── title: "Section 1"                                                     │
│  └── content_text: "Aladdin and the Wonderful Lamp..."                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Course Level (OneRoster)

| Field | Value |
|-------|-------|
| **sourcedId** | `80c8fa8d-744d-4df4-937b-2c93fb0cb93e` |
| **title** | Core Knowledge Reading Grade 3/3 |
| **grades** | `["3"]` |
| **status** | active |
| **primaryApp** | alpha_read |
| **totalLessons** | 131 |

**API Endpoint**: `GET /powerpath/syllabus/{courseId}`

**Example Response**:
```json
{
  "syllabus": {
    "course": {
      "sourcedId": "80c8fa8d-744d-4df4-937b-2c93fb0cb93e",
      "title": "Core Knowledge Reading Grade 3/3",
      "grades": ["3"],
      "status": "active",
      "metadata": {
        "contentGrade": "3",
        "totalLessons": 131,
        "primaryApp": "alpha_read",
        "isAlphaRead": true
      }
    },
    "subComponents": [...]
  }
}
```

---

## 2. Unit Level (subComponents)

Each course contains multiple **Units** (called `subComponents` in the API):

| # | Unit Title | Articles |
|---|------------|----------|
| 1 | Classic Tales | 11 |
| 2 | Rattenborough's Guide to Animals | 16 |
| 3 | How Does Your Body Work? | 12 |
| 4 | Stories of Ancient Rome | 17 |
| 5 | Adventures in Light and Sound | 12 |
| 6 | Gods, Giants, and Dwarves | 8 |
| 7 | What's in Our Universe? | 15 |
| 8 | Native American Stories | 10 |
| 9 | The Age of Exploration | 11 |
| 10 | Living in Colonial America | 12 |
| 11 | Introduction to Ecology | 9 |
| | **TOTAL** | **123** |

**Unit Structure**:
```json
{
  "sourcedId": "9ee49524-8eb1-41b6-92c3-1c3ba0407841",
  "title": "Classic Tales",
  "sortOrder": 1,
  "status": "active",
  "unlockDate": "2025-07-10T12:58:48.000Z",
  "metadata": {},
  "prerequisites": [],
  "componentResources": [...]  // Articles
}
```

---

## 3. Article Level (componentResources)

Each unit contains **Articles** (reading lessons):

| Field | Example Value |
|-------|---------------|
| **sourcedId** | `article_101001` |
| **title** | Aladdin and the Wonderful Lamp, Part I |
| **sortOrder** | 1 |
| **lessonType** | `alpha-read-article` |
| **xp** | 13 |
| **resource.type** | `qti` |
| **qti_url** | `https://qti.alpha-1edtech.ai/api/assessment-tests/article_101001` |

**Article Structure**:
```json
{
  "sourcedId": "article_101001",
  "status": "active",
  "title": "Aladdin and the Wonderful Lamp, Part I",
  "sortOrder": 1,
  "metadata": {},
  "dateLastModified": "2025-07-10T12:58:54.000Z",
  "courseComponent": {
    "sourcedId": "9ee49524-8eb1-41b6-92c3-1c3ba0407841"
  },
  "resource": {
    "sourcedId": "article_101001",
    "status": "active",
    "metadata": {
      "sourcedId": "article_101001",
      "lessonType": "alpha-read-article",
      "type": "qti",
      "subType": "qti-test",
      "xp": 13,
      "url": "https://qti.alpha-1edtech.ai/api/assessment-tests/article_101001",
      "questionType": "custom"
    },
    "title": "Aladdin and the Wonderful Lamp, Part I",
    "importance": "primary",
    "vendorResourceId": "101001",
    "type": "qti"
  }
}
```

**Key Connection**: The `sourcedId` (e.g., `article_101001`) links directly to the QTI Assessment Test identifier.

---

## 4. QTI Assessment Test

Each article maps to one **Assessment Test** in QTI:

**API Endpoint**: `GET /assessment-tests/{identifier}`

```json
{
  "identifier": "article_101001",
  "title": "Aladdin and the Wonderful Lamp, Part I",
  "qtiVersion": "3.0",
  "metadata": {},
  "test_parts": [
    {
      "identifier": "test_part_0",
      "navigationMode": "linear",
      "submissionMode": "individual",
      "sections": [...]
    }
  ]
}
```

---

## 5. Test Sections

Each assessment test has **5 sections** (typical pattern):

| Section | Title | Questions | Stimulus |
|---------|-------|-----------|----------|
| 1 | Guiding Questions | 1 | Section 1 of story |
| 2 | Guiding Questions | 1 | Section 2 of story |
| 3 | Guiding Questions | 1 | Section 3 of story |
| 4 | Guiding Questions | 1 | Section 4 of story |
| 5 | Quiz | 4-5 | None (tests full article) |

**Pattern**: 
- **Guiding Questions** = 1 question per story section (comprehension check as they read)
- **Quiz** = 4-5 questions at the end (overall understanding)

**Section Structure**:
```json
{
  "identifier": "test_guiding_21014",
  "title": "Guiding Questions",
  "sequence": 1,
  "items": [...]
}
```

**Section-to-Stimulus Mapping**:
| Section ID | Section Title | Stimulus ID |
|------------|---------------|-------------|
| test_guiding_21014 | Guiding Questions | guiding_21014 |
| test_guiding_21015 | Guiding Questions | guiding_21015 |
| test_guiding_21016 | Guiding Questions | guiding_21016 |
| test_guiding_21017 | Guiding Questions | guiding_21017 |
| test_quiz | Quiz | (none) |

---

## 6. Assessment Item (Question)

Each question has:

**API Endpoint**: `GET /assessment-items/{identifier}`

```json
{
  "identifier": "quiz_302005",
  "title": "Quiz Question",
  "type": "choice",
  "interaction_type": "choice",
  "prompt": "In the story, the magician tells Aladdin that finding the lamp will make him \"richer than any king in the world.\" What does this phrase mean?",
  "correct_answers": ["answer_600117"],
  "stimulus_ref": {
    "identifier": "guiding_21014",
    "href": "stimuli/guiding_21014",
    "title": "Section 1"
  },
  "choices": [
    {
      "identifier": "answer_600117",
      "text": "Aladdin will have more money than he can count",
      "feedback": "You successfully made a good prediction by using clues about the magic lamp and treasure...",
      "is_correct": true
    },
    {
      "identifier": "answer_600118",
      "text": "Aladdin will become the ruler of a kingdom",
      "feedback": "You may have thought \"richer than any king\" means Aladdin becomes a king...",
      "is_correct": false
    },
    {
      "identifier": "answer_600119",
      "text": "Aladdin will find gold coins in the cave",
      "feedback": "You may have brought in outside ideas (gold coins), but the text never mentions coins...",
      "is_correct": false
    },
    {
      "identifier": "answer_600120",
      "text": "Aladdin will meet kings from other countries",
      "feedback": "You may have focused on the word \"king\" and guessed he'd meet kings...",
      "is_correct": false
    }
  ]
}
```

**Key Features**:
- **4 answer choices** per question
- **Detailed feedback** for each choice (both correct and incorrect)
- **stimulus_ref** links to the reading passage

---

## 7. Stimulus (Reading Passage)

Each **Guiding Question** section has its own stimulus (portion of the story):

**API Endpoint**: `GET /stimuli/{identifier}`

```json
{
  "identifier": "guiding_21014",
  "title": "Section 1",
  "metadata": {},
  "content_html": "<div class='qti-stimulus-body'>...",
  "content_text": "Aladdin and the Wonderful Lamp, Part I\n\nThere once was a poor boy named Aladdin. His father worked as a tailor, making clothes for people. When his father died, Aladdin's mother had to work hard to earn money for food and shelter.\n\nOne day, a stranger walked up to Aladdin on the street..."
}
```

**Stimuli per Article**:
| Stimulus ID | Title | Content |
|-------------|-------|---------|
| guiding_21014 | Section 1 | First part of the story |
| guiding_21015 | Section 2 | Second part of the story |
| guiding_21016 | Section 3 | Third part of the story |
| guiding_21017 | Section 4 | Fourth part of the story |

---

## How Everything Connects

```
OneRoster Course (80c8fa8d-...)
    │
    └── subComponents (Units)
            │
            └── componentResources (Articles)
                    │
                    └── resource.sourcedId = "article_101001"
                            │
                            │  LINKS TO (same identifier)
                            ▼
QTI Assessment Test (article_101001)
    │
    └── test_parts[0]
            │
            └── sections[0-4] (Guiding Questions + Quiz)
                    │
                    └── items[0] (Question)
                            │
                            └── stimulus_ref.identifier = "guiding_21014"
                                    │
                                    │  LINKS TO
                                    ▼
QTI Stimulus (guiding_21014)
    │
    └── content_text: "Reading passage section 1..."
```

### ID Linking Pattern

| OneRoster Field | QTI Field | Example |
|-----------------|-----------|---------|
| `componentResource.sourcedId` | `assessment-test.identifier` | `article_101001` |
| `resource.vendorResourceId` | (numeric suffix) | `101001` |
| (implicit) | `stimulus.identifier` | `guiding_21014` |
| (implicit) | `assessment-item.identifier` | `quiz_302005` |

---

## API Summary

### Domains

| API | Domain | Purpose |
|-----|--------|---------|
| **OneRoster** | `api.alpha-1edtech.ai` | Course structure, units, articles |
| **QTI** | `qti.alpha-1edtech.ai` | Assessment tests, questions, passages |

### Authentication

Both APIs use **OAuth 2.0 Bearer tokens** from AWS Cognito:

```bash
# Get token
curl -X POST "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"

# Use token
curl "https://api.alpha-1edtech.ai/powerpath/syllabus/{courseId}" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Required Scopes**:
- `https://purl.imsglobal.org/spec/qti/v3/scope/admin` - QTI API
- `https://purl.imsglobal.org/spec/or/v1p1/scope/admin` - OneRoster API

### Key Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /powerpath/syllabus/{courseId}` | Full course with units and articles |
| `GET /ims/oneroster/rostering/v1p2/courses` | List all courses |
| `GET /ims/oneroster/rostering/v1p2/courses/{courseId}` | Single course info |
| `GET /assessment-tests/{id}` | Test structure with sections |
| `GET /assessment-items/{id}` | Individual question with choices |
| `GET /stimuli/{id}` | Reading passage content |

---

## Data Counts (Grade 3 Course Example)

| Metric | Count |
|--------|-------|
| Units | 12 |
| Total Articles | 131 |
| Questions per Article | ~8 (4 guiding + 4 quiz) |
| Total Questions (estimated) | ~1,048 |
| Stimuli per Article | 4 (one per story section) |
| Total Stimuli (estimated) | ~524 |

---

## Environment Variables

For the extraction script (`extract_course_qti.py`):

```bash
export TIMEBACK_CLIENT_ID="your_client_id"
export TIMEBACK_CLIENT_SECRET="your_client_secret"
```

---

## Related Files

- **Extractor Script**: `course_builder/extract_course_qti.py`
- **Original Extractor**: `course_builder/reference/qti-extractor/extract_qti_assessments.py`
- **Article IDs CSV**: `course_builder/reference/article_ids.csv`
- **Extracted Data**: `course_builder/test_course_extract.json`

---

## External Documentation

- [OneRoster API Docs](https://docs.playcademy.net/timeback/api-reference/oneroster)
- [QTI API Docs](https://docs.playcademy.net/timeback/api-reference/qti)
- [1EdTech QTI 3.0 Specification](https://www.1edtech.org/standards/qti)
- [1EdTech OneRoster Specification](https://www.1edtech.org/standards/oneroster)
