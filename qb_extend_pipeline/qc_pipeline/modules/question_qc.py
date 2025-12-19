#!/usr/bin/env python3
"""
Question Quality Control Module

Comprehensive validation of multiple-choice questions across all quality dimensions.
"""

import asyncio
import logging
import random
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import pandas as pd

import anthropic
from openai import AsyncOpenAI

from ..utils import load_prompts, parse_xml_response, parse_json_response, fill_prompt_variables

logger = logging.getLogger(__name__)

# Rate limiting configuration
MAX_RETRIES = 5
BASE_DELAY = 1.0  # Base delay in seconds
MAX_DELAY = 30.0  # Maximum delay between retries
MIN_REQUEST_INTERVAL = 0.3  # Minimum time between requests (300ms) - increased to avoid rate limits
BETWEEN_CHECK_DELAY = 0.5  # Delay between checks (500ms)


class RateLimiter:
    """Simple rate limiter to prevent hitting API rate limits."""
    
    def __init__(self, min_interval: float = MIN_REQUEST_INTERVAL):
        self.min_interval = min_interval
        self.last_request_time = 0
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Wait if necessary to respect rate limits."""
        async with self._lock:
            now = time.time()
            time_since_last = now - self.last_request_time
            if time_since_last < self.min_interval:
                await asyncio.sleep(self.min_interval - time_since_last)
            self.last_request_time = time.time()


class QuestionQCAnalyzer:
    """Analyzes question quality across all dimensions."""

    def __init__(self, claude_client: anthropic.AsyncAnthropic,
                 openai_client: Optional[AsyncOpenAI] = None,
                 claude_model: str = "claude-3-sonnet-20240229",
                 openai_model: str = "gpt-4-turbo",
                 examples_df: Optional[pd.DataFrame] = None,
                 skip_openai: bool = False):
        """
        Initialize the question QC analyzer.

        Args:
            claude_client: An authenticated Anthropic async client
            openai_client: An authenticated OpenAI async client (optional)
            claude_model: Claude model to use
            openai_model: OpenAI model to use
            examples_df: DataFrame of benchmark questions for difficulty assessment
            skip_openai: If True, skip all OpenAI-based checks (too_close, difficulty_assessment)
        """
        self.claude_client = claude_client
        self.openai_client = openai_client if not skip_openai else None
        self.claude_model = claude_model
        self.openai_model = openai_model
        self.temperature = 0
        self.prompts = load_prompts()
        self.examples_df = examples_df
        self.skip_openai = skip_openai
        self.rate_limiter = RateLimiter()

        # Define check lists
        self.distractor_checks = [
            'grammatical_parallel',
            'plausibility',
            'homogeneity',
            'specificity_balance',
            'too_close'  # Runs via OpenAI if available
        ]

        self.question_checks = [
            'standard_alignment',
            'clarity_precision',
            'single_correct_answer',
            'passage_reference',
            'difficulty_assessment'  # Runs via OpenAI if available and examples provided
        ]

    def _fill_prompt_variables(self, prompt_text: str, question_data: Dict[str, Any],
                               passage_text: str = "", grade: Optional[int] = None) -> str:
        """Fill variables in prompt template."""
        choices = question_data.get('choices', {})

        variables = {
            'question': question_data.get('question', ''),
            'passage': passage_text,
            'choice_A': choices.get('A', ''),
            'choice_B': choices.get('B', ''),
            'choice_C': choices.get('C', ''),
            'choice_D': choices.get('D', ''),
            'correct_answer': question_data.get('correct_answer', ''),
            'standard_code': question_data.get('CCSS', ''),
            'standard_description': question_data.get('CCSS_description', ''),
            'dok': str(question_data.get('DOK', '')),
            'grade': str(grade or ''),
            'option_a': choices.get('A', ''),
            'option_b': choices.get('B', ''),
            'option_c': choices.get('C', ''),
            'option_d': choices.get('D', ''),
            'correct_letter': question_data.get('correct_answer', '')
        }

        return fill_prompt_variables(prompt_text, variables)

    async def _run_claude_check(self, check_name: str, question_data: Dict[str, Any],
                               passage_text: str, grade: Optional[int] = None) -> Tuple[int, str]:
        """Run a single check via Claude API with retry logic."""
        check_prompts = self.prompts['question_qc']
        all_checks = {**check_prompts.get('distractor_checks', {}),
                     **check_prompts.get('question_checks', {})}

        if check_name not in all_checks:
            return 0, f"Check '{check_name}' not found"

        prompt_config = all_checks[check_name]
        filled_prompt = self._fill_prompt_variables(
            prompt_config['prompt'], question_data, passage_text, grade
        )

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                # Rate limit
                await self.rate_limiter.acquire()
                
                response = await self.claude_client.messages.create(
                    model=self.claude_model,
                    max_tokens=500,
                    temperature=self.temperature,
                    messages=[{"role": "user", "content": filled_prompt}]
                )

                response_text = response.content[0].text if hasattr(response.content[0], 'text') else str(response.content[0])
                score, reasoning = parse_xml_response(response_text.strip())
                return score, reasoning

            except anthropic.RateLimitError as e:
                last_error = e
                # Exponential backoff with jitter
                delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
                logger.warning(f"Rate limit hit for '{check_name}', retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
            except Exception as e:
                logger.error(f"Error running check '{check_name}': {e}")
                return 0, f"Error: {str(e)}"
        
        # If we exhausted all retries
        logger.error(f"Failed check '{check_name}' after {MAX_RETRIES} retries: {last_error}")
        return 0, f"Error: Rate limit exceeded after {MAX_RETRIES} retries"

    async def _run_openai_check(self, check_name: str, question_data: Dict[str, Any],
                               passage_text: str, grade: Optional[int] = None) -> Tuple[int, str]:
        """Run a single check via OpenAI API (for JSON-mode checks) with retry logic."""
        if not self.openai_client:
            return 0, "OpenAI API key not provided"

        check_prompts = self.prompts['question_qc']
        all_checks = {**check_prompts.get('distractor_checks', {}),
                     **check_prompts.get('question_checks', {})}

        if check_name not in all_checks:
            return 0, f"Check '{check_name}' not found"

        prompt_config = all_checks[check_name]
        filled_prompt = self._fill_prompt_variables(
            prompt_config['prompt'], question_data, passage_text, grade
        )

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                # Rate limit
                await self.rate_limiter.acquire()

                # Handle too_close check (JSON response)
                if check_name == 'too_close':
                    response = await self.openai_client.chat.completions.create(
                        model=self.openai_model,
                        messages=[{"role": "user", "content": filled_prompt}],
                        response_format={"type": "json_object"}
                    )

                    response_text = response.choices[0].message.content
                    data = parse_json_response(response_text)

                    if data and 'too_close' in data:
                        # Pass if NOT too close
                        passed = not data.get('too_close', True)
                        explanation = data.get('explanation', 'No explanation provided')
                        return (1 if passed else 0), explanation
                    else:
                        return 0, "Invalid JSON response"

                # Handle difficulty_assessment check
                elif check_name == 'difficulty_assessment':
                    if self.examples_df is None or self.examples_df.empty:
                        return 0, "No benchmark questions provided"

                    if not grade:
                        return 0, "Grade level required for difficulty assessment"

                    # Get benchmark questions for this grade
                    grade_examples = self.examples_df[self.examples_df['grade'] == grade].reset_index(drop=True)
                    if grade_examples.empty:
                        return 0, f"No benchmark questions for grade {grade}"

                    # Build prompt with examples
                    example_str = "\n\n---\n\n".join(
                        f"Example {i+1}:\n{self._format_benchmark_question(row)}"
                        for i, (_, row) in enumerate(grade_examples.head(5).iterrows())
                    )

                    candidate_str = self._format_candidate_question(question_data, passage_text)

                    full_prompt = f"""Grade {grade} Candidate Question:

{candidate_str}

Benchmark Grade {grade} Questions:

{example_str}

{prompt_config['prompt']}"""

                    response = await self.openai_client.chat.completions.create(
                        model=self.openai_model,
                        messages=[{"role": "user", "content": full_prompt}]
                    )

                    response_text = response.choices[0].message.content

                    # Parse judgment
                    if 'Appropriate' in response_text:
                        return 1, response_text
                    else:
                        return 0, response_text

                return 0, f"Unknown OpenAI check: {check_name}"

            except Exception as e:
                error_str = str(e)
                # Check for rate limit or quota errors
                if '429' in error_str or 'rate' in error_str.lower() or 'quota' in error_str.lower():
                    last_error = e
                    delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
                    logger.warning(f"Rate limit hit for OpenAI '{check_name}', retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"Error running OpenAI check '{check_name}': {e}")
                    return 0, f"Error: {str(e)}"
        
        # If we exhausted all retries
        logger.error(f"Failed OpenAI check '{check_name}' after {MAX_RETRIES} retries: {last_error}")
        return 0, f"Error: Rate limit exceeded after {MAX_RETRIES} retries"

    def _format_candidate_question(self, question_data: Dict[str, Any], passage: str) -> str:
        """Format candidate question for display."""
        choices = question_data.get('choices', {})
        question = question_data.get('question', '')
        correct = question_data.get('correct_answer', '')

        options_str = "\n".join(
            f"  {key}) {choices[key]}"
            for key in ['A', 'B', 'C', 'D'] if key in choices and choices[key]
        )

        passage_str = f"Passage:\n{passage[:2000]}\n\n" if passage else ""

        return f"{passage_str}Question: {question}\nOptions:\n{options_str}\nCorrect: {correct}"

    def _format_benchmark_question(self, row: pd.Series) -> str:
        """Format benchmark question for display."""
        question = row.get('question', '')
        passage = row.get('passage', '')

        options = []
        for key in ['answer_A', 'answer_B', 'answer_C', 'answer_D']:
            if key in row and row[key]:
                letter = key[-1]
                options.append(f"  {letter}) {row[key]}")

        options_str = "\n".join(options)
        correct = row.get('correct_answer', '')

        passage_str = f"Passage:\n{passage[:1000]}\n\n" if passage else ""

        return f"{passage_str}Question: {question}\nOptions:\n{options_str}\nCorrect: {correct}"

    def _run_length_check(self, question_data: Dict[str, Any]) -> Tuple[int, str]:
        """Check if answer choice lengths are balanced."""
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

            # Check balance
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
        Analyze a single question across all quality dimensions.

        Args:
            question_item: Dictionary with question data
            semaphore: Semaphore to limit concurrent API calls

        Returns:
            Dictionary with QC results
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

            logger.info(f"Analyzing question {question_id} (type: {question_type})")

            # Run all checks sequentially to avoid rate limits
            results = {}
            
            # Distractor checks
            for check_name in self.distractor_checks:
                if check_name == 'too_close':
                    if self.openai_client:
                        score, response = await self._run_openai_check(check_name, question_data, passage_text, grade)
                        results[check_name] = {'score': score, 'response': response, 'category': 'distractor'}
                        await asyncio.sleep(0.5)  # Rate limit delay
                else:
                    score, response = await self._run_claude_check(check_name, question_data, passage_text, grade)
                    results[check_name] = {'score': score, 'response': response, 'category': 'distractor'}
                    await asyncio.sleep(0.5)  # Rate limit delay

            # Question checks
            for check_name in self.question_checks:
                if check_name == 'difficulty_assessment':
                    if self.openai_client and self.examples_df is not None and grade:
                        score, response = await self._run_openai_check(check_name, question_data, passage_text, grade)
                        results[check_name] = {'score': score, 'response': response, 'category': 'question'}
                        await asyncio.sleep(0.5)  # Rate limit delay
                else:
                    score, response = await self._run_claude_check(check_name, question_data, passage_text, grade)
                    results[check_name] = {'score': score, 'response': response, 'category': 'question'}
                    await asyncio.sleep(0.5)  # Rate limit delay

            # Log check results
            for check_name, result in results.items():
                logger.debug(f"  {check_name}: {result['score']}")

            # Length check (MCQ only, runs synchronously)
            if question_type.upper() == 'MCQ':
                score, response = self._run_length_check(question_data)
                results['length_check'] = {
                    'score': score,
                    'response': response,
                    'category': 'distractor'
                }
                logger.debug(f"  length_check: {score}")

            # Calculate overall score
            total_score = sum(res['score'] for res in results.values())
            total_checks = len(results)
            overall_score = (total_score / total_checks) if total_checks > 0 else 0

            logger.info(f"Question {question_id} overall score: {overall_score:.2f} "
                       f"({total_score}/{total_checks} checks passed)")

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
        """
        Analyze a batch of questions concurrently.

        Args:
            questions: List of question items
            concurrency: Maximum number of concurrent API calls

        Returns:
            List of QC results
        """
        semaphore = asyncio.Semaphore(concurrency)
        tasks = []
        for i, question_item in enumerate(questions, 1):
            logger.info(f"Queueing question {i}/{len(questions)}")
            task = self.analyze_question(question_item, semaphore)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        return results

