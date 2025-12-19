#!/usr/bin/env python3
"""
Unified Quality Control Pipeline V2 - Optimized with Checkpointing and Concurrency

Uses batched API calls for dramatically faster QC:
- Question QC: 2 API calls per question (was 8+)
- Explanation QC: 1 API call per explanation (was 6-9)

Concurrency:
- Supports multiple API keys for parallel processing
- Each key processes questions independently
- 5 keys = 5x throughput

Checkpointing:
- Automatically detects completed questions from output folder
- Resumes from where it left off
- Partially completed questions are rerun

Usage:
  # Sequential (single API key)
  python pipeline_v2.py --input questions.csv --output results/ --mode questions

  # Concurrent with multiple API keys
  python pipeline_v2.py --input questions.csv --output results/ --mode questions --concurrent

Environment Variables (.env file):
  # Anthropic keys (comma-separated or numbered)
  ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3
  # OR
  ANTHROPIC_API_KEY_1=sk-ant-key1
  ANTHROPIC_API_KEY_2=sk-ant-key2

  # OpenAI keys (same format)
  OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3
  # OR
  OPENAI_API_KEY_1=sk-key1
  OPENAI_API_KEY_2=sk-key2
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Set, Optional, Tuple

import pandas as pd
from dotenv import load_dotenv
import anthropic
from openai import AsyncOpenAI

from qc_pipeline.modules.question_qc_v2 import QuestionQCAnalyzerV2
from qc_pipeline.modules.explanation_qc_v2 import ExplanationQCAnalyzerV2
from qc_pipeline.utils import validate_env_vars, calculate_pass_rate

# Load environment from .env file in the script's directory
ENV_FILE = Path(__file__).parent.parent / ".env"
try:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)
except Exception:
    pass  # .env may not exist or be readable

# Also try loading from standard locations
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_api_keys(provider: str) -> List[str]:
    """
    Load API keys from environment variables for a provider.
    
    Supports multiple formats:
    1. Comma-separated: {PROVIDER}_API_KEYS=key1,key2,key3
    2. Numbered: {PROVIDER}_API_KEY_1, {PROVIDER}_API_KEY_2, etc.
    3. Single key: {PROVIDER}_API_KEY (fallback)
    
    Args:
        provider: 'ANTHROPIC' or 'OPENAI'
        
    Returns: List of API keys
    """
    keys = []
    
    # Try comma-separated keys first
    comma_keys = os.getenv(f'{provider}_API_KEYS', '')
    if comma_keys:
        keys = [k.strip() for k in comma_keys.split(',') if k.strip()]
        if keys:
            logger.info(f"Loaded {len(keys)} {provider} API keys from {provider}_API_KEYS")
            return keys
    
    # Try numbered keys ({PROVIDER}_API_KEY_1, _2, etc.)
    i = 1
    while True:
        key = os.getenv(f'{provider}_API_KEY_{i}')
        if key:
            keys.append(key.strip())
            i += 1
        else:
            break
    
    if keys:
        logger.info(f"Loaded {len(keys)} {provider} API keys from {provider}_API_KEY_1 to {provider}_API_KEY_{len(keys)}")
        return keys
    
    # Fallback to single key
    single_key = os.getenv(f'{provider}_API_KEY')
    if single_key:
        logger.info(f"Loaded 1 {provider} API key from {provider}_API_KEY")
        return [single_key.strip()]
    
    return []


class QCPipelineV2:
    """Optimized quality control pipeline using batched API calls with checkpointing."""

    # Expected number of checks for a fully completed question
    EXPECTED_QUESTION_CHECKS = 8  # Adjust based on actual checks in question_qc_v2
    EXPECTED_EXPLANATION_CHECKS = 3  # Adjust based on actual checks in explanation_qc_v2

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.output_dir = Path(args.output)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        skip_openai = getattr(args, 'skip_openai', False)

        if skip_openai:
            env_vars = validate_env_vars('ANTHROPIC_API_KEY')
            self.claude_client = anthropic.AsyncAnthropic(api_key=env_vars['ANTHROPIC_API_KEY'])
            self.openai_client = None
            logger.info("Skipping OpenAI checks (--skip-openai flag set)")
        else:
            env_vars = validate_env_vars('ANTHROPIC_API_KEY', 'OPENAI_API_KEY')
            self.claude_client = anthropic.AsyncAnthropic(api_key=env_vars['ANTHROPIC_API_KEY'])
            self.openai_client = AsyncOpenAI(api_key=env_vars['OPENAI_API_KEY'])

        if args.mode in ['questions', 'both']:
            examples_df = pd.read_csv(args.examples) if args.examples else None
            if examples_df is not None:
                logger.info(f"Loaded {len(examples_df)} benchmark questions")

            self.question_qc = QuestionQCAnalyzerV2(
                claude_client=self.claude_client,
                openai_client=self.openai_client,
                claude_model=args.claude_model,
                openai_model=args.openai_model,
                examples_df=examples_df,
                skip_openai=skip_openai
            )
        else:
            self.question_qc = None

        if args.mode in ['explanations', 'both']:
            if skip_openai:
                logger.warning("Explanation QC requires OpenAI - skipping")
                self.explanation_qc = None
            else:
                self.explanation_qc = ExplanationQCAnalyzerV2(
                    client=self.openai_client,
                    model=args.openai_model
                )
        else:
            self.explanation_qc = None

        # Track completed questions
        self._completed_question_ids: Set[str] = set()
        self._completed_explanation_ids: Set[str] = set()
        self._existing_results: List[Dict[str, Any]] = []

    def _get_results_file(self, qc_type: str) -> Path:
        """Get the path to the results file for a given QC type."""
        return self.output_dir / f"{qc_type}_qc_v2_results.json"

    # Check names by provider
    CLAUDE_CHECKS = {
        'grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance',
        'standard_alignment', 'clarity_precision', 'single_correct_answer', 'passage_reference'
    }
    OPENAI_CHECKS = {'too_close', 'difficulty_assessment'}
    LOCAL_CHECKS = {'length_check'}

    def _load_completed_from_output(self, qc_type: str, expected_checks: int) -> tuple[Set[str], List[Dict[str, Any]], Set[str]]:
        """
        Load completed item IDs from the output folder.
        
        Returns:
            Tuple of (fully_completed_ids, existing_results, needs_openai_ids)
            - fully_completed_ids: Questions with all checks done
            - existing_results: All loaded results  
            - needs_openai_ids: Questions that have Claude checks but missing OpenAI checks
        """
        fully_completed_ids = set()
        needs_openai_ids = set()
        existing_results = []
        results_file = self._get_results_file(qc_type)
        
        if not results_file.exists():
            return fully_completed_ids, existing_results, needs_openai_ids
        
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
            
            for result in results:
                item_id = result.get('question_id', '')
                checks = result.get('checks', {})
                check_names = set(checks.keys())
                
                # Check what's present
                has_claude = len(check_names & self.CLAUDE_CHECKS) >= len(self.CLAUDE_CHECKS) - 1  # Allow 1 missing
                has_openai = len(check_names & self.OPENAI_CHECKS) >= 1
                has_local = 'length_check' in check_names
                
                existing_results.append(result)
                
                # Determine status
                if has_claude and has_openai and has_local:
                    fully_completed_ids.add(item_id)
                elif has_claude and not has_openai:
                    # Has Claude checks but missing OpenAI - can run just OpenAI
                    needs_openai_ids.add(item_id)
                # else: needs full rerun
            
            if fully_completed_ids:
                logger.info(f"  Found {len(fully_completed_ids)} fully completed {qc_type} results")
            if needs_openai_ids:
                logger.info(f"  Found {len(needs_openai_ids)} {qc_type} results needing only OpenAI checks")
                
        except Exception as e:
            logger.warning(f"  Could not read existing results: {e}")
        
        return fully_completed_ids, existing_results, needs_openai_ids

    def _save_results_incrementally(self, new_results: List[Dict[str, Any]], qc_type: str):
        """Save results incrementally to the output file."""
        results_file = self._get_results_file(qc_type)
        
        # Load existing results
        existing_results = []
        if results_file.exists():
            try:
                with open(results_file, 'r') as f:
                    existing_results = json.load(f)
            except:
                pass
        
        # Create a map of existing results by question_id
        results_map = {r.get('question_id'): r for r in existing_results}
        
        # Update/add new results
        for result in new_results:
            q_id = result.get('question_id')
            results_map[q_id] = result
        
        # Save all results
        all_results = list(results_map.values())
        with open(results_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        
        return all_results

    def load_input_data(self) -> pd.DataFrame:
        logger.info(f"Loading input data from {self.args.input}")
        df = pd.read_csv(self.args.input)
        
        total_questions = len(df)
        total_articles = df['article_id'].nunique() if 'article_id' in df.columns else 0

        # Filter by specific article ID
        if hasattr(self.args, 'article_id') and self.args.article_id:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --article-id filter")
            else:
                df = df[df['article_id'] == self.args.article_id]
                if len(df) == 0:
                    logger.error(f"No questions found for article_id: {self.args.article_id}")
                    raise ValueError(f"Article ID not found: {self.args.article_id}")
                logger.info(f"Filtered to article '{self.args.article_id}': {len(df)} questions")

        # Limit by number of articles
        elif hasattr(self.args, 'limit_articles') and self.args.limit_articles and self.args.limit_articles > 0:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --limit-articles filter")
            else:
                article_ids = df['article_id'].unique()[:self.args.limit_articles]
                df = df[df['article_id'].isin(article_ids)]
                logger.info(f"Limited to first {len(article_ids)} articles: {len(df)} questions")

        # Limit by number of questions (existing behavior)
        if self.args.limit and self.args.limit > 0:
            df = df.head(self.args.limit)
            logger.info(f"Limited to first {len(df)} questions")

        logger.info(f"Loaded {len(df)} questions from {df['article_id'].nunique() if 'article_id' in df.columns else 'N/A'} articles")
        logger.info(f"  (Total in file: {total_questions} questions, {total_articles} articles)")
        return df

    async def run_question_qc(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if not self.question_qc:
            return []

        logger.info("\n" + "=" * 60)
        logger.info("RUNNING QUESTION QC (OPTIMIZED V2 WITH CHECKPOINTING)")
        logger.info("=" * 60)

        skip_openai = getattr(self.args, 'skip_openai', False)

        # Load completed questions from output - now returns 3 values
        self._completed_question_ids, self._existing_results, needs_openai_ids = self._load_completed_from_output(
            'question', self.EXPECTED_QUESTION_CHECKS
        )
        
        # Build results map for merging later
        existing_results_map = {r.get('question_id'): r for r in self._existing_results}

        questions_full = []  # Need all checks
        questions_openai_only = []  # Only need OpenAI checks
        skipped = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            
            # Skip if already fully completed
            if question_id in self._completed_question_ids:
                skipped += 1
                continue
            
            choices = {
                'A': row.get('option_1') or row.get('choice_A', ''),
                'B': row.get('option_2') or row.get('choice_B', ''),
                'C': row.get('option_3') or row.get('choice_C', ''),
                'D': row.get('option_4') or row.get('choice_D', '')
            }

            structured_content = {
                'question': row.get('question', ''),
                'choices': choices,
                'correct_answer': row.get('correct_answer', ''),
                'CCSS': row.get('CCSS', ''),
                'CCSS_description': row.get('CCSS_description', ''),
                'DOK': row.get('DOK', '')
            }

            passage = row.get('passage_text') or row.get('passage') or row.get('stimulus', '')

            question_item = {
                'question_id': question_id,
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'grade': row.get('grade'),
                'structured_content': structured_content
            }
            
            # Check if this question only needs OpenAI checks
            if question_id in needs_openai_ids and not skip_openai and self.openai_client:
                questions_openai_only.append(question_item)
            elif question_id not in needs_openai_ids:
                questions_full.append(question_item)
            # else: already has Claude, skip_openai is True, so skip

        logger.info(f"\n📋 PROGRESS STATUS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Total in input:       {len(df)}")
        logger.info(f"  Fully completed:      {skipped}")
        logger.info(f"  Need all checks:      {len(questions_full)}")
        logger.info(f"  Need OpenAI only:     {len(questions_openai_only)}")

        if not questions_full and not questions_openai_only:
            logger.info("\n✓ All questions already processed!")
            return self._existing_results

        start_time = datetime.now()
        batch_size = getattr(self.args, 'batch_size', 50)
        all_new_results = []

        # Process questions needing full checks
        if questions_full:
            logger.info(f"\nProcessing {len(questions_full)} questions with full QC (Claude + OpenAI)...")
            logger.info(f"Expected API calls: ~{len(questions_full) * 2} (2 per question)")
            
            for batch_start in range(0, len(questions_full), batch_size):
                batch_end = min(batch_start + batch_size, len(questions_full))
                batch_questions = questions_full[batch_start:batch_end]
                
                logger.info(f"\n  Processing batch {batch_start+1}-{batch_end} of {len(questions_full)}...")
                
                batch_results = await self.question_qc.analyze_batch(batch_questions, self.args.concurrency)
                all_new_results.extend(batch_results)
                
                # Save incrementally after each batch
                all_results = self._save_results_incrementally(batch_results, 'question')
                logger.info(f"  ✓ Saved {len(batch_results)} results (total: {len(all_results)})")

        # Process questions needing only OpenAI checks
        if questions_openai_only and self.openai_client:
            logger.info(f"\nProcessing {len(questions_openai_only)} questions with OpenAI checks only...")
            logger.info(f"Expected API calls: ~{len(questions_openai_only)} (1 per question)")
            
            for batch_start in range(0, len(questions_openai_only), batch_size):
                batch_end = min(batch_start + batch_size, len(questions_openai_only))
                batch_questions = questions_openai_only[batch_start:batch_end]
                
                logger.info(f"\n  Processing OpenAI batch {batch_start+1}-{batch_end} of {len(questions_openai_only)}...")
                
                # Run only OpenAI checks and merge with existing results
                openai_results = await self.question_qc.analyze_batch_openai_only(batch_questions, self.args.concurrency)
                
                # Merge with existing Claude results
                for openai_result in openai_results:
                    q_id = openai_result.get('question_id')
                    if q_id in existing_results_map:
                        # Merge checks
                        existing = existing_results_map[q_id]
                        merged_checks = existing.get('checks', {}).copy()
                        merged_checks.update(openai_result.get('checks', {}))
                        
                        # Recalculate scores
                        passed = sum(1 for c in merged_checks.values() if c.get('score', 0) == 1)
                        total = len(merged_checks)
                        
                        merged_result = {
                            **existing,
                            'checks': merged_checks,
                            'total_checks_run': total,
                            'total_checks_passed': passed,
                            'overall_score': passed / total if total > 0 else 0
                        }
                        all_new_results.append(merged_result)
                        existing_results_map[q_id] = merged_result
                
                # Save incrementally
                all_results = self._save_results_incrementally(
                    [existing_results_map[q.get('question_id')] for q in batch_questions if q.get('question_id') in existing_results_map],
                    'question'
                )
                logger.info(f"  ✓ Merged OpenAI checks for {len(batch_questions)} questions")

        elapsed = (datetime.now() - start_time).total_seconds()

        # Combine with existing results
        all_results = self._existing_results + all_new_results

        logger.info(f"\nCompleted in {elapsed:.1f}s ({len(questions) / elapsed:.1f} questions/sec)")

        # Create timestamped copy
        output_file = self.output_dir / f"question_qc_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        logger.info(f"Saved question QC results to {output_file}")

        self._create_readable_csv(all_results, output_file)

        stats = calculate_pass_rate(all_results)
        logger.info(f"\nQuestion QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")

        return all_results

    async def run_explanation_qc(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if not self.explanation_qc:
            return []

        logger.info("\n" + "=" * 60)
        logger.info("RUNNING EXPLANATION QC (OPTIMIZED V2 WITH CHECKPOINTING)")
        logger.info("=" * 60)

        # Load completed explanations from output
        completed_ids, existing_results = self._load_completed_from_output(
            'explanation', self.EXPECTED_EXPLANATION_CHECKS
        )

        explanation_cols = [col for col in df.columns if 'explanation' in col.lower()]
        if not explanation_cols:
            logger.warning("No explanation columns found")
            return []

        explanations = []
        skipped = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            correct_answer_key = row.get('correct_answer', '')

            correct_option_text = ''
            if correct_answer_key == 'A':
                correct_option_text = row.get('option_1', '')
            elif correct_answer_key == 'B':
                correct_option_text = row.get('option_2', '')
            elif correct_answer_key == 'C':
                correct_option_text = row.get('option_3', '')
            elif correct_answer_key == 'D':
                correct_option_text = row.get('option_4', '')

            passage = row.get('passage_text') or row.get('passage') or row.get('stimulus', '')

            for j in range(1, 5):
                option_key = f'option_{j}'
                explanation_key = f'{option_key}_explanation'
                if explanation_key in row and pd.notna(row[explanation_key]):
                    letter = chr(64 + j)
                    is_correct = letter == correct_answer_key
                    
                    # Create unique ID for this explanation
                    explanation_id = f"{question_id}_{letter}"
                    
                    # Skip if already completed
                    if explanation_id in completed_ids:
                        skipped += 1
                        continue

                    explanation_item = {
                        'question_id': explanation_id,  # Use unique ID
                        'original_question_id': question_id,
                        'option_label': letter,
                        'explanation': row.get(explanation_key, ''),
                        'question': row.get('question', ''),
                        'passage': passage,
                        'option_text': row.get(option_key, ''),
                        'correct_option_text': correct_option_text,
                        'is_correct': is_correct,
                        'grade': row.get('grade', 5)
                    }
                    explanations.append(explanation_item)

        if not explanations:
            if skipped > 0:
                logger.info(f"\n✓ All {skipped} explanations already processed!")
                return existing_results
            logger.warning("No explanations found to evaluate")
            return []

        logger.info(f"\n📋 PROGRESS STATUS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Already completed:  {skipped}")
        logger.info(f"  To process:         {len(explanations)}")

        logger.info(f"\nProcessing {len(explanations)} explanations with batched API calls")
        logger.info(f"Expected API calls: ~{len(explanations)} (1 per explanation)")

        start_time = datetime.now()
        
        # Process in batches
        batch_size = getattr(self.args, 'batch_size', 50)
        all_new_results = []
        
        for batch_start in range(0, len(explanations), batch_size):
            batch_end = min(batch_start + batch_size, len(explanations))
            batch_explanations = explanations[batch_start:batch_end]
            
            logger.info(f"\n  Processing batch {batch_start+1}-{batch_end} of {len(explanations)}...")
            
            batch_results = await self.explanation_qc.analyze_batch(batch_explanations, self.args.concurrency)
            all_new_results.extend(batch_results)
            
            # Save incrementally
            all_results = self._save_results_incrementally(batch_results, 'explanation')
            logger.info(f"  ✓ Saved {len(batch_results)} results (total: {len(all_results)})")

        elapsed = (datetime.now() - start_time).total_seconds()

        # Combine with existing results
        all_results = existing_results + all_new_results

        logger.info(f"\nCompleted in {elapsed:.1f}s ({len(explanations) / elapsed:.1f} explanations/sec)")

        output_file = self.output_dir / f"explanation_qc_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        logger.info(f"Saved explanation QC results to {output_file}")

        self._create_readable_csv(all_results, output_file)

        stats = calculate_pass_rate(all_results)
        logger.info(f"\nExplanation QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")

        return all_results

    async def run(self):
        logger.info("=" * 60)
        logger.info("STARTING OPTIMIZED QC PIPELINE V2 (WITH CHECKPOINTING)")
        logger.info("=" * 60)
        logger.info(f"Mode: {self.args.mode}")
        logger.info(f"Input: {self.args.input}")
        logger.info(f"Output: {self.output_dir}")
        logger.info(f"Concurrency: {self.args.concurrency}")
        logger.info(f"\n📁 Checking for existing results in output folder...")

        df = self.load_input_data()

        start_time = datetime.now()

        question_results = []
        explanation_results = []

        if self.args.mode in ['questions', 'both']:
            question_results = await self.run_question_qc(df)

        if self.args.mode in ['explanations', 'both']:
            explanation_results = await self.run_explanation_qc(df)

        total_elapsed = (datetime.now() - start_time).total_seconds()

        self._create_summary_report(question_results, explanation_results, total_elapsed)

        logger.info("\n" + "=" * 60)
        logger.info("PIPELINE COMPLETED")
        logger.info("=" * 60)
        logger.info(f"Total time: {total_elapsed:.1f}s")
        logger.info(f"Results saved to {self.output_dir}")

    def _create_summary_report(self, question_results, explanation_results, elapsed):
        summary = {
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'mode': self.args.mode,
            'total_time_seconds': elapsed,
            'version': 'v2_optimized',
            'question_qc': calculate_pass_rate(question_results) if question_results else None,
            'explanation_qc': calculate_pass_rate(explanation_results) if explanation_results else None
        }

        summary_file = self.output_dir / "summary_report.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"Saved summary report to {summary_file}")

    def _create_readable_csv(self, qc_results: List[Dict[str, Any]], json_file: Path):
        if not qc_results:
            return

        all_checks = set()
        for result in qc_results:
            all_checks.update(result.get('checks', {}).keys())
        all_checks = sorted(all_checks)

        summary_csv_file = json_file.with_name(json_file.stem + '_summary.csv')
        summary_rows = []

        for result in qc_results:
            q_id = result.get('question_id', '')
            row = {
                'question_id': q_id,
                'score': f"{result.get('overall_score', 0):.0%}",
                'status': '✅' if result.get('overall_score', 0) >= 0.7 else '❌',
                'passed': result.get('total_checks_passed', 0),
                'total': result.get('total_checks_run', 0)
            }

            for check_name in all_checks:
                check = result.get('checks', {}).get(check_name, {})
                passed = check.get('score', 0) == 1 if 'score' in check else check.get('passed', False)
                row[check_name] = '✅' if passed else '❌'

            summary_rows.append(row)

        with open(summary_csv_file, 'w', newline='', encoding='utf-8') as f:
            fieldnames = ['question_id', 'score', 'status', 'passed', 'total'] + list(all_checks)
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)

        logger.info(f"Saved summary CSV to {summary_csv_file}")


class ConcurrentQCPipelineV2:
    """
    Concurrent QC pipeline using multiple API keys for parallel processing.
    
    Each API key processes questions independently, providing N-times throughput
    where N is the number of API keys.
    """

    EXPECTED_QUESTION_CHECKS = 8

    def __init__(
        self,
        anthropic_keys: List[str],
        openai_keys: List[str],
        args: argparse.Namespace,
        max_workers: Optional[int] = None
    ):
        self.args = args
        self.output_dir = Path(args.output)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.anthropic_keys = anthropic_keys
        self.openai_keys = openai_keys
        
        skip_openai = getattr(args, 'skip_openai', False)
        
        # Determine number of workers
        if skip_openai:
            self.num_workers = min(len(anthropic_keys), max_workers or len(anthropic_keys))
        else:
            # Need both keys for full QC
            self.num_workers = min(len(anthropic_keys), len(openai_keys), max_workers or 10)
        
        self.skip_openai = skip_openai
        
        # Thread-safe shared state
        self._processed_questions: Set[str] = set()
        self._checkpoint_lock = threading.Lock()
        self._output_lock = threading.Lock()
        self._progress_lock = threading.Lock()
        
        # Progress tracking
        self._total_questions = 0
        self._completed_questions = 0
        self._total_results: List[Dict[str, Any]] = []
        self._question_times: List[float] = []
        self._failed_questions: List[str] = []
        self._start_time = 0.0
        
        # Existing results from output folder
        self._existing_results: List[Dict[str, Any]] = []
        
        logger.info(f"Initialized concurrent QC pipeline with {self.num_workers} workers")

    def _get_results_file(self) -> Path:
        """Get the path to the results file."""
        return self.output_dir / "question_qc_v2_results.json"

    def _load_completed_from_output(self) -> Tuple[Set[str], List[Dict[str, Any]]]:
        """Load completed question IDs from the output folder."""
        completed_ids = set()
        existing_results = []
        results_file = self._get_results_file()
        
        if not results_file.exists():
            return completed_ids, existing_results
        
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
            
            for result in results:
                question_id = result.get('question_id', '')
                checks = result.get('checks', {})
                num_checks = len(checks)
                
                if num_checks >= self.EXPECTED_QUESTION_CHECKS:
                    completed_ids.add(question_id)
                    existing_results.append(result)
            
            if completed_ids:
                logger.info(f"  Found {len(completed_ids)} completed question results in output")
                
        except Exception as e:
            logger.warning(f"  Could not read existing results: {e}")
        
        return completed_ids, existing_results

    def _save_results_thread_safe(self, new_results: List[Dict[str, Any]]):
        """Save results in a thread-safe manner."""
        with self._output_lock:
            results_file = self._get_results_file()
            
            # Load existing
            existing = []
            if results_file.exists():
                try:
                    with open(results_file, 'r') as f:
                        existing = json.load(f)
                except:
                    pass
            
            # Merge
            results_map = {r.get('question_id'): r for r in existing}
            for result in new_results:
                results_map[result.get('question_id')] = result
            
            # Save
            all_results = list(results_map.values())
            with open(results_file, 'w') as f:
                json.dump(all_results, f, indent=2)
            
            return all_results

    def _worker_process_batch(
        self,
        worker_id: int,
        questions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Worker function to process a batch of questions.
        
        Each worker gets its own API clients with dedicated keys.
        """
        # Get API keys for this worker
        anthropic_key = self.anthropic_keys[worker_id % len(self.anthropic_keys)]
        openai_key = self.openai_keys[worker_id % len(self.openai_keys)] if self.openai_keys and not self.skip_openai else None
        
        # Create worker-specific clients
        claude_client = anthropic.AsyncAnthropic(api_key=anthropic_key)
        openai_client = AsyncOpenAI(api_key=openai_key) if openai_key else None
        
        # Create analyzer for this worker
        analyzer = QuestionQCAnalyzerV2(
            claude_client=claude_client,
            openai_client=openai_client,
            claude_model=self.args.claude_model,
            openai_model=self.args.openai_model,
            examples_df=None,
            skip_openai=self.skip_openai
        )
        
        results = []
        
        for question in questions:
            q_id = question.get('question_id', '')
            
            try:
                start_time = time.time()
                
                # Run async analysis in sync context
                result = asyncio.run(analyzer.analyze_question(question))
                
                elapsed = time.time() - start_time
                results.append(result)
                
                # Update progress
                with self._progress_lock:
                    self._completed_questions += 1
                    self._question_times.append(elapsed)
                    
                    progress = self._completed_questions / self._total_questions * 100
                    total_elapsed = time.time() - self._start_time
                    avg_time = total_elapsed / self._completed_questions
                    remaining = self._total_questions - self._completed_questions
                    eta = avg_time * remaining
                    
                    logger.info(
                        f"[Worker {worker_id}] ✓ {q_id} ({elapsed:.1f}s) | "
                        f"Progress: {self._completed_questions}/{self._total_questions} [{progress:.0f}%] | "
                        f"ETA: {eta:.0f}s"
                    )
                
                # Save incrementally every 10 questions
                if len(results) % 10 == 0:
                    self._save_results_thread_safe(results)
                    
            except Exception as e:
                logger.error(f"[Worker {worker_id}] ✗ {q_id}: {e}")
                with self._progress_lock:
                    self._failed_questions.append(q_id)
        
        # Final save for this batch
        self._save_results_thread_safe(results)
        
        return results

    def load_input_data(self) -> pd.DataFrame:
        logger.info(f"Loading input data from {self.args.input}")
        df = pd.read_csv(self.args.input)
        
        total_questions = len(df)
        total_articles = df['article_id'].nunique() if 'article_id' in df.columns else 0

        # Filter by specific article ID
        if hasattr(self.args, 'article_id') and self.args.article_id:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --article-id filter")
            else:
                df = df[df['article_id'] == self.args.article_id]
                if len(df) == 0:
                    logger.error(f"No questions found for article_id: {self.args.article_id}")
                    raise ValueError(f"Article ID not found: {self.args.article_id}")
                logger.info(f"Filtered to article '{self.args.article_id}': {len(df)} questions")

        # Limit by number of articles
        elif hasattr(self.args, 'limit_articles') and self.args.limit_articles and self.args.limit_articles > 0:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --limit-articles filter")
            else:
                article_ids = df['article_id'].unique()[:self.args.limit_articles]
                df = df[df['article_id'].isin(article_ids)]
                logger.info(f"Limited to first {len(article_ids)} articles: {len(df)} questions")

        # Limit by number of questions (existing behavior)
        if self.args.limit and self.args.limit > 0:
            df = df.head(self.args.limit)
            logger.info(f"Limited to first {len(df)} questions")

        logger.info(f"Loaded {len(df)} questions from {df['article_id'].nunique() if 'article_id' in df.columns else 'N/A'} articles")
        logger.info(f"  (Total in file: {total_questions} questions, {total_articles} articles)")
        return df

    def prepare_questions(self, df: pd.DataFrame, completed_ids: Set[str]) -> List[Dict[str, Any]]:
        """Prepare questions, skipping completed ones."""
        questions = []
        skipped = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            
            if question_id in completed_ids:
                skipped += 1
                continue
            
            choices = {
                'A': row.get('option_1') or row.get('choice_A', ''),
                'B': row.get('option_2') or row.get('choice_B', ''),
                'C': row.get('option_3') or row.get('choice_C', ''),
                'D': row.get('option_4') or row.get('choice_D', '')
            }

            structured_content = {
                'question': row.get('question', ''),
                'choices': choices,
                'correct_answer': row.get('correct_answer', ''),
                'CCSS': row.get('CCSS', ''),
                'CCSS_description': row.get('CCSS_description', ''),
                'DOK': row.get('DOK', '')
            }

            passage = row.get('passage_text') or row.get('passage') or row.get('stimulus', '')

            question_item = {
                'question_id': question_id,
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'grade': row.get('grade'),
                'structured_content': structured_content
            }
            questions.append(question_item)

        logger.info(f"\n📋 PROGRESS STATUS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Total in input:     {len(df)}")
        logger.info(f"  Already completed:  {skipped}")
        logger.info(f"  To process:         {len(questions)}")

        return questions

    def run(self):
        logger.info("\n" + "=" * 60)
        logger.info("CONCURRENT QC PIPELINE V2")
        logger.info(f"Workers: {self.num_workers}")
        logger.info("=" * 60)

        # Load completed from output
        logger.info(f"\n📁 Checking for existing results in output folder...")
        completed_ids, self._existing_results = self._load_completed_from_output()

        # Load and prepare data
        df = self.load_input_data()
        questions = self.prepare_questions(df, completed_ids)

        if not questions:
            logger.info("\n✓ All questions already processed!")
            self._create_final_report(self._existing_results)
            return

        self._total_questions = len(questions)
        self._start_time = time.time()

        # Distribute questions to workers
        questions_per_worker = len(questions) // self.num_workers
        worker_batches = []
        
        for i in range(self.num_workers):
            start_idx = i * questions_per_worker
            if i == self.num_workers - 1:
                # Last worker gets remaining
                batch = questions[start_idx:]
            else:
                batch = questions[start_idx:start_idx + questions_per_worker]
            if batch:
                worker_batches.append((i, batch))

        logger.info(f"\n{'─'*60}")
        logger.info(f"Starting {len(worker_batches)} workers...")
        logger.info(f"{'─'*60}")

        # Process concurrently
        all_results = []
        with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
            futures = {
                executor.submit(self._worker_process_batch, worker_id, batch): worker_id
                for worker_id, batch in worker_batches
            }
            
            for future in as_completed(futures):
                worker_id = futures[future]
                try:
                    results = future.result()
                    all_results.extend(results)
                except Exception as e:
                    logger.error(f"Worker {worker_id} failed: {e}")

        # Combine with existing
        final_results = self._existing_results + all_results
        
        # Create final report
        self._create_final_report(final_results)

    def _create_final_report(self, results: List[Dict[str, Any]]):
        total_elapsed = time.time() - self._start_time if self._start_time else 0

        # Save final timestamped output
        output_file = self.output_dir / f"question_qc_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)

        # Create CSV summary
        self._create_readable_csv(results, output_file)

        # Stats
        stats = calculate_pass_rate(results)

        logger.info(f"\n{'='*60}")
        logger.info("PIPELINE COMPLETED")
        logger.info(f"{'='*60}")
        logger.info(f"\n📊 RESULTS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Total:          {stats['total']}")
        logger.info(f"  Passed:         {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed:         {stats['failed']}")
        logger.info(f"  Avg Score:      {stats['average_score']:.2f}")
        
        if total_elapsed > 0:
            logger.info(f"\n⏱️  TIMING")
            logger.info(f"{'─'*40}")
            logger.info(f"  Total time:     {total_elapsed:.1f}s")
            if self._completed_questions > 0:
                logger.info(f"  Questions/sec:  {self._completed_questions / total_elapsed:.2f}")
        
        if self._failed_questions:
            logger.info(f"\n⚠️  FAILED ({len(self._failed_questions)})")
            for q in self._failed_questions[:10]:
                logger.info(f"  • {q}")
            if len(self._failed_questions) > 10:
                logger.info(f"  ... and {len(self._failed_questions) - 10} more")

        logger.info(f"\n📁 OUTPUT")
        logger.info(f"{'─'*40}")
        logger.info(f"  {output_file}")

        # Save summary
        summary = {
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'mode': 'concurrent',
            'workers': self.num_workers,
            'total_time_seconds': total_elapsed,
            'version': 'v2_concurrent',
            'question_qc': stats
        }
        
        summary_file = self.output_dir / "summary_report.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)

    def _create_readable_csv(self, qc_results: List[Dict[str, Any]], json_file: Path):
        if not qc_results:
            return

        all_checks = set()
        for result in qc_results:
            all_checks.update(result.get('checks', {}).keys())
        all_checks = sorted(all_checks)

        summary_csv_file = json_file.with_name(json_file.stem + '_summary.csv')
        summary_rows = []

        for result in qc_results:
            q_id = result.get('question_id', '')
            row = {
                'question_id': q_id,
                'score': f"{result.get('overall_score', 0):.0%}",
                'status': '✅' if result.get('overall_score', 0) >= 0.7 else '❌',
                'passed': result.get('total_checks_passed', 0),
                'total': result.get('total_checks_run', 0)
            }

            for check_name in all_checks:
                check = result.get('checks', {}).get(check_name, {})
                passed = check.get('score', 0) == 1 if 'score' in check else check.get('passed', False)
                row[check_name] = '✅' if passed else '❌'

            summary_rows.append(row)

        with open(summary_csv_file, 'w', newline='', encoding='utf-8') as f:
            fieldnames = ['question_id', 'score', 'status', 'passed', 'total'] + list(all_checks)
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)

        logger.info(f"Saved summary CSV to {summary_csv_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Optimized Quality Control Pipeline V2 with Checkpointing and Concurrency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Sequential mode (single API key)
    python pipeline_v2.py --input questions.csv --output results/ --mode questions

    # Process only a specific article
    python pipeline_v2.py --input questions.csv --output results/ --article-id article_101001

    # Process first 3 articles
    python pipeline_v2.py --input questions.csv --output results/ --limit-articles 3

    # Concurrent mode with multiple API keys
    python pipeline_v2.py --input questions.csv --output results/ --concurrent

    # Concurrent with specific worker count
    python pipeline_v2.py --input questions.csv --output results/ --concurrent --max-workers 3

Concurrency:
    Set multiple API keys in .env file for concurrent processing:
    
    Option 1 - Comma-separated:
        ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3
        OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3
    
    Option 2 - Numbered:
        ANTHROPIC_API_KEY_1=sk-ant-key1
        ANTHROPIC_API_KEY_2=sk-ant-key2
        OPENAI_API_KEY_1=sk-key1
        OPENAI_API_KEY_2=sk-key2
    
    Each key processes questions independently.
    5 keys = 5x throughput.
        """
    )

    parser.add_argument("--input", required=True, help="Input CSV file")
    parser.add_argument("--output", required=True, help="Output directory for results")
    parser.add_argument("--mode", choices=['questions', 'explanations', 'both'], default='questions')
    parser.add_argument("--examples", help="CSV file with benchmark questions")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent API calls per worker")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N questions (0 = all)")
    parser.add_argument("--batch-size", type=int, default=50, help="Questions per batch for incremental saves")
    
    # Article filtering
    parser.add_argument("--article-id", help="Process only questions from this specific article ID")
    parser.add_argument("--limit-articles", type=int, default=0, help="Process only first N articles (0 = all)")
    parser.add_argument("--claude-model", default="claude-sonnet-4-5-20250929", help="Claude model")
    parser.add_argument("--openai-model", default="gpt-4-turbo", help="OpenAI model")
    parser.add_argument("--skip-openai", action="store_true", help="Skip OpenAI checks")
    
    # Concurrency options
    parser.add_argument("--concurrent", action="store_true", help="Enable concurrent processing with multiple API keys")
    parser.add_argument("--max-workers", type=int, default=None, help="Maximum number of concurrent workers")

    args = parser.parse_args()

    try:
        if args.concurrent:
            # Load multiple API keys
            anthropic_keys = load_api_keys('ANTHROPIC')
            openai_keys = load_api_keys('OPENAI') if not args.skip_openai else []
            
            if not anthropic_keys:
                logger.error("ERROR: No Anthropic API keys found for concurrent mode.")
                logger.error("Set multiple keys in .env:")
                logger.error("  ANTHROPIC_API_KEYS=key1,key2,key3")
                logger.error("  or")
                logger.error("  ANTHROPIC_API_KEY_1=key1")
                logger.error("  ANTHROPIC_API_KEY_2=key2")
                sys.exit(1)
            
            if not args.skip_openai and not openai_keys:
                logger.warning("WARNING: No OpenAI API keys found. Use --skip-openai to run without OpenAI checks.")
                logger.warning("Proceeding with Anthropic-only mode...")
                args.skip_openai = True
            
            if len(anthropic_keys) == 1:
                logger.warning("WARNING: Only 1 Anthropic API key found. Concurrent mode works best with multiple keys.")
            
            # Run concurrent pipeline
            pipeline = ConcurrentQCPipelineV2(
                anthropic_keys=anthropic_keys,
                openai_keys=openai_keys,
                args=args,
                max_workers=args.max_workers
            )
            pipeline.run()
        else:
            # Sequential mode
            asyncio.run(QCPipelineV2(args).run())
            
    except KeyboardInterrupt:
        logger.info("Pipeline interrupted by user")
    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
