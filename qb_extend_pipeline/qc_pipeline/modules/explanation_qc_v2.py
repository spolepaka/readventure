#!/usr/bin/env python3
"""
Explanation Quality Control Module V2 - Optimized

Batches all explanation checks into a single API call per explanation.
Reduces from 6-9 API calls per explanation to just 1.
"""

import asyncio
import logging
import json
import random
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from openai import AsyncOpenAI

from ..utils import clamp_grade_to_band

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
BASE_DELAY = 1.0
MAX_DELAY = 30.0


class ExplanationQCAnalyzerV2:
    """Optimized explanation QC analyzer using batched API calls."""

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4-turbo"):
        self.client = client
        self.model = model

        # Check definitions
        self.correct_checks = [
            'correctness_explanation',
            'textual_evidence', 
            'skill_reinforcement'
        ]
        self.distractor_checks = [
            'specific_error',
            'misconception_diagnosis',
            'textual_refutation',
            'correct_guidance',
            'actionable_strategy',
            'reasoning_model'
        ]
        self.all_checks = [
            'tone',
            'conciseness',
            'grade_appropriateness'
        ]

    def _build_correct_answer_prompt(
        self,
        explanation: str,
        question: str,
        passage: str,
        option_text: str,
        grade_band: str
    ) -> str:
        """Build prompt for correct answer explanation QC."""
        return f"""You are a quality control expert for educational assessment feedback.

Evaluate the following CORRECT ANSWER explanation for a reading comprehension question.

## Passage:
{passage[:2000] if passage else "No passage provided"}

## Question: {question}

## Correct Answer: {option_text}

## Explanation to Evaluate:
{explanation}

## Grade Level: {grade_band}

---

Evaluate ALL of the following quality checks:

### 1. correctness_explanation
Does the explanation clearly state WHY this answer is correct?
- PASS: Clearly explains the reasoning for correctness
- FAIL: Does not explain why the answer is correct

### 2. textual_evidence
Does the explanation cite specific evidence from the passage?
- PASS: References specific text or quotes
- FAIL: No textual evidence provided

### 3. skill_reinforcement
Does the explanation reinforce the reading skill being tested?
- PASS: Mentions strategy or skill for future use
- FAIL: No skill reinforcement

### 4. tone
Is the tone encouraging and appropriate for students?
- PASS: Positive, supportive tone
- FAIL: Condescending, harsh, or inappropriate

### 5. conciseness
Is the explanation concise and not overly long?
- PASS: Clear and reasonably concise
- FAIL: Too verbose or rambling

### 6. grade_appropriateness
Is the language appropriate for {grade_band} students?
- PASS: Age-appropriate vocabulary and complexity
- FAIL: Too simple or too complex

Respond with JSON:
{{
  "correctness_explanation": {{"score": 0 or 1, "reasoning": "..."}},
  "textual_evidence": {{"score": 0 or 1, "reasoning": "..."}},
  "skill_reinforcement": {{"score": 0 or 1, "reasoning": "..."}},
  "tone": {{"score": 0 or 1, "reasoning": "..."}},
  "conciseness": {{"score": 0 or 1, "reasoning": "..."}},
  "grade_appropriateness": {{"score": 0 or 1, "reasoning": "..."}}
}}"""

    def _build_distractor_prompt(
        self,
        explanation: str,
        question: str,
        passage: str,
        option_text: str,
        correct_option_text: str,
        grade_band: str
    ) -> str:
        """Build prompt for distractor explanation QC."""
        return f"""You are a quality control expert for educational assessment feedback.

Evaluate the following INCORRECT ANSWER (distractor) explanation for a reading comprehension question.

## Passage:
{passage[:2000] if passage else "No passage provided"}

## Question: {question}

## Incorrect Answer Being Explained: {option_text}

## Correct Answer: {correct_option_text}

## Explanation to Evaluate:
{explanation}

## Grade Level: {grade_band}

---

Evaluate ALL of the following quality checks:

### 1. specific_error
Does the explanation identify WHY this specific answer is wrong?
- PASS: Explains the specific error in choosing this option
- FAIL: Generic or unclear about why it's wrong

### 2. misconception_diagnosis
Does it explain what misconception might lead to this choice?
- PASS: Identifies likely student thinking error
- FAIL: Does not address possible misconception

### 3. textual_refutation
Does it use passage evidence to show why it's wrong?
- PASS: Cites text that contradicts this choice
- FAIL: No textual refutation

### 4. correct_guidance
Does it point toward the correct answer?
- PASS: Guides student toward correct answer
- FAIL: Does not mention or lead to correct answer

### 5. actionable_strategy
Does it provide a strategy for avoiding this error?
- PASS: Gives actionable advice for future
- FAIL: No strategy provided

### 6. reasoning_model
Does it model good reasoning process?
- PASS: Shows how to think through the question
- FAIL: Does not demonstrate reasoning

### 7. tone
Is the tone supportive and not discouraging?
- PASS: Encouraging despite being wrong
- FAIL: Harsh or discouraging

### 8. conciseness
Is the explanation concise?
- PASS: Clear and reasonably concise
- FAIL: Too verbose

### 9. grade_appropriateness
Is the language appropriate for {grade_band} students?
- PASS: Age-appropriate
- FAIL: Too simple or complex

Respond with JSON:
{{
  "specific_error": {{"score": 0 or 1, "reasoning": "..."}},
  "misconception_diagnosis": {{"score": 0 or 1, "reasoning": "..."}},
  "textual_refutation": {{"score": 0 or 1, "reasoning": "..."}},
  "correct_guidance": {{"score": 0 or 1, "reasoning": "..."}},
  "actionable_strategy": {{"score": 0 or 1, "reasoning": "..."}},
  "reasoning_model": {{"score": 0 or 1, "reasoning": "..."}},
  "tone": {{"score": 0 or 1, "reasoning": "..."}},
  "conciseness": {{"score": 0 or 1, "reasoning": "..."}},
  "grade_appropriateness": {{"score": 0 or 1, "reasoning": "..."}}
}}"""

    async def _run_batch_check(
        self,
        explanation_item: Dict[str, Any]
    ) -> Dict[str, Dict[str, Any]]:
        """Run all checks for an explanation in a single API call."""
        explanation = explanation_item.get('explanation', '')
        question = explanation_item.get('question', '')
        passage = explanation_item.get('passage', '')
        option_text = explanation_item.get('option_text', '')
        correct_option_text = explanation_item.get('correct_option_text', '')
        is_correct = explanation_item.get('is_correct', False)
        grade = explanation_item.get('grade', 5)
        grade_band = clamp_grade_to_band(grade)

        # Build appropriate prompt
        if is_correct:
            prompt = self._build_correct_answer_prompt(
                explanation, question, passage, option_text, grade_band
            )
            expected_checks = self.correct_checks + self.all_checks
        else:
            prompt = self._build_distractor_prompt(
                explanation, question, passage, option_text, correct_option_text, grade_band
            )
            expected_checks = self.distractor_checks + self.all_checks

        for attempt in range(MAX_RETRIES):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )

                response_text = response.choices[0].message.content
                data = json.loads(response_text)

                results = {}
                for check_name in expected_checks:
                    check_data = data.get(check_name, {})
                    score = check_data.get('score', 0)
                    reasoning = check_data.get('reasoning', 'No reasoning provided')
                    results[check_name] = {
                        'passed': score == 1,
                        'reason': reasoning
                    }

                return results

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'rate' in error_str.lower():
                    delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
                    logger.warning(f"Rate limit, retrying in {delay:.1f}s")
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"Error in explanation QC batch: {e}")
                    return {check: {'passed': False, 'reason': f'Error: {str(e)}'} for check in expected_checks}

        return {check: {'passed': False, 'reason': 'Max retries exceeded'} for check in expected_checks}

    async def analyze_explanation(
        self,
        explanation_item: Dict[str, Any],
        semaphore: Optional[asyncio.Semaphore] = None
    ) -> Dict[str, Any]:
        """
        Analyze a single explanation with ONE API call.
        """
        async with semaphore if semaphore else asyncio.Semaphore(1):
            question_id = explanation_item.get('question_id', 'unknown')
            option_label = explanation_item.get('option_label', 'unknown')
            is_correct = explanation_item.get('is_correct', False)

            logger.info(f"Analyzing explanation {question_id}:{option_label} (correct={is_correct})")

            # Run batch check (1 API call)
            results = await self._run_batch_check(explanation_item)

            # Calculate score
            total_passed = sum(1 for r in results.values() if r.get('passed', False))
            total_checks = len(results)
            overall_score = (total_passed / total_checks) if total_checks > 0 else 0

            logger.info(f"Explanation {question_id}:{option_label}: {total_passed}/{total_checks} passed ({overall_score:.0%})")

            return {
                'question_id': question_id,
                'option_label': option_label,
                'is_correct': is_correct,
                'overall_score': overall_score,
                'total_checks_passed': total_passed,
                'total_checks_run': total_checks,
                'checks': results,
                'timestamp': datetime.now().isoformat()
            }

    async def analyze_batch(
        self,
        explanations: List[Dict[str, Any]],
        concurrency: int = 5
    ) -> List[Dict[str, Any]]:
        """Analyze batch of explanations with controlled concurrency."""
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [self.analyze_explanation(e, semaphore) for e in explanations]
        return await asyncio.gather(*tasks)

