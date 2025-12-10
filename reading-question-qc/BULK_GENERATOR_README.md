# Bulk Question Generator

This script processes a CSV file with question specifications and generates all missing questions using parallel processing, with integrated quality control and retry logic.

## Features

1. **Parallel Processing**: Generates and quality-checks questions simultaneously using multiple workers
2. **Quality Control Integration**: Automatically runs QC checks on all generated questions
3. **Retry Logic**: Implements exponential backoff for API errors and retries failed questions
4. **Intelligent Filtering**: 
   - Questions failing >1 QC check are discarded and retried
   - Questions failing ≤1 QC check are tentatively accepted
5. **Complete Output**: Creates a CSV with all original columns plus generated question data

## Usage

```bash
python bulk_question_generator.py input_file.csv [--output output_file.csv] [--max-workers 5]
```

### Arguments

- `input_file.csv`: CSV file with question specifications (required)
- `--output`: Output file name (optional, defaults to `{input_filename}_generated.csv`)
- `--max-workers`: Number of parallel workers (optional, defaults to 5)

## Input CSV Format

The input CSV must contain these columns:
- `passage_id`: Identifier for the text passage
- `passage_title`: Title of the passage
- `question_id`: Unique identifier for each question
- `passage_text`: Full text of the passage
- `DOK`: Depth of Knowledge level (1-4)
- `CCSS`: Common Core State Standard code
- `CCSS_description`: Description of the standard
- `difficulty`: Difficulty level (Low, Medium, High)
- `question_type`: Type of question (MCQ, SR, MP)

## Output CSV Format

The output CSV includes all original columns plus:
- `passage`: The passage text (duplicate of passage_text for convenience)
- `option_a`: First answer choice
- `option_b`: Second answer choice
- `option_c`: Third answer choice
- `option_d`: Fourth answer choice
- `correct_answer`: Full text of the correct answer option
- `question_text`: The generated question text
- `qc_passed_checks`: Number of QC checks passed
- `qc_total_checks`: Total number of QC checks run
- `qc_failed_checks`: Names of failed QC checks (semicolon-separated)

## Quality Control Checks

The script runs different QC checks based on question type:

### MCQ and MP Questions
- **Distractor Checks**: grammatical_parallel, plausibility, homogeneity, specificity_balance
- **Question Checks**: standard_alignment, clarity_precision, text_dependency, single_correct_answer, passage_reference

### SR (Short Response) Questions
- **Question Checks**: standard_alignment, clarity_precision, text_dependency, passage_reference

## Processing Logic

1. **Generation Phase**: All questions are generated in parallel
2. **QC Phase**: Quality control is run in parallel on all generated questions
3. **Filtering Phase**: 
   - Questions with >1 failed QC check are discarded and retried
   - Questions with ≤1 failed QC check are accepted
4. **Retry Phase**: Failed questions are retried up to 3 times with exponential backoff
5. **Output Phase**: Final CSV is generated with all completed questions

## Configuration

Ensure your `.env` file contains:
```
ANTHROPIC_API_KEY=your_api_key_here
```

## Dependencies

- pandas
- anthropic
- python-dotenv
- concurrent.futures (built-in)

## Example

```bash
# Generate questions from questions.csv with 8 parallel workers
python bulk_question_generator.py "ck_gen - questions.csv" --max-workers 8 --output my_generated_questions.csv
```

This will process all questions in the input CSV and create `my_generated_questions.csv` with all the generated content.

## Error Handling

- API errors are retried with exponential backoff
- Questions that fail generation are retried up to 3 times
- Questions exceeding retry limits are skipped but logged
- Final statistics show completion rate

## Performance Notes

- Default 5 workers provides good balance of speed and API rate limiting
- Increase workers for faster processing (watch for API rate limits)
- Large CSV files may take considerable time depending on question count
- Progress is logged throughout the process 