# QTI Extractor - Quick Start Guide

## Installation

```bash
pip3 install requests python-dotenv
```

## Basic Usage

### Extract a Few Assessments (Test Mode)

```bash
# Test with first 5 assessments
python3 extract_qti_assessments.py --limit 5

# Test Grade 3 with 10 assessments
python3 extract_qti_assessments.py --grade 3 --limit 10
```

### Extract a Full Grade

```bash
# Extract all Grade 3 assessments (~5 minutes, 131 assessments)
python3 extract_qti_assessments.py --grade 3 --all

# Extract all Grade 9 assessments (~5 minutes, 131 assessments)
python3 extract_qti_assessments.py --grade 9 --all
```

### Extract All Grades

```bash
# Extract all grades 3-12 (~60 minutes, 1,450 assessments)
./extract_all_grades.sh
```

## If Something Goes Wrong

**The script stops with an error?**
→ Just run the **exact same command** again!

```bash
python3 extract_qti_assessments.py --grade 3 --all
# Error occurs at assessment #50

# Run again - it will skip the first 49 and continue
python3 extract_qti_assessments.py --grade 3 --all
```

**Interrupted with Ctrl+C?**
→ Same thing - run the command again to resume!

**Want to start fresh?**
```bash
rm qti_grade_3_data.json extraction_state.json extraction.log
python3 extract_qti_assessments.py --grade 3 --all
```

## View Your Data

1. **Start the viewer:**
   ```bash
   python3 -m http.server 8000
   ```

2. **Open in browser:**
   ```
   http://localhost:8000/dashboard.html
   ```

3. **Select grade from dropdown**

## Files You'll See

| File | What It Is |
|------|------------|
| `qti_grade_3_data.json` | 📊 Your extracted data (this is what you want!) |
| `extraction.log` | 📝 Detailed logs (for debugging) |
| `extraction_state.json` | 💾 Resume info (tracks progress) |

## Common Commands

```bash
# Start small, then expand
python3 extract_qti_assessments.py --grade 3 --limit 10
python3 extract_qti_assessments.py --grade 3 --limit 50
python3 extract_qti_assessments.py --grade 3 --all

# Check what was completed
python3 -c "import json; print(len(json.load(open('extraction_state.json'))['completed']))"

# View recent errors
tail -50 extraction.log | grep ERROR

# Clean up after successful extraction
rm extraction_state.json extraction.log
```

## Available Grades

| Grade | Assessments | Time Estimate |
|-------|-------------|---------------|
| 3-8   | 97-134 each | ~4-5 min each |
| 9-12  | 131-233 each| ~5-9 min each |
| **All** | **1,450 total** | **~60 min** |

## Need Help?

- **Usage details**: See [QTI_EXTRACTOR_README.md](QTI_EXTRACTOR_README.md)
- **Error handling**: See [ERROR_HANDLING_GUIDE.md](ERROR_HANDLING_GUIDE.md)
- **Grade extraction**: See [GRADE_EXTRACTION_GUIDE.md](GRADE_EXTRACTION_GUIDE.md)

---

**That's it!** The system handles resume, validation, and errors automatically. 🎉


