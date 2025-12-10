# Reading Question Quality Control System - Complete Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Data Files & Formats](#data-files--formats)
5. [Quality Control Checks](#quality-control-checks)
6. [Prompt Engineering](#prompt-engineering)
7. [Processing Flows](#processing-flows)
8. [API Integration](#api-integration)
9. [Configuration Reference](#configuration-reference)
10. [Troubleshooting Guide](#troubleshooting-guide)

---

## System Overview

The Reading Question Quality Control System is a Python-based pipeline for **generating and validating reading comprehension assessment items** using Large Language Models (Claude and GPT). The system is designed to produce high-quality, standards-aligned multiple-choice questions (MCQ), short response (SR), and multipart (MP) questions that align with Common Core State Standards (CCSS).

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **Question Generation** | Creates reading comprehension questions from passage text using templated prompts |
| **Quality Control** | Validates questions across 10-12 quality dimensions |
| **Explanation QC** | Evaluates student-facing feedback for answer choices |
| **Bulk Processing** | Parallel processing with retry logic for large question sets |
| **DOK Alignment** | Supports Depth of Knowledge levels 1-4 |
| **CCSS Compliance** | Generates questions aligned to specific reading standards |

### System Goals

1. **Scalability**: Process hundreds of questions with parallel execution
2. **Quality Assurance**: Multi-dimensional validation ensures assessment validity
3. **Standards Alignment**: Questions directly assess Common Core reading standards
4. **Consistency**: Templated generation ensures uniform question quality
5. **Feedback Support**: Validates explanations for correct answers and distractors

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INPUT DATA LAYER                             │
├──────────────────┬──────────────────┬───────────────────────────────┤
│ ck_gen - ccss.csv│ck_gen - prompts  │ ck_gen - examples.csv         │
│ (Standards DB)   │.json (Prompts)   │ (Template Questions)          │
└────────┬─────────┴────────┬─────────┴───────────┬───────────────────┘
         │                  │                     │
         └──────────────────┼─────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     GENERATION ENGINE                                │
├─────────────────────────────────────────────────────────────────────┤
│  question_generator.py      │    bulk_question_generator.py         │
│  - Single question mode     │    - Parallel processing              │
│  - Template matching        │    - Automatic QC integration         │
│  - Example lookup           │    - Retry with exponential backoff   │
└─────────────────────────────┴───────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   QUALITY CONTROL ENGINE                             │
├─────────────────────────────────────────────────────────────────────┤
│  qc_pipeline/                                                        │
│  ├── pipeline.py          - Orchestration & coordination            │
│  ├── modules/                                                        │
│  │   ├── question_qc.py   - Question validation (10-11 checks)      │
│  │   └── explanation_qc.py - Explanation validation (9-12 checks)   │
│  ├── config/prompts.json  - QC prompt definitions                   │
│  └── utils.py             - Shared utilities                        │
└─────────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        OUTPUT LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│  - Generated questions CSV with QC scores                           │
│  - JSON results with per-check details                               │
│  - Summary statistics and reports                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
reading-question-qc/
├── question_generator.py          # Single-batch question generation
├── bulk_question_generator.py     # Parallel bulk generation with QC
├── ck_gen - prompts.json          # Generation prompts (MCQ/SR/MP by DOK)
├── ck_gen - ccss.csv              # CCSS standards database (grades 3-12)
├── ck_gen - examples.csv          # Template questions for generation
├── qc_pipeline/                   # Unified QC system
│   ├── __init__.py
│   ├── pipeline.py                # Main orchestrator
│   ├── modules/
│   │   ├── __init__.py
│   │   ├── question_qc.py         # Question QC analyzer
│   │   └── explanation_qc.py      # Explanation QC analyzer
│   ├── config/
│   │   └── prompts.json           # QC prompt definitions
│   └── utils.py                   # Shared utilities
├── README.md                      # Basic usage documentation
├── BULK_GENERATOR_README.md       # Bulk processing documentation
└── .env                           # API keys (not in repo)
```

---

## Core Components

### 1. Question Generator (`question_generator.py`)

The single-batch question generator processes rows from an input CSV and generates questions using Claude's API.

#### Class: `QuestionGenerator`

```python
class QuestionGenerator:
    def __init__(self, api_key: str)
    def generate_question(self, row: pd.Series) -> Optional[Dict]
    def generate_batch(self, start_idx: int, batch_size: int, output_file: str) -> List[Dict]
```

#### Key Methods

| Method | Purpose |
|--------|---------|
| `_load_prompts()` | Load generation prompts from JSON |
| `_load_ccss_standards()` | Load CCSS standards mapping |
| `_load_examples()` | Load template questions for pattern matching |
| `_find_matching_example()` | Find best example based on standard, DOK, difficulty |
| `_find_generation_prompt()` | Select prompt by question type and DOK level |
| `_fill_prompt_variables()` | Inject context into prompt template |
| `generate_question()` | Generate a single question via Claude API |

#### Example Matching Priority

The system uses a cascading priority for finding template examples:

1. **Exact match**: Same standard + DOK + difficulty
2. **Standard + DOK**: Same standard and DOK (any difficulty)
3. **Standard + Difficulty**: Same standard (different DOK) + matching difficulty
4. **Same Standard**: Any DOK, any difficulty
5. **Standard Family + Difficulty**: Same family (RL or RI) + matching difficulty
6. **Standard Family**: Same family (any DOK/difficulty)

---

### 2. Bulk Question Generator (`bulk_question_generator.py`)

The bulk generator extends the base generator with parallel processing, integrated QC, and retry logic.

#### Class: `BulkQuestionGenerator`

```python
class BulkQuestionGenerator:
    def __init__(self, api_key: str, max_workers: int = 5)
    def process_questions_batch(self, input_file: str, output_file: str) -> None
    def run_quality_control(self, generated_item: Dict) -> Dict
```

#### Key Features

| Feature | Implementation |
|---------|----------------|
| **Parallel Processing** | `ThreadPoolExecutor` with configurable workers |
| **Passage-Aware Batching** | Sequential processing within passages to maintain context |
| **Exponential Backoff** | Base delay × 2^attempt + jitter |
| **Automatic QC** | Questions failing QC are regenerated |
| **Length Check** | Validates answer choice lengths are balanced |

#### Processing Flow

```
1. Load input CSV
2. Group questions by passage_id
3. For each passage (parallel):
   a. Generate questions sequentially within passage
   b. Run QC on each generated question
   c. Track existing questions for duplicate prevention
4. Questions failing QC → retry queue
5. Repeat until all questions pass or max retries exceeded
6. Generate output CSV with QC scores
```

---

### 3. Question QC Module (`qc_pipeline/modules/question_qc.py`)

Comprehensive question validation across distractor and question quality dimensions.

#### Class: `QuestionQCAnalyzer`

```python
class QuestionQCAnalyzer:
    def __init__(
        self, 
        claude_client: anthropic.AsyncAnthropic,
        openai_client: Optional[AsyncOpenAI],
        claude_model: str,
        openai_model: str,
        examples_df: Optional[pd.DataFrame]
    )
    async def analyze_question(self, question_item: Dict) -> Dict
    async def analyze_batch(self, questions: List[Dict], concurrency: int) -> List[Dict]
```

#### Check Categories

**Distractor Checks (6)**:
- `grammatical_parallel` - Consistent grammatical structure
- `plausibility` - Believable wrong answers
- `homogeneity` - Same conceptual category
- `specificity_balance` - Similar detail levels
- `too_close` - Not too similar to correct answer (OpenAI)
- `length_check` - Balanced word/character counts (synchronous)

**Question Checks (5)**:
- `standard_alignment` - Assesses target standard
- `clarity_precision` - Clear, unambiguous wording
- `single_correct_answer` - Exactly one defensible answer
- `passage_reference` - Accurate structural references
- `difficulty_assessment` - Grade-appropriate (OpenAI + benchmarks)

---

### 4. Explanation QC Module (`qc_pipeline/modules/explanation_qc.py`)

Validates student-facing feedback for answer explanations.

#### Class: `ExplanationQCAnalyzer`

```python
class ExplanationQCAnalyzer:
    def __init__(self, client: AsyncOpenAI, model: str)
    async def analyze_explanation(self, explanation_item: Dict) -> Dict
    async def analyze_batch(self, explanations: List[Dict], concurrency: int) -> List[Dict]
```

#### Check Categories

**For Correct Answers (3 checks)**:
- `01_correctness_explanation` - Explains why answer is correct
- `02_textual_evidence` - References specific passage evidence
- `03_skill_reinforcement` - Names the reading skill used

**For Distractors (6 checks)**:
- `04_specific_error` - Explains why this choice is wrong
- `05_misconception_diagnosis` - Identifies the error type
- `06_textual_refutation` - Uses passage to contradict
- `07_correct_guidance` - Guides toward correct answer
- `08_actionable_strategy` - Provides future tips
- `09_reasoning_model` - Demonstrates correct thinking

**Universal Checks (3 checks)**:
- `10_tone` - Encouraging, supportive language
- `11_conciseness` - 1-4 sentences
- `12_grade_appropriateness` - Matches target grade level

---

### 5. Pipeline Orchestrator (`qc_pipeline/pipeline.py`)

Main coordination script for running QC on existing question sets.

#### Class: `QCPipeline`

```python
class QCPipeline:
    def __init__(self, args: argparse.Namespace)
    async def run_question_qc(self, df: pd.DataFrame) -> List[Dict]
    async def run_explanation_qc(self, df: pd.DataFrame) -> List[Dict]
    async def run(self) -> None
```

#### Execution Modes

| Mode | Runs |
|------|------|
| `questions` | Question QC only |
| `explanations` | Explanation QC only |
| `both` | Question + Explanation QC |

---

## Data Files & Formats

### 1. CCSS Standards (`ck_gen - ccss.csv`)

Contains Common Core State Standards for Reading Literature (RL) and Reading Informational Text (RI) for grades 3-12.

```csv
grade,standard_code,standard_description
3,RL.3.1,"Ask and answer questions to demonstrate understanding..."
3,RL.3.2,"Recount stories, including fables, folktales..."
...
```

**Fields**:
- `grade`: Numeric grade level (3-12)
- `standard_code`: CCSS identifier (e.g., RL.3.1, RI.5.4)
- `standard_description`: Full standard text

**Standard Families**:
- **RL (Reading Literature)**: Standards for fiction, poetry, drama
- **RI (Reading Informational)**: Standards for nonfiction text

---

### 2. Generation Prompts (`ck_gen - prompts.json`)

Contains all prompts for question generation and quality control.

```json
[
  {
    "function": "generate",      // "generate" or "quality_control"
    "name": "MCQ DOK 1",         // Prompt identifier
    "level": "mcq",              // Question type
    "prompt": "You are generating..." // Full prompt text
  }
]
```

**Prompt Types**:

| Function | Names | Purpose |
|----------|-------|---------|
| `generate` | MCQ DOK 1/2/3 | Multiple choice generation |
| `generate` | SR DOK 1/2/3/4 | Short response generation |
| `generate` | MP DOK 2/3 | Multipart question generation |
| `quality_control` | grammatical_parallel, etc. | QC validation prompts |

**Prompt Variables** (auto-filled):
- `{text_content}` - Passage text
- `{standard_code}` - CCSS code
- `{standard_description}` - Standard description
- `{example_question}` - Template question
- `{example_choice_a/b/c/d}` - Template choices
- `{example_correct}` - Template correct answer
- `{existing_questions}` - Previously generated questions

---

### 3. Example Questions (`ck_gen - examples.csv`)

Template questions used for pattern-matching during generation.

```csv
Standard,DOK,Difficulty,question,answer_A,answer_B,answer_C,answer_D,correct_answer
RL.3.1,1,Medium,"What happens first...","Event A","Event B","Event C","Event D",A
```

**Fields**:
- `Standard`: CCSS standard code
- `DOK`: Depth of Knowledge level (1-4)
- `Difficulty`: Low/Medium/High
- `question`: Example question text
- `answer_A/B/C/D`: Answer choices
- `correct_answer`: Correct choice letter

---

### 4. Input Questions CSV

Expected format for bulk processing:

```csv
passage_id,passage_title,question_id,passage_text,DOK,CCSS,CCSS_description,difficulty,question_type
G3-U1-Ch01,Title,G3-U1-Ch01-Q01,Full passage...,2,RL.3.1,Standard text...,Medium,MCQ
```

**Required Columns**:
- `passage_id`: Unique passage identifier
- `question_id`: Unique question identifier
- `passage_text`: Full reading passage
- `DOK`: Depth of Knowledge (1-4)
- `CCSS`: Standard code
- `question_type`: MCQ, SR, or MP

**Optional Columns**:
- `passage_title`: Passage title
- `CCSS_description`: Standard description
- `difficulty`: Low/Medium/High
- `grade`: Numeric grade level

---

### 5. Output Format

Generated questions CSV includes original columns plus:

```csv
passage,question_text,option_a,option_b,option_c,option_d,correct_answer,qc_passed_checks,qc_total_checks,qc_failed_checks
```

**Added Columns**:
- `passage`: Copy of passage text
- `question_text`: Generated question
- `option_a/b/c/d`: Answer choices
- `correct_answer`: Full text of correct answer
- `qc_passed_checks`: Number of QC checks passed
- `qc_total_checks`: Total QC checks run
- `qc_failed_checks`: Semicolon-separated list of failed checks

---

## Quality Control Checks

### Distractor Quality Checks

#### 1. Grammatical Parallelism
**Purpose**: Ensure all answer choices follow the same grammatical pattern.

**Good Examples**:
- All infinitive phrases: "to make", "to carry", "to take"
- All noun phrases: "the main character", "the setting", "the theme"

**Bad Examples**:
- Mixed structures: "to make", "carrying", "he takes"

#### 2. Plausibility
**Purpose**: Verify incorrect choices are believable distractors.

**Good Distractors**:
- Represent common misconceptions
- Logically related to the question
- Could fool students with partial understanding

**Bad Distractors**:
- Obviously wrong to any student
- Completely unrelated to the topic

#### 3. Homogeneity
**Purpose**: Confirm all choices belong to the same conceptual category.

**Good Examples**:
- Word meaning question → all choices are definitions
- Character question → all choices are character traits

**Bad Examples**:
- Mix of definitions and plot events
- Mix of themes and specific facts

#### 4. Specificity Balance
**Purpose**: Ensure similar detail levels across choices.

**Good Examples**:
- All general: "happy", "sad", "angry"
- All specific: "photosynthesis", "respiration", "transpiration"

**Bad Examples**:
- "sad" vs "experiencing deep melancholy"

#### 5. Too-Close Detection (OpenAI)
**Purpose**: Identify distractors semantically too similar to the correct answer.

**Too-Close Criteria**:
- Synonymous or near-synonymous wording
- Differs only in degree/intensity
- Equally supported by passage evidence
- Both could be considered correct

#### 6. Length Balance
**Purpose**: Ensure the correct answer isn't identifiable by length.

**Rules**:
- Correct answer cannot be >10% longer than longest distractor
- Correct answer cannot be >30% shorter than shortest distractor
- All choices ≤3 words automatically pass

---

### Question Quality Checks

#### 7. Standard Alignment
**Purpose**: Verify the question directly assesses the assigned CCSS standard.

**Validation**:
- Question tests the standard's specific skill
- Not a tangentially related skill
- Appropriate cognitive demand for the standard

#### 8. Clarity & Precision
**Purpose**: Ensure the question is clearly written and unambiguous.

**Issues Detected**:
- Ambiguous pronouns
- Double negatives
- Overly complex sentences
- Vague language
- Multiple interpretations

#### 9. Single Correct Answer
**Purpose**: Verify exactly one defensibly correct answer exists.

**Red Flags**:
- Multiple answers could be argued correct
- Correct answer requires unsupported inferences
- Opinion questions framed as facts

#### 10. Passage Reference Accuracy
**Purpose**: Validate specific passage references are accurate.

**Checks**:
- Paragraph numbers exist
- Line numbers are valid
- Section titles exist
- Quoted phrases appear in text

#### 11. Difficulty Assessment (OpenAI + Benchmarks)
**Purpose**: Verify the question is appropriate for the target grade level.

**Analysis Dimensions**:
- Level of inference required
- Distractor difficulty
- Comparison to benchmark questions

---

## Prompt Engineering

### Generation Prompt Structure

Each generation prompt follows this structure:

```
1. ROLE DEFINITION
   "You are generating a DOK X question type for grade Y..."

2. INPUT DATA
   - Text Section/Passage: {text_content}
   - Target Standard: {standard_code} - {standard_description}
   - DOK Level: X
   - Example Question (template)

3. TASK INSTRUCTIONS
   - Template Analysis Instructions
   - DOK-Level Requirements
   - Adaptation Process

4. QUALITY REQUIREMENTS
   - Template Fidelity
   - Text Dependency
   - Grade Appropriateness
   - Length Balance constraints

5. OUTPUT FORMAT
   ```json
   {
     "question": "...",
     "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},
     "correct_answer": "A",
     "DOK": 1,
     "CCSS": "...",
     "rationale": "..."
   }
   ```
```

### QC Prompt Structure

QC prompts follow this XML response format:

```
1. EVALUATION CONTEXT
   - What aspect is being evaluated
   - Input data (question, choices, passage)

2. EVALUATION CRITERIA
   - Good examples
   - Bad examples
   - Specific rules

3. OUTPUT INSTRUCTIONS
   <quality_check>
     <score>0|1</score>
     <reasoning>Explanation...</reasoning>
   </quality_check>
```

### DOK Level Guidelines

| DOK | Cognitive Process | Example Verbs |
|-----|-------------------|---------------|
| 1 | Recall & Reproduction | Identify, locate, recall, recognize |
| 2 | Skills & Concepts | Classify, compare, infer, explain |
| 3 | Strategic Thinking | Analyze, evaluate, synthesize, conclude |
| 4 | Extended Thinking | Create, design, connect across sources |

---

## Processing Flows

### Single Question Generation Flow

```
Input Row
    ↓
Find Generation Prompt (by type + DOK)
    ↓
Find Matching Example (by standard + DOK + difficulty)
    ↓
Fill Prompt Variables
    ↓
Call Claude API
    ↓
Parse JSON Response
    ↓
Return Structured Question
```

### Bulk Processing Flow

```
Load Input CSV
    ↓
Group by passage_id
    ↓
┌─────────────────────────────────────┐
│ For Each Passage (Parallel)         │
│   ↓                                 │
│   For Each Question (Sequential)    │
│     ↓                               │
│     Generate Question               │
│     ↓                               │
│     Run QC                          │
│     ↓                               │
│     Pass? → Add to completed        │
│     Fail? → Add to retry queue      │
│   ↓                                 │
│   Update passage context            │
└─────────────────────────────────────┘
    ↓
Retry Failed Questions (up to 3x)
    ↓
Generate Output CSV
```

### QC Pipeline Flow

```
Load Input CSV
    ↓
Extract Structured Content
    ↓
┌───────────────────────────────────┐
│ Question QC (Concurrent)          │
│   • Run distractor checks         │
│   • Run question checks           │
│   • Run length check              │
│   • Calculate overall score       │
└───────────────────────────────────┘
    ↓
┌───────────────────────────────────┐
│ Explanation QC (Concurrent)       │
│   • Identify correct/distractor   │
│   • Run appropriate checks        │
│   • Calculate overall score       │
└───────────────────────────────────┘
    ↓
Generate JSON Results
    ↓
Create Summary Report
```

---

## API Integration

### Anthropic Claude API

**Used For**:
- Question generation
- Most QC checks (XML response format)

**Configuration**:
```python
client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
model = "claude-sonnet-4-20250514"
temperature = 0.4  # Generation
temperature = 0    # QC
```

**Request Format**:
```python
response = client.messages.create(
    model=self.model,
    max_tokens=2000,
    temperature=0.4,
    messages=[{"role": "user", "content": prompt}]
)
```

### OpenAI API

**Used For**:
- Too-close detection (JSON mode)
- Difficulty assessment
- Explanation QC

**Configuration**:
```python
client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))
model = "gpt-4-turbo"
response_format = {"type": "json_object"}
```

**Request Format**:
```python
response = await client.chat.completions.create(
    model=self.model,
    messages=[{"role": "user", "content": prompt}],
    response_format={"type": "json_object"}
)
```

### Error Handling

**Retry Logic**:
```python
for attempt in range(max_retries):
    try:
        return make_api_call()
    except Exception as e:
        delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
        time.sleep(delay)
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API authentication |
| `OPENAI_API_KEY` | Conditional | GPT API for some checks |

### Command-Line Arguments

#### question_generator.py

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--start` | int | 0 | Starting row index |
| `--batch-size` | int | 10 | Questions to generate |
| `--output` | str | auto | Output filename |

#### bulk_question_generator.py

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `input_file` | str | required | Input CSV path |
| `--output` | str | auto | Output CSV path |
| `--max-workers` | int | 5 | Parallel workers |

#### pipeline.py

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--input` | str | required | Input CSV path |
| `--output` | str | required | Output directory |
| `--mode` | str | questions | questions/explanations/both |
| `--examples` | str | None | Benchmark CSV |
| `--concurrency` | int | 5 | Max concurrent calls |
| `--limit` | int | 0 | Limit rows (0=all) |
| `--claude-model` | str | claude-sonnet-4-5 | Claude model |
| `--openai-model` | str | gpt-5 | OpenAI model |

---

## Troubleshooting Guide

### Common Issues

#### 1. "ANTHROPIC_API_KEY not found"

**Cause**: Missing or invalid `.env` file.

**Solution**:
```bash
# Create .env file
echo "ANTHROPIC_API_KEY=sk-ant-your-key" > .env
```

#### 2. "No prompt found for X DOK Y"

**Cause**: Missing prompt in `ck_gen - prompts.json`.

**Solution**: Verify prompts exist for your question type and DOK level.

#### 3. "Could not parse generated content"

**Cause**: Claude returned non-JSON response.

**Solution**: 
- Check model temperature (lower = more consistent)
- Verify prompt explicitly requests JSON format

#### 4. Questions Failing Multiple QC Checks

**Cause**: Poor prompt matching or insufficient examples.

**Solutions**:
- Add more template examples to `ck_gen - examples.csv`
- Verify passage quality is sufficient
- Check standard alignment

#### 5. Rate Limiting Errors

**Cause**: Too many concurrent API calls.

**Solutions**:
- Reduce `--max-workers`
- System will auto-retry with exponential backoff

#### 6. "No benchmark questions for grade X"

**Cause**: Missing grade in benchmark file.

**Solution**: Add benchmark questions for all target grades.

### Performance Optimization

| Scenario | Recommendation |
|----------|----------------|
| Large CSV (1000+ questions) | Use batch processing with `--max-workers 3-5` |
| API rate limits | Reduce workers, increase retry delay |
| Memory issues | Process in smaller batches |
| Slow processing | Increase workers (watch rate limits) |

### Logging

Enable debug logging for troubleshooting:

```python
logging.basicConfig(level=logging.DEBUG)
```

Log files include:
- API call timestamps
- Per-question generation status
- QC check scores and responses
- Error stack traces



