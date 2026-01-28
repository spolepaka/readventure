# Student Onboarding: Grade Resolution & Enrollment

> **Purpose**: How to determine a student's grade from TimeBack and enroll them in Math Raiders.

---

## Grade Resolution

Students' grades are determined from their **Speed Score** assessments in AlphaMath Fluency.

### How It Works

1. Fetch all assessment results for a student (limit=3000)
2. Filter for **Speed Scores** (assessments with both `cqpm` AND `grade` in metadata)
3. Sort by date descending (newest first)
4. Use the `grade` field from the most recent Speed Score

### API Call

```bash
GET https://api.alpha-1edtech.ai/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='<timebackId>'&limit=3000&sort=scoreDate&orderBy=desc
```

### Speed Score Identification

Speed Scores have BOTH fields in metadata:
```json
{
  "metadata": {
    "cqpm": 42,      // Correct Questions Per Minute
    "grade": 3       // Student's grade level
  }
}
```

Other assessments (fluency checks, progress tests) may have `cqpm` but NOT `grade`.

### Implementation (from worker)

```typescript
async function fetchGradeFromTimeBack(timebackId: string): Promise<number | null> {
  const url = `${API}/assessmentResults?filter=student.sourcedId='${timebackId}'&limit=3000&sort=scoreDate&orderBy=desc`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  
  const data = await response.json();
  
  // Filter for Speed Scores (has BOTH cqpm AND grade)
  const speedScores = (data.assessmentResults || []).filter(r => 
    r.metadata?.cqpm !== undefined &&
    r.metadata?.grade !== undefined
  );
  
  if (speedScores.length === 0) {
    return 3;  // Default grade if no Speed Scores
  }
  
  // Client-side sort as backup (server should already be sorted)
  speedScores.sort((a, b) => {
    const dateA = new Date(a.scoreDate || a.dateLastModified || 0).getTime();
    const dateB = new Date(b.scoreDate || b.dateLastModified || 0).getTime();
    return dateB - dateA;
  });
  
  // Get grade from most recent Speed Score
  const raw = speedScores[0].metadata.grade;
  const grade = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  
  return (!isNaN(grade) && grade >= 0 && grade <= 5) ? grade : 3;
}
```

### Key Learnings

1. **Server-side sorting**: Use `&sort=scoreDate&orderBy=desc` for students with 3000+ assessments
2. **Client-side backup**: Always sort client-side too in case server sort fails
3. **Speed Score filter**: Must have BOTH `cqpm` AND `grade` - other assessments only have `cqpm`
4. **Default grade**: Return 3 if no Speed Scores found (middle grade, safe default)

### Example Results (Dec 2024 Pilot)

| Student | Grade | Speed Scores |
|---------|-------|--------------|
| Emma Schipper | 1 | 61 |
| Geraldine Gurrola | 1 | 66 |
| Sebastian Holzhauer | 1 | 52 |
| Everett Mroczkowski | 2 | 55 |
| Hawk Henson | 2 | 56 |
| Analea Lopez | 2 | 59 |
| Octavia Gieskes | 2 | 68 |
| Nova Victore | 2 | 50 |
| Wyatt Victore | 2 | 44 |
| Landen Goikhman | 3 | 32 |
| Jimmy Moore | 3 | 59 |
| Oslo Singer | 2 | 65 |
| Ren Sticker | 2 | 67 |

---

## Overview

Students need to be enrolled in Math Raiders **classes** (not courses) to receive XP credits in TimeBack. Without enrollment, TimeBack rejects Caliper events.

## Key Concepts

### Courses vs Classes

- **Course**: The curriculum definition (e.g., `math-raiders-grade-3`)
- **Class**: A section/instance of a course that students enroll in (e.g., `Math Raiders Grade 3 Class`)

Enrollments are created on **classes**, not courses.

## API Reference

### Authentication

```bash
curl -X POST https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>"
```

### Find User by Email

```bash
GET https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/users?filter=email='user@school.com'
```

**Note**: Email filter is case-sensitive. Nova Academy emails use lowercase.

### Get Available Classes

```bash
GET https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/classes?filter=title~'Math Raiders'
```

### Create Enrollment

```bash
POST https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/enrollments/
Content-Type: application/json

{
  "enrollment": {
    "sourcedId": "mr-enroll-<userId>-g<grade>",
    "status": "active",
    "role": "student",
    "user": { "sourcedId": "<user-timeback-id>" },
    "class": { "sourcedId": "<class-id>" }
  }
}
```

## Current Class IDs

| Grade | Class ID | Title |
|-------|----------|-------|
| K | `a747e46c-db9d-43de-a586-44b4cc17e003` | Math Raiders Grade K Class |
| 1 | `d7f70171-ad42-4cc9-9ebb-59c210bc6604` | Math Raiders Grade 1 Class |
| 2 | `db8df2b3-70d5-42b6-a5cd-15ec27031f4c` | Math Raiders Grade 2 Class |
| 3 | `f0dc89af-4867-47ea-86d5-5cf7124afd1c` | Math Raiders Grade 3 Class |
| 4 | `46c143a7-83eb-4362-921f-8afea732bcda` | Math Raiders Grade 4 Class |
| 5 | `fa2ca870-b475-44fe-9dc1-9f94dba5cb93` | Math Raiders Grade 5 Class |

> **Note**: Multiple classes exist per grade. Use these as the "default" class for each grade.

## Auto-Enrollment Flow (Future)

When implementing auto-enrollment:

1. **On first login**: After JWT verification, check if user has Math Raiders enrollment
2. **Determine grade**: Call `fetchGradeFromTimeBack()` to get grade from Speed Scores
3. **Check existing enrollment**: 
   ```
   GET /enrollments?filter=user.sourcedId='<userId>' AND class.title~'Math Raiders'
   ```
4. **Create if missing**: POST new enrollment to appropriate grade class
5. **Handle grade changes**: If student's grade changed, consider updating enrollment

### Pseudocode

```typescript
async function ensureEnrollment(timebackId: string, grade: number) {
  const token = await getToken();
  
  // Check existing enrollments
  const enrollments = await fetch(
    `${API}/enrollments?filter=user.sourcedId='${timebackId}'&limit=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  
  const hasMathRaiders = enrollments.enrollments?.some(e => 
    e.class?.sourcedId?.includes('math-raiders') ||
    e.class?.title?.includes('Math Raiders')
  );
  
  if (hasMathRaiders) {
    console.log('Already enrolled');
    return;
  }
  
  // Create enrollment
  const classIds = {
    1: 'd7f70171-ad42-4cc9-9ebb-59c210bc6604',
    2: 'db8df2b3-70d5-42b6-a5cd-15ec27031f4c',
    3: 'f0dc89af-4867-47ea-86d5-5cf7124afd1c',
    4: '46c143a7-83eb-4362-921f-8afea732bcda',
    5: 'fa2ca870-b475-44fe-9dc1-9f94dba5cb93',
  };
  
  await fetch(`${API}/enrollments/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      enrollment: {
        sourcedId: `mr-enroll-${timebackId}-g${grade}`,
        status: 'active',
        role: 'student',
        user: { sourcedId: timebackId },
        class: { sourcedId: classIds[grade] }
      }
    })
  });
}
```

## Troubleshooting

### HTTP 500 on enrollment
- Enrollments go on **classes**, not courses
- Check class ID exists and is valid

### User not found
- Email filter is case-sensitive
- Try lowercase for Nova Academy emails

### Enrollment exists but XP not showing
- Check enrollment status is `active`
- Verify the class is linked to the correct course
- Check Caliper event has matching course ID in `object.course.id`

## Related Scripts

- `scripts/timeback/checkEnrollments.ts` - Check user's enrollments
- `scripts/timeback/checkTSAEnrollments.ts` - Check pilot students
- `scripts/timeback/batchLookupStudents.ts` - Lookup multiple students
