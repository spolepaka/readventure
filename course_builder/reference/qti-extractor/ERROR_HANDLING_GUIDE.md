# Error Handling & Resume System Guide

## Overview

The QTI Extractor now includes a robust error handling and resume system that:
- **Logs everything** to a file with timestamps
- **Tracks extraction state** to resume from where it left off
- **Validates data** before saving
- **Stops gracefully** on errors and saves progress
- **Resumes automatically** by skipping already-completed assessments

## Key Features

### 1. Structured Logging

All operations are logged to `extraction.log` with:
- Timestamps
- Log levels (DEBUG, INFO, WARNING, ERROR)
- Detailed error messages
- Progress tracking

**Example log entry:**
```
2025-11-20 18:09:23 | INFO     | ✅ Completed: article_101001
2025-11-20 18:09:23 | DEBUG    | State saved: 4 completed, 0 errors
```

### 2. State Tracking

The `extraction_state.json` file tracks:
- **Completed assessments**: List of successfully extracted article IDs
- **Errors**: Map of article IDs to error messages
- **Last updated**: Timestamp of last state update

**Example state file:**
```json
{
  "completed": [
    "article_101001",
    "article_101002",
    "article_101003"
  ],
  "errors": {
    "article_101050": "Network error: Connection timeout"
  },
  "last_updated": "2025-11-20T18:09:30.312311"
}
```

### 3. JSON Validation

Before marking an assessment as complete, the system validates:
- Required fields exist (identifier, title, test_parts)
- No error fields in the data
- Test parts contain sections
- Sections contain items
- Items have valid data (no errors, has identifier)

### 4. Automatic Resume

When you run the script again:
1. Loads existing JSON file (if exists)
2. Validates each assessment
3. Skips assessments that are already complete and valid
4. Only fetches new/missing assessments

**Resume Output:**
```
Found existing file with 4 assessments
Loaded 4 valid assessments from existing file
🔄 Resume mode: Found 4 already completed assessments

[1/10] Assessment Title
   Article ID: article_101001
   ⏭️  Already completed - skipping
```

### 5. Error Recovery

When an error occurs:
1. **Logs the error** with full details
2. **Saves current progress** to JSON file
3. **Updates state file** with error information
4. **Stops execution** gracefully
5. **Displays summary** of what was completed

**Error Output:**
```
❌ ERROR: Network error fetching test article_101050: Connection timeout

💾 Saving progress before stopping...

============================================================
EXTRACTION STOPPED DUE TO ERROR
============================================================
Failed on: article_101050 - Assessment Title
Error: Network error fetching test article_101050: Connection timeout

Progress saved to: qti_grade_3_data.json
State saved to: extraction_state.json

Statistics:
  • New assessments fetched: 25
  • Assessments skipped (already done): 20
  • Total completed: 45
  • Total errors: 1

To resume, run the same command again.
============================================================
```

## Usage Examples

### Normal Extraction

```bash
# Start extracting Grade 3 assessments
python3 extract_qti_assessments.py --grade 3 --all
```

If it stops due to an error, simply run the **exact same command** again:

```bash
# Resume from where it left off
python3 extract_qti_assessments.py --grade 3 --all
```

### Expanding Your Extraction

Start with a small batch, then expand:

```bash
# Test with first 5
python3 extract_qti_assessments.py --grade 3 --limit 5

# Expand to 20 (will skip the first 5)
python3 extract_qti_assessments.py --grade 3 --limit 20

# Extract all (will skip the first 20)
python3 extract_qti_assessments.py --grade 3 --all
```

### Handling Interruptions

Press `Ctrl+C` to interrupt:
```
⚠️  Interrupted by user (Ctrl+C)
💾 Saving progress...

Progress saved. Run the command again to resume.
```

Resume by running the same command.

## File Management

### Files Created

| File | Purpose | When to Keep | When to Delete |
|------|---------|-------------|----------------|
| `qti_grade_X_data.json` | Extracted assessment data | Always | Never (your data!) |
| `extraction_state.json` | Tracks progress | During extraction | After successful completion |
| `extraction.log` | Detailed logs | For debugging | When too large or after success |

### Cleaning Up After Successful Extraction

```bash
# Optional: Remove state and log files after successful completion
rm extraction_state.json extraction.log
```

### Starting Fresh

To start over from scratch for a specific grade:

```bash
# Delete the output file, state, and log
rm qti_grade_3_data.json extraction_state.json extraction.log

# Run extraction again
python3 extract_qti_assessments.py --grade 3 --all
```

## Validation Details

### Assessment Validation Checks

1. **Structure checks:**
   - Assessment object is not empty
   - No "error" field present
   - Required fields exist: identifier, title, test_parts

2. **Content checks:**
   - Test parts array is not empty
   - Each test part has sections
   - Each section has items array

3. **Item checks:**
   - Each item has an identifier
   - No "error" field in items
   - Item data is complete

### JSON File Validation

When resuming, the system validates the JSON file:
- File exists and is readable
- Valid JSON syntax
- Has "metadata" and "assessments" keys
- Assessments is an array

If validation fails:
- Warning is logged
- Extraction starts fresh
- No data is lost (corrupted file is not overwritten)

## Progress Tracking

### During Extraction

Progress is saved:
- **After each successful assessment** (state file updated)
- **Every 10 assessments** (JSON file checkpoint)
- **On error** (both files saved)
- **On interruption** (Ctrl+C - both files saved)
- **On completion** (final save of both files)

### Progress Indicators

Console output shows:
```
[15/100] Assessment Title
   Article ID: article_101015
   ✅ Success! (15 new, 0 skipped)
```

- **15 new**: Successfully fetched in this session
- **0 skipped**: Already completed from previous sessions

## Troubleshooting

### Issue: Script keeps failing on the same assessment

**Solution:** Check the error in the log file:
```bash
tail -50 extraction.log
```

The error might be:
- **Network issue**: Wait and try again
- **API issue**: The specific assessment might have problems
- **Data issue**: Report to API maintainers

### Issue: Want to retry a failed assessment

**Solution:** Remove it from errors in state file:

1. Open `extraction_state.json`
2. Remove the article ID from the "errors" object
3. Run the extraction again

Or use this command:
```bash
# Edit state file to remove error for article_101050
python3 -c "import json; f=open('extraction_state.json','r+'); d=json.load(f); d['errors'].pop('article_101050', None); f.seek(0); json.dump(d,f,indent=2); f.truncate()"
```

### Issue: Validation says assessment is invalid but it looks okay

**Solution:** Check detailed validation error:
```bash
# Look for validation errors in log
grep "Invalid:" extraction.log
```

Fix manually if needed or report the issue.

### Issue: Want to see all errors

```bash
# View all error entries in log
grep "ERROR" extraction.log

# Or check the state file
cat extraction_state.json | python3 -m json.tool
```

## Best Practices

### 1. Start Small, Then Scale

```bash
# Day 1: Test with 10
python3 extract_qti_assessments.py --grade 3 --limit 10

# Verify data looks good, then scale up
python3 extract_qti_assessments.py --grade 3 --all
```

### 2. Monitor Long-Running Extractions

```bash
# In one terminal, run extraction
python3 extract_qti_assessments.py --grade 11 --all

# In another terminal, monitor progress
watch -n 10 'tail -20 extraction.log'
```

### 3. Extract Overnight

```bash
# Extract all grades overnight with logging
nohup ./extract_all_grades.sh > overnight_extraction.log 2>&1 &

# Check progress in the morning
tail -100 overnight_extraction.log
```

### 4. Keep Backups of Large Extractions

```bash
# After successful extraction, backup the data
cp qti_grade_11_data.json qti_grade_11_data.backup.json
```

## Summary Statistics

After each run, you'll see:

```
✅ Complete! Extraction Summary:
============================================================
   • Grade filter: 3
   • New assessments fetched: 25        ← Fetched this session
   • Assessments skipped (already done): 80   ← From previous sessions
   • Total assessments in file: 105    ← Total in output file
   • Total items extracted: 840        ← Questions/items
   • Errors encountered: 2             ← Failed assessments
   • Output file: qti_grade_3_data.json
   • File size: 5.2 MB
   • Log file: extraction.log
============================================================
```

## Error Types

Common errors you might encounter:

| Error Type | Cause | Solution |
|------------|-------|----------|
| Network timeout | API slow/unreachable | Wait and retry |
| Connection refused | API down | Wait longer, retry |
| JSON decode error | Invalid API response | Report to API team |
| Validation failed | Incomplete data | Check specific error in log |
| Permission denied | File system issue | Check file permissions |

## Advanced: Manual State Management

### View Current State

```bash
cat extraction_state.json | python3 -m json.tool
```

### Count Completed

```bash
python3 -c "import json; print(len(json.load(open('extraction_state.json'))['completed']))"
```

### List Errors

```bash
python3 -c "import json; errors=json.load(open('extraction_state.json'))['errors']; [print(f'{k}: {v}') for k,v in errors.items()]"
```

### Reset State

```bash
# Start completely fresh
rm extraction_state.json
```

## Support

If you encounter persistent issues:

1. Check `extraction.log` for detailed errors
2. Verify `extraction_state.json` content
3. Validate the output JSON file structure
4. Try extracting a single assessment to isolate the issue
5. Report the issue with log excerpts

---

**Remember:** You can always resume by running the same command again. The system is designed to be resilient and pick up where it left off!


