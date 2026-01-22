#!/usr/bin/env python3
"""
Rewrite Guiding Question Explanations for Grade 3

Takes guiding questions from the original QTI data and rewrites their
explanations to be Grade 3 friendly (matching the style of quiz questions).
"""

import asyncio
import csv
import json
import logging
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

# Load environment variables from .env file
from dotenv import load_dotenv
SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR / ".env")

from openai import AsyncOpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MAX_RETRIES = 8
BASE_DELAY = 0.5
MAX_DELAY = 60.0
JITTER_FACTOR = 0.3
DEFAULT_MODEL = "anthropic/claude-sonnet-4"

# Paths (SCRIPT_DIR already defined above)
INPUT_FILE = SCRIPT_DIR / "inputs" / "qti_existing_questions.csv"
OUTPUT_DIR = SCRIPT_DIR / "outputs" / "final_deliverables_grade3"
CHECKPOINT_FILE = OUTPUT_DIR / "guiding_rewrite_checkpoint.json"
LOG_DIR = OUTPUT_DIR / "guiding_rewrite_logs"


class TokenBucketRateLimiter:
    """Token bucket rate limiter for smooth request distribution."""
    
    def __init__(self, rate_per_minute: int = 25, burst_size: int = 5):
        self.rate_per_second = rate_per_minute / 60.0
        self.max_tokens = burst_size
        self.tokens = burst_size
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate_per_second)
            self.last_update = now
            
            if self.tokens >= 1:
                self.tokens -= 1
                return
            
            wait_time = (1 - self.tokens) / self.rate_per_second
            
        if wait_time > 0:
            await asyncio.sleep(wait_time)
            
        async with self._lock:
            self.tokens = 0
            self.last_update = time.monotonic()


class GuidingExplanationRewriter:
    """Rewrites guiding question explanations for Grade 3 readability."""
    
    def __init__(self, client: AsyncOpenAI, model: str = DEFAULT_MODEL):
        self.client = client
        self.model = model
        self.rate_limiter = TokenBucketRateLimiter(rate_per_minute=30, burst_size=5)
        self.stats = {'processed': 0, 'errors': 0}
    
    def _build_prompt(self, question_data: Dict[str, Any]) -> str:
        """Build prompt for rewriting explanations."""
        question = question_data.get('question', '')
        correct_answer = question_data.get('correct_answer', '')
        passage = question_data.get('passage_text', '')[:1500]
        
        # Map correct_answer letter to option number for display
        answer_map = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
        correct_letter = correct_answer if correct_answer in answer_map else 'B'
        
        options = {
            'A': question_data.get('option_1', ''),
            'B': question_data.get('option_2', ''),
            'C': question_data.get('option_3', ''),
            'D': question_data.get('option_4', '')
        }
        
        explanations = {
            'A': question_data.get('option_1_explanation', ''),
            'B': question_data.get('option_2_explanation', ''),
            'C': question_data.get('option_3_explanation', ''),
            'D': question_data.get('option_4_explanation', '')
        }
        
        return f"""You are rewriting reading feedback for Grade 3 students. Be ULTRA CONCISE.

## Passage:
{passage}

## Question: {question}
## Correct Answer: {correct_letter}

## Answer Choices:
A) {options.get('A', '')}
B) {options.get('B', '')}
C) {options.get('C', '')}
D) {options.get('D', '')}

## Current Explanations (rewrite ALL of these):
A) {explanations.get('A', '')}
B) {explanations.get('B', '')}
C) {explanations.get('C', '')}
D) {explanations.get('D', '')}

---

## REWRITE RULES:

### For the CORRECT answer ({correct_letter}):
- 2 sentences MAX (under 35 words)
- Start with "Great job!", "You got it!", "Exactly!", or "Nice work!"
- Include a SHORT quote from the passage (3-6 words in quotes)
- Explain why it's right in simple words

### For WRONG answers:
- 2 sentences MAX (under 40 words)
- Start with "Good try!", "Not quite!", "Nice thinking, but...", or "Close!"
- Explain why THIS answer doesn't match the story
- Hint at what the story actually says

### Grade 3 writing rules:
- Use words an 8-year-old knows
- No fancy words like "demonstrates", "evidence", "illustrates"
- Write like you're talking to the student
- Be friendly and encouraging, never harsh

## Output as JSON (rewritten explanations only, no other text):
{{
  "A": "rewritten explanation for A",
  "B": "rewritten explanation for B", 
  "C": "rewritten explanation for C",
  "D": "rewritten explanation for D"
}}"""

    async def rewrite_single(self, question_data: Dict[str, Any], semaphore: asyncio.Semaphore) -> Dict[str, Any]:
        """Rewrite explanations for a single question."""
        async with semaphore:
            question_id = question_data.get('question_id', 'unknown')
            prompt = self._build_prompt(question_data)
            
            for attempt in range(MAX_RETRIES):
                try:
                    await self.rate_limiter.acquire()
                    
                    response = await self.client.chat.completions.create(
                        model=self.model,
                        max_tokens=1000,
                        messages=[{"role": "user", "content": prompt}],
                        response_format={"type": "json_object"},
                        extra_headers={
                            "HTTP-Referer": "https://github.com/playcademy",
                            "X-Title": "Guiding Explanation Rewriter"
                        }
                    )
                    
                    response_text = response.choices[0].message.content
                    rewritten = json.loads(response_text)
                    
                    self.stats['processed'] += 1
                    logger.info(f"✓ Rewrote {question_id}")
                    
                    return {
                        'question_id': question_id,
                        'success': True,
                        'rewritten': rewritten
                    }
                    
                except json.JSONDecodeError as e:
                    logger.warning(f"JSON parse error for {question_id}: {e}")
                    import re
                    try:
                        json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
                        if json_match:
                            rewritten = json.loads(json_match.group())
                            self.stats['processed'] += 1
                            return {
                                'question_id': question_id,
                                'success': True,
                                'rewritten': rewritten
                            }
                    except:
                        pass
                    
                except Exception as e:
                    error_str = str(e)
                    if '429' in error_str or 'rate' in error_str.lower():
                        delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, JITTER_FACTOR), MAX_DELAY)
                        logger.warning(f"Rate limit for {question_id}, retry in {delay:.1f}s")
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"Error for {question_id}: {e}")
                        if attempt == MAX_RETRIES - 1:
                            self.stats['errors'] += 1
                            return {
                                'question_id': question_id,
                                'success': False,
                                'error': str(e)
                            }
            
            self.stats['errors'] += 1
            return {
                'question_id': question_id,
                'success': False,
                'error': 'Max retries exceeded'
            }

    async def rewrite_batch(self, questions: List[Dict[str, Any]], max_concurrent: int = 25) -> List[Dict[str, Any]]:
        """Rewrite explanations for a batch of questions."""
        semaphore = asyncio.Semaphore(max_concurrent)
        tasks = [self.rewrite_single(q, semaphore) for q in questions]
        return await asyncio.gather(*tasks)


def load_guiding_questions() -> List[Dict[str, Any]]:
    """Load guiding questions from the original CSV."""
    questions = []
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('question_category') == 'guiding':
                questions.append(dict(row))
    return questions


def load_checkpoint() -> Dict[str, Dict]:
    """Load checkpoint with already processed questions."""
    if CHECKPOINT_FILE.exists():
        try:
            with open(CHECKPOINT_FILE) as f:
                data = json.load(f)
                return data.get('results', {})
        except:
            pass
    return {}


def save_checkpoint(results: Dict[str, Dict]):
    """Save checkpoint with processed questions."""
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump({
            'results': results,
            'timestamp': datetime.now().isoformat()
        }, f, indent=2)


def update_comprehensive_qb(results: Dict[str, Dict]):
    """Update the comprehensive question bank with rewritten explanations."""
    csv_path = OUTPUT_DIR / "comprehensive_question_bank_grade3_3277_questions.csv"
    json_path = OUTPUT_DIR / "comprehensive_question_bank_grade3_3277_questions.json"
    
    # Read current CSV
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(dict(row))
    
    # Update explanations for guiding questions
    updated_count = 0
    for row in rows:
        question_id = row.get('question_id', '')
        if question_id in results and results[question_id].get('success'):
            rewritten = results[question_id]['rewritten']
            if 'A' in rewritten:
                row['option_1_explanation'] = rewritten['A']
            if 'B' in rewritten:
                row['option_2_explanation'] = rewritten['B']
            if 'C' in rewritten:
                row['option_3_explanation'] = rewritten['C']
            if 'D' in rewritten:
                row['option_4_explanation'] = rewritten['D']
            updated_count += 1
    
    # Save updated CSV
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    # Save updated JSON
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Updated {updated_count} guiding question explanations in comprehensive QB")
    return updated_count


async def main():
    """Main function to rewrite guiding question explanations."""
    start_time = datetime.now()
    
    logger.info("=" * 60)
    logger.info("GUIDING QUESTION EXPLANATION REWRITER")
    logger.info("=" * 60)
    
    # Initialize client
    api_key = os.getenv('OPENROUTER_API_KEY')
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable not set")
    
    client = AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key
    )
    
    # Load guiding questions
    all_questions = load_guiding_questions()
    logger.info(f"Loaded {len(all_questions)} guiding questions")
    
    # Load checkpoint
    results = load_checkpoint()
    completed_ids = set(results.keys())
    if completed_ids:
        logger.info(f"Resuming: {len(completed_ids)} already completed")
    
    # Filter to questions needing processing
    to_process = [q for q in all_questions if q.get('question_id', '') not in completed_ids]
    logger.info(f"To process: {len(to_process)} questions")
    
    if to_process:
        # Create log directory
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        
        # Initialize rewriter
        rewriter = GuidingExplanationRewriter(client=client)
        
        # Process in batches
        batch_size = 25
        total_batches = (len(to_process) + batch_size - 1) // batch_size
        
        for batch_idx in range(total_batches):
            batch_start = batch_idx * batch_size
            batch_end = min(batch_start + batch_size, len(to_process))
            batch = to_process[batch_start:batch_end]
            
            logger.info(f"\nBatch {batch_idx + 1}/{total_batches} ({len(batch)} questions)")
            
            batch_results = await rewriter.rewrite_batch(batch)
            
            for result in batch_results:
                question_id = result['question_id']
                results[question_id] = result
            
            save_checkpoint(results)
            logger.info(f"  ✓ Batch complete. Total: {len(results)}/{len(all_questions)}")
        
        logger.info(f"\nRewriter stats: {rewriter.stats}")
    
    # Update comprehensive question bank
    logger.info("\nUpdating comprehensive question bank...")
    update_comprehensive_qb(results)
    
    # Summary
    elapsed = (datetime.now() - start_time).total_seconds()
    success_count = sum(1 for r in results.values() if r.get('success'))
    
    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total guiding questions: {len(all_questions)}")
    logger.info(f"Successfully rewritten:  {success_count}")
    logger.info(f"Errors:                  {len(results) - success_count}")
    logger.info(f"Time:                    {elapsed:.1f}s")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
