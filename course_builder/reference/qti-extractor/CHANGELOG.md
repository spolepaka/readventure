# QTI Extractor Changelog

## Version 2.0 - Grade-Level Filtering (November 20, 2025)

### 🎯 New Features

#### Grade-Level Filtering
- Added `--grade` argument to filter assessments by grade level (3-12)
- Automatic output file naming based on grade (e.g., `qti_grade_3_data.json`)
- Grade metadata included in JSON output
- Support for all grade levels:
  - **Grades 3-8**: Core Knowledge curriculum (97-134 assessments per grade)
  - **Grades 9-12**: High School Reading (131-233 assessments per grade)

#### Command-Line Interface Enhancements
```bash
# New command options
python3 extract_qti_assessments.py --grade 3 --all      # Extract all Grade 3
python3 extract_qti_assessments.py --grade 5 --limit 10 # Extract 10 from Grade 5
```

### 📝 Modified Files

#### `extract_qti_assessments.py`
- Added `extract_grade_from_course()` function to parse grade from course field
- Added `--grade` argument with validation (3-12)
- Implemented grade filtering in CSV processing
- Enhanced metadata to include `grade_filter` field
- Updated output filename logic to include grade number
- Added grade information to `csv_metadata` for each assessment

#### `dashboard.html`
- Added dropdown options for all grade-specific JSON files (Grades 3-12)
- Added "Grade Filter" field to metadata display
- Updated JavaScript to display grade filter in dashboard
- Improved file selection with descriptive labels

#### `QTI_EXTRACTOR_README.md`
- Added "Available Grade Levels" section with assessment counts
- Updated usage examples to include grade filtering
- Updated output structure documentation with grade metadata
- Enhanced features list to highlight grade-level filtering

### 📚 New Files Created

#### `GRADE_EXTRACTION_GUIDE.md`
- Quick reference guide for grade-level extraction
- Assessment counts and time estimates per grade
- Command examples for all grades
- Tips and best practices

#### `extract_all_grades.sh`
- Automated bash script to extract all grades (3-12)
- Progress tracking and time calculation
- File size reporting
- Error handling

### 📊 Dataset Information

**Total Assessments by Grade:**
| Grade | Count |
|-------|-------|
| 3     | 131   |
| 4     | 97    |
| 5     | 109   |
| 6     | 118   |
| 7     | 126   |
| 8     | 134   |
| 9     | 131   |
| 10    | 150   |
| 11    | 233   |
| 12    | 221   |
| **Total** | **1,450** |

### 🔧 Technical Details

#### Grade Parsing Logic
The extractor uses regex pattern matching to identify grade levels from the course field:
- Pattern: `Grade\s+(\d+)`
- Handles formats: "Core Knowledge Grade 3/3", "Grade 9 Reading", etc.
- Returns integer grade number or None if not found

#### Output Structure Changes
```json
{
  "metadata": {
    "grade_filter": 3,  // NEW: Grade filter applied
    ...
  },
  "assessments": [{
    "csv_metadata": {
      "grade": 3,  // NEW: Grade number extracted
      ...
    }
  }]
}
```

### ✅ Testing

Successfully tested with:
- Grade 3 filtering (131 assessments available)
- Grade 9 filtering (131 assessments available)
- Both Core Knowledge and High School Reading formats
- Output file naming verification
- Dashboard compatibility

### 🚀 Usage Examples

#### Extract Single Grade
```bash
# Test with 5 assessments
python3 extract_qti_assessments.py --grade 3 --limit 5

# Extract all for specific grade
python3 extract_qti_assessments.py --grade 3 --all
```

#### Extract All Grades
```bash
# Using the automated script
./extract_all_grades.sh

# Or manually for each grade
for grade in {3..12}; do
  python3 extract_qti_assessments.py --grade $grade --all
done
```

#### View in Dashboard
1. Start server: `python3 -m http.server 8000`
2. Open: `http://localhost:8000/dashboard.html`
3. Select grade from dropdown

### 📈 Performance

- **Processing speed**: ~5 items/second
- **Grade 3 (131 tests)**: ~5 minutes
- **Grade 11 (233 tests)**: ~9 minutes
- **All grades (1,450 tests)**: ~60 minutes
- **File sizes**: 5-15 MB per grade

### 🐛 Bug Fixes

None - this is a feature addition release.

### 🔜 Future Enhancements

Potential improvements for future versions:
- Parallel processing for faster extraction
- Progress bars for long-running extractions
- Export to other formats (CSV, Excel)
- Advanced filtering (by topic, difficulty, etc.)
- Caching to avoid re-fetching unchanged data

---

## Version 1.0 - Initial Release

### Features
- Complete data extraction from QTI API
- Nested JSON output structure
- Smart XML parsing
- Rate limiting
- Error handling
- Dashboard viewer with pagination


