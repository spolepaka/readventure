# Clone Course ID Logic

This document explains how IDs are handled in the `clone_course.py` script for both creation and update modes.

---

## ID Structure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        ONEROSTER (Database)                      │
├─────────────────────────────────────────────────────────────────┤
│  Course          → sourcedId: NEW UUID (always unique)          │
│    └── Unit      → sourcedId: NEW UUID (always unique)          │
│          └── Resource       → sourcedId: NEW unique ID          │
│          └── ComponentRes   → sourcedId: same as Resource       │
│                                                                  │
│  metadata.url → points to QTI (can be EXISTING content)         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    (URL reference only)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                          QTI (Content)                           │
├─────────────────────────────────────────────────────────────────┤
│  assessment-test: article_101001  ← SHARED, not duplicated      │
│  stimuli, items: existing content                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Modes: CREATE vs UPDATE

| Aspect | CREATE Mode | UPDATE Mode |
|--------|-------------|-------------|
| **Course** | New UUID, title gets "(Clone N)", code gets "-clone-N" | Uses existing `--target-course-id`, NOT modified |
| **Units** | New UUIDs | New UUIDs (added to existing course) |
| **Resources** | New unique IDs | New unique IDs |
| **Articles** | New unique IDs | New unique IDs |

---

## ID Generation for Articles/Resources

### Default: Auto-Generate

```python
# Input (from source course)
original_id = "article_101001"

# Output (for cloned course)
{
    "sourcedId": "clone_f3d8b068_article_101001",  # UNIQUE for OneRoster
    "qti_id": "article_101001"                      # Points to EXISTING QTI
}
```

### With Mapping File

```bash
python clone_course.py --source-course-id <id> --id-mapping-file my_ids.json
```

**Simple format** (auto-uses original for QTI):
```json
{
    "article_101001": "my_custom_id_001",
    "article_101002": "my_custom_id_002"
}
```

**Full format** (specify both):
```json
{
    "article_101001": {
        "sourcedId": "my_custom_id_001",
        "qti_id": "article_101001"
    }
}
```

---

## Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                           INPUTS                                        │
├────────────────────────────────────────────────────────────────────────┤
│  --source-course-id     Required. Course to clone from                 │
│  --mode create|update   Required. Create new or update existing        │
│  --target-course-id     Required for UPDATE mode only                  │
│  --id-mapping-file      Optional. Custom ID mappings (JSON)            │
│  --course-title         Optional. Override title (CREATE mode)         │
│  --course-grades        Optional. Override grades (CREATE mode)        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         ID RESOLUTION                                   │
├────────────────────────────────────────────────────────────────────────┤
│  1. If --id-mapping-file provided:                                     │
│     └── Load custom mappings from JSON                                 │
│                                                                        │
│  2. Otherwise (DEFAULT):                                               │
│     └── Auto-generate: clone_<uuid8>_<original>                        │
│     └── QTI reference: original ID (reuses existing content)           │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      CREATE MODE                                        │
├────────────────────────────────────────────────────────────────────────┤
│  Course:                                                               │
│    sourcedId: NEW UUID (e.g., 5744017f-f91e-...)                       │
│    title: "Original Title (Clone 144415)"                              │
│    courseCode: "ORIGINAL_CODE-clone-144415"                            │
│                                                                        │
│  Units:                                                                │
│    sourcedId: NEW UUID each                                            │
│    course: { sourcedId: new_course_id }                                │
│                                                                        │
│  Resources:                                                            │
│    sourcedId: "clone_f3d8b068_article_101001" (unique)                 │
│    metadata.url: ".../assessment-tests/article_101001" (original QTI)  │
│                                                                        │
│  ComponentResources (Articles):                                        │
│    sourcedId: same as resource                                         │
│    resource: { sourcedId: resource_id }                                │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      UPDATE MODE                                        │
├────────────────────────────────────────────────────────────────────────┤
│  Course:                                                               │
│    ❌ NOT MODIFIED (uses --target-course-id as-is)                     │
│                                                                        │
│  Units, Resources, Articles:                                           │
│    ✅ Same as CREATE - new IDs, added to existing course               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Principles

1. **OneRoster IDs must be globally unique** - every `sourcedId` in the database must be different
2. **QTI content can be shared** - multiple OneRoster resources can point to the same QTI URL
3. **CREATE mode** - makes a completely new course with unique everything
4. **UPDATE mode** - adds new units/articles to an existing course (doesn't touch course-level fields)

---

## Usage Examples

### Clone to a new course (auto-generated IDs)

```bash
python clone_course.py \
  --source-course-id 80c8fa8d-744d-4df4-937b-2c93fb0cb93e \
  --mode create
```

### Clone to a new course with custom IDs

```bash
python clone_course.py \
  --source-course-id 80c8fa8d-744d-4df4-937b-2c93fb0cb93e \
  --mode create \
  --id-mapping-file custom_ids.json
```

### Add content to an existing course

```bash
python clone_course.py \
  --source-course-id 80c8fa8d-744d-4df4-937b-2c93fb0cb93e \
  --mode update \
  --target-course-id <existing-course-uuid>
```

### Dry run (preview without making changes)

```bash
python clone_course.py \
  --source-course-id 80c8fa8d-744d-4df4-937b-2c93fb0cb93e \
  --mode create \
  --dry-run
```
