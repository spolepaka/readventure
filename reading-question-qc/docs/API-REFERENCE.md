# API Reference

Complete reference for all classes, methods, and data structures in the Reading Question QC system.

---

## Table of Contents

1. [Question Generator](#question-generator)
2. [Bulk Question Generator](#bulk-question-generator)
3. [Question QC Analyzer](#question-qc-analyzer)
4. [Explanation QC Analyzer](#explanation-qc-analyzer)
5. [QC Pipeline](#qc-pipeline)
6. [Utility Functions](#utility-functions)
7. [Data Structures](#data-structures)

---

## Question Generator

**Module**: `question_generator.py`

### Class: `QuestionGenerator`

Single-batch question generation using Claude API.

#### Constructor

```python
def __init__(self, api_key: str)
```

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `api_key` | str | Anthropic API key |

**Attributes Initialized**:
- `self.client` - Anthropic client instance
- `self.model` - Model identifier (`"claude-sonnet-4-20250514"`)
- `self.temperature` - Generation temperature (`0.4`)
- `self.prompts` - Loaded prompts from JSON
- `self.ccss_standards` - Standards mapping dict
- `self.examples` - Examples DataFrame
- `self.questions_df` - Questions DataFrame

---

#### Method: `_load_prompts`

```python
def _load_prompts(self) -> List[Dict]
```

Load generation prompts from `ck_gen - prompts.json`.

**Returns**: List of prompt configuration dictionaries.

**Raises**: Exception if file not found or parse error.

---

#### Method: `_load_ccss_standards`

```python
def _load_ccss_standards(self) -> Dict[str, str]
```

Load CCSS standards from `ck_gen - ccss.csv`.

**Returns**: Dictionary mapping standard codes to descriptions.

**Example**:
```python
{
    "RL.3.1": "Ask and answer questions to demonstrate understanding...",
    "RI.3.2": "Determine the main idea of a text..."
}
```

---

#### Method: `_load_examples`

```python
def _load_examples(self) -> pd.DataFrame
```

Load template examples from `ck_gen - examples.csv`.

**Returns**: DataFrame with columns `Standard`, `DOK`, `Difficulty`, `question`, `answer_A/B/C/D`, `correct_answer`.

---

#### Method: `_find_matching_example`

```python
def _find_matching_example(
    self, 
    standard: str, 
    dok: int, 
    question_type: str, 
    difficulty: str = None
) -> Optional[Dict]
```

Find a matching example template for generation.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `standard` | str | CCSS standard code (e.g., "RL.3.1") |
| `dok` | int | Depth of Knowledge level (1-4) |
| `question_type` | str | "MCQ", "SR", or "MP" |
| `difficulty` | str | "Low", "Medium", or "High" (optional) |

**Returns**: Dictionary with example data or `None`.

**Return Format**:
```python
{
    'example_question': 'What does the word "bear" mean...',
    'example_choice_a': 'to make',
    'example_choice_b': 'to carry',
    'example_choice_c': 'to take on',
    'example_choice_d': 'to put up with',
    'example_correct': 'A'
}
```

**Matching Priority**:
1. Exact (standard + DOK + difficulty)
2. Standard + DOK
3. Standard + difficulty
4. Same standard
5. Standard family + difficulty
6. Standard family

---

#### Method: `_get_existing_questions`

```python
def _get_existing_questions(self, passage_id: str) -> str
```

Get previously generated questions for duplicate avoidance.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `passage_id` | str | Passage identifier |

**Returns**: Formatted string of existing questions or `"None"`.

---

#### Method: `_find_generation_prompt`

```python
def _find_generation_prompt(
    self, 
    question_type: str, 
    dok: int
) -> Optional[Dict]
```

Select the appropriate generation prompt.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `question_type` | str | "MCQ", "SR", or "MP" |
| `dok` | int | Depth of Knowledge (1-4) |

**Returns**: Prompt configuration dictionary or `None`.

**Prompt Mapping**:
- MCQ → `"MCQ DOK {dok}"`
- SR → `"SR DOK {dok}"`
- MP → `"MP DOK {dok}"` (min DOK 2)

---

#### Method: `_fill_prompt_variables`

```python
def _fill_prompt_variables(
    self, 
    prompt_text: str, 
    row: pd.Series, 
    example: Optional[Dict]
) -> str
```

Inject context variables into prompt template.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `prompt_text` | str | Raw prompt template |
| `row` | pd.Series | Question row from CSV |
| `example` | Dict | Example template data |

**Variables Replaced**:
- `{text_content}` → passage text
- `{standard_code}` → CCSS code
- `{standard_description}` → standard text
- `{existing_questions}` → previously generated questions
- `{example_question}` → template question
- `{example_choice_a/b/c/d}` → template choices
- `{example_correct}` → template answer

---

#### Method: `generate_question`

```python
def generate_question(self, row: pd.Series) -> Optional[Dict]
```

Generate a single question from a row.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `row` | pd.Series | Row with passage and metadata |

**Returns**: Generated question dictionary or `None` on failure.

**Return Format**:
```python
{
    'question_id': 'G3-U1-Ch01-Q01',
    'passage_id': 'G3-U1-Ch01',
    'passage_text': 'Full passage text...',
    'question_type': 'MCQ',
    'dok': 2,
    'standard': 'RL.3.1',
    'generated_content': 'Raw API response...',
    'prompt_used': 'MCQ DOK 2',
    'example_used': True,
    'timestamp': '2024-12-15T14:30:22',
    'structured_content': {  # Optional, if JSON parsed
        'question': 'What does...',
        'choices': {'A': '...', 'B': '...', 'C': '...', 'D': '...'},
        'correct_answer': 'A'
    }
}
```

---

#### Method: `generate_batch`

```python
def generate_batch(
    self, 
    start_idx: int = 0, 
    batch_size: int = 10, 
    output_file: str = None
) -> List[Dict]
```

Generate questions for a batch of rows.

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `start_idx` | int | 0 | Starting row index |
| `batch_size` | int | 10 | Number of questions |
| `output_file` | str | auto | Output JSON filename |

**Returns**: List of generated question dictionaries.

**Side Effects**: Writes results to JSON file.

---

## Bulk Question Generator

**Module**: `bulk_question_generator.py`

### Class: `BulkQuestionGenerator`

Parallel question generation with integrated QC and retry logic.

#### Constructor

```python
def __init__(self, api_key: str, max_workers: int = 5)
```

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `api_key` | str | required | Anthropic API key |
| `max_workers` | int | 5 | Max parallel workers |

**Additional Attributes**:
- `self.max_retries` - Maximum retry attempts (`3`)
- `self.base_delay` - Base delay for backoff (`1` second)
- `self.qc_prompts` - QC prompts dictionary

---

#### Method: `_make_api_call_with_retry`

```python
def _make_api_call_with_retry(
    self, 
    messages: List[Dict], 
    max_tokens: int = 2000, 
    temperature: float = None
) -> str
```

Make API call with exponential backoff retry.

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `messages` | List[Dict] | required | API messages |
| `max_tokens` | int | 2000 | Max response tokens |
| `temperature` | float | self.temperature | Sampling temperature |

**Retry Logic**:
```
delay = base_delay × 2^attempt + random(0, 1)
```

**Raises**: Exception after max retries exceeded.

---

#### Method: `_parse_generated_question`

```python
def _parse_generated_question(
    self, 
    generated_content: str
) -> Optional[Dict]
```

Parse generated content to extract structured data.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `generated_content` | str | Raw API response |

**Returns**: Parsed JSON dict or `None`.

**Handles**:
- JSON in code blocks (` ```json ... ``` `)
- Raw JSON strings
- Malformed responses

---

#### Method: `_extract_question_components`

```python
def _extract_question_components(
    self, 
    question_data: Dict
) -> Tuple[str, str, str, str, str, str]
```

Extract components for CSV output.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `question_data` | Dict | Structured question |

**Returns**: Tuple of `(question, option_a, option_b, option_c, option_d, correct_answer)`.

---

#### Method: `_extract_mp_question_parts`

```python
def _extract_mp_question_parts(
    self, 
    question_data: Dict
) -> Tuple[Tuple, Tuple]
```

Extract both parts of a multipart question.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `question_data` | Dict | MP question with `part_a` and `part_b` |

**Returns**: Two tuples, one for each part, each containing `(question, option_a, option_b, option_c, option_d, correct_answer)`.

---

#### Method: `generate_single_question`

```python
def generate_single_question(
    self, 
    row: pd.Series, 
    df: pd.DataFrame
) -> Optional[Dict]
```

Generate a single question with context awareness.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `row` | pd.Series | Current question row |
| `df` | pd.DataFrame | Full DataFrame for context |

**Returns**: Generated question dictionary or `None`.

---

#### Method: `_run_length_check`

```python
def _run_length_check(
    self, 
    question_data: Dict, 
    passage_text: str = ""
) -> Tuple[int, str]
```

Check if answer choice lengths are balanced.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `question_data` | Dict | Structured question |
| `passage_text` | str | Passage (unused) |

**Returns**: Tuple of `(score, reasoning)` where score is 0 or 1.

**Rules**:
- All choices ≤3 words → pass
- Correct answer >110% longest distractor → fail
- Correct answer <70% shortest distractor → fail

---

#### Method: `_run_quality_check`

```python
def _run_quality_check(
    self, 
    check_name: str, 
    question_data: Dict, 
    passage_text: str = ""
) -> Tuple[int, str]
```

Run a single QC check via API.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `check_name` | str | QC check identifier |
| `question_data` | Dict | Structured question |
| `passage_text` | str | Reading passage |

**Returns**: Tuple of `(score, reasoning)`.

---

#### Method: `run_quality_control`

```python
def run_quality_control(
    self, 
    generated_item: Dict
) -> Dict
```

Run full QC suite on a generated question.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `generated_item` | Dict | Generated question |

**Returns**: QC results dictionary.

**Return Format**:
```python
{
    'question_id': 'G3-U1-Ch01-Q01',
    'passage_id': 'G3-U1-Ch01',
    'question_type': 'MCQ',
    'overall_score': 0.9,
    'passed_checks': 9,
    'total_checks': 10,
    'checks': {
        'grammatical_parallel': {'score': 1, 'response': '...'},
        'plausibility': {'score': 1, 'response': '...'},
        # ...
    },
    'question_data': {...}
}
```

**Checks by Question Type**:

| Type | Checks Run |
|------|------------|
| MCQ | grammatical_parallel, plausibility, homogeneity, specificity_balance, clarity_precision, single_correct_answer, passage_reference, length_check |
| MP | Same as MCQ + length checks for both parts |
| SR | standard_alignment, clarity_precision, text_dependency, passage_reference |

---

#### Method: `_process_passage_questions`

```python
def _process_passage_questions(
    self, 
    passage_id: str, 
    question_indices: List[int], 
    df: pd.DataFrame, 
    updated_df: pd.DataFrame
) -> Dict
```

Process all questions for a passage sequentially.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `passage_id` | str | Passage identifier |
| `question_indices` | List[int] | Row indices to process |
| `df` | pd.DataFrame | Original DataFrame |
| `updated_df` | pd.DataFrame | DataFrame with completed questions |

**Returns**: Dictionary with `completed`, `failed_qc`, and `failed_generation` keys.

---

#### Method: `process_questions_batch`

```python
def process_questions_batch(
    self, 
    input_file: str, 
    output_file: str = None
) -> None
```

Process all questions with parallel execution.

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `input_file` | str | required | Input CSV path |
| `output_file` | str | auto | Output CSV path |

**Processing Flow**:
1. Group questions by passage
2. Process passages in parallel
3. Process questions within passages sequentially
4. Retry failed questions up to max_retries
5. Generate output CSV

---

## Question QC Analyzer

**Module**: `qc_pipeline/modules/question_qc.py`

### Class: `QuestionQCAnalyzer`

Async question quality control analyzer.

#### Constructor

```python
def __init__(
    self, 
    claude_client: anthropic.AsyncAnthropic,
    openai_client: Optional[AsyncOpenAI] = None,
    claude_model: str = "claude-3-sonnet-20240229",
    openai_model: str = "gpt-4-turbo",
    examples_df: Optional[pd.DataFrame] = None
)
```

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `claude_client` | AsyncAnthropic | required | Claude client |
| `openai_client` | AsyncOpenAI | None | OpenAI client |
| `claude_model` | str | claude-3-sonnet | Claude model |
| `openai_model` | str | gpt-4-turbo | OpenAI model |
| `examples_df` | DataFrame | None | Benchmark questions |

**Attributes**:
- `self.distractor_checks` - List of distractor check names
- `self.question_checks` - List of question check names
- `self.temperature` - QC temperature (`0`)

---

#### Method: `_run_claude_check`

```python
async def _run_claude_check(
    self, 
    check_name: str, 
    question_data: Dict[str, Any],
    passage_text: str, 
    grade: Optional[int] = None
) -> Tuple[int, str]
```

Run a QC check via Claude API.

**Returns**: Tuple of `(score, reasoning)`.

---

#### Method: `_run_openai_check`

```python
async def _run_openai_check(
    self, 
    check_name: str, 
    question_data: Dict[str, Any],
    passage_text: str, 
    grade: Optional[int] = None
) -> Tuple[int, str]
```

Run a QC check via OpenAI API.

**Handles**:
- `too_close` - JSON response format
- `difficulty_assessment` - With benchmark comparisons

---

#### Method: `analyze_question`

```python
async def analyze_question(
    self, 
    question_item: Dict[str, Any], 
    semaphore: Optional[asyncio.Semaphore] = None
) -> Dict[str, Any]
```

Analyze a single question across all dimensions.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `question_item` | Dict | Question data |
| `semaphore` | Semaphore | Concurrency limiter |

**Return Format**:
```python
{
    'question_id': 'Q123',
    'question_type': 'MCQ',
    'overall_score': 0.9,
    'total_checks_passed': 9,
    'total_checks_run': 10,
    'checks': {
        'grammatical_parallel': {'score': 1, 'response': '...', 'category': 'distractor'},
        # ...
    },
    'timestamp': '2024-12-15T14:30:22'
}
```

---

#### Method: `analyze_batch`

```python
async def analyze_batch(
    self, 
    questions: List[Dict[str, Any]],
    concurrency: int = 5
) -> List[Dict[str, Any]]
```

Analyze multiple questions concurrently.

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `questions` | List[Dict] | required | Questions to analyze |
| `concurrency` | int | 5 | Max concurrent calls |

---

## Explanation QC Analyzer

**Module**: `qc_pipeline/modules/explanation_qc.py`

### Class: `ExplanationQCAnalyzer`

Async explanation quality control analyzer.

#### Constructor

```python
def __init__(self, client: AsyncOpenAI, model: str = "gpt-4-turbo")
```

**Parameters**:
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `client` | AsyncOpenAI | required | OpenAI client |
| `model` | str | gpt-4-turbo | Model identifier |

**Attributes**:
- `self.correct_checks` - Checks for correct answer explanations
- `self.distractor_checks` - Checks for distractor explanations
- `self.all_checks` - Universal checks

---

#### Method: `_run_qc_check`

```python
async def _run_qc_check(
    self, 
    check_id: str, 
    explanation: str, 
    question: str,
    passage: str, 
    option: str, 
    grade_band: str, 
    correct: bool,
    correct_option: Optional[str] = None
) -> Tuple[bool, str]
```

Run a single explanation QC check.

**Returns**: Tuple of `(passed, reason)`.

---

#### Method: `analyze_explanation`

```python
async def analyze_explanation(
    self,
    explanation_item: Dict[str, Any],
    semaphore: Optional[asyncio.Semaphore] = None
) -> Dict[str, Any]
```

Analyze a single explanation.

**Input Format**:
```python
{
    'question_id': 'Q123',
    'option_label': 'A',
    'explanation': 'This is correct because...',
    'question': 'What does...',
    'passage': 'The passage text...',
    'option_text': 'to make',
    'correct_option_text': 'to carry',
    'is_correct': False,
    'grade': 5
}
```

**Return Format**:
```python
{
    'question_id': 'Q123',
    'option_label': 'A',
    'is_correct': False,
    'overall_score': 0.78,
    'total_checks_passed': 7,
    'total_checks_run': 9,
    'checks': {
        '04_specific_error': {'passed': True, 'reason': '...'},
        # ...
    },
    'timestamp': '2024-12-15T14:30:22'
}
```

---

## QC Pipeline

**Module**: `qc_pipeline/pipeline.py`

### Class: `QCPipeline`

Main orchestration class for QC operations.

#### Constructor

```python
def __init__(self, args: argparse.Namespace)
```

**Expected Args**:
- `args.input` - Input CSV path
- `args.output` - Output directory
- `args.mode` - "questions", "explanations", or "both"
- `args.examples` - Benchmark CSV path (optional)
- `args.concurrency` - Max concurrent calls
- `args.limit` - Row limit (0 = all)
- `args.claude_model` - Claude model name
- `args.openai_model` - OpenAI model name

---

#### Method: `run_question_qc`

```python
async def run_question_qc(
    self, 
    df: pd.DataFrame
) -> List[Dict[str, Any]]
```

Run question QC on DataFrame.

**Returns**: List of QC results.

**Output File**: `question_qc_{timestamp}.json`

---

#### Method: `run_explanation_qc`

```python
async def run_explanation_qc(
    self, 
    df: pd.DataFrame
) -> List[Dict[str, Any]]
```

Run explanation QC on DataFrame.

**Returns**: List of QC results.

**Output File**: `explanation_qc_{timestamp}.json`

---

#### Method: `run`

```python
async def run(self) -> None
```

Execute the complete pipeline.

**Outputs**:
- Question QC JSON (if mode includes questions)
- Explanation QC JSON (if mode includes explanations)
- Summary report JSON

---

## Utility Functions

**Module**: `qc_pipeline/utils.py`

### Function: `load_prompts`

```python
def load_prompts(prompts_file: Optional[str] = None) -> Dict[str, Any]
```

Load prompts from JSON file.

---

### Function: `parse_xml_response`

```python
def parse_xml_response(response_text: str) -> Tuple[int, str]
```

Parse XML-format QC response.

**Expected Format**:
```xml
<quality_check>
  <score>1</score>
  <reasoning>Explanation...</reasoning>
</quality_check>
```

**Fallback Parsing**:
- Looks for `[1]` or `[0]` markers
- Searches for 0/1 numbers
- Detects positive keywords

---

### Function: `parse_json_response`

```python
def parse_json_response(response_text: str) -> Optional[Dict[str, Any]]
```

Parse JSON from API response.

---

### Function: `fill_prompt_variables`

```python
def fill_prompt_variables(
    prompt_template: str, 
    variables: Dict[str, Any]
) -> str
```

Replace placeholders in prompt template.

**Supports**:
- `{variable}` format
- `[VARIABLE]` format

---

### Function: `clamp_grade_to_band`

```python
def clamp_grade_to_band(grade: int) -> str
```

Convert numeric grade to band.

**Returns**:
- Grades 3-5 → `"elementary"`
- Grades 6-8 → `"middle"`
- Grades 9-12 → `"high"`

---

### Function: `validate_env_vars`

```python
def validate_env_vars(*var_names: str) -> Dict[str, str]
```

Validate required environment variables.

**Raises**: SystemExit if any variable missing.

---

### Function: `calculate_pass_rate`

```python
def calculate_pass_rate(results: list) -> Dict[str, Any]
```

Calculate summary statistics from QC results.

**Returns**:
```python
{
    'total': 100,
    'passed': 85,
    'failed': 15,
    'pass_rate': 0.85,
    'average_score': 0.87
}
```

**Pass Threshold**: `overall_score >= 0.8`

---

## Data Structures

### Generated Question

```python
GeneratedQuestion = {
    'question_id': str,          # Unique identifier
    'passage_id': str,           # Passage identifier
    'passage_text': str,         # Full passage text
    'question_type': str,        # "MCQ", "SR", or "MP"
    'dok': int,                  # Depth of Knowledge (1-4)
    'standard': str,             # CCSS code
    'generated_content': str,    # Raw API response
    'prompt_used': str,          # Prompt name
    'example_used': bool,        # Whether template was used
    'timestamp': str,            # ISO timestamp
    'structured_content': {      # Optional parsed content
        'question': str,
        'choices': {'A': str, 'B': str, 'C': str, 'D': str},
        'correct_answer': str,
        'rationale': str
    }
}
```

### QC Result

```python
QCResult = {
    'question_id': str,
    'question_type': str,
    'overall_score': float,       # 0.0-1.0
    'total_checks_passed': int,
    'total_checks_run': int,
    'checks': {
        'check_name': {
            'score': int,         # 0 or 1
            'response': str,      # Reasoning
            'category': str       # "distractor" or "question"
        }
    },
    'timestamp': str
}
```

### Explanation QC Result

```python
ExplanationQCResult = {
    'question_id': str,
    'option_label': str,          # A, B, C, or D
    'is_correct': bool,
    'overall_score': float,
    'total_checks_passed': int,
    'total_checks_run': int,
    'checks': {
        'check_id': {
            'passed': bool,
            'reason': str
        }
    },
    'timestamp': str
}
```

### Prompt Configuration

```python
PromptConfig = {
    'function': str,              # "generate" or "quality_control"
    'name': str,                  # Identifier (e.g., "MCQ DOK 1")
    'level': str,                 # "mcq", "short_response", etc.
    'prompt': str,                # Full prompt text
    'response_format': str        # "xml" or "json" (QC only)
}
```

### Summary Statistics

```python
SummaryStats = {
    'total': int,
    'passed': int,
    'failed': int,
    'pass_rate': float,           # 0.0-1.0
    'average_score': float        # 0.0-1.0
}
```



