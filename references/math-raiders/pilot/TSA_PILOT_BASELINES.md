# TSA Informal Pilot - Speed Score Baselines

**Baseline Period:** Nov 6-12, 2025  
**Post-Test Target:** ~Nov 20-22, 2025  
**Pilot Duration:** ~2 weeks of Math Raiders practice

---

## Student Baselines (Pre-Test Scores)

### Seth Anders (Grade 5)
**Baseline Date:** Nov 10, 2025  
**Track:** Division (fastmath-track5-l2-assessment)  
**Best Score:** 73/78 (94%) - **37.0 CQPM**  
**Script:** `bun scripts/timeback/checkAssessment.ts seth.anders@2hourlearning.com 2025-11-10`

**Notes:** Took 14 Division tests that day (21-37 CQPM range). Use best score (37 CQPM).

---

### Renee Parnell (Grade 2)
**Baseline Date:** Nov 10, 2025  
**Track:** Subtraction Single-Digit (fastmath-track10-assessment)  
**Score:** 39/40 (98%) - **20.0 CQPM**  
**Script:** `bun scripts/timeback/checkAssessment.ts renee.parnell@2hourlearning.com 2025-11-10`

**Notes:** Improved from Nov 7 (14 CQPM on same track). Use Nov 10 for more recent baseline.

---

### De'Marcus Collins (Grade 3)
**Baseline Date:** Nov 7, 2025  
**Track:** Addition (fastmath-track6-assessment)  
**Score:** 55/59 (93%) - **29.0 CQPM**  
**Script:** `bun scripts/timeback/checkAssessment.ts demarcus.collins@2hourlearning.com 2025-11-07`

**Notes:** Has Nov 11 test (5 CQPM) but clearly didn't try - use Nov 7 instead.

---

### Peini Jiang (Grade 4)
**Baseline Date:** Nov 12, 2025  
**Track:** Multiplication (fastmath-track7-assessment)  
**Score:** 40/47 (85%) - **20.0 CQPM**  
**Script:** `bun scripts/timeback/checkAssessment.ts peini.jiang@2hourlearning.com 2025-11-12`

**Notes:** Most recent test. Low engagement overall but has baseline.

---

### Xiaoheng Jiang (Grade 4)  
**Baseline Date:** Nov 6, 2025  
**Track:** Division (fastmath-track5-l2-assessment)  
**Score:** 62/67 (93%) - **31.0 CQPM**  
**Script:** `bun scripts/timeback/checkAssessment.ts xiaoheng.jiang@2hourlearning.com 2025-11-06`

**Notes:** Oldest baseline (7 days before others). Less aligned but acceptable.

---

## Post-Test Instructions

**When pilot ends (~Nov 20-22):**

```bash
# Run for each student to get post-test scores:
bun scripts/timeback/checkAssessment.ts seth.anders@2hourlearning.com 2025-11-22
bun scripts/timeback/checkAssessment.ts renee.parnell@2hourlearning.com 2025-11-22
bun scripts/timeback/checkAssessment.ts demarcus.collins@2hourlearning.com 2025-11-22
bun scripts/timeback/checkAssessment.ts peini.jiang@2hourlearning.com 2025-11-22
bun scripts/timeback/checkAssessment.ts xiaoheng.jiang@2hourlearning.com 2025-11-22
```

**Compare post-test CQPM to baselines above for improvement measurement.**

---

## Math Raiders Internal Metrics

**From your database (doesn't need TimeBack):**

```bash
# Get latest backup
./scripts/ops/backup.sh production

# Run analysis
cd pilot
./analyze_pilot.py ~/Desktop/MathRaiders-Backups/production/production_2025-11-22.sqlite

# Shows:
# - Facts mastered (internal tracking)
# - Engagement (minutes played)
# - Accuracy maintained
# - Response time improvement
```

**Use both Speed Score (external) AND Math Raiders metrics (internal) for complete picture.**

---

## Notes

- **Pagination fix applied:** Scripts now use `limit=1000&sort=scoreDate&orderBy=desc` to get recent results efficiently
- **All TSA student data accessible:** No TimeBack sync issues (was pagination bug in scripts)
- **For historical dates (pre-Sept):** May need to increase limit if student has >1000 results

