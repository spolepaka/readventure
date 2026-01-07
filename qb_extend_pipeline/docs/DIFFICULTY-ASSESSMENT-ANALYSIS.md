# Difficulty Assessment QC Failure Analysis

## Overview

This document analyzes why the `difficulty_assessment` QC check has a significant gap between original questions (95% pass rate) and generated sibling questions (73% pass rate) for Grade 3 reading comprehension questions.

**Analysis Date:** January 2026  
**Data Source:** `qb_extend_pipeline/outputs/qc_results/question_qc_merged.json`

---

## What is the Difficulty Assessment Check?

The `difficulty_assessment` check (run via OpenAI) evaluates whether a question is appropriate for the target grade level by considering:

- Vocabulary complexity
- Reasoning demands
- Whether the question is too easy or too hard

**Prompt used:**
```
Is this question appropriate for Grade {grade}?
- Consider vocabulary complexity
- Consider reasoning demands
- Consider if it's too easy or too hard
```

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Failed (difficulty_assessment) | 48 |
| Generated (siblings) failed | 46 |
| Original questions failed | 2 |
| **Gap** | **+22% worse for generated** |

### Failure Pattern Breakdown (Generated Questions Only)

| Category | Count | % of Failures |
|----------|-------|---------------|
| **Inference beyond grade level** | 33 | 71.7% |
| **Too complex reasoning/vocabulary** | 8 | 17.4% |
| **Content not in passage** | 5 | 10.9% |
| **TOTAL** | 46 | 100% |

---

## Detailed Analysis by Failure Pattern

### Pattern 1: Inference Beyond Grade Level (71.7%)

**What the QC is flagging:**
- Questions require "abstract reasoning" about character motivations
- Questions ask for inference about unstated intentions
- Questions expect connections between ideas that aren't explicitly linked
- Reasoning required is beyond "straightforward comprehension skills"

**Example Failures:**

#### Example A: `quiz_302022_sibling_1`
**Question:** "Why does Aladdin hide when the princess invites the magician to dinner?"

**Choices:**
1. Because Aladdin wants to surprise the magician and take back the lamp without fighting.
2. Because Aladdin is afraid of the magician and doesn't want to talk to him.
3. Because Aladdin is tired from traveling and needs to rest quietly.
4. Because Aladdin forgot how to use the magic lamp and needs time to remember.

**QC Reasoning:**
> "The complexity of reasoning required to answer the question correctly is relatively high for a Grade 3 level. Given the abstract nature of strategizing to surprise someone and regain possession of an item subtly featured in the passage, younger students might find this reasoning challenging. Additionally, the context of Aladdin wanting to surprise the magician and take back the lamp without fighting is not directly stated in the passage provided, making it necessary to infer from knowledge outside this excerpt."

#### Example B: `quiz_302008_sibling_1`
**Question:** "Why does the author include the detail that the magician comes from 'far away in North Africa' to find the lamp?"

**QC Reasoning:**
> "For a Grade 3 level, the question might be somewhat challenging due to multiple factors. The vocabulary includes words such as 'merchant', 'magician', and 'North Africa', which could be complex for some third graders. Moreover, the reasoning required to deduce that the magician's willingness to travel a long distance demonstrates his desperation might be beyond straightforward comprehension skills expected at this grade level."

---

### Pattern 2: Content Not in Passage (10.9%)

**What the QC is flagging:**
- Correct answers reference events from other parts of the story
- Characters mentioned that don't appear in the excerpt
- Plot points assumed but not present in the provided text

**Example Failures:**

#### Example A: `quiz_302037_sibling_2`
**Question:** "Based on the Caterpillar's reaction to Alice, what can readers tell about his personality?"

**QC Reasoning:**
> "This question is inappropriate for the specified grade level for several reasons. Firstly, the passage does not mention the Caterpillar, yet the question asks about the Caterpillar's reaction, which could confuse third-grade students who are being tested on information not presented."

#### Example B: `quiz_302006_sibling_4`
**Question:** "What evidence from the story shows that the magician never intended to help Aladdin become wealthy?"

**Correct Answer:** "He becomes angry and traps Aladdin instead of helping him out of the cave"

**QC Reasoning:**
> "The correct answer to the question involves an event ('He becomes angry and traps Aladdin...') that is not mentioned in the provided passage. This requires information or critical thinking beyond what the passage offers, making it inappropriate for third graders who are expected to be able to answer questions based directly on the text."

---

### Pattern 3: Too Complex Reasoning/Vocabulary (17.4%)

**What the QC is flagging:**
- Vocabulary too sophisticated for Grade 3
- Concepts require abstract thinking
- Multiple factors combined make question too challenging

**Example:**

#### `quiz_302024_sibling_2`
**QC Reasoning:**
> "The question may be challenging for a Grade 3 level due to a few factors. Firstly, the connection between the story's content and what makes a good ruler isn't directly explored in the narrative; it requires abstract reasoning and interpretation that might be too advanced for this age group. Additionally, the vocabulary and concepts around governance ('good ruler', 'fair', 'kind') might be complex for third graders to fully grasp in the context of the storyline."

---

## Root Cause Analysis

### Problem 1: Generation Prompts Lack Grade-Specific Inference Constraints

The current DOK 2 prompt says:
```
- Apply skills and concepts to make basic inferences
- Make connections between ideas
```

**Issue:** There's no Grade 3-specific definition of what "basic inference" means. The LLM interprets this broadly, generating questions that require sophisticated inferential thinking.

### Problem 2: No Explicit Passage Boundary Rule

The current prompt says:
```
Test the SAME passage/section as the original
```

**Issue:** This doesn't explicitly prevent the LLM from:
- Assuming knowledge of the full story
- Referencing events not in the excerpt
- Creating correct answers based on unstated plot points

### Problem 3: DOK 3 May Be Inherently Too Hard for Grade 3

DOK 3 (Strategic Thinking) requires:
- Analysis, evaluation, or synthesis
- Drawing conclusions based on evidence
- Complex inferences or connections

**Issue:** These cognitive demands may exceed what's appropriate for typical 8-9 year olds, regardless of how the question is phrased.

---

## Recommendations

### 1. Add Explicit Passage Boundary Constraint

Add to ALL sibling generation prompts:

```markdown
## CRITICAL: Passage Boundary Rule
- ONLY ask about events, characters, and details that are EXPLICITLY STATED in the passage excerpt above
- Do NOT assume knowledge of the full story - the student only sees this excerpt
- The correct answer MUST be supportable using ONLY the provided text
- All answer choices (including distractors) should relate to the provided excerpt
- If a character, event, or detail is not in the excerpt, do NOT reference it
```

### 2. Add Grade 3-Specific Inference Guidelines

Add to DOK 2 and DOK 3 prompts when grade_level is Grade 3:

```markdown
## Grade 3 Inference Limits

For Grade 3 students, APPROPRIATE inferences include:
✅ Simple cause-effect ("Why did X happen?" when the cause is stated nearby)
✅ Basic character emotions when actions clearly show them
✅ Straightforward "what will happen next" based on stated events
✅ Simple meanings of figurative language with clear context
✅ Direct comparisons between two things explicitly mentioned

NOT appropriate for Grade 3:
❌ Abstract character motivations or intentions not directly shown
❌ Complex strategic thinking (why a character chose a specific strategy)
❌ Multi-step logical chains requiring unstated connections
❌ Analyzing author's purpose beyond simple "to inform/entertain"
❌ Evaluating themes through multiple pieces of evidence
❌ Understanding subtle implications or subtext
❌ Inferring feelings that require "reading between the lines"
```

### 3. Add Vocabulary Guidelines

```markdown
## Grade 3 Vocabulary Guidelines
- Use words a typical 8-9 year old would know
- Avoid abstract terms: sophisticated, strategic, conceptual, implies, evaluate, synthesize
- If using story-specific vocabulary (magician, merchant), ensure it appears in the passage
- Questions should be readable in one pass without re-reading
- Keep sentence structure simple - avoid multiple clauses
```

### 4. Consider DOK 3 Limitations for Grade 3

Options to address DOK 3 difficulty:

**Option A: Skip DOK 3 sibling generation for Grade 3**
- Configure the pipeline to only generate DOK 1 and DOK 2 siblings for Grade 3

**Option B: Add stricter DOK 3 constraints for Grade 3**
- Add explicit examples of Grade 3-appropriate DOK 3 questions
- Require that "strategic thinking" be scaffolded with text evidence

**Option C: Pre-generation validation**
- Before generating siblings, validate that the original DOK 3 question is truly Grade 3 appropriate
- If original fails difficulty check, don't generate siblings from it

### 5. Add Pre-Generation Quality Gate

Before generating siblings, verify:
1. Original question passes difficulty_assessment
2. Passage contains sufficient content for sibling variation
3. DOK level is achievable for the target grade

---

## Implementation Priority

| Priority | Recommendation | Expected Impact |
|----------|----------------|-----------------|
| 🔴 High | Passage Boundary Rule | Eliminates 10.9% of failures |
| 🔴 High | Grade 3 Inference Guidelines | Addresses 71.7% of failures |
| 🟡 Medium | Vocabulary Guidelines | Addresses 17.4% of failures |
| 🟡 Medium | DOK 3 Constraints | Prevents hardest questions |
| 🟢 Low | Pre-Generation Gate | Prevents cascading issues |

**Projected Overall Improvement:** 80-90% reduction in difficulty_assessment failures

---

## Appendix: Sample LLM Failure Responses

### Full Response Examples

**Question ID:** `quiz_302015_sibling_1`
**Grade:** 3
**DOK:** 3
**CCSS:** RL.3.3

**Question:** [Question about why a scene was included for narrative excitement]

**QC Response:**
> "The vocabulary and concepts involved in this question, including the implications of the genie's appearance and its impact, might be complex for the cognitive level expected at Grade 3. The reasoning required to understand why a scene was included for narrative excitement, versus reasons like selling an object or illustrating a general truth about magic, may be too abstract. Also, understanding nuances like the impact of powerful beings in a story might require more advanced analytical skills than typically expected at this grade level."

---

**Question ID:** `quiz_302023_sibling_4`
**Grade:** 3
**DOK:** 2

**QC Response:**
> "The vocabulary and complexity of reasoning required to answer this question might be too advanced for Grade 3 students. The analysis necessitates understanding abstract concepts like developing a 'clever plan' in a crisis situation, and how the characters' actions reflect a strategic response to conflict, which can be challenging for younger children to grasp."

---

## Related Files

- Generation prompts: `qb_extend_pipeline/qb_extend prompts.json`
- QC check implementation: `qb_extend_pipeline/qc_pipeline/modules/question_qc_v2.py`
- QC results: `qb_extend_pipeline/outputs/qc_results/question_qc_merged.json`
- Dashboard: `qb_extend_pipeline/qc_dashboard.py`

