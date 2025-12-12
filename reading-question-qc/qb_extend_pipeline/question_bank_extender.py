#!/usr/bin/env python3
"""
Question Bank Extender

Generates sibling questions for existing reading comprehension questions.
- By default: Only extends quiz questions (4 siblings per quiz question)
- With --include-guiding: Also extends guiding questions (1 sibling each)
- With --only-guiding: Only extends guiding questions

Uses Claude Sonnet 4.5 with structured output mode.
Processes one article at a time and saves checkpoints.
Logs all LLM communications with timestamps for traceability.

Usage:
    # Default: Only quiz questions
    python question_bank_extender.py \\
        --input inputs/qti_existing_questions.csv \\
        --output outputs/extended_questions.csv
    
    # Include guiding questions too
    python question_bank_extender.py \\
        --input inputs/qti_existing_questions.csv \\
        --output outputs/extended_questions.csv \\
        --include-guiding
    
    # Only guiding questions
    python question_bank_extender.py \\
        --input inputs/qti_existing_questions.csv \\
        --output outputs/extended_questions.csv \\
        --only-guiding
"""

import os
import json
import csv
import argparse
import time
import re
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import anthropic
from dotenv import load_dotenv
import pandas as pd

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
CONFIG_FILE = Path(__file__).parent / "config.json"


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

# MCQ Schema - Multiple Choice Questions
MCQ_SCHEMA = {
    "type": "object",
    "properties": {
        "variant_questions": {
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
                    "differentiation_notes": {
                        "type": "string",
                        "description": "How this question differs from the reference: text location, question type, aspect of standard assessed"
                    },
                    "quality_verification": {
                        "type": "object",
                        "description": "Self-check of quality and diversity requirements",
                        "properties": {
                            "homogeneity_check": {
                                "type": "string",
                                "description": "Confirmation that all choices belong to the same conceptual category"
                            },
                            "specificity_check": {
                                "type": "string",
                                "description": "Confirmation that all choices have similar detail levels"
                            },
                            "length_check": {
                                "type": "string",
                                "description": "Word counts for each choice confirming balance within 10%"
                            },
                            "semantic_distance_check": {
                                "type": "string",
                                "description": "Confirmation that no distractors are synonyms or too close to correct answer"
                            },
                            "single_correct_check": {
                                "type": "string",
                                "description": "Confirmation that only one answer is defensible as correct"
                            },
                            "diversity_check": {
                                "type": "string",
                                "description": "Confirmation that this question targets different text, uses different question stem, and requires different reasoning than reference and other variants"
                            }
                        },
                        "required": ["homogeneity_check", "specificity_check", "length_check", "semantic_distance_check", "single_correct_check", "diversity_check"],
                        "additionalProperties": False
                    }
                },
                "required": [
                    "question", "option_1", "option_2", "option_3", "option_4",
                    "correct_answer", "option_1_explanation", "option_2_explanation",
                    "option_3_explanation", "option_4_explanation",
                    "differentiation_notes", "quality_verification"
                ],
                "additionalProperties": False
            }
        }
    },
    "required": ["variant_questions"],
    "additionalProperties": False
}

# SR Schema - Short Response Questions
SR_SCHEMA = {
    "type": "object",
    "properties": {
        "variant_questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The short response question text including any instructions"
                    },
                    "expected_response": {
                        "type": "string",
                        "description": "Sample complete response showing what a full-credit answer includes"
                    },
                    "key_details": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key details or concepts that should be included in the response"
                    },
                    "scoring_notes": {
                        "type": "string",
                        "description": "Guidance on what constitutes a complete answer"
                    },
                    "dok_justification": {
                        "type": "string",
                        "description": "Explanation of why this question is at the specified DOK level"
                    },
                    "differentiation_notes": {
                        "type": "string",
                        "description": "How this question differs from reference: paragraph targeted, topic focus"
                    }
                },
                "required": [
                    "question", "expected_response", "key_details",
                    "scoring_notes", "dok_justification", "differentiation_notes"
                ],
                "additionalProperties": False
            }
        }
    },
    "required": ["variant_questions"],
    "additionalProperties": False
}

# MP Schema - Multipart Questions
MP_SCHEMA = {
    "type": "object",
    "properties": {
        "variant_questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "part_a": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string"},
                            "option_1": {"type": "string"},
                            "option_2": {"type": "string"},
                            "option_3": {"type": "string"},
                            "option_4": {"type": "string"},
                            "correct_answer": {"type": "string", "enum": ["A", "B", "C", "D"]},
                            "option_1_explanation": {"type": "string"},
                            "option_2_explanation": {"type": "string"},
                            "option_3_explanation": {"type": "string"},
                            "option_4_explanation": {"type": "string"},
                            "DOK": {"type": "integer"}
                        },
                        "required": ["question", "option_1", "option_2", "option_3", "option_4",
                                   "correct_answer", "option_1_explanation", "option_2_explanation",
                                   "option_3_explanation", "option_4_explanation", "DOK"],
                        "additionalProperties": False
                    },
                    "part_b": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string"},
                            "option_1": {"type": "string"},
                            "option_2": {"type": "string"},
                            "option_3": {"type": "string"},
                            "option_4": {"type": "string"},
                            "correct_answer": {"type": "string", "enum": ["A", "B", "C", "D"]},
                            "option_1_explanation": {"type": "string"},
                            "option_2_explanation": {"type": "string"},
                            "option_3_explanation": {"type": "string"},
                            "option_4_explanation": {"type": "string"},
                            "DOK": {"type": "integer"}
                        },
                        "required": ["question", "option_1", "option_2", "option_3", "option_4",
                                   "correct_answer", "option_1_explanation", "option_2_explanation",
                                   "option_3_explanation", "option_4_explanation", "DOK"],
                        "additionalProperties": False
                    },
                    "connection_rationale": {
                        "type": "string",
                        "description": "Explanation of how Part B builds on Part A"
                    },
                    "dok_justification": {
                        "type": "string",
                        "description": "Explanation of why the combined question reaches the target DOK"
                    },
                    "standard_assessment": {
                        "type": "string",
                        "description": "How this multipart question assesses the target standard"
                    },
                    "differentiation_notes": {
                        "type": "string",
                        "description": "How this question differs from reference: analytical focus, text elements targeted"
                    }
                },
                "required": ["part_a", "part_b", "connection_rationale", 
                           "dok_justification", "standard_assessment", "differentiation_notes"],
                "additionalProperties": False
            }
        }
    },
    "required": ["variant_questions"],
    "additionalProperties": False
}

# Map question types to their schemas
SCHEMA_MAP = {
    "MCQ": MCQ_SCHEMA,
    "SR": SR_SCHEMA,
    "MP": MP_SCHEMA
}


class LLMLogger:
    """Logs all LLM communications with timestamps for traceability."""
    
    def __init__(self, log_dir: Path, run_id: str):
        self.log_dir = log_dir
        self.run_id = run_id
        self.log_file = log_dir / f"llm_logs_{run_id}.jsonl"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # Also set up a summary log for quick reference
        self.summary_file = log_dir / f"llm_summary_{run_id}.txt"
        
        print(f"LLM logs will be saved to: {self.log_file}")
    
    def log_request(
        self,
        request_id: str,
        prompt: str,
        model: str,
        headers: Dict[str, Any],
        extra_body: Dict[str, Any],
        article_id: str = "",
        question_category: str = "",
        question_type: str = ""
    ) -> None:
        """Log an LLM request."""
        timestamp = datetime.now().isoformat()
        
        log_entry = {
            "timestamp": timestamp,
            "type": "request",
            "request_id": request_id,
            "article_id": article_id,
            "question_category": question_category,
            "question_type": question_type,
            "model": model,
            "headers": headers,
            "extra_body": extra_body,
            "prompt": prompt,
            "prompt_length": len(prompt)
        }
        
        # Write to JSONL file
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
        
        # Write summary
        with open(self.summary_file, 'a', encoding='utf-8') as f:
            f.write(f"\n{'='*80}\n")
            f.write(f"[{timestamp}] REQUEST {request_id}\n")
            f.write(f"Article: {article_id} | Category: {question_category} | Type: {question_type}\n")
            f.write(f"Model: {model}\n")
            f.write(f"Prompt length: {len(prompt)} chars\n")
            f.write(f"Headers: {json.dumps(headers)}\n")
            f.write(f"{'='*80}\n")
    
    def log_response(
        self,
        request_id: str,
        response_text: str,
        stop_reason: str,
        duration_seconds: float,
        success: bool,
        error_message: str = ""
    ) -> None:
        """Log an LLM response."""
        timestamp = datetime.now().isoformat()
        
        log_entry = {
            "timestamp": timestamp,
            "type": "response",
            "request_id": request_id,
            "success": success,
            "stop_reason": stop_reason,
            "duration_seconds": duration_seconds,
            "response_length": len(response_text) if response_text else 0,
            "response": response_text,
            "error_message": error_message
        }
        
        # Write to JSONL file
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
        
        # Write summary
        with open(self.summary_file, 'a', encoding='utf-8') as f:
            f.write(f"\n[{timestamp}] RESPONSE {request_id}\n")
            f.write(f"Success: {success} | Stop Reason: {stop_reason} | Duration: {duration_seconds:.2f}s\n")
            f.write(f"Response length: {len(response_text) if response_text else 0} chars\n")
            if error_message:
                f.write(f"Error: {error_message}\n")
            f.write(f"{'-'*80}\n")


class QuestionBankExtender:
    """Generates sibling questions for existing question bank."""
    
    def __init__(
        self, 
        api_key: str, 
        checkpoint_dir: Optional[str] = None,
        log_dir: Optional[str] = None,
        run_id: Optional[str] = None,
        include_guiding: bool = False,
        only_guiding: bool = False
    ):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.checkpoint_dir = Path(checkpoint_dir) if checkpoint_dir else None
        if self.checkpoint_dir:
            self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        
        self.processed_articles = set()
        self.generated_questions = []
        
        # Question category settings
        self.include_guiding = include_guiding
        self.only_guiding = only_guiding
        
        # Set up run ID (used for timestamped outputs)
        self.run_id = run_id or datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Set up LLM logger
        log_path = Path(log_dir) if log_dir else (Path(__file__).parent / "outputs" / "llm_logs")
        self.llm_logger = LLMLogger(log_path, self.run_id)
        self.request_counter = 0
        
        # Load DOK-specific prompts
        self.prompts = self._load_prompts()
        
        # Load CCSS descriptions
        self.ccss_descriptions = self._load_ccss_descriptions()
    
    def _load_prompts(self) -> Dict[str, str]:
        """Load prompts indexed by question_type and DOK from JSON file.
        
        Returns: Dict mapping 'question_type_dok' (e.g., 'MCQ_2') -> prompt string
        """
        prompts = {}
        if PROMPTS_FILE.exists():
            with open(PROMPTS_FILE, 'r', encoding='utf-8') as f:
                prompt_data = json.load(f)
                for item in prompt_data:
                    # Support both old 'sibling_generation' and new 'variant_generation' function names
                    if item.get('function') in ['variant_generation', 'sibling_generation']:
                        question_type = item.get('question_type', 'MCQ')
                        dok = item.get('dok')
                        key = f"{question_type}_{dok}"
                        prompts[key] = item.get('prompt', '')
            print(f"Loaded {len(prompts)} prompts for different question types and DOK levels")
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
        Build question-type and DOK-specific prompt for generating sibling questions.
        
        Args:
            question: The original question to create siblings for
            num_siblings: Number of siblings to generate
        """
        # Extract question type (default to MCQ)
        question_type = question.get('question_type', 'MCQ').upper()
        # Normalize question type
        if question_type not in ['MCQ', 'SR', 'MP']:
            question_type = 'MCQ'
        
        # Extract DOK level (default to 2 if not specified)
        dok = question.get('DOK', 2)
        try:
            dok = int(dok)
        except (ValueError, TypeError):
            dok = 2
        
        # Cap DOK based on question type
        # MCQ: DOK 1-3, SR: DOK 1-4, MP: DOK 2-3
        if question_type == 'MCQ':
            if dok > 3:
                dok = 3
            if dok < 1:
                dok = 1
        elif question_type == 'SR':
            if dok > 4:
                dok = 4
            if dok < 1:
                dok = 1
        elif question_type == 'MP':
            if dok > 3:
                dok = 3
            if dok < 2:
                dok = 2
        
        # Get the question-type and DOK-specific prompt template
        prompt_key = f"{question_type}_{dok}"
        prompt_template = self.prompts.get(prompt_key)
        if not prompt_template:
            # Fallback to MCQ DOK 2 if not found
            fallback_key = "MCQ_2"
            prompt_template = self.prompts.get(fallback_key, '')
            print(f"  WARNING: No prompt for {prompt_key}, using {fallback_key}")
        
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
        
        # For multiple questions, build a combined prompt with DIVERSITY focus
        # Get article info from first question
        article_title = questions[0].get('article_title', '')
        grade = questions[0].get('grade', 3)
        
        # Build passage context
        if question_category == 'guiding':
            passages_text = ""
            for q in questions:
                section_num = q.get('section_number', q.get('section_sequence', ''))
                passage = q.get('passage_text', '')
                if passage:
                    passages_text += f"\n### Section {section_num}:\n{passage}\n"
        else:
            passages_text = questions[0].get('passage_text', '')
        
        # Build reference question sections
        prompt_sections = []
        total_to_generate = len(questions) * num_siblings
        
        for idx, q in enumerate(questions, 1):
            dok = q.get('DOK', 2)
            try:
                dok = int(dok)
            except (ValueError, TypeError):
                dok = 2
                
            standard_code = q.get('CCSS', '')
            standard_description = self.ccss_descriptions.get(standard_code, '')
            grade_level = self._extract_grade_level(standard_code)
            dok_requirements = self._get_dok_requirements(dok)
            
            prompt_sections.append(f"""
### Reference Question {idx} (DOK {dok}, {q.get('difficulty', 'medium')}):
- Standard: {standard_code} - {standard_description}
- Question: {q.get('question', '')}
- A) {q.get('option_1', '')}
- B) {q.get('option_2', '')}
- C) {q.get('option_3', '')}
- D) {q.get('option_4', '')}
- Correct: {q.get('correct_answer', '')}

**Create {num_siblings} DIVERSE variants for this question at DOK {dok}, difficulty {q.get('difficulty', 'medium')}, CCSS {standard_code}.**
{dok_requirements}
""")
        
        prompt = f"""You are creating DIVERSE ALTERNATIVE assessment questions for a grade {grade} reading assessment.

Your goal is to create questions that are MAXIMALLY DIFFERENT from each reference while still assessing the same standard.

## Article: {article_title}

## Passage:
{passages_text}

## Reference Questions (for quality benchmark, NOT for copying):
{"".join(prompt_sections)}

## CRITICAL: MAXIMUM DIVERSITY REQUIREMENTS

### What You MUST Do Differently for EACH Variant:
1. **Ask about DIFFERENT text evidence** - Each variant should focus on a DIFFERENT paragraph, sentence, or detail
2. **Use DIFFERENT question stems** - Vary between "What...", "Why...", "How...", "Which detail...", "Based on...", "According to..."
3. **Target DIFFERENT correct answers** - Aim for different answer letters (A, B, C, D) across variants
4. **Focus on DIFFERENT aspects** - If reference asks about character words, ask about actions, settings, or events
5. **Require DIFFERENT reasoning** - Each variant should need unique thinking to answer

### What You Must NOT Do (AUTOMATIC REJECTION):
❌ Do NOT ask about the same phrase, sentence, or paragraph as the reference
❌ Do NOT rephrase the reference question with minor word changes
❌ Do NOT create variants where the same reasoning answers multiple questions
❌ Do NOT have multiple variants about the same concept (e.g., all about "being rich")
❌ Do NOT copy question structure - be creative with how you ask

### BAD Examples (TOO SIMILAR - would be rejected):
- Reference: "What does 'richer than any king' mean?"
- BAD Variant 1: "What does 'make any person very rich' mean?" ← Same concept (wealth)!
- BAD Variant 2: "What does 'richer than any king in the world' mean?" ← Same phrase!

### GOOD Examples (TRULY DIFFERENT):
- Reference: "What does 'richer than any king' mean?"
- GOOD Variant 1: "What does the phrase 'the earth split open' describe?" ← Different text, different concept
- GOOD Variant 2: "According to paragraph 1, what job did Aladdin's father have?" ← Different section, factual recall
- GOOD Variant 3: "How does the author show that the location is remote?" ← Different literary focus
- GOOD Variant 4: "What does it mean when the text says the magician 'needed someone to help him'?" ← Different quote

## Task:
Generate {num_siblings} DIVERSE variants for EACH reference question.
- Total questions to generate: {total_to_generate}
- Each variant must assess the SAME standard at the SAME DOK level
- Each variant must be COMPLETELY DIFFERENT from the reference AND from other variants

## Quality Requirements:

### Question Quality:
1. **Text Dependency**: Must require reading the passage
2. **Clear and Precise**: One correct answer, no ambiguity
3. **Grade Appropriate**: Suitable vocabulary for grade {grade}
4. **Standard Alignment**: Directly assess the target CCSS

### Answer Choice Quality:
5. **Plausible Distractors**: Believable but clearly incorrect
6. **Grammatical Parallelism**: All choices same structure
7. **Homogeneity**: All choices from same category
8. **Length Balance**: Within 10% word count
9. **Semantic Distance**: No synonyms or too-close pairs

### Feedback Requirements:
For CORRECT: Why correct + text evidence + strategy
For INCORRECT: Why wrong + misconception + guidance

## Output Format:
Generate exactly {total_to_generate} questions in the variant_questions array.
First all {num_siblings} variants for Reference 1, then all for Reference 2, etc.

```json
{{
  "variant_questions": [
    {{
      "question": "The question text",
      "option_1": "Choice A",
      "option_2": "Choice B", 
      "option_3": "Choice C",
      "option_4": "Choice D",
      "correct_answer": "A",
      "option_1_explanation": "Feedback for A",
      "option_2_explanation": "Feedback for B",
      "option_3_explanation": "Feedback for C",
      "option_4_explanation": "Feedback for D",
      "differentiation_notes": "Targets [paragraph X] about [topic Y] - differs from reference which asks about [Z]",
      "quality_verification": {{
        "homogeneity_check": "all choices are [category]",
        "specificity_check": "all at [detail level]",
        "length_check": "balanced within 10%",
        "semantic_distance_check": "no synonyms or too-close pairs",
        "single_correct_check": "only [letter] is defensible",
        "diversity_check": "targets [specific text/paragraph] - completely different from reference and other variants"
      }}
    }}
  ]
}}
```
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
        Respects the include_guiding and only_guiding settings.
        """
        results = []
        
        # Separate guiding and quiz questions
        guiding_questions = [q for q in questions if q.get('question_category') == 'guiding']
        quiz_questions = [q for q in questions if q.get('question_category') == 'quiz']
        
        # Determine which categories to process based on settings
        process_guiding = self.only_guiding or self.include_guiding
        process_quiz = not self.only_guiding
        
        # Generate guiding siblings (if enabled)
        if guiding_questions and process_guiding:
            print(f"  Generating {len(guiding_questions) * GUIDING_SIBLINGS} guiding siblings...")
            guiding_results = self._generate_batch(
                questions=guiding_questions,
                question_category='guiding',
                num_siblings=GUIDING_SIBLINGS,
                article_id=article_id
            )
            results.extend(guiding_results)
        elif guiding_questions:
            print(f"  Skipping {len(guiding_questions)} guiding questions (quiz-only mode)")
        
        # Generate quiz siblings (if enabled)
        if quiz_questions and process_quiz:
            print(f"  Generating {len(quiz_questions) * QUIZ_SIBLINGS} quiz siblings...")
            quiz_results = self._generate_batch(
                questions=quiz_questions,
                question_category='quiz',
                num_siblings=QUIZ_SIBLINGS,
                article_id=article_id
            )
            results.extend(quiz_results)
        elif quiz_questions:
            print(f"  Skipping {len(quiz_questions)} quiz questions (guiding-only mode)")
        
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
        
        # Determine question type from first question (assuming batch is same type)
        question_type = questions[0].get('question_type', 'MCQ').upper() if questions else 'MCQ'
        if question_type not in SCHEMA_MAP:
            question_type = 'MCQ'
        
        # Select appropriate schema
        schema = SCHEMA_MAP[question_type]
        
        # Generate unique request ID
        self.request_counter += 1
        request_id = f"{self.run_id}_{self.request_counter:04d}"
        
        # Prepare headers and extra_body for logging
        headers = {"anthropic-beta": STRUCTURED_OUTPUTS_BETA}
        extra_body = {
            "output_format": {
                "type": "json_schema",
                "schema": schema
            }
        }
        
        # Log the request
        self.llm_logger.log_request(
            request_id=request_id,
            prompt=prompt,
            model=MODEL,
            headers=headers,
            extra_body=extra_body,
            article_id=article_id,
            question_category=question_category,
            question_type=question_type
        )
        
        start_time = time.time()
        
        try:
            # Use the structured outputs beta API with streaming for long requests
            # See: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
            # Streaming is required for max_tokens > ~16K to avoid timeout errors
            
            collected_text = ""
            stop_reason = None
            
            # Use raw streaming with beta headers
            with self.client.messages.stream(
                model=MODEL,
                max_tokens=64000,  # Claude Sonnet 4.5 max output
                messages=[
                    {"role": "user", "content": prompt}
                ],
                extra_headers=headers,
                extra_body=extra_body
            ) as stream:
                for text in stream.text_stream:
                    collected_text += text
                # Get final message for stop_reason
                final_message = stream.get_final_message()
                stop_reason = final_message.stop_reason
            
            duration = time.time() - start_time
            
            # Log the response
            self.llm_logger.log_response(
                request_id=request_id,
                response_text=collected_text,
                stop_reason=stop_reason,
                duration_seconds=duration,
                success=True
            )
            
            # Check for refusal or max_tokens
            if stop_reason == "refusal":
                print(f"  WARNING: Claude refused the request")
                return []
            if stop_reason == "max_tokens":
                print(f"  WARNING: Response truncated due to max_tokens limit")
                return []
            
            # Parse the JSON response from collected stream
            generated = []
            response_data = json.loads(collected_text)
            # Support both old "sibling_questions" and new "variant_questions" keys
            variant_questions = response_data.get("variant_questions", response_data.get("sibling_questions", []))
            
            # Map generated questions back to original questions
            for i, orig_q in enumerate(questions):
                # Each original question gets num_variants new questions
                start_idx = i * num_siblings
                end_idx = start_idx + num_siblings
                
                for j, gen_q in enumerate(variant_questions[start_idx:end_idx]):
                    # Build base record with common metadata
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
                        'question_type': question_type,
                        
                        # Preserve metadata from original
                        'DOK': orig_q.get('DOK', ''),
                        'difficulty': orig_q.get('difficulty', ''),
                        'CCSS': orig_q.get('CCSS', ''),
                        'grade': orig_q.get('grade', 3),
                        
                        # Tracking
                        'parent_question_id': orig_q.get('question_id', ''),
                        'generation_timestamp': datetime.now().isoformat(),
                        'differentiation_notes': gen_q.get('differentiation_notes', gen_q.get('template_adaptation', '')),
                    }
                    
                    # Add question-type specific fields
                    if question_type == 'MCQ':
                        quality_verification = gen_q.get('quality_verification', {})
                        record.update({
                            'question': gen_q.get('question', ''),
                            'option_1': gen_q.get('option_1', ''),
                            'option_2': gen_q.get('option_2', ''),
                            'option_3': gen_q.get('option_3', ''),
                            'option_4': gen_q.get('option_4', ''),
                            'correct_answer': gen_q.get('correct_answer', ''),
                            'option_1_explanation': gen_q.get('option_1_explanation', ''),
                            'option_2_explanation': gen_q.get('option_2_explanation', ''),
                            'option_3_explanation': gen_q.get('option_3_explanation', ''),
                            'option_4_explanation': gen_q.get('option_4_explanation', ''),
                            'cognitive_process': gen_q.get('cognitive_process', ''),
                            'homogeneity_check': quality_verification.get('homogeneity_check', ''),
                            'specificity_check': quality_verification.get('specificity_check', ''),
                            'length_check': quality_verification.get('length_check', ''),
                            'semantic_distance_check': quality_verification.get('semantic_distance_check', ''),
                            'single_correct_check': quality_verification.get('single_correct_check', ''),
                            'diversity_check': quality_verification.get('diversity_check', quality_verification.get('uniqueness_check', ''))
                        })
                    
                    elif question_type == 'SR':
                        key_details = gen_q.get('key_details', [])
                        record.update({
                            'question': gen_q.get('question', ''),
                            'expected_response': gen_q.get('expected_response', ''),
                            'key_details': json.dumps(key_details) if isinstance(key_details, list) else key_details,
                            'scoring_notes': gen_q.get('scoring_notes', ''),
                            'dok_justification': gen_q.get('dok_justification', ''),
                            # Clear MCQ-specific fields
                            'option_1': '', 'option_2': '', 'option_3': '', 'option_4': '',
                            'correct_answer': '', 
                            'option_1_explanation': '', 'option_2_explanation': '',
                            'option_3_explanation': '', 'option_4_explanation': '',
                        })
                    
                    elif question_type == 'MP':
                        part_a = gen_q.get('part_a', {})
                        part_b = gen_q.get('part_b', {})
                        record.update({
                            # Part A
                            'question': part_a.get('question', ''),
                            'option_1': part_a.get('option_1', ''),
                            'option_2': part_a.get('option_2', ''),
                            'option_3': part_a.get('option_3', ''),
                            'option_4': part_a.get('option_4', ''),
                            'correct_answer': part_a.get('correct_answer', ''),
                            'option_1_explanation': part_a.get('option_1_explanation', ''),
                            'option_2_explanation': part_a.get('option_2_explanation', ''),
                            'option_3_explanation': part_a.get('option_3_explanation', ''),
                            'option_4_explanation': part_a.get('option_4_explanation', ''),
                            'part_a_dok': part_a.get('DOK', ''),
                            # Part B
                            'part_b_question': part_b.get('question', ''),
                            'part_b_option_1': part_b.get('option_1', ''),
                            'part_b_option_2': part_b.get('option_2', ''),
                            'part_b_option_3': part_b.get('option_3', ''),
                            'part_b_option_4': part_b.get('option_4', ''),
                            'part_b_correct_answer': part_b.get('correct_answer', ''),
                            'part_b_option_1_explanation': part_b.get('option_1_explanation', ''),
                            'part_b_option_2_explanation': part_b.get('option_2_explanation', ''),
                            'part_b_option_3_explanation': part_b.get('option_3_explanation', ''),
                            'part_b_option_4_explanation': part_b.get('option_4_explanation', ''),
                            'part_b_dok': part_b.get('DOK', ''),
                            # Connection info
                            'connection_rationale': gen_q.get('connection_rationale', ''),
                            'dok_justification': gen_q.get('dok_justification', ''),
                            'standard_assessment': gen_q.get('standard_assessment', ''),
                        })
                    
                    generated.append(record)
            
            return generated
            
        except Exception as e:
            duration = time.time() - start_time
            
            # Log the error
            self.llm_logger.log_response(
                request_id=request_id,
                response_text="",
                stop_reason="error",
                duration_seconds=duration,
                success=False,
                error_message=str(e)
            )
            
            print(f"  ERROR generating batch: {e}")
            return []
    
    def process_all_articles(
        self, 
        input_file: str, 
        output_file: str,
        limit: int = 0
    ) -> str:
        """
        Process all articles and generate sibling questions.
        Returns the path to the combined output file.
        
        Args:
            input_file: Path to input CSV with existing questions
            output_file: Path to output CSV for generated questions (base name, will add timestamp)
            limit: Limit number of articles to process (0 = all)
        """
        # Load existing questions grouped by article
        print(f"Loading existing questions from {input_file}...")
        articles = self.load_existing_questions(input_file)
        print(f"Found {len(articles)} articles with {sum(len(q) for q in articles.values())} questions")
        
        # Print mode info
        if self.only_guiding:
            print("Mode: ONLY guiding questions")
        elif self.include_guiding:
            print("Mode: Quiz questions + guiding questions")
        else:
            print("Mode: Quiz questions only (default)")
        
        # Load checkpoint
        self.load_checkpoint()
        
        # Prepare timestamped output file
        output_path = Path(output_file)
        extended_filename = f"{output_path.stem}_{self.run_id}{output_path.suffix}"
        extended_file = output_path.parent / extended_filename
        extended_file.parent.mkdir(parents=True, exist_ok=True)
        
        print(f"Extended questions will be saved to: {extended_file}")
        
        # Define fieldnames (includes all fields for MCQ, SR, and MP question types)
        fieldnames = [
            # Common metadata
            'article_id', 'article_title', 'section_id', 'section_sequence',
            'question_id', 'question_category', 'stimulus_id',
            'passage_text', 'lexile_level', 'course', 'module', 'section_number',
            'question', 'question_type',
            # MCQ / Part A fields
            'option_1', 'option_2', 'option_3', 'option_4',
            'correct_answer',
            'option_1_explanation', 'option_2_explanation',
            'option_3_explanation', 'option_4_explanation',
            # Common metadata continued
            'DOK', 'difficulty', 'CCSS', 'grade',
            'parent_question_id', 'generation_timestamp',
            'differentiation_notes', 'cognitive_process',
            # MCQ quality verification
            'homogeneity_check', 'specificity_check', 'length_check',
            'semantic_distance_check', 'single_correct_check', 'diversity_check',
            # SR-specific fields
            'expected_response', 'key_details', 'scoring_notes', 'dok_justification',
            # MP-specific Part B fields
            'part_a_dok',
            'part_b_question',
            'part_b_option_1', 'part_b_option_2', 'part_b_option_3', 'part_b_option_4',
            'part_b_correct_answer',
            'part_b_option_1_explanation', 'part_b_option_2_explanation',
            'part_b_option_3_explanation', 'part_b_option_4_explanation',
            'part_b_dok',
            'connection_rationale', 'standard_assessment'
        ]
        
        # Check if output file exists (for appending)
        file_exists = extended_file.exists()
        
        # Process articles
        article_ids = list(articles.keys())
        if limit > 0:
            article_ids = article_ids[:limit]
        
        total_generated = 0
        
        with open(extended_file, 'a' if file_exists else 'w', newline='', encoding='utf-8') as f:
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
                
                # Calculate expected based on mode
                if self.only_guiding:
                    expected = guiding_count * GUIDING_SIBLINGS
                elif self.include_guiding:
                    expected = guiding_count * GUIDING_SIBLINGS + quiz_count * QUIZ_SIBLINGS
                else:
                    expected = quiz_count * QUIZ_SIBLINGS
                
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
        
        print(f"\nExtension complete! Generated {total_generated} total questions")
        print(f"Extended questions saved to {extended_file}")
        
        # Now combine with original questions
        combined_file = self._combine_questions(
            extended_csv=str(extended_file),
            original_csv=input_file,
            output_dir=str(output_path.parent),
            output_base_name=output_path.stem
        )
        
        print(f"\n✓ Done! Combined output: {combined_file}")
        return combined_file
    
    def _combine_questions(
        self,
        extended_csv: str,
        original_csv: str,
        output_dir: str,
        output_base_name: str = "extended"
    ) -> str:
        """
        Combine original and extended questions into a single timestamped CSV.
        
        The combined filename is derived from the output_base_name:
        - If it contains 'extended', replace with 'combined'
        - Otherwise, use 'combined_' prefix
        
        Returns the path to the combined file.
        """
        print(f"\n--- Combining Questions ---")
        print(f"Reading extended questions from: {extended_csv}")
        extended_df = pd.read_csv(extended_csv)
        print(f"  Found {len(extended_df)} extended questions")
        
        # Get unique parent question IDs
        parent_ids = extended_df['parent_question_id'].dropna().unique()
        print(f"  Found {len(parent_ids)} unique parent question IDs")
        
        print(f"Reading original questions from: {original_csv}")
        original_df = pd.read_csv(original_csv)
        print(f"  Total original questions: {len(original_df)}")
        
        # Filter to only the parent questions that were extended
        original_parents_df = original_df[original_df['question_id'].isin(parent_ids)].copy()
        print(f"  Matched parent questions: {len(original_parents_df)}")
        
        # Add columns that exist in extended but not in original (fill with empty)
        extended_only_cols = [col for col in extended_df.columns if col not in original_df.columns]
        for col in extended_only_cols:
            original_parents_df[col] = ''
        
        # Mark question source for clarity
        original_parents_df['question_source'] = 'original'
        extended_df['question_source'] = 'extended'
        
        # Get all columns (union of both dataframes plus question_source)
        all_columns = list(extended_df.columns) + ['question_source']
        # Remove duplicates while preserving order
        all_columns = list(dict.fromkeys(all_columns))
        
        # Reorder both dataframes to have the same columns
        original_parents_df = original_parents_df.reindex(columns=all_columns)
        extended_df = extended_df.reindex(columns=all_columns)
        
        # Combine: originals first, then their extended siblings
        combined_df = pd.concat([original_parents_df, extended_df], ignore_index=True)
        
        # Sort to group originals with their siblings
        combined_df = combined_df.sort_values(
            by=['article_id', 'section_sequence', 'question_id'],
            key=lambda x: x.astype(str)
        ).reset_index(drop=True)
        
        # Create timestamped output filename
        # Derive combined name from the output base name
        if 'extended' in output_base_name.lower():
            # Replace 'extended' with 'combined' (case-insensitive)
            import re
            combined_base = re.sub(r'extended', 'combined', output_base_name, flags=re.IGNORECASE)
        else:
            # Fallback: prepend 'combined_' 
            combined_base = f"combined_{output_base_name}"
        
        combined_filename = f"{combined_base}_{self.run_id}.csv"
        combined_file = Path(output_dir) / combined_filename
        
        print(f"Saving combined questions to: {combined_file}")
        combined_df.to_csv(combined_file, index=False)
        print(f"  Total questions in combined file: {len(combined_df)}")
        print(f"    - Original questions: {len(original_parents_df)}")
        print(f"    - Extended questions: {len(extended_df)}")
        
        # Print summary by article
        print("\n--- Summary by Article ---")
        summary = combined_df.groupby(['article_id', 'question_source']).size().unstack(fill_value=0)
        print(summary)
        
        return str(combined_file)


def load_config() -> Dict[str, Any]:
    """Load configuration from config.json if it exists."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
            print(f"Loaded configuration from {CONFIG_FILE}")
            return config
    return {}


def main():
    parser = argparse.ArgumentParser(
        description='Generate sibling questions for existing question bank',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Default: Only quiz questions (4 siblings each)
    python question_bank_extender.py -i inputs/questions.csv -o outputs/extended.csv

    # Include guiding questions (1 sibling each) + quiz questions
    python question_bank_extender.py -i inputs/questions.csv -o outputs/extended.csv --include-guiding

    # Only guiding questions
    python question_bank_extender.py -i inputs/questions.csv -o outputs/extended.csv --only-guiding

Configuration:
    You can also set defaults in config.json:
    {
        "include_guiding": false,
        "only_guiding": false,
        "log_dir": "outputs/llm_logs"
    }
        """
    )
    parser.add_argument(
        '--input', '-i', 
        required=True, 
        help='Input CSV file with existing questions'
    )
    parser.add_argument(
        '--output', '-o', 
        required=True, 
        help='Output CSV file for generated questions (timestamp will be added)'
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
    parser.add_argument(
        '--include-guiding',
        action='store_true',
        help='Include guiding questions (by default, only quiz questions are extended)'
    )
    parser.add_argument(
        '--only-guiding',
        action='store_true',
        help='Only extend guiding questions (skip quiz questions)'
    )
    parser.add_argument(
        '--log-dir',
        default=None,
        help='Directory for LLM communication logs (default: outputs/llm_logs)'
    )
    parser.add_argument(
        '--config',
        default=None,
        help='Path to config file (default: config.json in script directory)'
    )
    
    args = parser.parse_args()
    
    # Load config file
    if args.config:
        global CONFIG_FILE
        CONFIG_FILE = Path(args.config)
    config = load_config()
    
    # Merge config with CLI args (CLI takes precedence)
    include_guiding = args.include_guiding or config.get('include_guiding', False)
    only_guiding = args.only_guiding or config.get('only_guiding', False)
    log_dir = args.log_dir or config.get('log_dir', None)
    
    # Validate mutually exclusive options
    if include_guiding and only_guiding:
        print("ERROR: Cannot use both --include-guiding and --only-guiding")
        return 1
    
    # Get API key
    api_key = args.api_key or os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        print("ERROR: No API key provided. Set ANTHROPIC_API_KEY or use --api-key")
        return 1
    
    # Create extender and run
    extender = QuestionBankExtender(
        api_key=api_key,
        checkpoint_dir=args.checkpoint,
        log_dir=log_dir,
        include_guiding=include_guiding,
        only_guiding=only_guiding
    )
    
    extender.process_all_articles(
        input_file=args.input,
        output_file=args.output,
        limit=args.limit
    )
    
    return 0


if __name__ == '__main__':
    exit(main())
