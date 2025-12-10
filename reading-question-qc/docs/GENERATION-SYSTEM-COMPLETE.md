# Question Generation System - Complete Documentation

A comprehensive guide to the question generation system for reading comprehension assessments.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Input Data](#input-data)
5. [Example Matching System](#example-matching-system)
6. [Generation Prompts](#generation-prompts)
7. [Output Formats](#output-formats)
8. [Bulk Processing](#bulk-processing)
9. [How to Recreate](#how-to-recreate)
10. [Quick Reference](#quick-reference)

---

## Overview

The question generation system creates **reading comprehension questions** using Claude API. It supports three question types across multiple Depth of Knowledge (DOK) levels:

| Type | Full Name | DOK Levels | Description |
|------|-----------|------------|-------------|
| **MCQ** | Multiple Choice | 1, 2, 3 | 4-option questions with one correct answer |
| **SR** | Short Response | 1, 2, 3, 4 | Open-ended questions requiring written answers |
| **MP** | Multipart | 2, 3 | Two-part questions (Part A + Part B) |

### Two Implementations

| Implementation | File | Use Case |
|----------------|------|----------|
| `question_generator.py` | Single batch processing | Small batches, testing |
| `bulk_question_generator.py` | Parallel processing with QC | Production, large datasets |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        QUESTION GENERATION SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   INPUT FILES                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │ ck_gen - questions.csv     → Your passages + question specifications     │  │
│   │ ck_gen - prompts.json      → Generation prompts by type/DOK             │  │
│   │ ck_gen - ccss.csv          → CCSS standards lookup                      │  │
│   │ ck_gen - examples.csv      → Template questions for pattern matching    │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                       ↓                                         │
│   PROCESSING FLOW                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │ 1. Load input row (passage_text, DOK, CCSS, question_type)              │  │
│   │ 2. Find generation prompt → "MCQ DOK 2"                                  │  │
│   │ 3. Find matching example → by standard/DOK/difficulty                   │  │
│   │ 4. Fill prompt variables → {text_content}, {example_question}, etc.     │  │
│   │ 5. Call Claude API → temperature 0.4-0.6, max_tokens 2000               │  │
│   │ 6. Parse JSON response → extract structured_content                     │  │
│   │ 7. Run QC (bulk only) → 8+ quality checks                               │  │
│   │ 8. Retry if failed → up to 3 attempts with exponential backoff          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                       ↓                                         │
│   OUTPUT FILES                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │ generated_questions_TIMESTAMP.json → Raw generation results             │  │
│   │ *_generated.csv                    → Final output with QC scores        │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Requirements

### Environment Variables

```bash
# Create .env file in the reading-question-qc folder
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Python Dependencies

```bash
pip install pandas anthropic python-dotenv
```

### Required Files

| File | Purpose | Format |
|------|---------|--------|
| `ck_gen - questions.csv` | Your input data | CSV with passages |
| `ck_gen - prompts.json` | Generation prompts | JSON array |
| `ck_gen - ccss.csv` | Standards database | CSV |
| `ck_gen - examples.csv` | Template questions | CSV |

---

## Input Data

### Input CSV Format (`ck_gen - questions.csv`)

**Required Columns:**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `passage_id` | string | Groups questions by passage | `story-1` |
| `question_id` | string | Unique identifier | `story-1-q1` |
| `passage_text` | string | Full reading passage | `"The old lighthouse..."` |
| `DOK` | int | Depth of Knowledge (1-4) | `2` |
| `CCSS` | string | Standard code | `RL.3.3` |
| `question_type` | string | MCQ, SR, or MP | `MCQ` |

**Optional Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `CCSS_description` | string | Full standard text |
| `difficulty` | string | Low, Medium, High |
| `grade` | int | Grade level (3-12) |

**Example:**

```csv
passage_id,question_id,passage_text,DOK,CCSS,CCSS_description,difficulty,question_type,grade
story-1,story-1-q1,"The old lighthouse stood alone...",2,RL.3.3,"Describe characters...",Medium,MCQ,3
story-1,story-1-q2,"The old lighthouse stood alone...",1,RL.3.1,"Ask and answer...",Low,MCQ,3
```

### CCSS Standards Database (`ck_gen - ccss.csv`)

```csv
grade,standard_code,standard_description
3,RL.3.1,"Ask and answer questions to demonstrate understanding..."
3,RL.3.2,"Recount stories, including fables, folktales..."
3,RL.3.3,"Describe characters in a story..."
```

### Examples Database (`ck_gen - examples.csv`)

Template questions used for pattern matching:

```csv
Standard,DOK,Difficulty,question,answer_A,answer_B,answer_C,answer_D,correct_answer
RL.3.1,1,Low,What does the main character do at the beginning?,goes to school,eats breakfast,plays outside,reads a book,A
RL.3.3,2,Medium,How does the character's feelings change?,from sad to happy,from excited to bored,from scared to brave,from angry to calm,C
```

---

## Example Matching System

The system finds template questions to guide generation using a **cascading priority** system:

### Priority Order

```python
def _find_matching_example(self, standard, dok, question_type, difficulty=None):
    # Priority 1: Exact match (standard + DOK + difficulty)
    matches = examples[
        (examples['Standard'] == standard) & 
        (examples['DOK'] == dok) &
        (examples['Difficulty'].str.lower() == difficulty.lower())
    ]
    
    # Priority 2: Standard + DOK (any difficulty)
    if matches.empty:
        matches = examples[
            (examples['Standard'] == standard) & 
            (examples['DOK'] == dok)
        ]
    
    # Priority 3: Same standard + matching difficulty (any DOK)
    if matches.empty:
        matches = examples[
            (examples['Standard'] == standard) &
            (examples['Difficulty'].str.lower() == difficulty.lower())
        ]
    
    # Priority 4: Same standard (any DOK, any difficulty)
    if matches.empty:
        matches = examples[examples['Standard'] == standard]
    
    # Priority 5: Same standard family (RL or RI) + matching difficulty
    if matches.empty:
        standard_family = standard.split('.')[0]  # RL or RI
        matches = examples[
            (examples['Standard'].str.startswith(standard_family)) &
            (examples['Difficulty'].str.lower() == difficulty.lower())
        ]
    
    # Priority 6: Same standard family (any difficulty)
    if matches.empty:
        matches = examples[examples['Standard'].str.startswith(standard_family)]
    
    # Return random sample from matches
    return matches.sample(n=1).iloc[0] if not matches.empty else None
```

### Example Match Output

```python
{
    'example_question': 'How does the character\'s feelings change?',
    'example_choice_a': 'from sad to happy',
    'example_choice_b': 'from excited to bored',
    'example_choice_c': 'from scared to brave',
    'example_choice_d': 'from angry to calm',
    'example_correct': 'C'
}
```

---

## Generation Prompts

### Prompt Selection Logic

```python
def _find_generation_prompt(self, question_type: str, dok: int):
    type_mapping = {
        'MCQ': f'MCQ DOK {dok}',      # MCQ DOK 1, MCQ DOK 2, MCQ DOK 3
        'SR': f'SR DOK {dok}',         # SR DOK 1, SR DOK 2, SR DOK 3, SR DOK 4
        'MP': f'MP DOK {dok}' if dok >= 2 else 'MP DOK 2'  # MP only has DOK 2, 3
    }
    
    target_name = type_mapping.get(question_type.upper())
    
    for prompt in self.prompts:
        if prompt.get('function') == 'generate' and prompt.get('name') == target_name:
            return prompt
    
    return None
```

### Prompt Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{text_content}` | `passage_text` column | The reading passage |
| `{standard_code}` | `CCSS` column | Standard code (e.g., RL.3.3) |
| `{standard_description}` | CCSS lookup | Full standard text |
| `{existing_questions}` | Previous generations | Avoid duplicates |
| `{example_question}` | Example match | Template question |
| `{example_choice_a}` - `{example_choice_d}` | Example match | Template choices |
| `{example_correct}` | Example match | Template correct answer |

---

## Exact Generation Prompts

### MCQ DOK 1 Prompt

```
You are generating a DOK 1 multiple choice question for grades 9-10 reading assessment using a provided example as a template.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 1 (Recall and Reproduction)
Question Type: Multiple Choice
Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}
Existing Questions to Avoid Duplication:
{existing_questions}
Task: Use the example question as a template to create a new question for the provided text.
Template Analysis Instructions:
1. Question Structure: Identify the question pattern and phrasing style from the example
2. Content Focus: Note what specific type of information the example asks for
3. Answer Choice Pattern: Observe the structure and style of the example's choices
4. Cognitive Level: Ensure your question matches the same DOK 1 recall level
DOK 1 Requirements:
- Test recall of basic facts, definitions, or details
- Require simple recognition or identification
- Ask for information directly stated in the text
- No inference or analysis required
Adaptation Process:
1. Identify the question type and structure from the example
2. Find equivalent information in your provided text
3. Adapt the question wording to fit your text content
4. Create answer choices that match the example's style and structure
5. Ensure one choice is clearly correct based on the text
6. Make distractors plausible but clearly wrong
Quality Requirements:
1. Template Fidelity: Follow the example's question structure and style
2. Text Dependency: Must require reading the passage to answer
3. Grade Appropriate: Use vocabulary and concepts suitable for grades 9-10
4. Clear and Precise: Unambiguous question with one correct answer
5. Plausible Distractors: Wrong answers should be believable but clearly incorrect
6. Grammatical Parallelism: All choices should follow same grammatical structure as example
7. Length Balance - **IMPORTANT**: Choices should maintain similar length to each other

**SPECIAL CONSTRAINT**: The correct answer MUST NEVER be the longest option.
Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "A",
   "DOK": 1,
  "CCSS": "standard code",
  "template_adaptation": "brief explanation of how you adapted the example to fit your text",
  "rationale": "brief explanation of why this answer is correct"
}
```
Instructions: Generate exactly one DOK 1 multiple choice question that follows the example's template structure while adapting the content to assess the target standard using the provided text.
```

---

### MCQ DOK 2 Prompt

```
You are generating a DOK 2 multiple choice question for grades 9-10 reading assessment using a provided example as a template.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 2 (Skills and Concepts)
Question Type: Multiple Choice
Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}
Existing Questions to Avoid Duplication:
{existing_questions}
Task: Use the example question as a template to create a new question for the provided text.
Template Analysis Instructions:
1. Question Structure: Identify the question pattern and cognitive demand from the example
2. Inference Type: Note what kind of reasoning or application the example requires
3. Answer Choice Logic: Observe how choices represent different levels of understanding
4. Cognitive Process: Ensure your question matches the same DOK 2 application level
DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Demonstrate understanding beyond simple recall
Adaptation Process:
1. Identify the cognitive process required by the example (inference, comparison, classification, etc.)
2. Find equivalent information or relationships in your provided text
3. Adapt the question structure to target the same cognitive process with your content
4. Create answer choices that reflect different levels of understanding
5. Ensure the correct choice requires the same type of reasoning as the example
6. Make distractors represent reasonable misconceptions or partial understanding
Quality Requirements:
1. Template Fidelity: Follow the example's cognitive demand and question structure
2. Inference Required: Cannot be answered by simple recall alone
3. Text Dependency: Must require reading and understanding the passage
4. Clear and Precise: Unambiguous question with one correct answer
5. Plausible Distractors: Wrong answers should represent reasonable misconceptions
6. Cognitive Match: Should require the same type of thinking as the example
7. Length Balance - **IMPORTANT**: Choices should maintain similar length to each other

**SPECIAL CONSTRAINT**: The correct answer MUST NEVER be the longest option.
Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice reflecting the example's reasoning patterns",
    "B": "second choice reflecting the example's reasoning patterns", 
    "C": "third choice reflecting the example's reasoning patterns",
    "D": "fourth choice reflecting the example's reasoning patterns"
  },
  "correct_answer": "B",
   "DOK": 2,
  "CCSS": "standard code",
  "template_adaptation": "explanation of how you adapted the example's cognitive process to your text",
  "cognitive_process": "what type of DOK 2 thinking this question requires (matching the example)",
  "rationale": "explanation of why this answer requires DOK 2 reasoning"
}
```
Instructions: Generate exactly one DOK 2 multiple choice question that follows the example's cognitive template while adapting the content to require the same type of reasoning using the provided text.
```

---

### MCQ DOK 3 Prompt

```
You are generating a DOK 3 multiple choice question for grades 9-10 reading assessment using a provided example as a template.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 3 (Strategic Thinking)
Question Type: Multiple Choice
Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}
Existing Questions to Avoid Duplication:
{existing_questions}
Task: Use the example question as a template to create a new question for the provided text.
Template Analysis Instructions:
1. Strategic Thinking Pattern: Identify what type of analysis, evaluation, or synthesis the example requires
2. Question Complexity: Note the sophisticated reasoning process the example demands
3. Evidence Integration: Observe how the example requires connecting multiple text elements
4. Depth Level: Ensure your question matches the same DOK 3 strategic thinking level
DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw conclusions based on evidence
- Make complex inferences or connections
- Demonstrate deep understanding
Adaptation Process:
1. Identify the strategic thinking process required by the example (analysis of purpose, evaluation of evidence, synthesis of themes, etc.)
2. Find equivalent complex relationships or deep concepts in your provided text
3. Adapt the question structure to target the same strategic thinking process
4. Create answer choices that represent different levels of analytical sophistication
5. Ensure the correct choice requires the same depth of reasoning as the example
6. Make distractors represent sophisticated but incomplete analysis
Quality Requirements:
1. Template Fidelity: Follow the example's strategic thinking demand and analytical structure
2. Strategic Thinking: Must require analysis, evaluation, or synthesis matching the example
3. Evidence-Based: Answer should be supported by multiple text clues like the example
4. Complex Reasoning: Goes beyond simple inference to sophisticated analysis
5. Plausible Distractors: Should represent sophisticated misconceptions or partial analysis
6. Depth Match: Should require the same level of strategic thinking as the example
7. Length Balance - **IMPORTANT**: Choices should maintain similar length to each other

**SPECIAL CONSTRAINT**: The correct answer MUST NEVER be the longest option.
Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice reflecting sophisticated analytical options",
    "B": "second choice reflecting sophisticated analytical options", 
    "C": "third choice reflecting sophisticated analytical options",
    "D": "fourth choice reflecting sophisticated analytical options"
  },
  "correct_answer": "C",
   "DOK": 3,
  "CCSS": "standard code",
  "template_adaptation": "explanation of how you adapted the example's strategic thinking process to your text",
  "strategic_thinking_type": "what type of DOK 3 analysis this requires (matching the example pattern)",
  "evidence_integration": "how this question requires connecting multiple text elements like the example",
  "rationale": "detailed explanation of why this answer requires strategic thinking"
}
```
Instructions: Generate exactly one DOK 3 multiple choice question that follows the example's strategic thinking template while adapting the content to require the same depth of analysis using the provided text.
```

---

### SR DOK 1 Prompt

```
You are generating a DOK 1 short response question for grades 9-10 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 1 (Recall and Reproduction)
Question Type: Short Response
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 1 Requirements:
- Test recall of basic facts, definitions, or details
- Require simple identification or listing
- Ask for information directly stated in the text
- No analysis or complex explanation required
Short Response Characteristics:
- Expected answer length: 1-2 sentences
- Should require specific text evidence
- Student must locate and extract information
- Minimal interpretation required
Quality Requirements:
1. Text Dependency: Must require reading passage to answer
2. Specific Evidence: Should prompt for particular details or examples
3. Grade Appropriate: Language and expectations suitable for 8
4. Clear Scoring: Answers should be objectively verifiable
5. Focused Response: Should have a clear, limited scope
Sample Rubric Expectations:
- 2 points: Complete, accurate answer with specific text evidence
- 1 point: Partially correct answer or missing some evidence
- 0 points: Incorrect or no evidence from text
Output Format:
```json
{
  "question": "exact question text including any specific instructions",
  "expected_response": "sample complete response showing what a full-credit answer would include",
  "key_details": ["detail 1", "detail 2", "detail 3"],
  "scoring_notes": "brief guidance on what constitutes a complete answer",
  "dok_justification": "explanation of why this is DOK 1"
}
```
Instructions: Generate exactly one DOK 1 short response question that requires students to recall and cite specific information from the text to assess the target standard.
```

---

### SR DOK 2 Prompt

```
You are generating a DOK 2 short response question for grades 9-10 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 2 (Skills and Concepts)
Question Type: Short Response
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Explain simple relationships or processes
Short Response Characteristics:
- Expected answer length: 2-3 sentences
- Should require inference or application
- Student must explain their reasoning
- Connects multiple pieces of information
Cognitive Processes for DOK 2:
- Making basic inferences from text evidence
- Explaining simple cause-and-effect relationships
- Comparing or contrasting elements
- Organizing information logically
- Applying understanding to explain concepts
Quality Requirements:
1. Inference Required: Cannot be answered by simple recall alone
2. Text Evidence: Must cite specific examples or details
3. Explanation Expected: Student should explain their thinking
4. Clear Criteria: Scoring should be based on clear, achievable standards
5. Grade Appropriate: Expectations match grades 9-10 capabilities
Sample Rubric Expectations:
- 2 points: Clear inference/application with appropriate text evidence and explanation
- 1 point: Partial inference or weak evidence/explanation
- 0 points: No clear inference or insufficient text evidence
Output Format:
```json
{
  "question": "exact question text including any specific instructions about evidence or explanation",
  "expected_response": "sample complete response showing inference/application with text evidence",
  "key_concepts": ["concept 1", "concept 2"],
  "required_evidence": ["type of evidence needed", "another type"],
  "scoring_notes": "guidance on what constitutes complete inference and adequate evidence",
  "dok_justification": "explanation of what skill/concept application this question requires"
}
```
Instructions: Generate exactly one DOK 2 short response question that requires students to make inferences or apply concepts while providing text evidence to assess the target standard.
```

---

### SR DOK 3 Prompt

```
You are generating a DOK 3 short response question for grades 9-10 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 3 (Strategic Thinking)
Question Type: Short Response
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw complex conclusions based on evidence
- Make sophisticated connections across text
- Demonstrate deep understanding
Short Response Characteristics:
- Expected answer length: 3-4 sentences
- Should require analysis or evaluation
- Student must synthesize multiple text elements
- Demonstrates complex understanding
Cognitive Processes for DOK 3:
- Analyzing author's purpose or craft decisions
- Evaluating effectiveness of text elements
- Synthesizing information from multiple parts
- Drawing complex conclusions with evidence
- Making sophisticated text-to-text connections
- Recognizing implicit themes or messages
Quality Requirements:
1. Strategic Thinking: Must require analysis, evaluation, or synthesis
2. Multiple Text Elements: Should connect different parts of the passage
3. Complex Reasoning: Goes beyond simple inference to sophisticated analysis
4. Evidence Integration: Must synthesize multiple pieces of evidence
5. Grade-Appropriate Depth: Challenging but achievable for grades 9-10
Sample Rubric Expectations:
- 2 points: Clear analysis/evaluation with well-integrated evidence and sophisticated reasoning
- 1 point: Some analysis with adequate evidence but less sophisticated reasoning
- 0 points: Little analysis or insufficient evidence integration
Output Format:
```json
{
  "question": "exact question text with clear expectations for analysis/evaluation",
  "expected_response": "sample response demonstrating strategic thinking with integrated evidence",
  "analysis_focus": "what aspect should be analyzed/evaluated",
  "evidence_requirements": ["type 1", "type 2", "connections needed"],
  "scoring_notes": "guidance on recognizing strategic thinking and evidence integration",
  "dok_justification": "explanation of the strategic thinking process this question requires"
}
```
Instructions: Generate exactly one DOK 3 short response question that requires students to analyze, evaluate, or synthesize information with integrated text evidence to assess the target standard.
```

---

### SR DOK 4 Prompt

```
You are generating a DOK 4 short response question for 8 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 4 (Extended Thinking)
Question Type: Short Response
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 4 Requirements:
- Require extended thinking over time
- Complex analysis across multiple sources or extended text
- Synthesize and apply knowledge in new situations
- Create original connections or solutions
- Demonstrate sophisticated reasoning
Short Response Characteristics:
- Expected answer length: 4-5 sentences
- Should require complex synthesis or creation
- Student must make original connections
- Demonstrates extended reasoning process
Cognitive Processes for DOK 4:
- Creating original applications or extensions
- Synthesizing across multiple sources or experiences
- Designing solutions or alternatives
- Making complex comparative analyses
- Developing original interpretations
- Applying understanding to new contexts
Quality Requirements:
1. Extended Thinking: Must require sustained reasoning beyond single concept
2. Original Application: Should ask for creation or extension of ideas
3. Complex Synthesis: Connects passage with broader knowledge or experiences
4. Sophisticated Reasoning: Demonstrates deep understanding and original thinking
5. Grade-Appropriate Challenge: Ambitious but achievable for advanced grades 9-10 students
Sample Rubric Expectations:
- 2 points: Original, creative response with sophisticated reasoning and clear text connections
- 1 point: Some original thinking with adequate reasoning and text connections
- 0 points: Limited original thinking or weak connections to text
Output Format:
```json
{
  "question": "exact question text that prompts extended thinking and original application",
  "expected_response": "sample response showing extended reasoning and original connections",
  "thinking_process": "what extended cognitive process is required",
  "synthesis_elements": ["element 1", "element 2", "creative component"],
  "scoring_notes": "guidance on recognizing extended thinking and original applications",
  "dok_justification": "explanation of why this requires extended thinking and complex reasoning"
}
```
Instructions: Generate exactly one DOK 4 short response question that requires students to engage in extended thinking, synthesis, or original application while assessing the target standard.
```

---

### MP DOK 2 Prompt

```
You are generating a DOK 2 multipart question for grades 9-10 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 2 (Skills and Concepts)
Question Type: Multipart
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Demonstrate understanding through multiple steps
Multipart Structure:
- Part A: Foundation question (often recall or basic inference)
- Part B: Application question that builds on Part A
- Both parts should work together to assess the standard
- Combined difficulty should reach DOK 2 level
Standard-Specific Examples:
- RI.3.2: Part A: "What is the main topic of this passage?" Part B: "Which two details best support this main topic?"
- RI.3.8: Part A: "What is the first step in the process?" Part B: "How does this first step connect to the final result?"
- RL.3.3: Part A: "What problem does the character face?" Part B: "How do the character's actions help solve this problem?"
Quality Requirements:
1. Connected Parts: Part B should build meaningfully on Part A
2. Progressive Difficulty: Part A establishes foundation, Part B requires application
3. Text Dependency: Both parts must require passage comprehension
4. Clear Scoring: Each part should have distinct, measurable expectations
5. Cumulative Assessment: Together they should fully assess the target standard
Typical Part A Characteristics:
- Identifies key information or concept
- Often DOK 1-2 level
- Sets up Part B response
- Multiple choice
Typical Part B Characteristics:
- Applies or extends Part A concept
- Requires explanation or reasoning
- DOK 2 level thinking
- Multiple choice

## Important MCQ Considerations
1. Text Dependency: Must require reading the passage to answer
2. Grade Appropriate: Use vocabulary and concepts suitable for grades 9-10
3. Clear and Precise: Unambiguous question with one correct answer
4. Plausible Distractors: Wrong answers should be believable but clearly incorrect
5. Grammatical Parallelism: All choices should follow a similar grammatical structure
6. Length Balance - **IMPORTANT**: Choices should maintain similar length to each other

**SPECIAL CONSTRAINT**: The correct answer MUST NEVER be the longest option.
Output Format:
```json
{
  "part_a": {
    "question": "exact text for Part A",
    "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "A",
   "DOK": 1,
  "CCSS": "standard code",
  },
  "part_b": {
    "question": "exact text for Part B",
    "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "B",
   "DOK": 1,
  "CCSS": "standard code",
  },
  "connection_rationale": "explanation of how Part B builds on Part A",
  "dok_justification": "explanation of why the combined question reaches DOK 2",
  "standard_assessment": "how this multipart question assesses the target standard"
}
```
Instructions: Generate exactly one DOK 2 multipart question where Part A establishes a foundation and Part B requires application or reasoning that builds on Part A to assess the target standard.
```

---

### MP DOK 3 Prompt

```
You are generating a DOK 3 multipart question for grades 9-10 reading assessment.
Text Section/Passage:
{text_content}
Target Standard: {standard_code} - {standard_description}
DOK Level: 3 (Strategic Thinking)
Question Type: Multipart
Existing Questions to Avoid Duplication:
{existing_questions}
DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw complex conclusions based on evidence
- Make sophisticated connections across text
Multipart Structure:
- Part A: Analysis or inference question
- Part B: Strategic thinking question that extends Part A
- Both parts should work together to demonstrate deep understanding
- Combined difficulty should reach DOK 3 level
Standard-Specific Examples:
- RI.3.6: Part A: "What is the author's main purpose in writing this passage?" Part B: "How do the author's word choices in the first and last paragraphs support this purpose?"
- RI.3.8: Part A: "What conclusion can be drawn about the importance of each step in the process?" Part B: "What piece of evidence from the passage best supports your answer to the previous question?"
- RL.3.3: Part A: "How do the character's feelings change throughout the story?" Part B: "Which quotation from the text best supports your answer to the previous question?"
Quality Requirements:
1. Strategic Connection: Part B should require sophisticated reasoning beyond Part A
2. Deep Analysis: Combined parts should demonstrate thorough understanding
3. Evidence Integration: Both parts should require synthesizing multiple text elements
4. Complex Reasoning: Part B should extend thinking in meaningful ways
5. Standard Mastery: Together they should comprehensively assess the target standard
Typical Part A Characteristics:
- Requires analysis or complex inference
- DOK 2-3 level thinking
- Establishes analytical foundation
Multiple choice
Typical Part B Characteristics:
- Requires evaluation, synthesis, or strategic thinking
- Clear DOK 3 level reasoning
- Extends or deepens Part A analysis
Multiple choice

## Important MCQ Considerations
1. Text Dependency: Must require reading the passage to answer
2. Grade Appropriate: Use vocabulary and concepts suitable for grades 9-10
3. Clear and Precise: Unambiguous question with one correct answer
4. Plausible Distractors: Wrong answers should be believable but clearly incorrect
5. Grammatical Parallelism: All choices should follow a similar grammatical structure
6. Length Balance - **IMPORTANT**: Choices should maintain similar length to each other

**SPECIAL CONSTRAINT**: The correct answer MUST NEVER be the longest option.

Output Format:
```json
{
  "part_a": {
    "question": "exact text for Part A requiring analysis or complex inference",
    "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "A",
   "DOK": 1,
  "CCSS": "standard code",
  },
  "part_b": {
    "question": "exact text for Part B requiring strategic thinking that builds on Part A",
    "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "A",
   "DOK": 1,
  "CCSS": "standard code",
  },
  "strategic_connection": "explanation of how Part B requires strategic thinking beyond Part A",
  "dok_justification": "explanation of the strategic thinking process required across both parts",
  "standard_assessment": "how this multipart question demonstrates comprehensive mastery of the target standard"
}
```
Instructions: Generate exactly one DOK 3 multipart question where Part A requires analysis and Part B requires strategic thinking that builds on and extends Part A to comprehensively assess the target standard.
```

---

## Output Formats

### JSON Output (question_generator.py)

```json
{
  "question_id": "story-1-q1",
  "passage_id": "story-1",
  "passage_text": "The old lighthouse stood alone...",
  "question_type": "MCQ",
  "dok": 2,
  "standard": "RL.3.3",
  "generated_content": "```json\n{...}\n```",
  "prompt_used": "MCQ DOK 2",
  "example_used": true,
  "timestamp": "2025-12-06T23:10:40.568080",
  "structured_content": {
    "question": "How does Thomas's emotional state change?",
    "choices": {
      "A": "from content to worried",
      "B": "from calm to frantic to satisfied",
      "C": "from tired to energetic",
      "D": "from confident to defeated"
    },
    "correct_answer": "B",
    "DOK": 2,
    "CCSS": "RL.9-10.3",
    "template_adaptation": "...",
    "cognitive_process": "...",
    "rationale": "..."
  }
}
```

### CSV Output (bulk_question_generator.py)

| Column | Description |
|--------|-------------|
| `passage` | Copy of passage text |
| `question_text` | Generated question |
| `option_a` - `option_d` | Answer choices |
| `correct_answer` | Full text of correct answer |
| `qc_passed_checks` | Number of QC checks passed |
| `qc_total_checks` | Total QC checks run |
| `qc_failed_checks` | Semicolon-separated list of failed checks |

---

## Bulk Processing

### Processing Flow

```
Load Input CSV
       ↓
Group by passage_id
       ↓
┌─────────────────────────────────────┐
│ For Each Passage (PARALLEL)         │
│       ↓                             │
│   For Each Question (SEQUENTIAL)    │
│       ↓                             │
│     Generate Question               │
│       ↓                             │
│     Run QC                          │
│       ↓                             │
│     Pass? → Add to completed        │
│     Fail? → Add to retry queue      │
│       ↓                             │
│   Update passage context            │
│   (so next question sees previous)  │
└─────────────────────────────────────┘
       ↓
Retry Failed Questions (up to 3x)
       ↓
Generate Output CSV
```

### API Configuration

```python
# Generation settings
model = "claude-sonnet-4-5-20250929"
temperature = 0.4  # question_generator.py
temperature = 0.6  # bulk_question_generator.py
max_tokens = 2000

# Retry settings
max_retries = 3
base_delay = 1  # second

# Parallel processing
max_workers = 5  # configurable
```

### Retry Logic with Exponential Backoff

```python
def _make_api_call_with_retry(self, messages, max_tokens=2000, temperature=None):
    for attempt in range(self.max_retries):
        try:
            response = client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                temperature=temperature or self.temperature,
                messages=messages
            )
            return response.content[0].text
            
        except Exception as e:
            if attempt == self.max_retries - 1:
                raise e
            
            # Exponential backoff with jitter
            delay = (self.base_delay * (2 ** attempt)) + random.uniform(0, 1)
            time.sleep(delay)
    
    raise Exception("Max retries exceeded")
```

---

## How to Recreate

### Step 1: Create Input Files

**1. Create `ck_gen - questions.csv`:**

```csv
passage_id,question_id,passage_text,DOK,CCSS,CCSS_description,difficulty,question_type,grade
story-1,story-1-q1,"Your passage text here...",2,RL.3.3,"Describe characters...",Medium,MCQ,3
```

**2. Create `ck_gen - prompts.json`:**

```json
[
  {
    "function": "generate",
    "name": "MCQ DOK 1",
    "level": "mcq",
    "prompt": "Your prompt text here with {text_content}, {standard_code}, etc."
  },
  {
    "function": "generate",
    "name": "MCQ DOK 2",
    "level": "mcq",
    "prompt": "..."
  }
]
```

**3. Create `ck_gen - ccss.csv`:**

```csv
grade,standard_code,standard_description
3,RL.3.1,"Ask and answer questions to demonstrate understanding..."
3,RL.3.3,"Describe characters in a story..."
```

**4. Create `ck_gen - examples.csv`:**

```csv
Standard,DOK,Difficulty,question,answer_A,answer_B,answer_C,answer_D,correct_answer
RL.3.1,1,Low,What does the main character do?,goes to school,eats breakfast,plays outside,reads a book,A
```

### Step 2: Core Generation Function

```python
import anthropic
import pandas as pd
import json
from typing import Dict, Optional

class QuestionGenerator:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-sonnet-4-5-20250929"
        self.temperature = 0.4
        
        # Load data files
        self.prompts = self._load_prompts()
        self.ccss_standards = self._load_ccss_standards()
        self.examples = self._load_examples()
    
    def _load_prompts(self):
        with open('ck_gen - prompts.json', 'r') as f:
            return json.load(f)
    
    def _load_ccss_standards(self):
        df = pd.read_csv('ck_gen - ccss.csv')
        return dict(zip(df['standard_code'], df['standard_description']))
    
    def _load_examples(self):
        return pd.read_csv('ck_gen - examples.csv')
    
    def _find_generation_prompt(self, question_type: str, dok: int):
        type_mapping = {
            'MCQ': f'MCQ DOK {dok}',
            'SR': f'SR DOK {dok}',
            'MP': f'MP DOK {dok}' if dok >= 2 else 'MP DOK 2'
        }
        target_name = type_mapping.get(question_type.upper())
        
        for prompt in self.prompts:
            if prompt.get('function') == 'generate' and prompt.get('name') == target_name:
                return prompt
        return None
    
    def _find_matching_example(self, standard: str, dok: int, difficulty: str = None):
        # Priority 1: Exact match
        if difficulty:
            matches = self.examples[
                (self.examples['Standard'] == standard) & 
                (self.examples['DOK'] == dok) &
                (self.examples['Difficulty'].str.lower() == difficulty.lower())
            ]
            if not matches.empty:
                example = matches.sample(n=1).iloc[0]
                return {
                    'example_question': example['question'],
                    'example_choice_a': example['answer_A'],
                    'example_choice_b': example['answer_B'],
                    'example_choice_c': example['answer_C'],
                    'example_choice_d': example['answer_D'],
                    'example_correct': example['correct_answer']
                }
        
        # Priority 2-6: Cascading fallbacks (see full code)
        return None
    
    def _fill_prompt_variables(self, prompt_text: str, row, example):
        variables = {
            'text_content': row.get('passage_text', ''),
            'standard_code': row.get('CCSS', ''),
            'standard_description': self.ccss_standards.get(row.get('CCSS', ''), ''),
            'existing_questions': 'None'
        }
        
        if example:
            variables.update(example)
        else:
            variables.update({
                'example_question': '[No matching example found]',
                'example_choice_a': '',
                'example_choice_b': '',
                'example_choice_c': '',
                'example_choice_d': '',
                'example_correct': ''
            })
        
        filled = prompt_text
        for var, value in variables.items():
            filled = filled.replace(f'{{{var}}}', str(value))
        return filled
    
    def generate_question(self, row) -> Optional[Dict]:
        question_type = row.get('question_type', 'MCQ')
        dok = int(row.get('DOK', 1))
        standard = row.get('CCSS', '')
        
        # Find prompt
        prompt_config = self._find_generation_prompt(question_type, dok)
        if not prompt_config:
            return None
        
        # Find example
        example = None
        if question_type.upper() == 'MCQ':
            difficulty = row.get('difficulty', '')
            example = self._find_matching_example(standard, dok, difficulty)
        
        # Fill prompt
        filled_prompt = self._fill_prompt_variables(prompt_config['prompt'], row, example)
        
        # Call API
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            temperature=self.temperature,
            messages=[{"role": "user", "content": filled_prompt}]
        )
        
        response_text = response.content[0].text
        
        # Parse JSON
        result = {
            'question_id': row.get('question_id', ''),
            'passage_id': row.get('passage_id', ''),
            'question_type': question_type,
            'dok': dok,
            'standard': standard,
            'generated_content': response_text,
            'prompt_used': prompt_config['name'],
            'example_used': example is not None
        }
        
        # Extract JSON from response
        if '```json' in response_text:
            json_start = response_text.find('```json') + 7
            json_end = response_text.find('```', json_start)
            json_content = response_text[json_start:json_end].strip()
            result['structured_content'] = json.loads(json_content)
        
        return result
```

### Step 3: Run Generation

```bash
# Simple batch generation
python question_generator.py --start 0 --batch-size 10

# Bulk processing with QC
python bulk_question_generator.py "ck_gen - questions.csv" --max-workers 5
```

---

## Quick Reference

### Prompt Types Summary

| Prompt Name | Question Type | DOK | Key Focus |
|-------------|---------------|-----|-----------|
| MCQ DOK 1 | Multiple Choice | 1 | Recall and Reproduction |
| MCQ DOK 2 | Multiple Choice | 2 | Skills and Concepts |
| MCQ DOK 3 | Multiple Choice | 3 | Strategic Thinking |
| SR DOK 1 | Short Response | 1 | Basic recall (1-2 sentences) |
| SR DOK 2 | Short Response | 2 | Inference (2-3 sentences) |
| SR DOK 3 | Short Response | 3 | Analysis (3-4 sentences) |
| SR DOK 4 | Short Response | 4 | Extended thinking (4-5 sentences) |
| MP DOK 2 | Multipart | 2 | Part A + Part B building |
| MP DOK 3 | Multipart | 3 | Strategic thinking across parts |

### Variable Reference

| Variable | Source | Used In |
|----------|--------|---------|
| `{text_content}` | `passage_text` column | All prompts |
| `{standard_code}` | `CCSS` column | All prompts |
| `{standard_description}` | CCSS lookup | All prompts |
| `{existing_questions}` | Previous generations | All prompts |
| `{example_question}` | Example CSV | MCQ prompts |
| `{example_choice_a-d}` | Example CSV | MCQ prompts |
| `{example_correct}` | Example CSV | MCQ prompts |

### API Settings

| Setting | question_generator.py | bulk_question_generator.py |
|---------|----------------------|---------------------------|
| Model | claude-sonnet-4-5-20250929 | claude-sonnet-4-5-20250929 |
| Temperature | 0.4 | 0.6 |
| Max Tokens | 2000 | 2000 |
| Max Retries | - | 3 |
| Max Workers | 1 (sequential) | 5 (configurable) |

### Command Line Usage

```bash
# Single batch
python question_generator.py --start 0 --batch-size 5 --output my_questions.json

# Bulk with QC
python bulk_question_generator.py input.csv --output output.csv --max-workers 8
```

---

## Version History

- **v1.0** - Initial documentation created from codebase analysis
