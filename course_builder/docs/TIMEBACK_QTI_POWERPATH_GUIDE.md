# Building PowerPath 100-Ready Assessments with Timeback APIs

This guide explains how to use the Timeback QTI and OneRoster APIs to create assessment content that integrates with PowerPath 100 courses.

> **Related Documents:**
> - [COURSE-STRUCTURE-BREAKDOWN.md](./COURSE-STRUCTURE-BREAKDOWN.md) - Understanding the overall hierarchy and how to READ existing content
> - [Creating a new Alpha Read Article.md](./Creating%20a%20new%20Alpha%20Read%20Article.md) - Alpha Read specific patterns (guiding questions, quiz structure, ID conventions)

## APIs Overview

| API | Base URL | Purpose |
|-----|----------|---------|
| **QTI API** | `https://qti.alpha-1edtech.ai/api` | Assessment items, assessment tests, stimuli |
| **OneRoster API** | `{ONEROSTER_API_URL}/ims/oneroster/...` | Courses, components, resources |

Both APIs use **Bearer token** authentication (OAuth2 client credentials via Cognito).

---

## Pre-Step: Create Stimuli (Passage Content)

If your questions require reading passages or other stimulus content, you need to create the stimulus **before** creating the questions that reference it.

**Endpoint:** `POST https://qti.alpha-1edtech.ai/api/stimuli`

```bash
curl https://qti.alpha-1edtech.ai/api/stimuli \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "format": "json",
  "identifier": "question-001-stimulus",
  "title": "Forest Ecosystem Reading Passage",
  "content": "\n    <div class=\"stimulus-content\">\n      <h2>Forest Ecosystems</h2>\n      <p>A forest ecosystem is a complex community of plants, animals, and microorganisms that interact with each other and their physical environment. These ecosystems play crucial roles in maintaining environmental balance and supporting biodiversity.</p>\n      <h3>Layers of the Forest</h3>\n      <p><strong>Canopy Layer:</strong> The uppermost layer formed by the crowns of tall trees. This layer receives the most sunlight and is home to many birds, insects, and mammals.</p>\n      <p><strong>Understory:</strong> Below the canopy, this layer consists of smaller trees and shrubs that can tolerate lower light conditions. Many flowering plants and young trees grow here.</p>\n      <p><strong>Forest Floor:</strong> The ground level where decomposition occurs. Fallen leaves, branches, and other organic matter break down, providing nutrients for plant growth.</p>\n      <h3>Ecological Relationships</h3>\n      <p>Forest ecosystems demonstrate various ecological relationships:</p>\n      <ul>\n        <li><em>Producers:</em> Trees and plants that make their own food through photosynthesis</li>\n        <li><em>Primary Consumers:</em> Herbivores that eat plants, such as deer and rabbits</li>\n        <li><em>Secondary Consumers:</em> Carnivores that eat herbivores, such as foxes and hawks</li>\n        <li><em>Decomposers:</em> Organisms like fungi and bacteria that break down dead material</li>\n      </ul>\n    </div>\n  ",
  "metadata": {
    "subject": "Science",
    "grade": "7",
    "standard": "Life Science",
    "lesson": "Ecosystems and Biodiversity",
    "difficulty": "medium"
  }
}'
```

### Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `identifier` | **Yes** | Unique ID for this stimulus. Use a naming convention like `question-001-stimulus` to track which stimulus goes with which question(s). |
| `title` | **Yes** | Display title for the passage |
| `content` | **Yes** | HTML content of the passage/stimulus |
| `metadata` | No | Optional metadata (subject, grade, difficulty, etc.) — not required for the stimulus to work |

### Tips

- **Create stimuli first** — You'll need the stimulus `identifier` when creating questions that reference it
- **Use descriptive identifiers** — A naming convention like `question-001-stimulus` or `ecosystems-passage-001` helps you track which stimuli belong to which questions
- **HTML content** — The `content` field accepts HTML, so you can include headings, lists, bold/italic text, etc.
- **Reusable** — Multiple questions can reference the same stimulus by its identifier

---

## Part 1: Create Questions (QTI Assessment Items)

**Endpoint:** `POST https://qti.alpha-1edtech.ai/api/assessment-items`

```bash
curl https://qti.alpha-1edtech.ai/api/assessment-items \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "format": "json",
  "identifier": "choice-item-1",
  "type": "choice",
  "title": "Sample Choice Question",
  "metadata": {
    "subject": "Math",
    "grade": "5",
    "standard": "Number Operations",
    "lesson": "Basic Addition",
    "difficulty": "hard"
  },
  "interaction": {
    "type": "choice",
    "responseIdentifier": "RESPONSE",
    "shuffle": false,
    "maxChoices": 1,
    "questionStructure": {
      "prompt": "What is 2 + 2?",
      "choices": [
        {
          "identifier": "A",
          "content": "3",
          "feedbackInline": "<span style=\"color: #D9534F;\">Incorrect: Try counting again.</span>",
          "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        },
        {
          "identifier": "B",
          "content": "4",
          "feedbackInline": "<span style=\"color: #2E8B57;\">Correct: Well done!</span>",
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
        "value": ["B"]
      }
    }
  ],
  "outcomeDeclarations": [
    {
      "identifier": "FEEDBACK",
      "cardinality": "single",
      "baseType": "identifier"
    },
    {
      "identifier": "FEEDBACK-INLINE",
      "cardinality": "single",
      "baseType": "identifier"
    }
  ],
  "responseProcessing": {
    "templateType": "match_correct",
    "responseDeclarationIdentifier": "RESPONSE",
    "outcomeIdentifier": "FEEDBACK",
    "correctResponseIdentifier": "CORRECT",
    "incorrectResponseIdentifier": "INCORRECT"
  },
  "feedbackBlock": [
    {
      "outcomeIdentifier": "FEEDBACK",
      "identifier": "CORRECT",
      "showHide": "show",
      "content": "<p><strong>Correct!</strong> Well done.</p>"
    },
    {
      "outcomeIdentifier": "FEEDBACK",
      "identifier": "INCORRECT",
      "showHide": "show",
      "content": "<p><strong>Incorrect.</strong> Please review and try again.</p>"
    }
  ],
  "rubrics": [
    {
      "use": "ext:criteria",
      "view": "scorer",
      "body": "<p>Grading Criteria:</p><ul><li>The response must correctly identify 4 as the answer.</li></ul>"
    }
  ],
  "stimulus": {
    "identifier": "question-001-stimulus"
  }
}'
```

### Key Fields Explained

| Field | Description |
|-------|-------------|
| `format` | `"json"` — Use JSON format (alternative is XML) |
| `identifier` | Unique ID for this item (NCName-safe) |
| `type` | Question type: `"choice"`, `"text-entry"`, `"extended-text"` |
| `title` | Display title |
| `metadata` | Custom metadata (subject, grade, difficulty, etc.) |
| `interaction` | The question content and answer options |
| `responseDeclarations` | Defines correct answer(s) |
| `outcomeDeclarations` | Variables used for feedback/scoring |
| `responseProcessing` | Scoring logic (`match_correct` is simplest) |
| `feedbackBlock` | Feedback shown after submission |
| `rubrics` | Grading criteria (optional) |
| `stimulus` | Reference to shared stimulus content (optional) | 

**NOTE: This is how you add your passages to the questions.** The stimulus `identifier` should match the `identifier` of the stimulus you created in [Pre-Step: Create Stimuli (Passage Content)](#pre-step-create-stimuli-passage-content).

### Interaction Types

**Choice (multiple choice):**
- `maxChoices: 1` = single select
- `maxChoices: 0` = unlimited (multiple select)

---

## Part 2: Create a Question Bank (QTI Assessment Test)

**Endpoint:** `POST https://qti.alpha-1edtech.ai/api/assessment-tests`

```bash
curl https://qti.alpha-1edtech.ai/api/assessment-tests \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "identifier": "my-test-001",
  "title": "Basic Math Quiz",
  "toolName": "your-tool-name",
  "toolVersion": "1.0.0",
  "metadata": {
    "subject": "Math",
    "grade": "5"
  },
  "qti-test-part": [
    {
      "identifier": "part-1",
      "navigationMode": "linear",
      "submissionMode": "individual",
      "qti-assessment-section": [
        {
          "identifier": "section-1",
          "title": "Addition Questions",
          "visible": true,
          "required": true,
          "sequence": 1,
          "qti-assessment-item-ref": [
            { "identifier": "choice-item-1" },
            { "identifier": "choice-item-2" }
          ]
        }
      ]
    }
  ],
  "qti-outcome-declaration": [
    {
      "identifier": "SCORE",
      "cardinality": "single",
      "baseType": "float"
    }
  ]
}'
```

### Test Structure (QTI 3.0)

- **Test** → contains **Test Parts**
- **Test Parts** → contain **Assessment Sections**
- **Sections** → contain **Item References** (pointing to your assessment items by identifier)

### Key Fields

| Field | Description |
|-------|-------------|
| `identifier` | Unique ID for this test (NCName-safe) |
| `title` | Display title |
| `toolName` | Your tool's name (for filtering your content later) |
| `toolVersion` | Your tool's version |
| `metadata` | Custom metadata (subject, grade, etc.) |
| `qti-test-part` | Array of test parts |
| `qti-assessment-section` | Sections within a test part |
| `qti-assessment-item-ref` | References to assessment items by identifier |
| `qti-outcome-declaration` | Scoring variables (SCORE is standard) |

---

## Part 3: Link to a Course for PowerPath 100

PowerPath uses **OneRoster** to organize courses. To make your assessment test available in a course, you need to:

1. Create a **Resource** that points to your QTI Assessment Test
2. Create a **ComponentResource** that links the resource to a course component

### A. Create a Resource Pointing to Your Assessment Test

```bash
curl {ONEROSTER_API_URL}/ims/oneroster/resources/v1p2/resources/ \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --data '{
  "resource": {
    "sourcedId": "resource-001",
    "status": "active",
    "title": "Basic Math Quiz",
    "roles": ["primary"],
    "importance": "primary",
    "vendorResourceId": "my-test-001",
    "vendorId": "your-tool-name",
    "applicationId": "your-tool-name-1.0.0",
    "metadata": {
      "type": "qti",
      "subType": "qti-test",
      "url": "https://qti.alpha-1edtech.ai/api/assessment-tests/my-test-001",
      "xp": 100
    }
  }
}'
```

The `xp` field in metadata defines how many experience points (XP) the learner earns for completing this quiz. PowerPath uses this value to track learner progress and award points upon successful completion.

### B. Link Resource to Course Component

```bash
curl {ONEROSTER_API_URL}/ims/oneroster/rostering/v1p2/courses/component-resources \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --data '{
  "componentResource": {
    "sourcedId": "compres-001",
    "status": "active",
    "title": "Basic Math Quiz",
    "sortOrder": 1,
    "courseComponent": { "sourcedId": "existing-component-id" },
    "resource": { "sourcedId": "resource-001" },
    "lessonType": "powerpath-100"
  }
}'
```

### Lesson Types

| Value | Description |
|-------|-------------|
| `quiz` | Standard quiz assessment |
| `test-out` | Test-out/placement assessment |
| `placement` | Placement assessment |
| `powerpath-100` | PowerPath 100 assessment |

---

## The Complete Chain

```
Course (OneRoster)
  └── Course Component
        └── ComponentResource (lessonType: "powerpath-100")
              └── Resource (metadata.type: "qti", metadata.subType: "qti-test")
                    │
                    |
                    └── metadata.url: "https://qti.alpha-1edtech.ai/api/assessment-tests/my-test-001"
                          │
                          └── QTI Assessment Test (my-test-001)
                                └── qti-assessment-item-ref
                                      ├── choice-item-1
                                      └── choice-item-2
```

---

## Summary

| Step | API | Endpoint | Creates |
|------|-----|----------|---------|
| 0 (optional) | QTI | `POST /stimuli` | Passage/stimulus content |
| 1 | QTI | `POST /assessment-items` | Individual questions (can reference stimuli) |
| 2 | QTI | `POST /assessment-tests` | Question bank (references items) |
| 3 | OneRoster | `POST /resources/` | Resource pointing to assessment test |
| 4 | OneRoster | `POST /component-resources` | Link to course component |

PowerPath reads the course syllabus, finds the ComponentResource → Resource → `metadata.url`, and loads the QTI assessment test from there.

---

## Fetching Content

### Get a Single Stimulus

```bash
curl https://qti.alpha-1edtech.ai/api/stimuli/{identifier} \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

### Get a Single Assessment Item

```bash
curl https://qti.alpha-1edtech.ai/api/assessment-items/{identifier} \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

### Get a Single Assessment Test

```bash
curl https://qti.alpha-1edtech.ai/api/assessment-tests/{identifier} \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

### Get Course Syllabus (PowerPath View)

```bash
curl {ONEROSTER_API_URL}/powerpath/syllabus/{courseId} \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

Returns the full nested structure with all components, componentResources, and linked resource metadata.
