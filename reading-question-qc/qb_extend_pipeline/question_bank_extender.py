#!/usr/bin/env python3
"""
Question Bank Extender

Generates sibling questions for existing reading comprehension questions.
- 1 sibling per guiding question
- 4 siblings per quiz question

Uses Claude Sonnet 4.5 with structured output mode.
Processes one article at a time and saves checkpoints.

Uses DOK-specific prompts from 'qb_extend prompts.json' with full quality requirements
matching the bulk generation system.

Usage:
    python question_bank_extender.py \
        --input qti_existing_questions.csv \
        --output extended_questions.csv \
        --checkpoint checkpoints/
"""

import os
import json
import csv
import argparse
import time
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import anthropic
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


# Model configuration
MODEL = "claude-sonnet-4-5-20250929"
STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13"

# Generation counts
GUIDING_SIBLINGS = 1  # Generate 1 sibling per guiding question
QUIZ_SIBLINGS = 4     # Generate 4 siblings per quiz question

# Prompt file path
PROMPTS_FILE = Path(__file__).parent / "qb_extend prompts.json"
CCSS_FILE = Path(__file__).parent / "ck_gen - ccss.csv"


@dataclass
class GeneratedQuestion:
    """Represents a generated sibling question."""
    question: str
    option_1: str
    option_2: str
    option_3: str
    option_4: str
    correct_answer: str
    option_1_explanation: str
    option_2_explanation: str
    option_3_explanation: str
    option_4_explanation: str


# JSON Schema for structured output (following Anthropic structured outputs spec)
# See: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "sibling_questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question prompt text"
                    },
                    "option_1": {
                        "type": "string",
                        "description": "First answer choice (A)"
                    },
                    "option_2": {
                        "type": "string",
                        "description": "Second answer choice (B)"
                    },
                    "option_3": {
                        "type": "string",
                        "description": "Third answer choice (C)"
                    },
                    "option_4": {
                        "type": "string",
                        "description": "Fourth answer choice (D)"
                    },
                    "correct_answer": {
                        "type": "string",
                        "enum": ["A", "B", "C", "D"],
                        "description": "The correct answer letter"
                    },
                    "option_1_explanation": {
                        "type": "string",
                        "description": "Feedback for option A explaining why it is correct or incorrect"
                    },
                    "option_2_explanation": {
                        "type": "string",
                        "description": "Feedback for option B explaining why it is correct or incorrect"
                    },
                    "option_3_explanation": {
                        "type": "string",
                        "description": "Feedback for option C explaining why it is correct or incorrect"
                    },
                    "option_4_explanation": {
                        "type": "string",
                        "description": "Feedback for option D explaining why it is correct or incorrect"
                    },
                    "template_adaptation": {
                        "type": "string",
                        "description": "Brief explanation of how the original was adapted to create this sibling"
                    },
                    "quality_verification": {
                        "type": "object",
                        "description": "Self-check of quality requirements",
                        "properties": {
                            "homogeneity_check": {
                                "type": "string",
                                "description": "Confirmation that all choices belong to the same category"
                            },
                            "specificity_check": {
                                "type": "string",
                                "description": "Confirmation that all choices have similar detail levels"
                            },
                            "length_check": {
                                "type": "string",
                                "description": "Confirmation that correct answer is not the longest"
                            }
                        },
                        "required": ["homogeneity_check", "specificity_check", "length_check"],
                        "additionalProperties": False
                    }
                },
                "required": [
                    "question", "option_1", "option_2", "option_3", "option_4",
                    "correct_answer", "option_1_explanation", "option_2_explanation",
                    "option_3_explanation", "option_4_explanation",
                    "template_adaptation", "quality_verification"
                ],
                "additionalProperties": False
            }
        }
    },
    "required": ["sibling_questions"],
    "additionalProperties": False
}


class QuestionBankExtender:
    """Generates sibling questions for existing question bank."""
    
    def __init__(self, api_key: str, checkpoint_dir: Optional[str] = None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.checkpoint_dir = Path(checkpoint_dir) if checkpoint_dir else None
        if self.checkpoint_dir:
            self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        
        self.processed_articles = set()
        self.generated_questions = []
        
        # Load DOK-specific prompts
        self.prompts = self._load_prompts()
        
        # Load CCSS descriptions
        self.ccss_descriptions = self._load_ccss_descriptions()
    
    def _load_prompts(self) -> Dict[int, str]:
        """Load DOK-specific prompts from JSON file."""
        prompts = {}
        if PROMPTS_FILE.exists():
            with open(PROMPTS_FILE, 'r', encoding='utf-8') as f:
                prompt_data = json.load(f)
                for item in prompt_data:
                    if item.get('function') == 'sibling_generation':
                        dok = item.get('dok')
                        prompts[dok] = item.get('prompt', '')
            print(f"Loaded {len(prompts)} DOK-specific prompts")
        else:
            print(f"WARNING: Prompts file not found at {PROMPTS_FILE}")
        return prompts
    
    def _load_ccss_descriptions(self) -> Dict[str, str]:
        """Load CCSS standard descriptions from CSV file."""
        descriptions = {}
        if CCSS_FILE.exists():
            with open(CCSS_FILE, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    code = row.get('standard_code', row.get('code', ''))
                    desc = row.get('standard_description', row.get('description', ''))
                    if code and desc:
                        descriptions[code] = desc
            print(f"Loaded {len(descriptions)} CCSS descriptions")
        else:
            print(f"WARNING: CCSS file not found at {CCSS_FILE}")
        return descriptions
    
    def _extract_grade_level(self, standard_code: str) -> str:
        """Extract grade level string from CCSS standard code.
        
        Examples:
            RL.3.1 -> "grade 3"
            RI.5.2 -> "grade 5"
            RL.9-10.3 -> "grades 9-10"
            RL.K.1 -> "kindergarten"
        """
        match = re.search(r'\.(K|\d+(?:-\d+)?)\.\d+', standard_code)
        if match:
            grade_part = match.group(1)
            if grade_part == 'K':
                return "kindergarten"
            elif '-' in grade_part:
                return f"grades {grade_part}"
            else:
                return f"grade {grade_part}"
        return "grade 3"  # default
        
    def load_existing_questions(self, input_file: str) -> Dict[str, List[Dict]]:
        """
        Load existing questions from CSV and group by article_id.
        
        Returns: Dict mapping article_id -> list of question records
        """
        articles = {}
        
        with open(input_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                article_id = row['article_id']
                if article_id not in articles:
                    articles[article_id] = []
                articles[article_id].append(row)
        
        return articles
    
    def load_checkpoint(self) -> None:
        """Load checkpoint if exists."""
        if not self.checkpoint_dir:
            return
            
        checkpoint_file = self.checkpoint_dir / 'progress.json'
        if checkpoint_file.exists():
            with open(checkpoint_file, 'r') as f:
                data = json.load(f)
                self.processed_articles = set(data.get('processed_articles', []))
                print(f"Loaded checkpoint: {len(self.processed_articles)} articles already processed")
    
    def save_checkpoint(self, article_id: str) -> None:
        """Save checkpoint after processing an article."""
        if not self.checkpoint_dir:
            return
            
        self.processed_articles.add(article_id)
        
        checkpoint_file = self.checkpoint_dir / 'progress.json'
        with open(checkpoint_file, 'w') as f:
            json.dump({
                'processed_articles': list(self.processed_articles),
                'last_updated': datetime.now().isoformat()
            }, f, indent=2)
    
    def build_generation_prompt_for_question(
        self, 
        question: Dict,
        num_siblings: int
    ) -> str:
        """
        Build DOK-specific prompt for generating sibling questions for a single question.
        
        Args:
            question: The original question to create siblings for
            num_siblings: Number of siblings to generate
        """
        # Extract DOK level (default to 2 if not specified)
        dok = question.get('DOK', 2)
        try:
            dok = int(dok)
        except (ValueError, TypeError):
            dok = 2
        
        # Cap DOK at 3 (we only have prompts for 1, 2, 3)
        if dok > 3:
            dok = 3
        if dok < 1:
            dok = 1
        
        # Get the DOK-specific prompt template
        prompt_template = self.prompts.get(dok)
        if not prompt_template:
            # Fallback to DOK 2 if not found
            prompt_template = self.prompts.get(2, '')
            print(f"  WARNING: No prompt for DOK {dok}, using DOK 2")
        
        # Extract CCSS and get description
        standard_code = question.get('CCSS', '')
        standard_description = self.ccss_descriptions.get(standard_code, '')
        
        # Extract grade level from standard code
        grade_level = self._extract_grade_level(standard_code)
        
        # Build the prompt with all placeholders filled
        prompt = prompt_template.format(
            grade_level=grade_level,
            passage_text=question.get('passage_text', ''),
            standard_code=standard_code,
            standard_description=standard_description,
            difficulty=question.get('difficulty', 'medium'),
            original_question=question.get('question', ''),
            original_option_1=question.get('option_1', ''),
            original_option_2=question.get('option_2', ''),
            original_option_3=question.get('option_3', ''),
            original_option_4=question.get('option_4', ''),
            original_correct_answer=question.get('correct_answer', ''),
            original_option_1_explanation=question.get('option_1_explanation', '')[:500],
            original_option_2_explanation=question.get('option_2_explanation', '')[:500],
            original_option_3_explanation=question.get('option_3_explanation', '')[:500],
            original_option_4_explanation=question.get('option_4_explanation', '')[:500],
            num_siblings=num_siblings
        )
        
        return prompt
    
    def build_generation_prompt(
        self, 
        questions: List[Dict], 
        question_category: str,
        num_siblings: int
    ) -> str:
        """
        Build prompt for generating sibling questions (legacy method for batch processing).
        Now redirects to DOK-specific prompts when possible.
        
        Args:
            questions: List of existing questions (same category, same article)
            question_category: 'guiding' or 'quiz'
            num_siblings: Number of siblings to generate per question
        """
        # If we have DOK-specific prompts and only one question, use the new method
        if len(questions) == 1 and self.prompts:
            return self.build_generation_prompt_for_question(questions[0], num_siblings)
        
        # For multiple questions, build a combined prompt using DOK-specific templates
        # Get article info from first question
        article_title = questions[0].get('article_title', '')
        grade = questions[0].get('grade', 3)
        
        # Build passage context
        if question_category == 'guiding':
            # For guiding, include section-specific passages
            passages_text = ""
            for q in questions:
                section_num = q.get('section_number', q.get('section_sequence', ''))
                passage = q.get('passage_text', '')
                if passage:
                    passages_text += f"\n### Section {section_num}:\n{passage}\n"
        else:
            # For quiz, use the combined passage (should be same for all)
            passages_text = questions[0].get('passage_text', '')
        
        # Group questions by DOK level for better prompt generation
        questions_by_dok = {}
        for q in questions:
            dok = q.get('DOK', 2)
            try:
                dok = int(dok)
            except (ValueError, TypeError):
                dok = 2
            if dok not in questions_by_dok:
                questions_by_dok[dok] = []
            questions_by_dok[dok].append(q)
        
        # Build prompt sections for each DOK level
        prompt_sections = []
        total_to_generate = len(questions) * num_siblings
        
        for dok, dok_questions in sorted(questions_by_dok.items()):
            # Get DOK-specific requirements
            dok_requirements = self._get_dok_requirements(dok)
            
            for i, q in enumerate(dok_questions, 1):
                standard_code = q.get('CCSS', '')
                standard_description = self.ccss_descriptions.get(standard_code, '')
                grade_level = self._extract_grade_level(standard_code)
                
                prompt_sections.append(f"""
### Original Question (DOK {dok}, {q.get('difficulty', 'medium')}):
- Standard: {standard_code} - {standard_description}
- Grade Level: {grade_level}
- Question: {q.get('question', '')}
- A) {q.get('option_1', '')}
- B) {q.get('option_2', '')}
- C) {q.get('option_3', '')}
- D) {q.get('option_4', '')}
- Correct Answer: {q.get('correct_answer', '')}

Feedback for each option:
- A) {q.get('option_1_explanation', '')[:300]}...
- B) {q.get('option_2_explanation', '')[:300]}...
- C) {q.get('option_3_explanation', '')[:300]}...
- D) {q.get('option_4_explanation', '')[:300]}...

**Generate {num_siblings} sibling(s) for this question with SAME DOK ({dok}), difficulty ({q.get('difficulty', 'medium')}), and CCSS ({standard_code}).**
{dok_requirements}
""")
        
        prompt = f"""You are generating sibling questions for a grade {grade} reading assessment.

## Article: {article_title}

## Passage(s):
{passages_text}

## Original Questions to Create Siblings For:
{"".join(prompt_sections)}

## Task:
Generate {num_siblings} NEW sibling question(s) for EACH original question above.
- Total questions to generate: {total_to_generate}
- Each sibling must have the SAME DOK, difficulty, and CCSS as its original
- Each sibling must test the SAME passage/section as its original
- Questions must be DIFFERENT from the originals (different focus, angle, or details)

## Quality Requirements (CRITICAL - All Must Be Met):

### Question Quality:
1. **Text Dependency**: Must require reading the passage to answer - cannot be answered with general knowledge
2. **Clear and Precise**: Unambiguous question with one correct answer
3. **Grade Appropriate**: Vocabulary and concepts suitable for the grade level
4. **Standard Alignment**: Question must directly assess the specific skill in the CCSS
5. **Template Fidelity**: Follow the original's question structure and cognitive demand

### Answer Choice Quality:
6. **Plausible Distractors**: Wrong answers should be believable but clearly incorrect
7. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
8. **Homogeneity**: All choices MUST belong to the same conceptual category
   - Do NOT mix character traits with setting details, or themes with specific facts
9. **Specificity Balance**: All choices MUST have similar levels of detail
   - GOOD: "happy", "sad", "angry", "worried" (all single emotion words)
   - BAD: "sad" vs "experiencing deep melancholy" (different detail levels)
10. **Length Balance**: Correct answer must NOT be the longest option
11. **Semantic Distance**: Distractors must NOT be synonyms of the correct answer

### Feedback/Explanations (REQUIRED for each choice):
For CORRECT answers: Why correct with text evidence + reading strategy
For INCORRECT answers: Common misconception + why wrong + correct answer + strategy tip

## Output Format:
Generate exactly {total_to_generate} questions in the sibling_questions array.

```json
{{
  "sibling_questions": [
    {{
      "question": "The full question text here",
      "option_1": "First answer choice (A)",
      "option_2": "Second answer choice (B)",
      "option_3": "Third answer choice (C)",
      "option_4": "Fourth answer choice (D)",
      "correct_answer": "A",
      "option_1_explanation": "Detailed feedback for option A",
      "option_2_explanation": "Detailed feedback for option B",
      "option_3_explanation": "Detailed feedback for option C",
      "option_4_explanation": "Detailed feedback for option D",
      "template_adaptation": "How you adapted the original",
      "quality_verification": {{
        "homogeneity_check": "all choices are [category]",
        "specificity_check": "all choices are at [detail level]",
        "length_check": "correct answer is appropriate length"
      }}
    }}
  ]
}}
```

Generate siblings in order: first all siblings for Question 1, then all siblings for Question 2, etc.
"""
        
        return prompt
    
    def _get_dok_requirements(self, dok: int) -> str:
        """Get DOK-specific requirements text."""
        if dok == 1:
            return """
DOK 1 Requirements for siblings:
- Test recall of basic facts, definitions, or details
- Require simple recognition or identification
- Ask for information directly stated in the text
- No inference or analysis required"""
        elif dok == 2:
            return """
DOK 2 Requirements for siblings:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Cannot be answered by simple recall alone"""
        elif dok >= 3:
            return """
DOK 3 Requirements for siblings:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw conclusions based on multiple pieces of evidence
- Make complex inferences or connections"""
        return ""
    
    def generate_siblings_for_article(
        self, 
        article_id: str, 
        questions: List[Dict]
    ) -> List[Dict]:
        """
        Generate sibling questions for all questions in an article.
        
        Makes separate API calls for guiding and quiz questions.
        """
        results = []
        
        # Separate guiding and quiz questions
        guiding_questions = [q for q in questions if q.get('question_category') == 'guiding']
        quiz_questions = [q for q in questions if q.get('question_category') == 'quiz']
        
        # Generate guiding siblings
        if guiding_questions:
            print(f"  Generating {len(guiding_questions) * GUIDING_SIBLINGS} guiding siblings...")
            guiding_results = self._generate_batch(
                questions=guiding_questions,
                question_category='guiding',
                num_siblings=GUIDING_SIBLINGS,
                article_id=article_id
            )
            results.extend(guiding_results)
        
        # Generate quiz siblings
        if quiz_questions:
            print(f"  Generating {len(quiz_questions) * QUIZ_SIBLINGS} quiz siblings...")
            quiz_results = self._generate_batch(
                questions=quiz_questions,
                question_category='quiz',
                num_siblings=QUIZ_SIBLINGS,
                article_id=article_id
            )
            results.extend(quiz_results)
        
        return results
    
    def _generate_batch(
        self,
        questions: List[Dict],
        question_category: str,
        num_siblings: int,
        article_id: str
    ) -> List[Dict]:
        """Generate a batch of sibling questions via API call using structured outputs."""
        
        prompt = self.build_generation_prompt(questions, question_category, num_siblings)
        
        try:
            # Use the structured outputs beta API
            # See: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
            response = self.client.beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                betas=[STRUCTURED_OUTPUTS_BETA],
                messages=[
                    {"role": "user", "content": prompt}
                ],
                output_format={
                    "type": "json_schema",
                    "schema": QUESTION_SCHEMA
                }
            )
            
            # Check for refusal or max_tokens
            if response.stop_reason == "refusal":
                print(f"  WARNING: Claude refused the request")
                return []
            if response.stop_reason == "max_tokens":
                print(f"  WARNING: Response truncated due to max_tokens limit")
                return []
            
            # Parse the JSON response directly from content
            generated = []
            response_data = json.loads(response.content[0].text)
            sibling_questions = response_data.get("sibling_questions", [])
            
            # Map generated questions back to original questions
            for i, orig_q in enumerate(questions):
                # Each original question gets num_siblings new questions
                start_idx = i * num_siblings
                end_idx = start_idx + num_siblings
                
                for j, gen_q in enumerate(sibling_questions[start_idx:end_idx]):
                    # Extract quality verification if present
                    quality_verification = gen_q.get('quality_verification', {})
                    
                    # Build output record matching QC pipeline format
                    record = {
                        # Preserve original metadata
                        'article_id': article_id,
                        'article_title': orig_q.get('article_title', ''),
                        'section_id': orig_q.get('section_id', ''),
                        'section_sequence': orig_q.get('section_sequence', ''),
                        'question_id': f"{orig_q.get('question_id', '')}_sibling_{j+1}",
                        'question_category': question_category,
                        'stimulus_id': orig_q.get('stimulus_id', ''),
                        'passage_text': orig_q.get('passage_text', ''),
                        'lexile_level': orig_q.get('lexile_level', ''),
                        'course': orig_q.get('course', ''),
                        'module': orig_q.get('module', ''),
                        'section_number': orig_q.get('section_number', ''),
                        
                        # Generated content
                        'question': gen_q.get('question', ''),
                        'question_type': 'MCQ',
                        'option_1': gen_q.get('option_1', ''),
                        'option_2': gen_q.get('option_2', ''),
                        'option_3': gen_q.get('option_3', ''),
                        'option_4': gen_q.get('option_4', ''),
                        'correct_answer': gen_q.get('correct_answer', ''),
                        'option_1_explanation': gen_q.get('option_1_explanation', ''),
                        'option_2_explanation': gen_q.get('option_2_explanation', ''),
                        'option_3_explanation': gen_q.get('option_3_explanation', ''),
                        'option_4_explanation': gen_q.get('option_4_explanation', ''),
                        
                        # Preserve metadata from original
                        'DOK': orig_q.get('DOK', ''),
                        'difficulty': orig_q.get('difficulty', ''),
                        'CCSS': orig_q.get('CCSS', ''),
                        'grade': orig_q.get('grade', 3),
                        
                        # Tracking
                        'parent_question_id': orig_q.get('question_id', ''),
                        'generation_timestamp': datetime.now().isoformat(),
                        
                        # Quality verification from generation
                        'template_adaptation': gen_q.get('template_adaptation', ''),
                        'homogeneity_check': quality_verification.get('homogeneity_check', ''),
                        'specificity_check': quality_verification.get('specificity_check', ''),
                        'length_check': quality_verification.get('length_check', '')
                    }
                    generated.append(record)
            
            return generated
            
        except Exception as e:
            print(f"  ERROR generating batch: {e}")
            return []
    
    def process_all_articles(
        self, 
        input_file: str, 
        output_file: str,
        limit: int = 0
    ) -> None:
        """
        Process all articles and generate sibling questions.
        
        Args:
            input_file: Path to input CSV with existing questions
            output_file: Path to output CSV for generated questions
            limit: Limit number of articles to process (0 = all)
        """
        # Load existing questions grouped by article
        print(f"Loading existing questions from {input_file}...")
        articles = self.load_existing_questions(input_file)
        print(f"Found {len(articles)} articles with {sum(len(q) for q in articles.values())} questions")
        
        # Load checkpoint
        self.load_checkpoint()
        
        # Prepare output file
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Define fieldnames
        fieldnames = [
            'article_id', 'article_title', 'section_id', 'section_sequence',
            'question_id', 'question_category', 'stimulus_id',
            'passage_text', 'lexile_level', 'course', 'module', 'section_number',
            'question', 'question_type',
            'option_1', 'option_2', 'option_3', 'option_4',
            'correct_answer',
            'option_1_explanation', 'option_2_explanation',
            'option_3_explanation', 'option_4_explanation',
            'DOK', 'difficulty', 'CCSS', 'grade',
            'parent_question_id', 'generation_timestamp',
            'template_adaptation', 'homogeneity_check', 'specificity_check', 'length_check'
        ]
        
        # Check if output file exists (for appending)
        file_exists = output_path.exists()
        
        # Process articles
        article_ids = list(articles.keys())
        if limit > 0:
            article_ids = article_ids[:limit]
        
        total_generated = 0
        
        with open(output_file, 'a' if file_exists else 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            
            for i, article_id in enumerate(article_ids):
                # Skip if already processed
                if article_id in self.processed_articles:
                    print(f"[{i+1}/{len(article_ids)}] Skipping {article_id} (already processed)")
                    continue
                
                print(f"[{i+1}/{len(article_ids)}] Processing {article_id}...")
                
                questions = articles[article_id]
                guiding_count = sum(1 for q in questions if q.get('question_category') == 'guiding')
                quiz_count = sum(1 for q in questions if q.get('question_category') == 'quiz')
                
                expected = guiding_count * GUIDING_SIBLINGS + quiz_count * QUIZ_SIBLINGS
                print(f"  Existing: {guiding_count} guiding + {quiz_count} quiz")
                print(f"  Expected to generate: {expected} questions")
                
                # Generate siblings
                start_time = time.time()
                generated = self.generate_siblings_for_article(article_id, questions)
                elapsed = time.time() - start_time
                
                # Write to output
                for record in generated:
                    writer.writerow(record)
                f.flush()  # Ensure written to disk
                
                total_generated += len(generated)
                print(f"  Generated: {len(generated)} questions in {elapsed:.1f}s")
                
                # Save checkpoint
                self.save_checkpoint(article_id)
                
                # Rate limiting
                time.sleep(1)
        
        print(f"\nDone! Generated {total_generated} total questions")
        print(f"Output saved to {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description='Generate sibling questions for existing question bank'
    )
    parser.add_argument(
        '--input', '-i', 
        required=True, 
        help='Input CSV file with existing questions'
    )
    parser.add_argument(
        '--output', '-o', 
        required=True, 
        help='Output CSV file for generated questions'
    )
    parser.add_argument(
        '--checkpoint', '-c',
        default='checkpoints',
        help='Directory for checkpoint files (default: checkpoints/)'
    )
    parser.add_argument(
        '--limit', '-l',
        type=int,
        default=0,
        help='Limit number of articles to process (0 = all)'
    )
    parser.add_argument(
        '--api-key',
        help='Anthropic API key (or set ANTHROPIC_API_KEY env var)'
    )
    
    args = parser.parse_args()
    
    # Get API key
    api_key = args.api_key or os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        print("ERROR: No API key provided. Set ANTHROPIC_API_KEY or use --api-key")
        return 1
    
    # Create extender and run
    extender = QuestionBankExtender(
        api_key=api_key,
        checkpoint_dir=args.checkpoint
    )
    
    extender.process_all_articles(
        input_file=args.input,
        output_file=args.output,
        limit=args.limit
    )
    
    return 0


if __name__ == '__main__':
    exit(main())

