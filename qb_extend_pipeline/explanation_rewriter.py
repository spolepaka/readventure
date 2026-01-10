#!/usr/bin/env python3
"""
Explanation Rewriter - Rewrites question explanations for grade-level readability.

Uses OpenRouter API (Claude 4.5 Sonnet) to rewrite explanations in a concise,
grade-appropriate manner.

Features:
- Batches all 4 explanations per question into 1 API call
- Checkpointing for resume support
- Async with adaptive rate limiting
- Preserves original file, outputs to new file

Usage:
    python explanation_rewriter.py \
        --input outputs/qb_extended_combined.csv \
        --output outputs/qb_extended_rewritten.csv \
        --grade 3 \
        --concurrency 25
"""

import asyncio
import argparse
import csv
import json
import logging
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import shutil

from openai import AsyncOpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Rate limiting configuration
MAX_RETRIES = 8
BASE_DELAY = 0.5
MAX_DELAY = 60.0
JITTER_FACTOR = 0.3

# Default model
DEFAULT_MODEL = "anthropic/claude-sonnet-4"


class TokenBucketRateLimiter:
    """Token bucket rate limiter for smooth request distribution."""
    
    def __init__(self, rate_per_minute: int = 25, burst_size: int = 5):
        self.rate_per_second = rate_per_minute / 60.0
        self.max_tokens = burst_size
        self.tokens = burst_size
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Wait until a token is available, then consume it."""
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


class ExplanationRewriter:
    """Rewrites question explanations for grade-level readability."""
    
    def __init__(
        self,
        client: AsyncOpenAI,
        model: str = DEFAULT_MODEL,
        grade: int = 3,
        rate_per_minute: int = 25,
        max_concurrent: int = 25
    ):
        self.client = client
        self.model = model
        self.grade = grade
        self.rate_limiter = TokenBucketRateLimiter(rate_per_minute, burst_size=5)
        self.max_concurrent = max_concurrent
        
        # Stats tracking
        self._stats = {
            'processed': 0,
            'skipped': 0,
            'errors': 0,
            'total_time': 0
        }
    
    def _build_rewrite_prompt(
        self,
        question: str,
        correct_answer: str,
        options: Dict[str, str],
        explanations: Dict[str, str],
        passage: str
    ) -> str:
        """Build prompt to rewrite all 4 explanations for a question."""
        
        # Truncate passage if too long
        max_passage_len = 1500
        if len(passage) > max_passage_len:
            passage = passage[:max_passage_len] + "..."
        
        return f"""You are rewriting reading feedback for Grade {self.grade} students. Be ULTRA CONCISE.

## Passage:
{passage}

## Question: {question}
## Correct Answer: {correct_answer}

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

### For the CORRECT answer ({correct_answer}):
- 2 sentences MAX (under 35 words)
- Start with "Great job!", "You got it!", "Exactly!", or "Nice work!"
- Include a SHORT quote from the passage (3-6 words in quotes)
- Explain why it's right in simple words

### For WRONG answers:
- 2 sentences MAX (under 40 words)
- Start with "Good try!", "Not quite!", "Nice thinking, but...", or "Close!"
- Explain why THIS answer doesn't match the story
- Hint at what the story actually says

### Grade {self.grade} writing rules:
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

    async def _rewrite_single(
        self,
        question_data: Dict[str, Any],
        semaphore: asyncio.Semaphore
    ) -> Dict[str, Any]:
        """Rewrite all explanations for a single question."""
        async with semaphore:
            question_id = question_data.get('question_id', 'unknown')
            
            # Extract data
            question = question_data.get('question', '')
            correct_answer = question_data.get('correct_answer', '')
            passage = question_data.get('passage_text', '')
            
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
            
            # Build prompt
            prompt = self._build_rewrite_prompt(
                question, correct_answer, options, explanations, passage
            )
            
            # Call API with retries
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
                            "X-Title": "Explanation Rewriter"
                        }
                    )
                    
                    response_text = response.choices[0].message.content
                    rewritten = json.loads(response_text)
                    
                    self._stats['processed'] += 1
                    logger.info(f"✓ Rewrote {question_id}")
                    
                    return {
                        'question_id': question_id,
                        'success': True,
                        'rewritten': rewritten,
                        'original': explanations
                    }
                    
                except json.JSONDecodeError as e:
                    logger.warning(f"JSON parse error for {question_id}: {e}")
                    # Try to extract JSON from response
                    try:
                        import re
                        json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
                        if json_match:
                            rewritten = json.loads(json_match.group())
                            self._stats['processed'] += 1
                            return {
                                'question_id': question_id,
                                'success': True,
                                'rewritten': rewritten,
                                'original': explanations
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
                            self._stats['errors'] += 1
                            return {
                                'question_id': question_id,
                                'success': False,
                                'error': str(e),
                                'original': explanations
                            }
            
            self._stats['errors'] += 1
            return {
                'question_id': question_id,
                'success': False,
                'error': 'Max retries exceeded',
                'original': explanations
            }

    async def rewrite_batch(
        self,
        questions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Rewrite explanations for a batch of questions."""
        semaphore = asyncio.Semaphore(self.max_concurrent)
        tasks = [self._rewrite_single(q, semaphore) for q in questions]
        return await asyncio.gather(*tasks)


class RewritePipeline:
    """Main pipeline for rewriting explanations with checkpointing."""
    
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.input_path = Path(args.input)
        self.output_path = Path(args.output)
        self.grade = args.grade
        self.checkpoint_dir = self.output_path.parent / "rewrite_checkpoints"
        self.log_dir = self.output_path.parent / "rewrite_logs"
        self.backup_dir = self.output_path.parent / "backups"
        
        # Create directories
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize OpenRouter client
        api_key = os.getenv('OPENROUTER_API_KEY')
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable not set")
        
        self.client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        
        self.rewriter = ExplanationRewriter(
            client=self.client,
            model=args.model,
            grade=args.grade,
            rate_per_minute=args.rate_limit,
            max_concurrent=args.concurrency
        )
        
        # Tracking
        self._completed_ids: set = set()
        self._results: Dict[str, Dict] = {}
        self._log_file = None
    
    def _load_checkpoint(self) -> set:
        """Load completed question IDs from checkpoint."""
        checkpoint_file = self.checkpoint_dir / "progress.json"
        if checkpoint_file.exists():
            try:
                with open(checkpoint_file) as f:
                    data = json.load(f)
                    self._results = data.get('results', {})
                    return set(data.get('completed_ids', []))
            except Exception as e:
                logger.warning(f"Could not load checkpoint: {e}")
        return set()
    
    def _save_checkpoint(self):
        """Save progress to checkpoint file."""
        checkpoint_file = self.checkpoint_dir / "progress.json"
        with open(checkpoint_file, 'w') as f:
            json.dump({
                'completed_ids': list(self._completed_ids),
                'results': self._results,
                'timestamp': datetime.now().isoformat(),
                'grade': self.grade
            }, f, indent=2)
    
    def _load_csv(self) -> List[Dict[str, Any]]:
        """Load input CSV file."""
        rows = []
        with open(self.input_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            self._fieldnames = reader.fieldnames
            for row in reader:
                rows.append(dict(row))
        return rows
    
    def _save_csv(self, rows: List[Dict[str, Any]]):
        """Save output CSV file."""
        with open(self.output_path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=self._fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    
    def _backup_original(self):
        """Create backup of original file."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = self.backup_dir / f"{self.input_path.stem}_{timestamp}.csv"
        shutil.copy(self.input_path, backup_path)
        logger.info(f"Created backup: {backup_path}")
    
    def _apply_rewrites(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Apply rewritten explanations to rows."""
        updated_rows = []
        for row in rows:
            question_id = row.get('question_id', '')
            if question_id in self._results:
                result = self._results[question_id]
                if result.get('success') and 'rewritten' in result:
                    rewritten = result['rewritten']
                    # Map A/B/C/D back to option_1/2/3/4
                    if 'A' in rewritten:
                        row['option_1_explanation'] = rewritten['A']
                    if 'B' in rewritten:
                        row['option_2_explanation'] = rewritten['B']
                    if 'C' in rewritten:
                        row['option_3_explanation'] = rewritten['C']
                    if 'D' in rewritten:
                        row['option_4_explanation'] = rewritten['D']
            updated_rows.append(row)
        return updated_rows
    
    async def run(self):
        """Run the rewrite pipeline."""
        start_time = datetime.now()
        
        logger.info("=" * 60)
        logger.info("EXPLANATION REWRITER")
        logger.info("=" * 60)
        logger.info(f"Input:  {self.input_path}")
        logger.info(f"Output: {self.output_path}")
        logger.info(f"Grade:  {self.grade}")
        logger.info(f"Model:  {self.args.model}")
        logger.info("=" * 60)
        
        # Backup original
        self._backup_original()
        
        # Load data
        rows = self._load_csv()
        logger.info(f"Loaded {len(rows)} questions from input")
        
        # Load checkpoint
        self._completed_ids = self._load_checkpoint()
        if self._completed_ids:
            logger.info(f"Resuming: {len(self._completed_ids)} already completed")
        
        # Filter to questions that need processing
        to_process = [r for r in rows if r.get('question_id', '') not in self._completed_ids]
        logger.info(f"To process: {len(to_process)} questions")
        
        if not to_process:
            logger.info("All questions already processed!")
            # Still save output with existing results
            updated_rows = self._apply_rewrites(rows)
            self._save_csv(updated_rows)
            return
        
        # Open log file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_path = self.log_dir / f"rewrite_{timestamp}.jsonl"
        self._log_file = open(log_path, 'w')
        
        # Process in batches
        batch_size = self.args.batch_size
        total_batches = (len(to_process) + batch_size - 1) // batch_size
        
        for batch_idx in range(total_batches):
            batch_start = batch_idx * batch_size
            batch_end = min(batch_start + batch_size, len(to_process))
            batch = to_process[batch_start:batch_end]
            
            logger.info(f"\nBatch {batch_idx + 1}/{total_batches} ({len(batch)} questions)")
            
            # Process batch
            results = await self.rewriter.rewrite_batch(batch)
            
            # Save results
            for result in results:
                question_id = result['question_id']
                self._completed_ids.add(question_id)
                self._results[question_id] = result
                
                # Log to file
                self._log_file.write(json.dumps(result) + '\n')
                self._log_file.flush()
            
            # Save checkpoint after each batch
            self._save_checkpoint()
            
            logger.info(f"  ✓ Batch complete. Total: {len(self._completed_ids)}/{len(rows)}")
        
        # Close log
        self._log_file.close()
        
        # Apply rewrites and save final output
        updated_rows = self._apply_rewrites(rows)
        self._save_csv(updated_rows)
        
        # Summary
        elapsed = (datetime.now() - start_time).total_seconds()
        stats = self.rewriter._stats
        
        logger.info("\n" + "=" * 60)
        logger.info("COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Processed: {stats['processed']}")
        logger.info(f"Errors:    {stats['errors']}")
        logger.info(f"Time:      {elapsed:.1f}s ({len(to_process) / elapsed:.1f} questions/sec)")
        logger.info(f"Output:    {self.output_path}")
        logger.info(f"Log:       {log_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Rewrite question explanations for grade-level readability"
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Input CSV file with questions and explanations"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output CSV file with rewritten explanations"
    )
    parser.add_argument(
        "--grade", "-g",
        type=int,
        default=3,
        help="Target grade level (default: 3)"
    )
    parser.add_argument(
        "--model", "-m",
        default=DEFAULT_MODEL,
        help=f"OpenRouter model to use (default: {DEFAULT_MODEL})"
    )
    parser.add_argument(
        "--concurrency", "-c",
        type=int,
        default=25,
        help="Maximum concurrent API requests (default: 25)"
    )
    parser.add_argument(
        "--rate-limit", "-r",
        type=int,
        default=25,
        help="Requests per minute (default: 25)"
    )
    parser.add_argument(
        "--batch-size", "-b",
        type=int,
        default=20,
        help="Questions per batch for checkpointing (default: 20)"
    )
    
    args = parser.parse_args()
    
    pipeline = RewritePipeline(args)
    asyncio.run(pipeline.run())


if __name__ == "__main__":
    main()
