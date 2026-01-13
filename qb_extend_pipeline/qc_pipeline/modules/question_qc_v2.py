#!/usr/bin/env python3
"""
Question Quality Control Module V2 - Optimized

Batches all checks into minimal API calls using structured output:
- 1 Claude API call for all Claude-based checks
- 1 OpenAI API call for all OpenAI-based checks (if enabled)
- 1 local check (length_check - no API)

This reduces API calls from 8+ per question to just 2.
"""

import asyncio
import logging
import random
import time
import json
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import pandas as pd

import anthropic
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# Rate limiting configuration
MAX_RETRIES = 5
BASE_DELAY = 1.0
MAX_DELAY = 30.0

# Claude checks to batch
CLAUDE_CHECKS = [
    'grammatical_parallel',
    'plausibility', 
    'homogeneity',
    'specificity_balance',
    'standard_alignment',
    'clarity_precision',
    'single_correct_answer',
    'passage_reference'
]

# OpenAI checks to batch
OPENAI_CHECKS = [
    'too_close',
    'difficulty_assessment'
]

# Schema for Claude structured output
CLAUDE_QC_SCHEMA = {
    "type": "object",
    "properties": {
        "grammatical_parallel": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "plausibility": {
            "type": "object", 
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "homogeneity": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "specificity_balance": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "standard_alignment": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "clarity_precision": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "single_correct_answer": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        },
        "passage_reference": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        }
    },
    "required": CLAUDE_CHECKS
}


class QuestionQCAnalyzerV2:
    """Optimized question QC analyzer using batched structured output."""

    def __init__(
        self,
        claude_client: anthropic.AsyncAnthropic,
        openai_client: Optional[AsyncOpenAI] = None,
        claude_model: str = "claude-sonnet-4-5-20250929",
        openai_model: str = "gpt-4-turbo",
        examples_df: Optional[pd.DataFrame] = None,
        skip_openai: bool = False
    ):
        self.claude_client = claude_client
        self.openai_client = openai_client if not skip_openai else None
        self.claude_model = claude_model
        self.openai_model = openai_model
        self.examples_df = examples_df
        self.skip_openai = skip_openai

    def _build_claude_batch_prompt(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> str:
        """Build a single prompt for all Claude-based checks."""
        choices = question_data.get('choices', {})
        question = question_data.get('question', '')
        correct_answer = question_data.get('correct_answer', '')
        standard_code = question_data.get('CCSS', '')
        standard_description = question_data.get('CCSS_description', '')
        dok = question_data.get('DOK', '')

        prompt = f"""You are a quality control expert for reading comprehension assessment items.

Analyze the following multiple-choice question and evaluate it on ALL of the quality checks listed below.

## Passage:
{passage_text[:3000] if passage_text else "No passage provided"}

## Question:
{question}

## Answer Choices:
A) {choices.get('A', '')}
B) {choices.get('B', '')}
C) {choices.get('C', '')}
D) {choices.get('D', '')}

## Correct Answer: {correct_answer}

## Metadata:
- Standard: {standard_code} - {standard_description}
- DOK Level: {dok}
- Grade: {grade or 'Not specified'}

---

## Quality Checks to Evaluate:

### 1. grammatical_parallel
Do all answer choices follow the same grammatical pattern/structure?
- PASS (1): All choices have consistent grammatical structure
- FAIL (0): Choices have inconsistent structures

### 2. plausibility
Are all INCORRECT choices believable distractors (not obviously wrong)?
- PASS (1): All distractors are plausible
- FAIL (0): Any distractor is obviously wrong or unrelated

### 3. homogeneity
Do all choices belong to the same conceptual category?
- PASS (1): All choices are the same type of answer
- FAIL (0): Choices span different categories

### 4. specificity_balance
Are all choices at similar levels of detail/specificity?
- PASS (1): Similar levels of detail across choices
- FAIL (0): Significant differences in specificity

### 5. standard_alignment
Does this question properly assess the assigned learning standard ({standard_code})?
- PASS (1): Question directly assesses the standard
- FAIL (0): Question assesses a different skill

### 6. clarity_precision
Is the question clearly written and unambiguous?
- PASS (1): Clear, precise, one interpretation
- FAIL (0): Ambiguous, confusing, or unclear

### 7. single_correct_answer
Is there exactly one defensibly correct answer?
- PASS (1): One clear correct answer
- FAIL (0): Multiple answers could be correct, or none

### 8. passage_reference
Are any specific passage references (paragraph numbers, quotes, etc.) accurate?
- PASS (1): All references are accurate OR no specific references made
- FAIL (0): Any reference is inaccurate

---

Evaluate each check and provide your assessment."""

        return prompt

    def _build_openai_batch_prompt(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> str:
        """Build a single prompt for all OpenAI-based checks."""
        choices = question_data.get('choices', {})
        question = question_data.get('question', '')
        correct_answer = question_data.get('correct_answer', '')

        # Get correct answer text
        correct_text = choices.get(correct_answer, '')
        
        # Get distractor texts
        distractors = {k: v for k, v in choices.items() if k != correct_answer}

        prompt = f"""Analyze this multiple-choice question for quality issues.

## Passage:
{passage_text[:2000] if passage_text else "No passage provided"}

## Question: {question}

## Choices:
A) {choices.get('A', '')}
B) {choices.get('B', '')}
C) {choices.get('C', '')}
D) {choices.get('D', '')}

## Correct Answer: {correct_answer} - {correct_text}

## Grade Level: {grade or 'Not specified'}

---

Evaluate the following:

### 1. too_close
Are any distractors semantically too similar to the correct answer, making it confusing?
- Check if distractors could be confused with the correct answer
- Consider if the distinction between correct and incorrect is clear

### 2. difficulty_assessment  
Is this question appropriate for Grade {grade or 'the target grade'}?
- Consider vocabulary complexity
- Consider reasoning demands
- Consider if it's too easy or too hard

Respond with JSON:
{{
  "too_close": {{
    "score": 0 or 1,
    "too_close_detected": true or false,
    "reasoning": "explanation"
  }},
  "difficulty_assessment": {{
    "score": 0 or 1,
    "appropriate": true or false,
    "reasoning": "explanation"
  }}
}}"""

        return prompt

    async def _run_claude_batch(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> Dict[str, Dict[str, Any]]:
        """Run all Claude checks in a single API call using structured output."""
        prompt = self._build_claude_batch_prompt(question_data, passage_text, grade)

        tools = [{
            "name": "submit_qc_results",
            "description": "Submit quality control check results for all checks",
            "input_schema": CLAUDE_QC_SCHEMA
        }]

        for attempt in range(MAX_RETRIES):
            try:
                response = await self.claude_client.messages.create(
                    model=self.claude_model,
                    max_tokens=2000,
                    tools=tools,
                    tool_choice={"type": "tool", "name": "submit_qc_results"},
                    messages=[{"role": "user", "content": prompt}]
                )

                # Extract structured output
                for block in response.content:
                    if block.type == "tool_use" and block.name == "submit_qc_results":
                        results = {}
                        for check_name in CLAUDE_CHECKS:
                            check_data = block.input.get(check_name, {})
                            results[check_name] = {
                                'score': check_data.get('score', 0),
                                'response': check_data.get('reasoning', 'No reasoning provided'),
                                'category': 'distractor' if check_name in ['grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance'] else 'question'
                            }
                        return results

                # Fallback if no tool use found
                return {check: {'score': 0, 'response': 'No structured output', 'category': 'unknown'} for check in CLAUDE_CHECKS}

            except anthropic.RateLimitError as e:
                delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
                logger.warning(f"Rate limit, retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
            except Exception as e:
                logger.error(f"Error in Claude batch: {e}")
                return {check: {'score': 0, 'response': f'Error: {str(e)}', 'category': 'unknown'} for check in CLAUDE_CHECKS}

        return {check: {'score': 0, 'response': 'Max retries exceeded', 'category': 'unknown'} for check in CLAUDE_CHECKS}

    async def _run_openai_batch(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> Dict[str, Dict[str, Any]]:
        """Run all OpenAI checks in a single API call."""
        if not self.openai_client:
            return {}

        prompt = self._build_openai_batch_prompt(question_data, passage_text, grade)

        for attempt in range(MAX_RETRIES):
            try:
                response = await self.openai_client.chat.completions.create(
                    model=self.openai_model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )

                response_text = response.choices[0].message.content
                data = json.loads(response_text)

                results = {}
                
                # Parse too_close
                too_close_data = data.get('too_close', {})
                too_close_detected = too_close_data.get('too_close_detected', False)
                results['too_close'] = {
                    'score': 0 if too_close_detected else 1,  # Pass if NOT too close
                    'response': too_close_data.get('reasoning', 'No reasoning'),
                    'category': 'distractor'
                }

                # Parse difficulty_assessment
                diff_data = data.get('difficulty_assessment', {})
                appropriate = diff_data.get('appropriate', True)
                results['difficulty_assessment'] = {
                    'score': 1 if appropriate else 0,
                    'response': diff_data.get('reasoning', 'No reasoning'),
                    'category': 'question'
                }

                return results

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'rate' in error_str.lower():
                    delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
                    logger.warning(f"OpenAI rate limit, retrying in {delay:.1f}s")
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"Error in OpenAI batch: {e}")
                    return {
                        'too_close': {'score': 0, 'response': f'Error: {str(e)}', 'category': 'distractor'},
                        'difficulty_assessment': {'score': 0, 'response': f'Error: {str(e)}', 'category': 'question'}
                    }

        return {
            'too_close': {'score': 0, 'response': 'Max retries exceeded', 'category': 'distractor'},
            'difficulty_assessment': {'score': 0, 'response': 'Max retries exceeded', 'category': 'question'}
        }

    def _run_length_check(self, question_data: Dict[str, Any]) -> Tuple[int, str]:
        """Check if answer choice lengths are balanced (local, no API)."""
        try:
            choices = question_data.get('choices', {})
            correct_answer = question_data.get('correct_answer', '')

            if not choices or not correct_answer:
                return 0, "Missing choices or correct answer"

            choice_texts = []
            correct_text = ""

            for key, text in choices.items():
                choice_texts.append(text)
                if key == correct_answer:
                    correct_text = text

            if not correct_text:
                return 0, f"Correct answer '{correct_answer}' not found"

            word_counts = [len(text.split()) for text in choice_texts]
            correct_word_count = len(correct_text.split())

            # All choices <= 3 words is acceptable
            if all(count <= 3 for count in word_counts):
                return 1, "All choices are 3 words or less"

            distractor_counts = [
                len(choices[key].split())
                for key in choices
                if key != correct_answer
            ]

            if not distractor_counts:
                return 0, "No distractors found"

            longest_distractor = max(distractor_counts)
            shortest_distractor = min(distractor_counts)

            if correct_word_count > 1.1 * longest_distractor:
                return 0, f"Correct answer ({correct_word_count} words) too long"

            if shortest_distractor > 1.1 * correct_word_count:
                return 0, f"Shortest distractor ({shortest_distractor} words) too long"

            return 1, "Choice lengths are balanced"

        except Exception as e:
            logger.error(f"Error in length check: {e}")
            return 0, f"Error: {str(e)}"

    async def analyze_question(
        self,
        question_item: Dict[str, Any],
        semaphore: Optional[asyncio.Semaphore] = None
    ) -> Dict[str, Any]:
        """
        Analyze a single question with batched API calls.
        
        Only 2 API calls total:
        - 1 Claude call for 8 checks
        - 1 OpenAI call for 2 checks (if enabled)
        """
        async with semaphore if semaphore else asyncio.Semaphore(1):
            question_id = question_item.get('question_id', 'unknown')
            question_type = question_item.get('question_type', 'MCQ')
            passage_text = question_item.get('passage_text', '')
            grade = question_item.get('grade')

            if 'structured_content' not in question_item:
                logger.warning(f"No structured_content for {question_id}")
                return {
                    'question_id': question_id,
                    'overall_score': 0,
                    'error': 'No structured_content provided',
                    'checks': {},
                    'timestamp': datetime.now().isoformat()
                }

            question_data = question_item['structured_content']
            logger.info(f"Analyzing question {question_id} (optimized batch mode)")

            results = {}

            # Run Claude batch (1 API call for 8 checks)
            claude_results = await self._run_claude_batch(question_data, passage_text, grade)
            results.update(claude_results)

            # Run OpenAI batch (1 API call for 2 checks)
            if self.openai_client:
                openai_results = await self._run_openai_batch(question_data, passage_text, grade)
                results.update(openai_results)

            # Run local length check (no API)
            if question_type.upper() == 'MCQ':
                score, response = self._run_length_check(question_data)
                results['length_check'] = {
                    'score': score,
                    'response': response,
                    'category': 'distractor'
                }

            # Calculate overall score
            total_score = sum(res['score'] for res in results.values())
            total_checks = len(results)
            overall_score = (total_score / total_checks) if total_checks > 0 else 0

            logger.info(f"Question {question_id}: {total_score}/{total_checks} checks passed ({overall_score:.0%})")

            return {
                'question_id': question_id,
                'question_type': question_type,
                'overall_score': overall_score,
                'total_checks_passed': total_score,
                'total_checks_run': total_checks,
                'checks': results,
                'timestamp': datetime.now().isoformat()
            }

    async def analyze_batch(
        self,
        questions: List[Dict[str, Any]],
        concurrency: int = 5
    ) -> List[Dict[str, Any]]:
        """Analyze a batch of questions with controlled concurrency."""
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [self.analyze_question(q, semaphore) for q in questions]
        return await asyncio.gather(*tasks)

    async def analyze_openai_only(
        self,
        question_item: Dict[str, Any],
        semaphore: Optional[asyncio.Semaphore] = None
    ) -> Dict[str, Any]:
        """
        Run only OpenAI checks for a question.
        
        Used when Claude checks have already been completed and only OpenAI checks are missing.
        Returns partial results that should be merged with existing Claude results.
        """
        async with semaphore if semaphore else asyncio.Semaphore(1):
            question_id = question_item.get('question_id', 'unknown')
            passage_text = question_item.get('passage_text', '')
            grade = question_item.get('grade')

            if 'structured_content' not in question_item:
                logger.warning(f"No structured_content for {question_id}")
                return {
                    'question_id': question_id,
                    'checks': {},
                    'error': 'No structured_content provided'
                }

            question_data = question_item['structured_content']
            logger.debug(f"Running OpenAI checks only for {question_id}")

            results = {}

            # Run only OpenAI batch (1 API call for 2 checks)
            if self.openai_client:
                openai_results = await self._run_openai_batch(question_data, passage_text, grade)
                results.update(openai_results)
            else:
                logger.warning(f"No OpenAI client for {question_id}")
                return {
                    'question_id': question_id,
                    'checks': {},
                    'error': 'No OpenAI client available'
                }

            return {
                'question_id': question_id,
                'checks': results,
                'timestamp': datetime.now().isoformat()
            }

    async def analyze_batch_openai_only(
        self,
        questions: List[Dict[str, Any]],
        concurrency: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Run only OpenAI checks for a batch of questions.
        
        Used when Claude checks have already been completed and only OpenAI checks are missing.
        Returns partial results that should be merged with existing Claude results.
        """
        if not self.openai_client:
            logger.warning("No OpenAI client available for OpenAI-only batch")
            return []
        
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [self.analyze_openai_only(q, semaphore) for q in questions]
        return await asyncio.gather(*tasks)