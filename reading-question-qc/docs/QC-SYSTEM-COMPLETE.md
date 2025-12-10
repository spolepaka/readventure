# Quality Control (QC) System - Complete Documentation

A comprehensive guide to the QC system for reading comprehension question validation.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [QC Checks Reference](#qc-checks-reference)
   - [Distractor Checks](#distractor-checks)
   - [Question Checks](#question-checks)
5. [Exact Prompts](#exact-prompts)
6. [Response Parsing](#response-parsing)
7. [Scoring System](#scoring-system)
8. [Explanation QC](#explanation-qc)
9. [How to Recreate](#how-to-recreate)
10. [Quick Reference](#quick-reference)

---

## Overview

The QC system has **two implementations**:

| Implementation | File | When Used |
|----------------|------|-----------|
| **Inline QC** | `bulk_question_generator.py` | During question generation (immediate feedback) |
| **Pipeline QC** | `qc_pipeline/pipeline.py` | Standalone evaluation of existing questions |

Both use the same fundamental checks but the Pipeline QC has additional features (OpenAI integration, difficulty assessment, explanation QC).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              QC SYSTEM ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────┐    ┌─────────────────────────────────────┐  │
│  │   INLINE QC (Generation)      │    │   PIPELINE QC (Standalone)          │  │
│  │   bulk_question_generator.py  │    │   qc_pipeline/                       │  │
│  │                               │    │                                     │  │
│  │   • 8 checks                  │    │   • 10-11 Question checks           │  │
│  │   • Claude only               │    │   • 9-12 Explanation checks         │  │
│  │   • Runs during generation    │    │   • Claude + OpenAI                 │  │
│  │   • ck_gen - prompts.json     │    │   • config/prompts.json             │  │
│  └───────────────────────────────┘    └─────────────────────────────────────┘  │
│                                                                                 │
│  Both share common checks:                                                      │
│  • grammatical_parallel          • clarity_precision                           │
│  • plausibility                  • single_correct_answer                       │
│  • homogeneity                   • passage_reference                           │
│  • specificity_balance           • length_check (local, no API)               │
│                                                                                 │
│  Pipeline QC adds:                                                              │
│  • too_close (OpenAI)            • difficulty_assessment (OpenAI + benchmarks) │
│  • standard_alignment            • Explanation QC (12 checks)                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
reading-question-qc/
├── bulk_question_generator.py     # Inline QC during generation
├── ck_gen - prompts.json          # Prompts for generation + inline QC
├── qc_pipeline/
│   ├── pipeline.py                # Main QC orchestrator
│   ├── config/
│   │   └── prompts.json           # QC-specific prompts
│   ├── modules/
│   │   ├── question_qc.py         # Question QC analyzer
│   │   └── explanation_qc.py      # Explanation QC analyzer
│   └── utils.py                   # Shared utilities
└── docs/
    └── QC-SYSTEM-COMPLETE.md      # This file
```

---

## Requirements

### Environment Variables

```bash
# Required for both implementations
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Required for Pipeline QC (optional for Inline QC)
OPENAI_API_KEY=sk-your-openai-key-here
```

### Python Dependencies

```bash
pip install pandas anthropic openai python-dotenv
```

### Input Data Format

**For Inline QC** (used during generation):
- The generated question's `structured_content` field containing:
  - `question`: The question text
  - `choices`: `{A, B, C, D}` with answer texts
  - `correct_answer`: Letter of correct choice

**For Pipeline QC** (standalone):

```csv
question_id,question,passage,option_1,option_2,option_3,option_4,correct_answer,grade,CCSS,CCSS_description,DOK
Q1,"What is...",Passage text...,Choice A,Choice B,Choice C,Choice D,A,3,RL.3.1,"Standard desc",2
```

---

## QC Checks Reference

### Distractor Checks

| Check | Purpose | API | Required |
|-------|---------|-----|----------|
| `grammatical_parallel` | Verify consistent grammatical structure | Claude | Yes |
| `plausibility` | Verify believable distractors | Claude | Yes |
| `homogeneity` | Verify same conceptual category | Claude | Yes |
| `specificity_balance` | Verify similar detail levels | Claude | Yes |
| `too_close` | Detect semantically similar options | OpenAI | Pipeline only |
| `length_check` | Verify balanced word counts | Local | Yes |

### Question Checks

| Check | Purpose | API | Required |
|-------|---------|-----|----------|
| `standard_alignment` | Verify assesses target CCSS standard | Claude | Pipeline only |
| `clarity_precision` | Verify clear, unambiguous wording | Claude | Yes |
| `single_correct_answer` | Verify exactly one correct answer | Claude | Yes |
| `passage_reference` | Verify accurate structural references | Claude | Yes |
| `difficulty_assessment` | Verify grade-appropriate difficulty | OpenAI | Pipeline + benchmarks |

---

## Exact Prompts

### Distractor Check Prompts

#### 1. grammatical_parallel

**Purpose**: Verify all answer choices follow the same grammatical pattern

```
You are evaluating whether answer choices have consistent grammatical structure.
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Task: Determine if all choices follow the same grammatical pattern.
Examples of GOOD parallelism:
All infinitive phrases: "to make", "to carry", "to take", "to hold"
All single words: "happy", "sad", "angry", "excited"
All noun phrases: "the main character", "the setting", "the conflict", "the theme"
All complete sentences: "He was tired.", "He was hungry.", "He was lost.", "He was scared."
Examples of BAD parallelism:
Mixed structures: "to make", "carrying", "he takes", "holds it"
Mixed lengths: "run", "walking quickly", "to jump over the fence", "swimming"
IMPORTANT: Your goal is to fail questions that are unfair due to the grammatical structure of their options. Minor variations are to be accepted as long as they do not provide an unfair advantage or disadvantage.

Instructions:
Evaluate ONLY grammatical consistency. Return exactly one number:
1 if all choices follow the same grammatical pattern
0 if choices have inconsistent grammatical structures
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 2. plausibility

**Purpose**: Verify incorrect choices are believable distractors

```
You are evaluating whether incorrect answer choices are plausible distractors.
Passage: {passage}
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Correct Answer: {correct_answer}
Task: Evaluate if each INCORRECT choice is a believable wrong answer.
GOOD distractors:
Represent common misconceptions
Are logically related to the question
Could reasonably fool a student who partially understands
BAD distractors:
Are obviously wrong to any reasonable student
Are completely unrelated to the question topic
Are "throwaway" options with no educational value
Instructions:
Consider only the incorrect choices. Return exactly one number:
1 if all incorrect choices are plausible distractors
0 if any incorrect choice is obviously wrong or unrelated
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 3. homogeneity

**Purpose**: Verify all choices belong to the same conceptual category

```
You are evaluating whether all answer choices belong to the same conceptual category.
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Task: Determine if all choices address the same type of concept.
GOOD homogeneity examples:
Word meaning question → All choices are possible definitions
Character motivation question → All choices are possible motivations
Text structure question → All choices are structural elements
Main idea question → All choices are potential main ideas
BAD homogeneity examples:
Word meaning question → Mix of definitions and plot events
Character question → Mix of character traits and setting details
Main idea question → Mix of themes and specific facts
Instructions:
Return exactly one number:
1 if all choices belong to the same conceptual category
0 if choices span different conceptual categories
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 4. specificity_balance

**Purpose**: Verify choices have similar levels of detail

```
You are evaluating whether answer choices have similar levels of detail and specificity.
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Task: Determine if choices are at similar specificity levels.
GOOD specificity balance:
All general: "happy", "sad", "angry", "worried"
All specific: "photosynthesis", "respiration", "transpiration", "germination"
All at same detail level: "ran quickly", "walked slowly", "jumped high", "crawled carefully"
BAD specificity balance:
Mixed levels: "sad" vs "experiencing deep melancholy" vs "blue"
One outlier: Three simple words + one complex phrase
Technical vs casual: "H2O" vs "water" vs "liquid" vs "beverage"
Instructions:
Return exactly one number:
1 if all choices are at similar levels of specificity/detail
0 if there are significant differences in specificity levels
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 5. too_close (Pipeline QC only)

**Purpose**: Identify distractors semantically too similar to correct answer

```
You are an expert in semantic analysis of educational questions. Your task is to identify questions where one or more distractors (incorrect options) are **too close** to the correct answer, making the question unfair or ambiguous.

A distractor is **TOO CLOSE** if:
1. **Synonymous or Near-Synonymous**: Uses different wording but conveys essentially the same meaning
2. **Degree-Only Difference**: Differs only in degree/intensity when the passage doesn't clearly establish the distinction
3. **Equally Text-Supported**: Both correct answer and distractor are equally supported by passage evidence
4. **Double-Key Risk**: Two options could both be considered correct based on reasonable interpretation
5. **Grade-Inappropriate Distinction**: The distinction requires knowledge beyond the target grade level

Analyze the question carefully and output **ONLY** valid JSON following this schema:
{
  "too_close": true,
  "problematic_options": ["A", "C"],
  "explanation": "Options A and C are both synonymous and equally supported by lines 4-6.",
  "notes": "Grade 4 students cannot distinguish between 'elated' and 'thrilled'."
}

Target Grade: {grade}

Passage:
{passage}

Question:
{question}

Options:
A) {option_a}
B) {option_b}
C) {option_c}
D) {option_d}

Correct Answer (letter): {correct_letter}

Task:
Identify whether ANY distractor(s) are TOO-CLOSE by the rubric. Return ONLY the JSON per schema.
```

**Response Format**: JSON  
**API**: OpenAI (GPT-4)

---

#### 6. length_check (Local, no API)

**Purpose**: Verify answer choice lengths are balanced

**Logic** (Python):

```python
def _run_length_check(self, question_data: Dict) -> Tuple[int, str]:
    choices = question_data.get('choices', {})
    correct_answer = question_data.get('correct_answer', '')
    
    # Get word counts
    word_counts = [len(text.split()) for text in choices.values()]
    correct_word_count = len(choices[correct_answer].split())
    
    # Rule 1: All choices <= 3 words is acceptable
    if all(count <= 3 for count in word_counts):
        return 1, "All choices are 3 words or less"
    
    distractor_counts = [len(choices[key].split()) for key in choices if key != correct_answer]
    longest_distractor = max(distractor_counts)
    shortest_distractor = min(distractor_counts)
    
    # Rule 2: Correct answer cannot be >10% longer than longest distractor
    if correct_word_count > 1.1 * longest_distractor:
        return 0, f"Correct answer ({correct_word_count} words) too long"
    
    # Rule 3: Shortest distractor cannot be >10% longer than correct answer
    if shortest_distractor > 1.1 * correct_word_count:
        return 0, f"Shortest distractor ({shortest_distractor} words) too long"
    
    return 1, "Choice lengths are balanced"
```

**API**: None (runs locally)

---

### Question Check Prompts

#### 7. standard_alignment

**Purpose**: Verify question assesses the assigned CCSS standard

```
You are evaluating whether this question properly assesses the assigned learning standard.
Passage: {passage}
Question: {question}
Standard: {standard_code} - {standard_description}
DOK Level: {dok}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Common Standards (Examples):
RI.3.1: Ask and answer questions to demonstrate understanding, referring explicitly to text
RI.3.2: Determine the main idea; recount key details
RI.3.4: Determine meaning of words/phrases in text
RL.3.1: Ask and answer questions about key details
RL.3.3: Describe characters and explain how their actions contribute to story events
Task: Determine if this question directly assesses the assigned standard.
Instructions:
Compare what the question is testing against what the standard requires. The question must directly assess the standard's specific skill, not a tangentially related skill.
Return exactly one number:
1 if the question directly and appropriately assesses the assigned standard
0 if the question assesses a different skill or misaligns with the standard
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 8. clarity_precision

**Purpose**: Verify question is clear and unambiguous

```
You are evaluating whether this question is clearly written and unambiguous.
Passage: {passage}
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Clarity Issues to Check:
Ambiguous pronouns (unclear "it", "this", "that", "they")
Double negatives
Overly complex sentence structure
Vague or imprecise language
Multiple possible interpretations
Unnecessary wordiness
Task: Determine if the question is clear and precise.
Instructions:
Evaluate whether a student would understand exactly what is being asked. The question should have one clear interpretation and be written at appropriate complexity for the grade level.
Return exactly one number:
1 if the question is clear, precise, and unambiguous
0 if the question has clarity issues that could confuse students
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 9. single_correct_answer

**Purpose**: Verify exactly one defensible correct answer exists

```
You are validating that this multiple choice question has exactly one defensibly correct answer.
Question: {question}
Passage: {passage}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Indicated Correct Answer: {correct_answer}
Task: Verify there is exactly one correct answer that can be defended based on the passage.
Red Flags:
Multiple answers could be argued as correct
Correct answer requires unsupported inferences
Question asks for opinions as if they were facts
Passage contradicts itself on the topic
Instructions:
Based on the passage, determine if exactly one answer is clearly correct and the others are clearly incorrect.
Return exactly one number:
1 if there is exactly one defensibly correct answer
0 if multiple answers could be correct or no answer is clearly correct
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 10. passage_reference

**Purpose**: Verify specific passage references are accurate

```
You are verifying that specific passage references in the question are accurate and exist.
Question: {question}
Passage: {passage}
Task: Verify that any specific references to passage elements are accurate.
Types of References to Check:
Paragraph numbers (e.g., "In paragraph 3...")
Line numbers (e.g., "Line 15 shows...")
Section titles (e.g., "The section titled 'Getting Started'...")
Specific quotes or phrases referenced
Page numbers or other structural elements
Verification Process:
1. Identify any specific structural references in the question
2. Check if those elements actually exist in the passage
3. Confirm the references are accurate and accessible
Examples of GOOD references:
"In paragraph 2..." when passage has 4 paragraphs
"The section titled 'Materials Needed'..." when that section exists
"According to the last paragraph..." when referring to final paragraph
Examples of BAD references:
"In paragraph 5..." when passage only has 3 paragraphs
"The section titled 'Conclusion'..." when no such section exists
"Line 20..." when passage only has 15 lines
Instructions:
Check if all specific passage references in the question are accurate and correspond to actual elements in the passage.
Return exactly one number:
1 if all passage references are accurate and exist; OR if the question does not contain passage references
0 if any passage reference is inaccurate or doesn't exist
<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

**Response Format**: XML  
**API**: Claude

---

#### 11. difficulty_assessment (Pipeline QC only)

**Purpose**: Verify question is appropriate for target grade level

```
You are an expert in educational assessment and psychometrics, with a specialization in analyzing the cognitive complexity and difficulty of test questions for K-12 education. Your task is to determine if a candidate test question is appropriate for its intended grade level.

You will be given the following information:
1.  **Candidate Question:** The question to be evaluated.
2.  **Intended Grade Level:** The grade for which the question is intended.
3.  **Example Questions:** A set of the 5 most semantically similar validated test questions that are considered benchmarks for the specified grade level.

Your analysis must be based on two primary dimensions:
1.  **Level of Inference Required:** The cognitive steps a student must take to arrive at the correct answer (Low, Moderate, High).
2.  **Distractor Difficulty:** The quality and plausibility of the incorrect answer choices (Weak, Plausible, Strong).

**Process:**
1.  **Analyze the Candidate Question:** Assess its inference level and distractor difficulty.
2.  **Analyze the Example Questions:** Establish a baseline for the typical cognitive demands for this grade level based on these highly similar examples.
3.  **Compare and Conclude:** Compare the candidate to the baseline and make a final judgment.
4.  **Provide a Rationale:** Justify your reasoning clearly.

**Output Format:**
**Judgment:** [Appropriate / Too Hard / Too Easy]
**Rationale:**
* **Candidate Question Analysis:**
    * **Inference Level:** [Your assessment and brief explanation]
    * **Distractor Difficulty:** [Your assessment and brief explanation]
* **Comparison to Grade Level Examples:**
    * [Your comparative analysis, explaining how the candidate question's demands align with or deviate from the benchmark examples.]
```

**Response Format**: Text  
**API**: OpenAI (GPT-4)  
**Requires**: Benchmark questions CSV file

---

## Response Parsing

### XML Response Parser (Claude)

```python
import re
import xml.etree.ElementTree as ET
from typing import Tuple

def parse_xml_response(response_text: str) -> Tuple[int, str]:
    """
    Parse QC response in XML format from Claude API.
    
    Expected format:
    <quality_check>
      <score>0|1</score>
      <reasoning>...</reasoning>
    </quality_check>
    
    Returns:
        Tuple of (score, reasoning)
    """
    try:
        # Try complete XML parsing
        if '<quality_check>' in response_text:
            if '</quality_check>' in response_text:
                xml_match = re.search(r'<quality_check>(.*?)</quality_check>',
                                     response_text, re.DOTALL)
            else:
                xml_match = re.search(r'<quality_check>(.*)',
                                     response_text, re.DOTALL)
            
            if xml_match:
                xml_content = xml_match.group(1)
                
                # Try complete XML parsing first
                if '</quality_check>' in response_text:
                    try:
                        full_xml = f"<quality_check>{xml_content}</quality_check>"
                        root = ET.fromstring(full_xml)
                        score_elem = root.find('score')
                        reasoning_elem = root.find('reasoning')
                        
                        if score_elem is not None and score_elem.text:
                            score = int(score_elem.text.strip())
                            reasoning = (reasoning_elem.text.strip()
                                       if reasoning_elem is not None and reasoning_elem.text
                                       else "No reasoning provided")
                            score = 1 if score > 0 else 0
                            return score, reasoning
                    except ET.ParseError:
                        pass
                
                # Try partial XML parsing
                score_match = re.search(r'<score>(\d+)</score>', xml_content)
                reasoning_match = re.search(r'<reasoning>(.*?)(?:</reasoning>|$)',
                                          xml_content, re.DOTALL)
                
                if score_match:
                    score = int(score_match.group(1))
                    score = 1 if score > 0 else 0
                    reasoning = (reasoning_match.group(1).strip()
                               if reasoning_match
                               else "Score found but reasoning incomplete")
                    return score, reasoning
        
        # Fallback to legacy parsing
        if '[1]' in response_text:
            return 1, "Legacy format: Contains [1]"
        elif '[0]' in response_text:
            return 0, "Legacy format: Contains [0]"
        else:
            numbers = re.findall(r'\b[01]\b', response_text)
            if numbers:
                score = int(numbers[-1])
                return score, f"Legacy format: Found {score} in text"
            else:
                response_lower = response_text.lower()
                if any(word in response_lower for word in
                      ['correct', 'good', 'appropriate', 'yes', 'passes']):
                    return 1, "Legacy format: Positive keywords detected"
                else:
                    return 0, "Legacy format: No clear positive indicators"
    
    except Exception as e:
        return 0, f"Parse error: {str(e)}"
```

### JSON Response Parser (OpenAI)

```python
import json
from typing import Dict, Any, Optional

def parse_json_response(response_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse JSON response from OpenAI API.
    
    Returns:
        Parsed JSON dict or None on failure
    """
    try:
        # Try to extract JSON from code blocks first
        if '```json' in response_text:
            json_start = response_text.find('```json') + 7
            json_end = response_text.find('```', json_start)
            json_content = response_text[json_start:json_end].strip()
            return json.loads(json_content)
        
        # Try parsing entire content as JSON
        return json.loads(response_text)
    except json.JSONDecodeError as e:
        return None
```

---

## Scoring System

### Pass Criteria

```python
# Question passes QC if overall_score >= 0.8 (80% of checks passed)
passed = overall_score >= 0.8
```

### Overall Score Calculation

```python
def calculate_overall_score(results: Dict) -> float:
    total_score = sum(res['score'] for res in results.values())
    total_checks = len(results)
    return total_score / total_checks if total_checks > 0 else 0
```

### Inline QC Filtering (bulk_question_generator.py)

```python
# Questions failing >1 check are discarded and retried
# Questions failing ≤1 check are tentatively accepted
if failed_checks > 1:
    retry_queue.append(question)
else:
    accepted_questions.append(question)
```

### Summary Statistics

```python
def calculate_pass_rate(results: list) -> Dict[str, Any]:
    if not results:
        return {'total': 0, 'passed': 0, 'failed': 0, 'pass_rate': 0.0, 'average_score': 0.0}
    
    total = len(results)
    passed = sum(1 for r in results if r.get('overall_score', 0) >= 0.8)
    failed = total - passed
    average_score = sum(r.get('overall_score', 0) for r in results) / total
    
    return {
        'total': total,
        'passed': passed,
        'failed': failed,
        'pass_rate': passed / total if total > 0 else 0.0,
        'average_score': average_score
    }
```

---

## Explanation QC

The Pipeline QC includes additional checks for answer explanations (student feedback).

### For Correct Answers (3 checks)

| Check ID | Purpose | Prompt Summary |
|----------|---------|----------------|
| `01_correctness_explanation` | Explains WHY the answer is correct | Must articulate core logic, not just confirm correctness |
| `02_textual_evidence` | References specific passage evidence | Must include quotes/paraphrases/specific references |
| `03_skill_reinforcement` | Names the reading skill used | Must explicitly identify reading skill (e.g., "main idea", "inference") |

### For Distractors (6 checks)

| Check ID | Purpose | Prompt Summary |
|----------|---------|----------------|
| `04_specific_error` | Explains why this choice is wrong | Must address particular distractor, not generic "wrong answer" |
| `05_misconception_diagnosis` | Identifies the error type | Must name type of thinking error (e.g., "overgeneralization") |
| `06_textual_refutation` | Uses passage to contradict | Must cite specific content that contradicts wrong answer |
| `07_correct_guidance` | Guides toward correct answer | Must state or clearly guide to correct answer |
| `08_actionable_strategy` | Provides future tips | Must include forward-looking, specific advice |
| `09_reasoning_model` | Demonstrates correct thinking | Must walk through expert reasoning step-by-step |

### Universal Checks (3 checks)

| Check ID | Purpose | Prompt Summary |
|----------|---------|----------------|
| `10_tone` | Encouraging, supportive language | Positive, motivating tone even when correcting |
| `11_conciseness` | 1-4 sentences | Focused, digestible, no repetition |
| `12_grade_appropriateness` | Matches target grade level | Vocabulary/complexity appropriate for grade band |

### Grade Bands

```python
def clamp_grade_to_band(grade: int) -> str:
    if grade <= 5:
        return "elementary"
    elif 6 <= grade <= 8:
        return "middle"
    else:  # 9-12
        return "high"
```

---

## How to Recreate

### Step 1: Create Prompt Files

**For Inline QC** (`ck_gen - prompts.json`):

```json
[
  {
    "function": "quality_control",
    "name": "grammatical_parallel",
    "level": "distractors",
    "prompt": "Your prompt text here..."
  },
  {
    "function": "quality_control",
    "name": "plausibility",
    "level": "distractors",
    "prompt": "..."
  }
]
```

**For Pipeline QC** (`qc_pipeline/config/prompts.json`):

```json
{
  "question_qc": {
    "distractor_checks": {
      "grammatical_parallel": {
        "prompt": "...",
        "response_format": "xml"
      }
    },
    "question_checks": { }
  },
  "explanation_qc": {
    "correct": { },
    "distractor": { },
    "all": { }
  }
}
```

### Step 2: Create Core Functions

```python
import anthropic
from openai import AsyncOpenAI
import os

# Initialize clients
claude_client = anthropic.AsyncAnthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
openai_client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# 1. Fill prompt variables
def fill_prompt_variables(prompt: str, question_data: Dict, passage: str) -> str:
    variables = {
        'question': question_data['question'],
        'passage': passage,
        'choice_A': question_data['choices']['A'],
        'choice_B': question_data['choices']['B'],
        'choice_C': question_data['choices']['C'],
        'choice_D': question_data['choices']['D'],
        'correct_answer': question_data['correct_answer'],
        'standard_code': question_data.get('CCSS', ''),
        'standard_description': question_data.get('CCSS_description', ''),
        'dok': str(question_data.get('DOK', '')),
    }
    for var, value in variables.items():
        prompt = prompt.replace(f'{{{var}}}', str(value))
    return prompt

# 2. Run single check (Claude)
async def run_claude_check(check_name: str, question_data: Dict, passage: str) -> Tuple[int, str]:
    prompt_config = prompts['question_qc']['distractor_checks'].get(check_name) or \
                    prompts['question_qc']['question_checks'].get(check_name)
    filled_prompt = fill_prompt_variables(prompt_config['prompt'], question_data, passage)
    
    response = await claude_client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=500,
        temperature=0,  # Important: QC uses 0 temperature
        messages=[{"role": "user", "content": filled_prompt}]
    )
    
    return parse_xml_response(response.content[0].text)

# 3. Run all checks
async def run_quality_control(question_item: Dict) -> Dict:
    distractor_checks = ['grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance']
    question_checks = ['clarity_precision', 'single_correct_answer', 'passage_reference']
    
    results = {}
    
    # Run API checks
    for check in distractor_checks + question_checks:
        score, response = await run_claude_check(
            check, 
            question_item['structured_content'], 
            question_item['passage_text']
        )
        results[check] = {'score': score, 'response': response}
    
    # Add length check (local)
    score, response = run_length_check(question_item['structured_content'])
    results['length_check'] = {'score': score, 'response': response}
    
    # Calculate overall
    total = sum(r['score'] for r in results.values())
    return {
        'overall_score': total / len(results),
        'passed_checks': total,
        'total_checks': len(results),
        'checks': results
    }
```

### Step 3: API Configuration

```python
# Claude (for most checks)
claude_client = anthropic.AsyncAnthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
claude_model = "claude-sonnet-4-5-20250929"
temperature = 0  # Important: QC uses 0 temperature for consistency

# OpenAI (for too_close, difficulty_assessment, explanation QC)
openai_client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))
openai_model = "gpt-4-turbo"
response_format = {"type": "json_object"}  # For JSON responses
```

---

## Quick Reference

### Check Summary Table

| Check | Type | API | Response | Required |
|-------|------|-----|----------|----------|
| `grammatical_parallel` | Distractor | Claude | XML | Yes |
| `plausibility` | Distractor | Claude | XML | Yes |
| `homogeneity` | Distractor | Claude | XML | Yes |
| `specificity_balance` | Distractor | Claude | XML | Yes |
| `too_close` | Distractor | OpenAI | JSON | Pipeline only |
| `length_check` | Distractor | Local | N/A | Yes |
| `standard_alignment` | Question | Claude | XML | Pipeline only |
| `clarity_precision` | Question | Claude | XML | Yes |
| `single_correct_answer` | Question | Claude | XML | Yes |
| `passage_reference` | Question | Claude | XML | Yes |
| `difficulty_assessment` | Question | OpenAI | Text | Pipeline + benchmarks |

### Prompt Variables

| Variable | Source |
|----------|--------|
| `{question}` | `structured_content['question']` |
| `{passage}` | `passage_text` |
| `{choice_A}` through `{choice_D}` | `structured_content['choices']` |
| `{correct_answer}` | `structured_content['correct_answer']` |
| `{standard_code}` | `CCSS` column |
| `{standard_description}` | `CCSS_description` column |
| `{dok}` | `DOK` column |
| `{grade}` | `grade` column |

### Command Line Usage

```bash
# Inline QC (during generation)
python bulk_question_generator.py "input.csv" --max-workers 5

# Pipeline QC (standalone)
python qc_pipeline/pipeline.py --input questions.csv --output results/ --mode questions

# Pipeline QC with benchmarks (enables difficulty_assessment)
python qc_pipeline/pipeline.py --input questions.csv --output results/ --examples benchmarks.csv

# Pipeline QC for explanations
python qc_pipeline/pipeline.py --input questions.csv --output results/ --mode explanations
```

---

## Version History

- **v1.0** - Initial documentation created from codebase analysis