# Question Bank Extender Pipeline

Generates sibling questions for existing reading comprehension questions to expand the question bank.

## Purpose

- **1 sibling** per guiding question
- **4 siblings** per quiz question

Each sibling maintains the **same DOK, difficulty, CCSS, and passage/section** as the original while testing different aspects.

## Files

| File | Description |
|------|-------------|
| `question_bank_extender.py` | Main script |
| `qb_extend prompts.json` | DOK-specific prompt templates (DOK 1, 2, 3) |
| `ck_gen - ccss.csv` | CCSS standard descriptions |
| `requirements.txt` | Python dependencies |
| `inputs/` | Place input CSV files here |
| `outputs/` | Generated questions and checkpoints |

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set API key:**
   ```bash
   # Create .env file
   echo "ANTHROPIC_API_KEY=your-api-key-here" > .env
   ```
   
   Or pass via command line: `--api-key YOUR_KEY`

## Usage

```bash
python question_bank_extender.py \
    --input inputs/qti_existing_questions.csv \
    --output outputs/extended_questions.csv \
    --checkpoint outputs/checkpoints/
```

### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `--input`, `-i` | Input CSV with existing questions | Yes |
| `--output`, `-o` | Output CSV for generated questions | Yes |
| `--checkpoint`, `-c` | Directory for checkpoint files | No (default: `checkpoints/`) |
| `--limit`, `-l` | Limit articles to process (0 = all) | No (default: 0) |
| `--api-key` | Anthropic API key | No (uses env var) |

## Input Format

The input CSV must have these columns:

| Column | Description |
|--------|-------------|
| `article_id` | Unique article identifier |
| `question_id` | Unique question identifier |
| `question_category` | `guiding` or `quiz` |
| `passage_text` | The text passage |
| `question` | Question text |
| `option_1` - `option_4` | Answer choices |
| `correct_answer` | Correct answer (A/B/C/D) |
| `option_1_explanation` - `option_4_explanation` | Feedback for each choice |
| `DOK` | Depth of Knowledge (1, 2, or 3) |
| `difficulty` | Difficulty level |
| `CCSS` | Common Core standard code |

## Output

Generated questions include:
- All original metadata preserved
- New question with 4 options + feedback
- `parent_question_id` linking to original
- `template_adaptation` explaining how sibling was created
- Quality verification checks

## DOK-Specific Prompts

The system uses different prompts for each DOK level:

| DOK | Focus |
|-----|-------|
| DOK 1 | Recall and reproduction - test different facts/details |
| DOK 2 | Skills and concepts - test different inferences/connections |
| DOK 3 | Strategic thinking - test different analysis/synthesis |

## Checkpointing

The system saves progress after each article. If interrupted, it will resume from where it left off.

## Model

Uses **Claude Sonnet 4.5** (`claude-sonnet-4-5-20250929`) with structured outputs for reliable JSON generation.
