# CK Generation Scripts

This repository contains two scripts for generating and quality controlling educational questions using Claude Sonnet 4.0:

1. **`question_generator.py`** - Generates questions for each row in the questions CSV
2. **`quality_control.py`** - Validates generated questions against quality standards

## Prerequisites

1. **Python 3.8+**
2. **Anthropic API Key** - Get from https://console.anthropic.com/
3. **Environment Setup**:
   ```bash
   pip install -r requirements.txt
   ```
4. **Create a `.env` file** in the project directory with your API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

## Data Files Required

Make sure you have these files in the same directory:
- `ck_gen - prompts.json` - Contains generation and quality control prompts
- `ck_gen - questions.csv` - Main data source with passage text and metadata
- `ck_gen - ccss.csv` - Common Core State Standards mapping
- `ck_gen - examples.csv` - Template questions for pattern matching

## Usage

### 1. Question Generation

Generate questions using Claude Sonnet 4.0:

```bash
python question_generator.py --start 0 --batch-size 10
```

**Parameters:**
- `--start` (optional): Starting row index in the CSV (default: 0)
- `--batch-size` (optional): Number of questions to generate (default: 10)
- `--output` (optional): Custom output filename

**Example:**
```bash
# Generate first 5 questions
python question_generator.py --start 0 --batch-size 5

# Generate questions 10-19 with custom output file
python question_generator.py --start 10 --batch-size 10 --output my_questions.json
```

**Output:**
- JSON file with generated questions (timestamped filename by default)
- Each question includes metadata, prompt used, and structured content

### 2. Quality Control

Validate generated questions using Claude Sonnet 4.0 at 0 temperature:

```bash
python quality_control.py --input generated_questions_file.json
```

**Parameters:**
- `--input` (required): JSON file from question generation
- `--output` (optional): Custom output filename

**Example:**
```bash
python quality_control.py --input generated_questions_20241215_143022.json
```

**Output:**
- Quality control results JSON file
- Summary statistics JSON file
- Individual scores for each quality check

## Question Generation Process

The system automatically:

1. **Analyzes each row** in `ck_gen - questions.csv`
2. **Selects appropriate prompt** based on question type (MCQ/SR/MP) and DOK level (1-4)
3. **Finds matching examples** from `ck_gen - examples.csv` for template-based generation
4. **Fills prompt variables** with passage text, standards, and examples
5. **Generates questions** using Claude with specified parameters
6. **Extracts structured data** from JSON responses when available

### Supported Question Types:
- **MCQ** (Multiple Choice): DOK levels 1-3
- **SR** (Short Response): DOK levels 1-4  
- **MP** (Multipart): DOK levels 2-3

## Quality Control Checks

The system runs different checks based on question type:

### For Multiple Choice Questions (MCQ):
**Distractor Checks:**
- `grammatical_parallel` - Answer choices follow same grammatical pattern
- `plausibility` - Incorrect choices are believable distractors
- `homogeneity` - All choices belong to same conceptual category
- `specificity_balance` - Choices have similar levels of detail

**Question Checks:**
- `standard_alignment` - Question properly assesses assigned standard
- `clarity_precision` - Question is clear and unambiguous
- `text_dependency` - Requires reading passage to answer
- `single_correct_answer` - Exactly one defensibly correct answer
- `passage_reference` - Specific passage references are accurate

### For Short Response/Multipart Questions:
- `standard_alignment` - Question properly assesses assigned standard
- `clarity_precision` - Question is clear and unambiguous  
- `text_dependency` - Requires reading passage to answer
- `passage_reference` - Specific passage references are accurate

### Scoring:
- Each check returns 0 (fail) or 1 (pass)
- Overall score = (total passed checks) / (total checks run)
- Questions with ≥0.8 overall score are considered "passed"

## Example Workflow

```bash
# 1. Generate 20 questions starting from row 0
python question_generator.py --start 0 --batch-size 20

# 2. Quality control the generated questions
python quality_control.py --input generated_questions_20241215_143022.json

# 3. Review results in the quality control output files
```

## Output Files

### Question Generation Output:
```json
{
  "question_id": "G3-U1-Ch01-QQ01",
  "passage_id": "G3-U1-Ch01", 
  "question_type": "MCQ",
  "dok": 2,
  "standard": "RL.3.4",
  "generated_content": "...",
  "structured_content": {
    "question": "What does the word 'bear' mean as used in the passage?",
    "choices": {
      "A": "to make",
      "B": "to carry", 
      "C": "to take on",
      "D": "to put up with"
    },
    "correct_answer": "A"
  },
  "prompt_used": "MCQ DOK 2",
  "example_used": true,
  "timestamp": "2024-12-15T14:30:22"
}
```

### Quality Control Output:
```json
{
  "question_id": "G3-U1-Ch01-QQ01",
  "overall_score": 0.89,
  "total_checks_passed": 8,
  "total_checks_run": 9,
  "checks": {
    "grammatical_parallel": {
      "score": 1,
      "response": "[1]",
      "category": "distractor"
    },
    "standard_alignment": {
      "score": 1, 
      "response": "[1]",
      "category": "question"
    }
  }
}
```

## Configuration

### Model Settings:
- **Generation**: Claude Sonnet 4.0, temperature 0.4
- **Quality Control**: Claude Sonnet 4.0, temperature 0

### Prompt Variables:
The system automatically fills these variables in prompts:
- `{text_content}` - Passage text from CSV
- `{standard_code}` - CCSS standard code 
- `{standard_description}` - Full standard description
- `{example_question}` - Template question from examples
- `{example_choice_a-d}` - Template answer choices
- `{existing_questions}` - Previously generated questions for same passage

## Troubleshooting

### Common Issues:

1. **API Key Error**: Ensure your `.env` file contains a valid `ANTHROPIC_API_KEY` with sufficient credits
2. **Environment Variables**: Make sure the `.env` file is in the same directory as the scripts
3. **File Not Found**: Check that all required CSV/JSON files are in the current directory
4. **Large CSV**: The questions CSV is very large (>2MB) - the script handles this automatically
5. **JSON Parsing**: Some generated content may not parse as JSON - this is handled gracefully

### Rate Limiting:
- The Anthropic API has rate limits
- For large batches, consider smaller batch sizes
- Add delays between requests if needed

## Notes

- Generated questions follow templates from the examples CSV when available
- Quality control uses zero temperature for consistent evaluation
- All outputs include timestamps for tracking
- The system handles fallbacks when exact template matches aren't found
- Structured JSON output is extracted when available, otherwise raw text is preserved 