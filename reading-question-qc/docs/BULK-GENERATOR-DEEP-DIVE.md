# Bulk Question Generator: Complete Technical Reference

> **Purpose**: This document provides a comprehensive deep dive into `bulk_question_generator.py` so that the system can be fully understood, maintained, or recreated from scratch.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Flow](#architecture-flow)
3. [Input Files Required](#input-files-required)
4. [Prompt System](#prompt-system)
   - [Generation Prompts](#generation-prompts)
   - [QC Prompts](#qc-prompts)
5. [Step-by-Step Execution Flow](#step-by-step-execution-flow)
6. [Example Matching Algorithm](#example-matching-algorithm)
7. [Quality Control System](#quality-control-system)
8. [Parallel Processing Strategy](#parallel-processing-strategy)
9. [Output Format](#output-format)
10. [Configuration & Dependencies](#configuration--dependencies)
11. [Known Limitations](#known-limitations)
12. [Recreation Checklist](#recreation-checklist)

---

## Overview

The `bulk_question_generator.py` is a parallel question generation system that:

1. **Reads** an input CSV with passage/question specifications
2. **Generates** questions using Claude API with template-based prompts
3. **Validates** each generated question with inline QC checks
4. **Retries** failed questions up to 3 times
5. **Outputs** a complete CSV with generated questions and QC results

### Key Features

- Parallel processing across passages (5 workers by default)
- Sequential processing within passages (maintains context)
- Template-based generation using example questions
- Inline quality control with automatic retry
- Support for MCQ, Short Response (SR), and Multipart (MP) questions
- CCSS standard alignment verification

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            INITIALIZATION                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Load 4 data files:                                                              │
│  ├── ck_gen - prompts.json    → Generation prompts (9) + QC prompts (10)        │
│  ├── ck_gen - ccss.csv        → 171 CCSS standards (grades 3-12)                │
│  ├── ck_gen - examples.csv    → 9 template questions for pattern matching        │
│  └── ck_gen - questions.csv   → INPUT: passages + question specs                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        MAIN PROCESSING LOOP                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  For each question in input CSV:                                                 │
│                                                                                  │
│  1. GROUP by passage_id (process sequentially within passage)                    │
│  2. PARALLELIZE across passages (ThreadPoolExecutor, 5 workers default)          │
│                                                                                  │
│  Per question:                                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  A. Find Generation Prompt                                                  │ │
│  │     └── Based on question_type + DOK → "MCQ DOK 2", "SR DOK 3", etc.       │ │
│  │                                                                             │ │
│  │  B. Find Matching Example (MCQ only)                                        │ │
│  │     └── Priority: Standard+DOK+Difficulty → Standard+DOK → Standard        │ │
│  │                   → Standard Family+Difficulty → Standard Family            │ │
│  │                                                                             │ │
│  │  C. Fill Prompt Variables                                                   │ │
│  │     └── {text_content}, {standard_code}, {standard_description},           │ │
│  │         {existing_questions}, {example_*}                                   │ │
│  │                                                                             │ │
│  │  D. Call Claude API                                                         │ │
│  │     └── Model: claude-sonnet-4-5-20250929, Temp: 0.6                        │ │
│  │                                                                             │ │
│  │  E. Parse JSON Response                                                     │ │
│  │     └── Extract structured question data                                    │ │
│  │                                                                             │ │
│  │  F. Run Inline QC (7-8 checks)                                              │ │
│  │     └── If ALL pass → Complete                                              │ │
│  │     └── If ANY fail → Retry (up to 3 times)                                 │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            OUTPUT CSV                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Original columns + new columns:                                                 │
│  question_text, option_a/b/c/d, correct_answer, passage,                        │
│  qc_passed_checks, qc_total_checks, qc_failed_checks                            │
│                                                                                  │
│  Special: MP questions split into 2 rows (Part A, Part B)                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Input Files Required

### 1. `ck_gen - questions.csv` (User Input)

This is the primary input file containing passages and question specifications.

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `passage_id` | ✅ | Unique ID for the passage | `story-1` |
| `question_id` | ✅ | Unique ID for the question | `story-1-q1` |
| `passage_text` | ✅ | The full text content | (passage text) |
| `DOK` | ✅ | Depth of Knowledge (1-4) | `2` |
| `CCSS` | ✅ | Standard code | `RL.3.3` |
| `CCSS_description` | ⚪ | Optional (auto-looked up) | (description) |
| `difficulty` | ⚪ | Low/Medium/High | `Medium` |
| `question_type` | ✅ | MCQ, SR, or MP | `MCQ` |
| `grade` | ⚪ | Grade level | `3` |

**Example Row:**
```csv
passage_id,question_id,passage_text,DOK,CCSS,CCSS_description,difficulty,question_type,grade
story-1,story-1-q1,"The old lighthouse stood alone...",2,RL.3.3,"Describe characters...",Medium,MCQ,3
```

### 2. `ck_gen - prompts.json` (System File)

Contains all generation and QC prompts as a JSON array.

**Structure:**
```json
[
  {
    "function": "generate",      // or "quality_control"
    "name": "MCQ DOK 1",         // Prompt identifier
    "level": "mcq",              // mcq, short_response, multipart, distractors, question
    "prompt": "You are generating..."  // Full prompt text
  },
  // ... more prompts
]
```

**Prompt Types:**
- Generation: `MCQ DOK 1`, `MCQ DOK 2`, `MCQ DOK 3`, `SR DOK 1-4`, `MP DOK 2-3`
- QC: `grammatical_parallel`, `plausibility`, `homogeneity`, `specificity_balance`, `standard_alignment`, `clarity_precision`, `text_dependency`, `single_correct_answer`, `passage_reference`, `skill_integration`

### 3. `ck_gen - ccss.csv` (System File)

Maps CCSS standard codes to their full descriptions.

| Column | Description |
|--------|-------------|
| `grade` | Grade level (3-12) |
| `standard_code` | CCSS code (e.g., "RL.3.3") |
| `standard_description` | Full text of the standard |

**Contains:** 171 standards across grades 3-12 for RL (Reading Literature) and RI (Reading Informational Text).

### 4. `ck_gen - examples.csv` (System File)

Template questions used for pattern matching during MCQ generation.

| Column | Description |
|--------|-------------|
| `Standard` | CCSS code |
| `DOK` | Depth of Knowledge |
| `Difficulty` | Low/Medium/High |
| `question` | Example question text |
| `answer_A` | Choice A text |
| `answer_B` | Choice B text |
| `answer_C` | Choice C text |
| `answer_D` | Choice D text |
| `correct_answer` | Correct option letter |

---

## Prompt System

### Generation Prompts

#### MCQ DOK 1 Prompt (Full Text)

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

#### MCQ DOK 2 Prompt

Same structure as DOK 1 but with different requirements:

**DOK 2 Requirements:**
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Demonstrate understanding beyond simple recall

#### MCQ DOK 3 Prompt

**DOK 3 Requirements:**
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw conclusions based on evidence
- Make complex inferences or connections
- Demonstrate deep understanding

#### SR (Short Response) Prompts

Short Response prompts don't use examples. Output format:

```json
{
  "question": "exact question text including any specific instructions",
  "expected_response": "sample complete response showing what a full-credit answer would include",
  "key_details": ["detail 1", "detail 2", "detail 3"],
  "scoring_notes": "brief guidance on what constitutes a complete answer",
  "dok_justification": "explanation of why this is DOK X"
}
```

#### MP (Multipart) Prompts

Multipart questions have Part A and Part B. Output format:

```json
{
  "part_a": {
    "question": "exact text for Part A",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "A",
    "DOK": 1,
    "CCSS": "standard code"
  },
  "part_b": {
    "question": "exact text for Part B (builds on Part A)",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "B",
    "DOK": 2,
    "CCSS": "standard code"
  },
  "connection_rationale": "explanation of how Part B builds on Part A",
  "dok_justification": "explanation of why the combined question reaches DOK 2/3",
  "standard_assessment": "how this multipart question assesses the target standard"
}
```

### Prompt Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `{text_content}` | `passage_text` column | The passage to generate questions about |
| `{standard_code}` | `CCSS` column | e.g., "RL.3.3" |
| `{standard_description}` | Looked up from ccss.csv | Full text of the standard |
| `{existing_questions}` | Other questions for same passage | Prevents duplicates (often empty) |
| `{example_question}` | From examples.csv | Template question |
| `{example_choice_a/b/c/d}` | From examples.csv | Template choices |
| `{example_correct}` | From examples.csv | Template correct answer |

---

### QC Prompts

#### 1. `grammatical_parallel` (Distractors Level)

**Purpose:** Ensure all answer choices follow the same grammatical pattern.

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

#### 2. `plausibility` (Distractors Level)

**Purpose:** Ensure incorrect choices are believable distractors.

#### 3. `homogeneity` (Distractors Level)

**Purpose:** Ensure all choices belong to the same conceptual category.

#### 4. `specificity_balance` (Distractors Level)

**Purpose:** Ensure choices have similar levels of detail.

#### 5. `standard_alignment` (Question Level)

**Purpose:** Verify question assesses the assigned CCSS standard.

#### 6. `clarity_precision` (Question Level)

**Purpose:** Ensure question is clear and unambiguous.

#### 7. `text_dependency` (Question Level)

**Purpose:** Verify question requires reading the passage to answer.

#### 8. `single_correct_answer` (Question Level)

**Purpose:** Verify exactly one answer is defensibly correct.

#### 9. `passage_reference` (Question Level)

**Purpose:** Verify paragraph/line references are accurate.

#### 10. `skill_integration` (Question Set Level)

**Purpose:** Ensure question set covers multiple reading competencies.

---

## Step-by-Step Execution Flow

### Phase 1: Initialization

```python
class BulkQuestionGenerator:
    def __init__(self, api_key: str, max_workers: int = 5):
        self.api_key = api_key
        self.model = "claude-sonnet-4-5-20250929"
        self.temperature = 0.6
        self.max_workers = max_workers
        self.max_retries = 3
        self.base_delay = 1  # Base delay for exponential backoff
        
        # Load data files
        self.prompts = self._load_prompts()           # ck_gen - prompts.json
        self.ccss_standards = self._load_ccss_standards()  # ck_gen - ccss.csv → Dict
        self.examples = self._load_examples()         # ck_gen - examples.csv → DataFrame
        self.qc_prompts = self._get_quality_control_prompts()  # Filter QC prompts
```

### Phase 2: Find Generation Prompt

```python
def _find_generation_prompt(self, question_type: str, dok: int) -> Optional[Dict]:
    """Find the appropriate generation prompt based on question type and DOK level."""
    type_mapping = {
        'MCQ': f'MCQ DOK {dok}',
        'SR': f'SR DOK {dok}',
        'MP': f'MP DOK {dok}' if dok >= 2 else f'MP DOK 2'  # MP minimum is DOK 2
    }
    
    target_name = type_mapping.get(question_type.upper())
    
    for prompt in self.prompts:
        if prompt.get('function') == 'generate' and prompt.get('name') == target_name:
            return prompt
    
    return None
```

### Phase 3: Question Generation

```python
def generate_single_question(self, row: pd.Series, df: pd.DataFrame) -> Optional[Dict]:
    # 1. Determine prompt type
    question_type = row.get('question_type', 'MCQ')
    dok = int(row.get('DOK', 1))
    standard = row.get('CCSS', '')
    
    # 2. Find generation prompt
    prompt_config = self._find_generation_prompt(question_type, dok)
    if not prompt_config:
        return None
    
    # 3. Find matching example (MCQ only)
    example = None
    if question_type.upper() == 'MCQ':
        difficulty = row.get('difficulty', '')
        example = self._find_matching_example(standard, dok, question_type, difficulty)
    
    # 4. Fill prompt variables
    filled_prompt = self._fill_prompt_variables(
        prompt_config['prompt'], row, df, example
    )
    
    # 5. Call Claude API
    response_text = self._make_api_call_with_retry([
        {"role": "user", "content": filled_prompt}
    ])
    
    # 6. Parse and return result
    result = {
        'question_id': row.get('question_id', ''),
        'passage_id': row.get('passage_id', ''),
        'passage_text': row.get('passage_text', ''),
        'question_type': question_type,
        'dok': dok,
        'standard': standard,
        'generated_content': response_text,
        'prompt_used': prompt_config['name'],
        'example_used': example is not None,
        'timestamp': datetime.now().isoformat()
    }
    
    # Try to extract JSON from response
    parsed_json = self._parse_generated_question(response_text)
    if parsed_json:
        result['structured_content'] = parsed_json
    
    return result
```

### Phase 4: API Call with Retry

```python
def _make_api_call_with_retry(self, messages: List[Dict], max_tokens: int = 2000, 
                               temperature: float = None) -> str:
    if temperature is None:
        temperature = self.temperature
        
    for attempt in range(self.max_retries):
        try:
            client = anthropic.Anthropic(api_key=self.api_key)
            response = client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages
            )
            return response.content[0].text
            
        except Exception as e:
            if attempt == self.max_retries - 1:
                raise e
            
            # Exponential backoff with jitter
            delay = (self.base_delay * (2 ** attempt)) + random.uniform(0, 1)
            logger.warning(f"API call failed (attempt {attempt + 1}), retrying in {delay:.2f}s")
            time.sleep(delay)
    
    raise Exception("Max retries exceeded")
```

---

## Example Matching Algorithm

The system finds template examples for MCQ questions using a priority-based search:

```python
def _find_matching_example(self, standard: str, dok: int, question_type: str, 
                           difficulty: str = None) -> Optional[Dict]:
    """Find a matching example based on standard, DOK level, question type, and difficulty."""
    
    # Priority 1: Exact match (Standard + DOK + Difficulty)
    if difficulty:
        matches = self.examples[
            (self.examples['Standard'] == standard) & 
            (self.examples['DOK'] == dok) &
            (self.examples['Difficulty'].str.lower() == difficulty.lower())
        ]
        if not matches.empty:
            return self._format_example(matches.sample(n=1).iloc[0])
    
    # Priority 2: Standard + DOK (any difficulty)
    matches = self.examples[
        (self.examples['Standard'] == standard) & 
        (self.examples['DOK'] == dok)
    ]
    if not matches.empty:
        return self._format_example(matches.sample(n=1).iloc[0])
    
    # Priority 3: Same standard + matching difficulty (any DOK)
    if difficulty:
        matches = self.examples[
            (self.examples['Standard'] == standard) &
            (self.examples['Difficulty'].str.lower() == difficulty.lower())
        ]
        if not matches.empty:
            return self._format_example(matches.sample(n=1).iloc[0])
    
    # Priority 4: Same standard (any DOK, any difficulty)
    matches = self.examples[self.examples['Standard'] == standard]
    if not matches.empty:
        return self._format_example(matches.sample(n=1).iloc[0])
    
    # Priority 5: Same standard family + matching difficulty
    standard_family = standard.split('.')[0]  # RL or RI
    if difficulty:
        matches = self.examples[
            (self.examples['Standard'].str.startswith(standard_family)) &
            (self.examples['Difficulty'].str.lower() == difficulty.lower())
        ]
        if not matches.empty:
            return self._format_example(matches.sample(n=1).iloc[0])
    
    # Priority 6: Same standard family (any difficulty)
    matches = self.examples[self.examples['Standard'].str.startswith(standard_family)]
    if not matches.empty:
        return self._format_example(matches.sample(n=1).iloc[0])
    
    return None  # No match found
```

**Priority Order:**
1. Standard + DOK + Difficulty (exact match)
2. Standard + DOK (any difficulty)
3. Standard + Difficulty (any DOK)
4. Same standard (any DOK, any difficulty)
5. Standard family (e.g., RL.*) + Difficulty
6. Standard family (any difficulty)

---

## Quality Control System

### Checks by Question Type

| Question Type | Checks Run |
|---------------|------------|
| **MCQ** | grammatical_parallel, plausibility, homogeneity, specificity_balance, clarity_precision, single_correct_answer, passage_reference, length_check |
| **MP** | Same as MCQ + length_check for both parts |
| **SR** | standard_alignment, clarity_precision, text_dependency, passage_reference |

### Length Check (Hardcoded Rules)

```python
def _run_length_check(self, question_data: Dict, passage_text: str = "") -> Tuple[int, str]:
    choices = question_data.get('choices', {})
    correct_answer = question_data.get('correct_answer', '')
    
    # Get all choice texts and word counts
    choice_texts = list(choices.values())
    word_counts = [len(text.split()) for text in choice_texts]
    
    # Rule 1: If all choices < 4 words → automatic pass
    if all(count < 4 for count in word_counts):
        return 1, "All choices are less than 4 words"
    
    # Get correct answer and distractor lengths
    correct_text = choices.get(correct_answer, '')
    correct_char_length = len(correct_text)
    
    distractor_char_lengths = [
        len(text) for key, text in choices.items() 
        if key != correct_answer
    ]
    
    longest_distractor = max(distractor_char_lengths)
    shortest_distractor = min(distractor_char_lengths)
    
    # Rule 2: Correct answer > 110% of longest distractor → FAIL
    if correct_char_length > 1.1 * longest_distractor:
        return 0, f"Correct answer too long ({correct_char_length} vs {longest_distractor})"
    
    # Rule 3: Correct answer < 70% of shortest distractor → FAIL
    if correct_char_length < 0.7 * shortest_distractor:
        return 0, f"Correct answer too short ({correct_char_length} vs {shortest_distractor})"
    
    return 1, "Choice lengths are appropriately balanced"
```

### QC Response Parsing

```python
def _parse_qc_response(self, response_text: str) -> Tuple[int, str]:
    # Try XML parsing first
    if '<quality_check>' in response_text:
        # Extract <score> and <reasoning> from XML
        score_match = re.search(r'<score>(\d+)</score>', response_text)
        reasoning_match = re.search(r'<reasoning>(.*?)</reasoning>', response_text, re.DOTALL)
        
        if score_match:
            score = int(score_match.group(1))
            score = 1 if score > 0 else 0  # Normalize to 0 or 1
            reasoning = reasoning_match.group(1).strip() if reasoning_match else "No reasoning"
            return score, reasoning
    
    # Fallback to legacy parsing
    if '[1]' in response_text:
        return 1, "Legacy format: Contains [1]"
    elif '[0]' in response_text:
        return 0, "Legacy format: Contains [0]"
    
    # Last resort: keyword detection
    if any(word in response_text.lower() for word in ['correct', 'good', 'passes']):
        return 1, "Positive keywords detected"
    else:
        return 0, "No clear positive indicators"
```

---

## Parallel Processing Strategy

### Design Rationale

- **Within passage**: Sequential processing maintains context for `existing_questions`
- **Across passages**: Parallel processing maximizes throughput

### Implementation

```python
def process_questions_batch(self, input_file: str, output_file: str = None):
    df = pd.read_csv(input_file)
    
    # Group questions by passage
    passage_groups = {}
    for idx in range(len(df)):
        passage_id = df.iloc[idx].get('passage_id', 'unknown')
        if passage_id not in passage_groups:
            passage_groups[passage_id] = []
        passage_groups[passage_id].append(idx)
    
    # Process passages in parallel
    with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
        future_to_passage = {
            executor.submit(
                self._process_passage_questions, 
                passage_id, 
                indices, 
                df, 
                updated_df
            ): passage_id
            for passage_id, indices in passage_groups.items()
        }
        
        for future in as_completed(future_to_passage):
            passage_id = future_to_passage[future]
            try:
                passage_results = future.result()
                # Handle completed, failed_qc, failed_generation
            except Exception as e:
                logger.error(f"Exception processing passage {passage_id}: {e}")
```

### Retry Loop

```python
max_loops = 10  # Prevent infinite loops

while questions_to_generate and loop_count < max_loops:
    loop_count += 1
    
    # Generate and QC questions
    # ...
    
    # Questions that failed QC go back to retry list
    questions_to_generate = [
        idx for idx in questions_to_retry 
        if failed_attempts[idx] < self.max_retries  # 3 attempts max
    ]
```

---

## Output Format

### Output CSV Columns

| Column | Description |
|--------|-------------|
| (original columns) | All columns from input CSV |
| `passage` | Copy of passage_text |
| `question_text` | Generated question |
| `option_a` | Choice A |
| `option_b` | Choice B |
| `option_c` | Choice C |
| `option_d` | Choice D |
| `correct_answer` | Full text of correct answer |
| `qc_passed_checks` | Number of QC checks passed |
| `qc_total_checks` | Total QC checks run |
| `qc_failed_checks` | Semicolon-separated list of failed checks |

### MP Question Handling

Multipart questions are split into **two rows**:
- Row 1: Part A question with "Part A: " prefix
- Row 2: Part B question with "Part B: " prefix

Both rows share the same QC results and metadata.

---

## Configuration & Dependencies

### Python Dependencies

```
anthropic>=0.18.0
pandas>=2.0.0
python-dotenv>=1.0.0
```

### Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Key Configuration Values

```python
MODEL = "claude-sonnet-4-5-20250929"   # Claude model
TEMPERATURE = 0.6                       # Generation creativity (0-1)
QC_TEMPERATURE = 0                      # QC consistency (deterministic)
MAX_WORKERS = 5                         # Parallel passages
MAX_RETRIES = 3                         # Retry on QC failure
BASE_DELAY = 1                          # Exponential backoff base (seconds)
MAX_TOKENS = 2000                       # Generation response limit
QC_MAX_TOKENS = 500                     # QC response limit
```

---

## Known Limitations

### 1. `existing_questions` is Ineffective

The `_get_existing_questions()` method reads from the input CSV which typically has **empty** `question_text` columns. The intent is to show previously generated questions to avoid duplicates, but:

- Input CSV doesn't have generated questions yet
- Generated questions aren't persisted to a database
- Each run starts "fresh" with no memory of previous runs

### 2. No Cross-Run Persistence

There's no database or persistent storage. Questions generated in one run are not remembered in subsequent runs.

### 3. No Semantic Similarity Checking

Duplicate detection relies entirely on the LLM "noticing" similar questions in the prompt. There's no embedding-based or algorithmic similarity check.

### 4. No Built-in Rate Limiting

Relies only on exponential backoff after failures. No proactive throttling to prevent rate limits.

### 5. Memory Usage

Entire input CSV is loaded into memory. Large datasets may cause issues.

### 6. Single-Model Dependency

Hardcoded to Claude. No fallback to alternative models.

---

## Recreation Checklist

To recreate this system from scratch:

### Required Files

- [ ] `prompts.json` - All 9 generation + 10 QC prompts
- [ ] `ccss.csv` - 171 CCSS standards (grades 3-12)
- [ ] `examples.csv` - Template questions for pattern matching

### Core Functions

- [ ] Prompt variable filling (`{text_content}`, `{standard_code}`, etc.)
- [ ] Example matching with priority cascade
- [ ] API call with exponential backoff retry
- [ ] JSON parsing from LLM response (handle markdown code blocks)
- [ ] QC response parsing (XML format with fallbacks)
- [ ] Length check algorithm
- [ ] Parallel processing with passage grouping
- [ ] MP question splitting for output

### Configuration

- [ ] Model: `claude-sonnet-4-5-20250929` (or newer)
- [ ] Temperature: 0.6 for generation, 0 for QC
- [ ] Max workers: 5 (adjustable)
- [ ] Max retries: 3
- [ ] Exponential backoff with jitter

### Output Handling

- [ ] Preserve all input columns
- [ ] Add question_text, options, correct_answer
- [ ] Add QC result columns
- [ ] Split MP questions into separate rows

---

## Usage

```bash
# Basic usage
python bulk_question_generator.py input.csv

# With options
python bulk_question_generator.py input.csv --output output.csv --max-workers 3
```

### Command Line Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `input_file` | Input CSV file path | (required) |
| `--output` | Output CSV file path | `{input}_generated.csv` |
| `--max-workers` | Parallel workers | 5 |

---

*Document created: December 2024*
*Based on analysis of bulk_question_generator.py v1.0*

