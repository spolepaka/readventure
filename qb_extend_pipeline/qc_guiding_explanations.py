#!/usr/bin/env python3
"""
QC Guiding Question Explanations

Runs explanation quality control on the rewritten guiding question explanations.
"""

import asyncio
import csv
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

from dotenv import load_dotenv

# Load environment variables
SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR / ".env")

from openai import AsyncOpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Paths
OUTPUT_DIR = SCRIPT_DIR / "outputs" / "final_deliverables_grade3"
COMPREHENSIVE_QB = OUTPUT_DIR / "comprehensive_question_bank_grade3_3277_questions.csv"
QC_RESULTS_FILE = OUTPUT_DIR / "guiding_explanation_qc_results.json"

# Configuration
MAX_RETRIES = 5
BASE_DELAY = 1.0
DEFAULT_MODEL = "gpt-4o-mini"  # Faster and cheaper for QC


class GuidingExplanationQC:
    """QC analyzer for guiding question explanations."""
    
    def __init__(self, client: AsyncOpenAI, model: str = DEFAULT_MODEL):
        self.client = client
        self.model = model
        self.stats = {'processed': 0, 'errors': 0}
    
    def _build_prompt(self, explanation_item: Dict[str, Any]) -> str:
        """Build QC prompt for an explanation."""
        explanation = explanation_item.get('explanation', '')
        question = explanation_item.get('question', '')
        passage = explanation_item.get('passage', '')[:1500]
        option_text = explanation_item.get('option_text', '')
        is_correct = explanation_item.get('is_correct', False)
        
        check_type = "CORRECT ANSWER" if is_correct else "INCORRECT ANSWER"
        
        return f"""You are a quality control expert for Grade 3 educational feedback.

Evaluate this {check_type} explanation for a reading question.

## Passage:
{passage}

## Question: {question}

## Answer Option: {option_text}

## Explanation to Evaluate:
{explanation}

---

Rate each quality aspect (score 0 or 1):

1. **tone**: Is it encouraging and supportive? (Starts with "Great job!", "Good try!", etc.)
2. **conciseness**: Is it 2 sentences or less and under 40 words?
3. **grade_appropriateness**: Uses simple words an 8-year-old knows?
4. **textual_reference**: Does it mention what the story/passage says?
5. **clarity**: Is the reasoning clear and easy to understand?

Respond with JSON only:
{{
  "tone": {{"score": 0 or 1, "reason": "brief reason"}},
  "conciseness": {{"score": 0 or 1, "reason": "brief reason"}},
  "grade_appropriateness": {{"score": 0 or 1, "reason": "brief reason"}},
  "textual_reference": {{"score": 0 or 1, "reason": "brief reason"}},
  "clarity": {{"score": 0 or 1, "reason": "brief reason"}}
}}"""

    async def analyze_explanation(
        self,
        explanation_item: Dict[str, Any],
        semaphore: asyncio.Semaphore
    ) -> Dict[str, Any]:
        """Analyze a single explanation."""
        async with semaphore:
            question_id = explanation_item.get('question_id', 'unknown')
            option_label = explanation_item.get('option_label', 'unknown')
            
            prompt = self._build_prompt(explanation_item)
            
            for attempt in range(MAX_RETRIES):
                try:
                    response = await self.client.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "user", "content": prompt}],
                        response_format={"type": "json_object"},
                        max_tokens=500
                    )
                    
                    response_text = response.choices[0].message.content
                    data = json.loads(response_text)
                    
                    # Calculate score
                    checks = {}
                    total_passed = 0
                    for check_name in ['tone', 'conciseness', 'grade_appropriateness', 'textual_reference', 'clarity']:
                        check_data = data.get(check_name, {})
                        passed = check_data.get('score', 0) == 1
                        checks[check_name] = {
                            'passed': passed,
                            'reason': check_data.get('reason', '')
                        }
                        if passed:
                            total_passed += 1
                    
                    overall_score = total_passed / 5
                    
                    self.stats['processed'] += 1
                    
                    return {
                        'question_id': question_id,
                        'option_label': option_label,
                        'is_correct': explanation_item.get('is_correct', False),
                        'overall_score': overall_score,
                        'passed': overall_score >= 0.6,  # 3/5 checks
                        'total_passed': total_passed,
                        'total_checks': 5,
                        'checks': checks
                    }
                    
                except Exception as e:
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(BASE_DELAY * (2 ** attempt))
                    else:
                        self.stats['errors'] += 1
                        return {
                            'question_id': question_id,
                            'option_label': option_label,
                            'error': str(e),
                            'passed': False
                        }
            
            return {'question_id': question_id, 'option_label': option_label, 'error': 'Max retries', 'passed': False}

    async def analyze_batch(self, explanations: List[Dict[str, Any]], concurrency: int = 30) -> List[Dict[str, Any]]:
        """Analyze batch of explanations."""
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [self.analyze_explanation(e, semaphore) for e in explanations]
        return await asyncio.gather(*tasks)


def load_guiding_questions() -> List[Dict[str, Any]]:
    """Load guiding questions from comprehensive QB."""
    questions = []
    with open(COMPREHENSIVE_QB, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('question_category') == 'guiding':
                questions.append(dict(row))
    return questions


def prepare_explanations(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Prepare explanation items for QC."""
    explanations = []
    
    for q in questions:
        question_id = q.get('question_id', '')
        question_text = q.get('question', '')
        passage = q.get('passage_text', '')
        correct_answer = q.get('correct_answer', '')
        
        # Map correct answer to option number
        answer_map = {'A': '1', 'B': '2', 'C': '3', 'D': '4', '1': '1', '2': '2', '3': '3', '4': '4'}
        correct_num = answer_map.get(str(correct_answer), '1')
        
        # Create explanation item for each option
        for i, label in enumerate(['A', 'B', 'C', 'D'], 1):
            option_text = q.get(f'option_{i}', '')
            explanation = q.get(f'option_{i}_explanation', '')
            is_correct = str(i) == correct_num
            
            if explanation:  # Only include if there's an explanation
                explanations.append({
                    'question_id': question_id,
                    'option_label': label,
                    'option_text': option_text,
                    'explanation': explanation,
                    'question': question_text,
                    'passage': passage,
                    'is_correct': is_correct
                })
    
    return explanations


async def main():
    """Main function to run explanation QC."""
    start_time = datetime.now()
    
    logger.info("=" * 60)
    logger.info("GUIDING QUESTION EXPLANATION QC")
    logger.info("=" * 60)
    
    # Initialize client
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        # Try OpenRouter
        api_key = os.getenv('OPENROUTER_API_KEY')
        if api_key:
            client = AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=api_key
            )
            model = "openai/gpt-4o-mini"
        else:
            raise ValueError("No API key found (OPENAI_API_KEY or OPENROUTER_API_KEY)")
    else:
        client = AsyncOpenAI(api_key=api_key)
        model = "gpt-4o-mini"
    
    # Load guiding questions
    questions = load_guiding_questions()
    logger.info(f"Loaded {len(questions)} guiding questions")
    
    # Prepare explanations (4 per question)
    explanations = prepare_explanations(questions)
    logger.info(f"Prepared {len(explanations)} explanations for QC")
    
    # Initialize QC analyzer
    qc = GuidingExplanationQC(client=client, model=model)
    
    # Process in batches
    batch_size = 100
    all_results = []
    total_batches = (len(explanations) + batch_size - 1) // batch_size
    
    for batch_idx in range(total_batches):
        batch_start = batch_idx * batch_size
        batch_end = min(batch_start + batch_size, len(explanations))
        batch = explanations[batch_start:batch_end]
        
        logger.info(f"\nBatch {batch_idx + 1}/{total_batches} ({len(batch)} explanations)")
        
        results = await qc.analyze_batch(batch)
        all_results.extend(results)
        
        # Progress update
        passed = sum(1 for r in results if r.get('passed', False))
        logger.info(f"  Batch complete: {passed}/{len(batch)} passed ({passed/len(batch)*100:.1f}%)")
    
    # Calculate overall stats
    total_passed = sum(1 for r in all_results if r.get('passed', False))
    total_processed = len([r for r in all_results if 'error' not in r])
    avg_score = sum(r.get('overall_score', 0) for r in all_results if 'error' not in r) / max(total_processed, 1)
    
    # Check-level stats
    check_stats = {}
    for check_name in ['tone', 'conciseness', 'grade_appropriateness', 'textual_reference', 'clarity']:
        passed = sum(1 for r in all_results if r.get('checks', {}).get(check_name, {}).get('passed', False))
        check_stats[check_name] = {
            'passed': passed,
            'total': total_processed,
            'rate': passed / max(total_processed, 1)
        }
    
    # Save results
    summary = {
        'timestamp': datetime.now().isoformat(),
        'total_explanations': len(explanations),
        'total_processed': total_processed,
        'total_passed': total_passed,
        'pass_rate': total_passed / max(total_processed, 1),
        'average_score': avg_score,
        'check_stats': check_stats,
        'errors': qc.stats['errors']
    }
    
    output = {
        'summary': summary,
        'results': all_results
    }
    
    with open(QC_RESULTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    logger.info(f"\nSaved results to: {QC_RESULTS_FILE}")
    
    # Print summary
    elapsed = (datetime.now() - start_time).total_seconds()
    
    logger.info("\n" + "=" * 60)
    logger.info("QC SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Total Explanations: {len(explanations)}")
    logger.info(f"Processed:          {total_processed}")
    logger.info(f"Passed:             {total_passed} ({total_passed/max(total_processed,1)*100:.1f}%)")
    logger.info(f"Average Score:      {avg_score*100:.1f}%")
    logger.info(f"Errors:             {qc.stats['errors']}")
    logger.info(f"Time:               {elapsed:.1f}s")
    logger.info("\nCheck-level Results:")
    for check, stats in check_stats.items():
        logger.info(f"  {check}: {stats['passed']}/{stats['total']} ({stats['rate']*100:.1f}%)")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
