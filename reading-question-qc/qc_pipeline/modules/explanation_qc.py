#!/usr/bin/env python3
"""
Explanation Quality Control Module

Uses OpenAI GPT-5 to validate explanation quality for both correct answers
and distractors across multiple dimensions.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from openai import AsyncOpenAI

from ..utils import load_prompts, parse_json_response, fill_prompt_variables, clamp_grade_to_band

logger = logging.getLogger(__name__)


class ExplanationQCAnalyzer:
    """Analyzes explanation quality using OpenAI API."""

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4-turbo"):
        """
        Initialize the explanation QC analyzer.

        Args:
            client: An authenticated OpenAI async client
            model: OpenAI model to use
        """
        self.client = client
        self.model = model
        self.prompts = load_prompts()

        # Define QC check names for correct vs distractor explanations
        self.correct_checks = [
            '01_correctness_explanation',
            '02_textual_evidence',
            '03_skill_reinforcement'
        ]
        self.distractor_checks = [
            '04_specific_error',
            '05_misconception_diagnosis',
            '06_textual_refutation',
            '07_correct_guidance',
            '08_actionable_strategy',
            '09_reasoning_model'
        ]
        self.all_checks = [
            '10_tone',
            '11_conciseness',
            '12_grade_appropriateness'
        ]

    def _fill_qc_prompt(self, prompt_text: str, explanation: str,
                       question: str, passage: str, option: str,
                       grade_band: str, correct: bool,
                       correct_option: Optional[str] = None) -> str:
        """Fill variables in explanation QC prompt."""
        variables = {
            'FEEDBACK_TO_EVALUATE': explanation,
            'EXPLANATION': explanation,
            'QUESTION': question,
            'PASSAGE': passage,
            'ANSWER_CHOICE': option,
            'OPTION': option,
            'DISTRACTOR_CHOICE': option,
            'CORRECT_ANSWER': correct_option or option,
            'CORRECT_CHOICE': correct_option or option,
            'ALL_OPTIONS': '',  # Not used in current prompts
            'GRADE_LEVEL': grade_band,
            'YES/NO': 'YES' if correct else 'NO'
        }

        return fill_prompt_variables(prompt_text, variables)

    async def _run_qc_check(self, check_id: str, explanation: str, question: str,
                           passage: str, option: str, grade_band: str, correct: bool,
                           correct_option: Optional[str] = None) -> Tuple[bool, str]:
        """Run a single QC check via OpenAI API."""
        try:
            # Find the prompt
            all_prompts = self.prompts['explanation_qc']
            prompt_config = None

            for category in ['correct', 'distractor', 'all']:
                if check_id in all_prompts.get(category, {}):
                    prompt_config = all_prompts[category][check_id]
                    break

            if not prompt_config:
                logger.error(f"QC check '{check_id}' not found in prompts")
                return False, f"Check '{check_id}' not available"

            # Fill prompt
            filled_prompt = self._fill_qc_prompt(
                prompt_config['prompt'], explanation, question, passage,
                option, grade_band, correct, correct_option
            )

            # Add JSON output instruction
            filled_prompt += f"\n\nReturn JSON with fields check_id (must be '{check_id}'), passed (boolean), reason (string)."

            # Call API
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "user", "content": filled_prompt}
                ],
                response_format={"type": "json_object"}
            )

            response_text = response.choices[0].message.content
            data = parse_json_response(response_text)

            if (data and
                data.get('check_id') == check_id and
                isinstance(data.get('passed'), bool) and
                isinstance(data.get('reason'), str)):
                return data['passed'], data['reason']
            else:
                return False, "Failed to parse QC response"

        except Exception as e:
            logger.error(f"Error running QC check '{check_id}': {e}")
            return False, f"Error: {str(e)}"

    async def analyze_explanation(
        self,
        explanation_item: Dict[str, Any],
        semaphore: Optional[asyncio.Semaphore] = None
    ) -> Dict[str, Any]:
        """
        Analyze a single explanation's quality.

        Args:
            explanation_item: Dictionary containing explanation data
            semaphore: Semaphore to limit concurrent API calls

        Returns:
            Dictionary with QC results
        """
        async with semaphore if semaphore else asyncio.Semaphore(1):
            question_id = explanation_item.get('question_id', 'unknown')
            option_label = explanation_item.get('option_label', 'unknown')
            explanation = explanation_item.get('explanation', '')
            question = explanation_item.get('question', '')
            passage = explanation_item.get('passage', '')
            option_text = explanation_item.get('option_text', '')
            correct_option_text = explanation_item.get('correct_option_text', '')
            is_correct = explanation_item.get('is_correct', False)
            grade = explanation_item.get('grade', 5)

            grade_band = clamp_grade_to_band(grade)

            logger.info(f"Analyzing explanation for {question_id}:{option_label} "
                       f"(correct={is_correct})")

            # Determine which checks to run
            if is_correct:
                checks_to_run = self.correct_checks + self.all_checks
            else:
                checks_to_run = self.distractor_checks + self.all_checks

            # Run QC checks
            tasks = []
            for check_id in checks_to_run:
                task = self._run_qc_check(
                    check_id, explanation, question, passage, option_text,
                    grade_band, is_correct, correct_option_text if not is_correct else None
                )
                tasks.append(task)

            check_results = await asyncio.gather(*tasks)

            results = {}
            total_passed = 0
            for i, check_id in enumerate(checks_to_run):
                passed, reason = check_results[i]
                results[check_id] = {'passed': passed, 'reason': reason}
                if passed:
                    total_passed += 1
                logger.debug(f"  {check_id}: {'PASS' if passed else 'FAIL'}")

            # Calculate overall score
            total_checks = len(checks_to_run)
            overall_score = (total_passed / total_checks) if total_checks > 0 else 0

            logger.info(f"Explanation {question_id}:{option_label} overall score: "
                       f"{overall_score:.2f} ({total_passed}/{total_checks} checks passed)")

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
        """
        Analyze a batch of explanations concurrently.

        Args:
            explanations: List of explanation items
            concurrency: Maximum number of concurrent API calls

        Returns:
            List of QC results
        """
        semaphore = asyncio.Semaphore(concurrency)
        tasks = []
        for i, explanation_item in enumerate(explanations, 1):
            logger.info(f"Queueing explanation {i}/{len(explanations)}")
            task = self.analyze_explanation(explanation_item, semaphore)
            tasks.append(task)

        results = await asyncio.gather(*tasks)
        return results
