#!/usr/bin/env python3
"""
Question Quality Control Module V2 - OpenRouter Version

Uses OpenRouter API (OpenAI-compatible) for Claude calls instead of direct Anthropic API.
Benefits:
- Higher rate limits (paid: 1000 req/day, 20 req/min)
- Fewer concurrency restrictions on paid models
- Single API for multiple providers

OpenRouter API is OpenAI-compatible, so we use the OpenAI SDK with a custom base_url.

Rate Limits (as of 2024):
- Free users: 50 req/day, 20 req/min
- Paid users (≥$10 credits): 1000 req/day, 20 req/min
- Paid models: No strict OpenRouter limits (upstream provider limits apply)
"""

import asyncio
import logging
import random
import json
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from collections import deque
import pandas as pd

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# Rate limiting configuration - optimized for OpenRouter
MAX_RETRIES = 8  # More retries for better reliability
BASE_DELAY = 0.5  # Start with shorter delay
MAX_DELAY = 60.0  # Allow longer max delay for busy periods
JITTER_FACTOR = 0.3  # Add randomness to avoid thundering herd

# OpenRouter specific settings
OPENROUTER_REQUESTS_PER_MINUTE = 20  # Default rate limit
OPENROUTER_BURST_SIZE = 5  # Allow small bursts


class TokenBucketRateLimiter:
    """
    Token bucket rate limiter for smooth request distribution.
    
    Allows bursting while maintaining average rate over time.
    """
    
    def __init__(self, rate_per_minute: int = 20, burst_size: int = 5):
        self.rate_per_second = rate_per_minute / 60.0
        self.max_tokens = burst_size
        self.tokens = burst_size  # Start with full bucket
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Wait until a token is available, then consume it."""
        async with self._lock:
            now = time.monotonic()
            # Add tokens based on elapsed time
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate_per_second)
            self.last_update = now
            
            if self.tokens >= 1:
                self.tokens -= 1
                return
            
            # Calculate wait time for next token
            wait_time = (1 - self.tokens) / self.rate_per_second
            
        # Wait outside the lock
        if wait_time > 0:
            logger.debug(f"Rate limiter: waiting {wait_time:.2f}s")
            await asyncio.sleep(wait_time)
            
        async with self._lock:
            self.tokens = 0  # Consume the token we waited for
            self.last_update = time.monotonic()


class AdaptiveRateLimiter:
    """
    Adaptive rate limiter that adjusts based on API responses.
    
    Increases delay when hitting rate limits, decreases when successful.
    """
    
    def __init__(self, initial_rate: int = 20, min_rate: int = 5, max_rate: int = 50):
        self.current_rate = initial_rate
        self.min_rate = min_rate
        self.max_rate = max_rate
        self.bucket = TokenBucketRateLimiter(initial_rate, burst_size=5)
        self._lock = asyncio.Lock()
        self._consecutive_successes = 0
        self._consecutive_failures = 0
    
    async def acquire(self):
        """Acquire a token from the rate limiter."""
        await self.bucket.acquire()
    
    async def report_success(self):
        """Report a successful request - may increase rate."""
        async with self._lock:
            self._consecutive_successes += 1
            self._consecutive_failures = 0
            
            # After 10 consecutive successes, try increasing rate
            if self._consecutive_successes >= 10 and self.current_rate < self.max_rate:
                self.current_rate = min(self.max_rate, int(self.current_rate * 1.2))
                self.bucket = TokenBucketRateLimiter(self.current_rate, burst_size=5)
                logger.info(f"Rate limiter: increased rate to {self.current_rate}/min")
                self._consecutive_successes = 0
    
    async def report_rate_limit(self):
        """Report a rate limit hit - decrease rate."""
        async with self._lock:
            self._consecutive_failures += 1
            self._consecutive_successes = 0
            
            # Decrease rate on rate limit
            self.current_rate = max(self.min_rate, int(self.current_rate * 0.7))
            self.bucket = TokenBucketRateLimiter(self.current_rate, burst_size=3)
            logger.warning(f"Rate limiter: decreased rate to {self.current_rate}/min after rate limit")


# Global rate limiter instance (shared across all requests)
_global_rate_limiter: Optional[AdaptiveRateLimiter] = None


def get_rate_limiter(initial_rate: int = 20) -> AdaptiveRateLimiter:
    """Get or create the global rate limiter."""
    global _global_rate_limiter
    if _global_rate_limiter is None:
        _global_rate_limiter = AdaptiveRateLimiter(initial_rate=initial_rate)
    return _global_rate_limiter


def reset_rate_limiter():
    """Reset the global rate limiter (useful between runs)."""
    global _global_rate_limiter
    _global_rate_limiter = None


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

# Default OpenAI model via OpenRouter
DEFAULT_OPENAI_MODEL = "openai/gpt-4o"  # GPT-4o via OpenRouter for speed + unified billing

# JSON Schema for structured output (OpenAI format)
CLAUDE_QC_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        check: {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        }
        for check in CLAUDE_CHECKS
    },
    "required": CLAUDE_CHECKS
}


class QuestionQCAnalyzerV2OpenRouter:
    """
    Optimized question QC analyzer using OpenRouter API.
    
    OpenRouter provides access to Claude models via an OpenAI-compatible API,
    with higher rate limits and better concurrency support.
    
    Features:
    - Adaptive rate limiting (adjusts based on API responses)
    - Higher default concurrency (25 vs 10 for Anthropic)
    - Request queuing for smooth throughput
    - Automatic retry with exponential backoff
    """

    def __init__(
        self,
        openrouter_client: AsyncOpenAI,
        openai_client: Optional[AsyncOpenAI] = None,
        claude_model: str = "anthropic/claude-sonnet-4",
        openai_model: str = DEFAULT_OPENAI_MODEL,  # Now defaults to GPT-4o via OpenRouter
        examples_df: Optional[pd.DataFrame] = None,
        skip_openai: bool = False,
        initial_rate: int = 25,  # Higher default for OpenRouter
        max_concurrent: int = 30,  # Allow high concurrency
        use_openrouter_for_openai: bool = True  # Route GPT through OpenRouter too
    ):
        """
        Initialize the OpenRouter-based QC analyzer.
        
        Args:
            openrouter_client: AsyncOpenAI client configured for OpenRouter
            openai_client: Standard OpenAI client for supplementary checks (legacy, optional)
            claude_model: OpenRouter model ID (e.g., "anthropic/claude-sonnet-4")
            openai_model: OpenAI model ID (e.g., "openai/gpt-4o" for OpenRouter or "gpt-4o" for direct)
            examples_df: Benchmark questions for difficulty assessment
            skip_openai: Skip OpenAI-based checks
            initial_rate: Initial requests per minute (default: 25)
            max_concurrent: Maximum concurrent requests (default: 30)
            use_openrouter_for_openai: Route GPT calls through OpenRouter (default: True)
        """
        self.openrouter_client = openrouter_client
        self.claude_model = claude_model
        self.openai_model = openai_model
        self.examples_df = examples_df
        self.skip_openai = skip_openai
        self.max_concurrent = max_concurrent
        self.use_openrouter_for_openai = use_openrouter_for_openai
        
        # For GPT calls: use OpenRouter client if enabled, else use separate OpenAI client
        if use_openrouter_for_openai:
            self.openai_client = openrouter_client  # Same client, different model
            # Ensure model ID is in OpenRouter format
            if not self.openai_model.startswith('openai/'):
                self.openai_model = f"openai/{self.openai_model}"
            logger.info(f"GPT checks will use OpenRouter: {self.openai_model}")
        else:
            self.openai_client = openai_client if not skip_openai else None
        
        # Initialize rate limiter with custom rate
        reset_rate_limiter()  # Reset for fresh start
        self.rate_limiter = get_rate_limiter(initial_rate)
        
        # Stats tracking
        self._stats = {
            'total_requests': 0,
            'successful_requests': 0,
            'rate_limit_hits': 0,
            'errors': 0
        }

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

Respond with a JSON object containing your assessment for each check. Each check should have a "score" (0 or 1) and "reasoning" (string explanation).

Example format:
{{
  "grammatical_parallel": {{"score": 1, "reasoning": "All choices follow parallel structure..."}},
  "plausibility": {{"score": 0, "reasoning": "Option D is obviously wrong..."}},
  ...
}}"""

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

    async def _run_claude_batch_via_openrouter(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        Run all Claude checks via OpenRouter API (OpenAI-compatible).
        
        Features:
        - Adaptive rate limiting
        - Exponential backoff with jitter
        - Automatic retry on transient errors
        """
        prompt = self._build_claude_batch_prompt(question_data, passage_text, grade)
        self._stats['total_requests'] += 1

        for attempt in range(MAX_RETRIES):
            try:
                # Acquire rate limit token before making request
                await self.rate_limiter.acquire()
                
                # Use OpenAI-compatible API via OpenRouter
                response = await self.openrouter_client.chat.completions.create(
                    model=self.claude_model,
                    max_tokens=2000,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    extra_headers={
                        "HTTP-Referer": "https://github.com/playcademy",  # For OpenRouter stats
                        "X-Title": "QC Pipeline V2 - High Priority"  # For OpenRouter dashboard
                    }
                )

                response_text = response.choices[0].message.content
                
                try:
                    data = json.loads(response_text)
                except json.JSONDecodeError:
                    logger.warning(f"Failed to parse JSON response, attempting extraction...")
                    # Try to extract JSON from response
                    import re
                    json_match = re.search(r'\{[\s\S]*\}', response_text)
                    if json_match:
                        data = json.loads(json_match.group())
                    else:
                        raise ValueError("No valid JSON found in response")

                # Parse results
                results = {}
                for check_name in CLAUDE_CHECKS:
                    check_data = data.get(check_name, {})
                    if isinstance(check_data, dict):
                        results[check_name] = {
                            'score': check_data.get('score', 0),
                            'response': check_data.get('reasoning', 'No reasoning provided'),
                            'category': 'distractor' if check_name in ['grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance'] else 'question'
                        }
                    else:
                        results[check_name] = {
                            'score': 0,
                            'response': 'Invalid response format',
                            'category': 'unknown'
                        }
                
                # Report success to rate limiter (may increase rate)
                await self.rate_limiter.report_success()
                self._stats['successful_requests'] += 1
                
                return results

            except Exception as e:
                error_str = str(e).lower()
                
                # Check for rate limit errors
                is_rate_limit = '429' in str(e) or 'rate' in error_str or 'limit' in error_str or 'too many' in error_str
                
                if is_rate_limit:
                    self._stats['rate_limit_hits'] += 1
                    
                    # Report to rate limiter (will decrease rate)
                    await self.rate_limiter.report_rate_limit()
                    
                    # Exponential backoff with jitter
                    base_delay = BASE_DELAY * (2 ** attempt)
                    jitter = base_delay * JITTER_FACTOR * random.random()
                    delay = min(base_delay + jitter, MAX_DELAY)
                    
                    logger.warning(f"Rate limit hit, retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES}, current rate: {self.rate_limiter.current_rate}/min)")
                    await asyncio.sleep(delay)
                    
                elif 'timeout' in error_str or 'connection' in error_str:
                    # Transient errors - retry with shorter delay
                    delay = BASE_DELAY * (attempt + 1) + random.uniform(0, 1)
                    logger.warning(f"Transient error: {e}, retrying in {delay:.1f}s")
                    await asyncio.sleep(delay)
                    
                else:
                    # Non-retryable error
                    self._stats['errors'] += 1
                    logger.error(f"Error in OpenRouter Claude batch: {e}")
                    return {check: {'score': 0, 'response': f'Error: {str(e)}', 'category': 'unknown'} for check in CLAUDE_CHECKS}

        self._stats['errors'] += 1
        return {check: {'score': 0, 'response': 'Max retries exceeded', 'category': 'unknown'} for check in CLAUDE_CHECKS}

    async def _run_openai_batch(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        Run all OpenAI/GPT checks in a single API call.
        
        Now optimized to use OpenRouter for GPT-4o with same rate limiting
        as Claude checks for unified, fast processing.
        """
        if not self.openai_client:
            return {}

        prompt = self._build_openai_batch_prompt(question_data, passage_text, grade)
        self._stats['total_requests'] += 1

        for attempt in range(MAX_RETRIES):
            try:
                # Use same rate limiter for unified throughput control
                if self.use_openrouter_for_openai:
                    await self.rate_limiter.acquire()
                
                # Build request - add OpenRouter headers if using OpenRouter
                extra_kwargs = {}
                if self.use_openrouter_for_openai:
                    extra_kwargs['extra_headers'] = {
                        "HTTP-Referer": "https://github.com/playcademy",
                        "X-Title": "QC Pipeline V2 - GPT Checks"
                    }
                
                response = await self.openai_client.chat.completions.create(
                    model=self.openai_model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    max_tokens=1000,  # GPT checks need less tokens
                    **extra_kwargs
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

                # Track success for adaptive rate limiting
                self._stats['successful_requests'] += 1
                if self.use_openrouter_for_openai:
                    await self.rate_limiter.report_success()
                
                return results

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'rate' in error_str.lower():
                    self._stats['rate_limit_hits'] += 1
                    if self.use_openrouter_for_openai:
                        await self.rate_limiter.report_rate_limit()
                    delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, JITTER_FACTOR), MAX_DELAY)
                    logger.warning(f"GPT rate limit (attempt {attempt + 1}), retrying in {delay:.1f}s")
                    await asyncio.sleep(delay)
                else:
                    self._stats['errors'] += 1
                    logger.error(f"Error in GPT batch: {e}")
                    return {
                        'too_close': {'score': 0, 'response': f'Error: {str(e)}', 'category': 'distractor'},
                        'difficulty_assessment': {'score': 0, 'response': f'Error: {str(e)}', 'category': 'question'}
                    }

        self._stats['errors'] += 1
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

            word_counts = [len(str(text).split()) for text in choice_texts]
            correct_word_count = len(str(correct_text).split())

            # All choices <= 3 words is acceptable
            if all(count <= 3 for count in word_counts):
                return 1, "All choices are 3 words or less"

            distractor_counts = [
                len(str(choices[key]).split())
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
        Analyze a single question with batched API calls via OpenRouter.
        
        Only 2 API calls total:
        - 1 OpenRouter call for 8 Claude checks
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
            logger.info(f"Analyzing question {question_id} (OpenRouter mode)")

            results = {}

            # Run Claude batch via OpenRouter (1 API call for 8 checks)
            claude_results = await self._run_claude_batch_via_openrouter(question_data, passage_text, grade)
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
                'provider': 'openrouter',
                'timestamp': datetime.now().isoformat()
            }

    async def analyze_batch(
        self,
        questions: List[Dict[str, Any]],
        concurrency: int = 25  # Higher default for OpenRouter (vs 10 for Anthropic)
    ) -> List[Dict[str, Any]]:
        """
        Analyze a batch of questions with controlled concurrency.
        
        OpenRouter typically supports higher concurrency than direct Anthropic API.
        Default concurrency is 25 (vs 10 for direct Anthropic).
        
        The adaptive rate limiter will automatically adjust the actual request rate
        based on API responses, so setting high concurrency is safe.
        """
        # Use the max of provided concurrency and instance max
        effective_concurrency = min(concurrency, self.max_concurrent)
        logger.info(f"Starting batch analysis: {len(questions)} questions, concurrency={effective_concurrency}")
        
        semaphore = asyncio.Semaphore(effective_concurrency)
        tasks = [self.analyze_question(q, semaphore) for q in questions]
        results = await asyncio.gather(*tasks)
        
        # Log stats after batch
        logger.info(f"Batch complete - Stats: {self._stats}")
        logger.info(f"Final rate: {self.rate_limiter.current_rate}/min")
        
        return results
    
    def get_stats(self) -> Dict[str, Any]:
        """Get processing statistics."""
        return {
            **self._stats,
            'current_rate_per_min': self.rate_limiter.current_rate,
            'success_rate': (
                self._stats['successful_requests'] / self._stats['total_requests'] 
                if self._stats['total_requests'] > 0 else 0
            )
        }

    async def analyze_openai_only(
        self,
        question_item: Dict[str, Any],
        semaphore: Optional[asyncio.Semaphore] = None
    ) -> Dict[str, Any]:
        """
        Run only OpenAI checks for a question.
        
        Used when Claude checks have already been completed.
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
        """Run only OpenAI checks for a batch of questions."""
        if not self.openai_client:
            logger.warning("No OpenAI client available for OpenAI-only batch")
            return []
        
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [self.analyze_openai_only(q, semaphore) for q in questions]
        return await asyncio.gather(*tasks)

