# QTI Assessment Data Extractor

A Python script that queries the QTI API to extract comprehensive assessment test data including questions, answers, feedback, and reading passages.

## Features

✅ **Complete Data Extraction**:
- Assessment test metadata and structure
- Section organization
- Question prompts and interaction types
- Multiple choice options with identifiers
- Detailed feedback for each option
- Correct answer identification
- Associated stimulus content (reading passages)

✅ **Grade-Level Filtering**: Extract assessments by grade (3-12)
- Grades 3-8: Core Knowledge curriculum
- Grades 9-12: High school reading
- ~131 assessments per grade level

✅ **Robust Error Handling & Resume**:
- Automatic resume from last successful point
- Validates data before marking complete
- Logs all operations with timestamps
- Graceful error recovery with progress saving
- Skip already-completed assessments
- Detailed error reporting

✅ **Nested JSON Output**: Data organized hierarchically by test → sections → items

✅ **Smart Parsing**: Extracts data from rawXml fields for easier processing

## Requirements

Install required packages:
```bash
pip install requests python-dotenv
```

## Available Grade Levels

The dataset includes assessments for grades 3-12:

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

## Usage

### Test Mode (First 5 Tests)
```bash
python3 extract_qti_assessments.py
```
or
```bash
python3 extract_qti_assessments.py --limit 5
```

### Process Specific Number of Tests
```bash
python3 extract_qti_assessments.py --limit 10
```

### Process All Tests
```bash
python3 extract_qti_assessments.py --all
```

### Filter by Grade Level (3-12)
```bash
# Extract all Grade 3 assessments
python3 extract_qti_assessments.py --grade 3 --all

# Extract first 10 Grade 5 assessments
python3 extract_qti_assessments.py --grade 5 --limit 10

# Extract all Grade 9 assessments
python3 extract_qti_assessments.py --grade 9 --all
```

Output files are automatically named based on grade: `qti_grade_3_data.json`, `qti_grade_5_data.json`, etc.

### Custom Output File
```bash
python3 extract_qti_assessments.py --all --output my_data.json
```

### Resume After Interruption or Error

The extractor automatically resumes from where it left off:

```bash
# Start extraction
python3 extract_qti_assessments.py --grade 3 --all

# If interrupted (Ctrl+C) or error occurs, just run again
python3 extract_qti_assessments.py --grade 3 --all
# It will skip already-completed assessments and continue
```

**Benefits:**
- ✅ No need to re-fetch completed assessments
- ✅ Validates existing data before skipping
- ✅ Saves progress after each assessment
- ✅ Detailed logging to `extraction.log`
- ✅ State tracking in `extraction_state.json`

See [ERROR_HANDLING_GUIDE.md](ERROR_HANDLING_GUIDE.md) for detailed information.

## Output Structure

```json
{
  "metadata": {
    "total_tests": 5,
    "extraction_date": "2025-11-20 17:04:32",
    "api_base_url": "https://qti.alpha-1edtech.ai/api",
    "grade_filter": "3"
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
                  "prompt": "Aladdin's father worked as a",
                  "interaction_type": "choice",
                  "correct_answers": ["answer_600101"],
                  "choices": [
                    {
                      "identifier": "answer_600102",
                      "text": "baker",
                      "is_correct": false,
                      "feedback": "You may have chosen baker because..."
                    },
                    {
                      "identifier": "answer_600101",
                      "text": "tailor",
                      "is_correct": true,
                      "feedback": "You successfully identified..."
                    }
                  ],
                  "stimulus": {
                    "identifier": "guiding_21014",
                    "title": "Section 1",
                    "content_html": "<qti-stimulus-body>...",
                    "content_text": "There once was a poor boy named Aladdin...",
                    "metadata": {
                      "lexile_level": 692,
                      "course": "Core Knowledge Reading Grade 3/3"
                    }
                  }
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

## Data Extracted Per Item

For each assessment item, the script extracts:

1. **Basic Info**: identifier, title, type
2. **Question**: prompt text, interaction type (choice, text_entry, extended_text)
3. **Choices**: identifier, text, feedback, correctness indicator
4. **Correct Answers**: list of correct answer identifiers
5. **Stimulus** (if present):
   - Identifier and title
   - HTML content
   - Plain text content
   - Metadata (lexile level, course info, etc.)

## Test Results

✅ Successfully tested with first 5 assessment tests:
- **Tests processed**: 5
- **Total items extracted**: 41
- **File size**: 217 KB
- **All data fields captured**: ✓

## Notes

- The script includes rate limiting (0.1s between items, 0.5s between tests) to avoid overwhelming the API
- GET requests don't require authentication according to the API docs
- Both JSON `content` and `rawXml` fields are fetched, with primary parsing from rawXml
- Stimulus content is fetched separately when referenced by items

## Error Handling & Resume System

The extractor includes comprehensive error handling:

### Automatic Features
- **Resume capability**: Automatically skips already-completed assessments
- **Data validation**: Validates each assessment before marking complete
- **Progress checkpoints**: Saves progress every 10 assessments
- **Error recovery**: Stops gracefully on error, saves progress
- **Detailed logging**: All operations logged to `extraction.log`
- **State tracking**: Tracks completed/errored assessments in `extraction_state.json`

### Error Types Handled
- Network failures (timeout, connection refused)
- API errors (4xx, 5xx responses)
- XML parsing errors
- Data validation errors
- Missing required fields
- Keyboard interrupts (Ctrl+C)

### Files Created

| File | Purpose |
|------|---------|
| `qti_grade_X_data.json` | Extracted assessment data (your main output) |
| `extraction.log` | Detailed operation logs with timestamps |
| `extraction_state.json` | Tracks completed assessments and errors |

### Recovery Example

```bash
# Extraction fails at assessment #50
python3 extract_qti_assessments.py --grade 3 --all
# Error occurs, progress saved (49 completed)

# Run again - automatically resumes from assessment #50
python3 extract_qti_assessments.py --grade 3 --all
# Skips first 49, continues from #50

# Output shows:
# ✅ Success! (51 new, 49 skipped)
```

For complete details, see [ERROR_HANDLING_GUIDE.md](ERROR_HANDLING_GUIDE.md).

## Processing Time Estimate

Based on testing:
- ~5 items/second with API delays
- First 5 tests (41 items): ~20 seconds
- All ~50 tests: ~3-5 minutes (estimated)
