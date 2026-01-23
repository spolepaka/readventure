# Grade-Level Extraction Quick Guide

## Overview

The QTI extractor now supports filtering assessments by grade level (3-12). Each grade's data is automatically saved to a separate JSON file with the grade in the filename.

## Quick Commands

### Extract All Assessments for a Single Grade

```bash
# Grade 3 (131 assessments) - estimated time: ~5 minutes
python3 extract_qti_assessments.py --grade 3 --all

# Grade 5 (109 assessments) - estimated time: ~4 minutes
python3 extract_qti_assessments.py --grade 5 --all

# Grade 9 (131 assessments) - estimated time: ~5 minutes
python3 extract_qti_assessments.py --grade 9 --all

# Grade 12 (221 assessments) - estimated time: ~8 minutes
python3 extract_qti_assessments.py --grade 12 --all
```

### Test Before Full Extraction

```bash
# Extract first 10 assessments from Grade 3
python3 extract_qti_assessments.py --grade 3 --limit 10

# Extract first 5 assessments from Grade 11
python3 extract_qti_assessments.py --grade 11 --limit 5
```

## Output Files

Files are automatically named based on grade:
- Grade 3 → `qti_grade_3_data.json`
- Grade 4 → `qti_grade_4_data.json`
- Grade 9 → `qti_grade_9_data.json`
- etc.

## Extract All Grades

To extract all assessments for all grades, you can use this bash script:

```bash
#!/bin/bash
# Extract all grades (3-12)

for grade in {3..12}
do
  echo "Extracting Grade $grade..."
  python3 extract_qti_assessments.py --grade $grade --all
  echo "Grade $grade complete!"
  echo "---"
done

echo "All grades extracted!"
```

Save as `extract_all_grades.sh`, make executable with `chmod +x extract_all_grades.sh`, then run with `./extract_all_grades.sh`

## Assessment Counts by Grade

| Grade | Count | Est. Time | Output File |
|-------|-------|-----------|-------------|
| 3 | 131 | ~5 min | qti_grade_3_data.json |
| 4 | 97 | ~4 min | qti_grade_4_data.json |
| 5 | 109 | ~4 min | qti_grade_5_data.json |
| 6 | 118 | ~5 min | qti_grade_6_data.json |
| 7 | 126 | ~5 min | qti_grade_7_data.json |
| 8 | 134 | ~5 min | qti_grade_8_data.json |
| 9 | 131 | ~5 min | qti_grade_9_data.json |
| 10 | 150 | ~6 min | qti_grade_10_data.json |
| 11 | 233 | ~9 min | qti_grade_11_data.json |
| 12 | 221 | ~8 min | qti_grade_12_data.json |
| **Total** | **1,450** | **~60 min** | 10 files |

## Data Structure

Each grade JSON file includes:

```json
{
  "metadata": {
    "total_tests": 131,
    "extraction_date": "2025-11-20 18:30:00",
    "api_base_url": "https://qti.alpha-1edtech.ai/api",
    "grade_filter": 3
  },
  "assessments": [
    {
      "identifier": "article_101001",
      "title": "Assessment Title",
      "csv_metadata": {
        "course": "Core Knowledge Grade 3/3",
        "title": "Assessment Title",
        "grade": 3
      },
      "test_parts": [...]
    }
  ]
}
```

## Viewing the Data

Use the dashboard to view extracted data:

1. Start the local server (if not already running):
   ```bash
   python3 -m http.server 8000
   ```

2. Open in browser: `http://localhost:8000/dashboard.html`

3. Select the grade-specific JSON file from the dropdown

## Tips

- **Start small**: Test with `--limit 10` first to verify everything works
- **Run overnight**: Extracting all grades takes about 1 hour
- **Check disk space**: Each grade file is approximately 5-15 MB
- **Rate limiting**: The script includes delays to avoid overwhelming the API


