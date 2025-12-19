#!/usr/bin/env python3
"""
Unified Quality Control Pipeline V3 - Batch Processing with Checkpointing

Uses Claude's Message Batches API for maximum efficiency:
- 50% cost reduction on all Claude API calls
- Higher throughput for large-scale QC
- Prompt caching to share article/passage content across questions

Checkpointing:
- Automatically detects completed questions from output folder
- Resumes from where it left off
- Partially completed questions are rerun

Reference: https://platform.claude.com/docs/en/build-with-claude/batch-processing

Usage:
  # Process all questions in a CSV (resumes from checkpoint)
  python pipeline_v3_batch.py --input questions.csv --output results/

  # Process only a specific article
  python pipeline_v3_batch.py --input questions.csv --output results/ --article-id article_101001

  # Process first N articles
  python pipeline_v3_batch.py --input questions.csv --output results/ --limit-articles 5

  # Resume a previously submitted batch
  python pipeline_v3_batch.py --resume --batch-id msgbatch_xxx --input questions.csv --output results/
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Set, Optional

import pandas as pd
from dotenv import load_dotenv
import anthropic
from openai import AsyncOpenAI

from qc_pipeline.modules.question_qc_v3_batch import QuestionQCAnalyzerV3Batch
from qc_pipeline.modules.question_qc_v2 import QuestionQCAnalyzerV2
from qc_pipeline.utils import calculate_pass_rate

# Load environment from .env file in the script's directory
ENV_FILE = Path(__file__).parent.parent / ".env"
try:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)
except Exception:
    pass
load_dotenv()


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
        return keys
    
    # Fallback to single key
    single_key = os.getenv(f'{provider}_API_KEY')
    if single_key:
        return [single_key.strip()]
    
    return []

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class QCPipelineV3Batch:
    """
    Batch-based QC pipeline using Claude's Message Batches API with checkpointing.
    
    Key Features:
    - 50% cost reduction via batch API pricing
    - Prompt caching for shared article content
    - Resume capability for interrupted batches
    - Automatic grouping by passage for cache efficiency
    - Checkpointing to resume from output folder
    """

    # Expected number of checks for a fully completed question
    EXPECTED_QUESTION_CHECKS = 8

    # Check names by provider
    CLAUDE_CHECKS = {
        'grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance',
        'standard_alignment', 'clarity_precision', 'single_correct_answer', 'passage_reference'
    }
    OPENAI_CHECKS = {'too_close', 'difficulty_assessment'}
    LOCAL_CHECKS = {'length_check'}

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.output_dir = Path(args.output)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Load API keys (supports ANTHROPIC_API_KEY_1, _2 format)
        anthropic_keys = load_api_keys('ANTHROPIC')
        if not anthropic_keys:
            raise ValueError("No Anthropic API key found. Set ANTHROPIC_API_KEY or ANTHROPIC_API_KEY_1 in .env")
        
        logger.info(f"Loaded {len(anthropic_keys)} Anthropic API key(s)")
        
        # Use first key for batch API (batch doesn't benefit from multiple keys)
        self.claude_client = anthropic.Anthropic(api_key=anthropic_keys[0])
        
        # Load OpenAI keys for supplementary checks
        openai_keys = load_api_keys('OPENAI')
        skip_openai = getattr(args, 'skip_openai', False)
        
        if openai_keys and not skip_openai:
            self.openai_client = AsyncOpenAI(api_key=openai_keys[0])
            logger.info(f"Loaded {len(openai_keys)} OpenAI API key(s) for supplementary checks")
        else:
            self.openai_client = None
            if not skip_openai:
                logger.info("No OpenAI API keys found - will skip OpenAI checks (too_close, difficulty_assessment)")

        self.question_qc = QuestionQCAnalyzerV3Batch(
            claude_client=self.claude_client,
            claude_model=args.claude_model,
            output_dir=self.output_dir / "batch_data"
        )
        
        # Create V2 analyzer for OpenAI-only checks
        if self.openai_client:
            self.openai_analyzer = QuestionQCAnalyzerV2(
                claude_client=None,
                openai_client=self.openai_client,
                claude_model=args.claude_model,
                openai_model="gpt-4-turbo",
                skip_openai=False
            )
        else:
            self.openai_analyzer = None

        # Track completed questions
        self._completed_question_ids: Set[str] = set()
        self._needs_openai_ids: Set[str] = set()
        self._existing_results: List[Dict[str, Any]] = []
        self._existing_results_map: Dict[str, Dict[str, Any]] = {}

    def _get_results_file(self) -> Path:
        """Get the path to the results file."""
        return self.output_dir / "question_qc_v3_results.json"

    def _load_completed_from_output(self) -> tuple[Set[str], List[Dict[str, Any]], Set[str], Dict[str, Dict[str, Any]]]:
        """
        Load completed question IDs from the output folder.
        
        Returns:
            Tuple of (fully_completed_ids, existing_results, needs_openai_ids, results_map)
            - fully_completed_ids: Questions with all checks done
            - existing_results: All loaded results
            - needs_openai_ids: Questions that have Claude checks but missing OpenAI checks
            - results_map: Map of question_id to result for merging
        """
        fully_completed_ids = set()
        needs_openai_ids = set()
        existing_results = []
        results_map = {}
        results_file = self._get_results_file()
        
        if not results_file.exists():
            return fully_completed_ids, existing_results, needs_openai_ids, results_map
        
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
            
            for result in results:
                question_id = result.get('question_id', '')
                checks = result.get('checks', {})
                check_names = set(checks.keys())
                
                # Check what's present
                has_claude = len(check_names & self.CLAUDE_CHECKS) >= len(self.CLAUDE_CHECKS) - 1
                has_openai = len(check_names & self.OPENAI_CHECKS) >= 1
                has_local = 'length_check' in check_names
                
                existing_results.append(result)
                results_map[question_id] = result
                
                # Determine status
                if has_claude and has_openai and has_local:
                    fully_completed_ids.add(question_id)
                elif has_claude and not has_openai:
                    # Has Claude checks but missing OpenAI - can run just OpenAI
                    needs_openai_ids.add(question_id)
                # else: needs full rerun (missing Claude checks)
            
            if fully_completed_ids:
                logger.info(f"  Found {len(fully_completed_ids)} fully completed question results")
            if needs_openai_ids:
                logger.info(f"  Found {len(needs_openai_ids)} questions needing only OpenAI checks")
                
        except Exception as e:
            logger.warning(f"  Could not read existing results: {e}")
        
        return fully_completed_ids, existing_results, needs_openai_ids, results_map

    def _save_results_incrementally(self, new_results: List[Dict[str, Any]]):
        """Save results incrementally to the output file."""
        results_file = self._get_results_file()
        
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

    def prepare_questions(self, df: pd.DataFrame, skip_completed: bool = True) -> List[Dict[str, Any]]:
        """
        Prepare questions from dataframe, optionally skipping completed ones.
        
        Args:
            df: Input dataframe
            skip_completed: If True, skip questions already in output (including those needing only OpenAI)
            
        Returns:
            List of question dicts to process (only those needing Claude checks)
        """
        questions = []
        skipped_complete = 0
        skipped_has_claude = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            
            # Skip if fully completed (has all checks)
            if skip_completed and question_id in self._completed_question_ids:
                skipped_complete += 1
                continue
            
            # Skip if already has Claude checks (only needs OpenAI)
            # These are handled separately by _run_openai_checks
            if skip_completed and question_id in self._needs_openai_ids:
                skipped_has_claude += 1
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
                'structured_content': structured_content,
                'article_id': row.get('article_id', '')
            }
            questions.append(question_item)

        if skip_completed:
            logger.info(f"\n📋 PROGRESS STATUS")
            logger.info(f"{'─'*40}")
            logger.info(f"  Total in input:       {len(df)}")
            logger.info(f"  Fully completed:      {skipped_complete}")
            logger.info(f"  Has Claude (OpenAI only): {skipped_has_claude}")
            logger.info(f"  Need Claude batch:    {len(questions)}")

        return questions

    def run_batch_qc(self, questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not questions:
            logger.info("\n✓ All questions already processed!")
            return self._existing_results

        logger.info("\n" + "=" * 60)
        logger.info("RUNNING QUESTION QC (BATCH V3 WITH CHECKPOINTING)")
        logger.info("=" * 60)
        logger.info(f"Processing {len(questions)} questions via Message Batches API")
        logger.info(f"Expected cost: 50% of standard API pricing")

        start_time = time.time()
        
        results = self.question_qc.analyze_batch(questions, save_results=True)
        
        elapsed = time.time() - start_time

        # Save results incrementally
        all_results = self._save_results_incrementally(results)
        logger.info(f"  ✓ Saved {len(results)} new results (total: {len(all_results)})")

        logger.info(f"\nCompleted in {elapsed:.1f}s ({len(questions) / elapsed:.1f} questions/sec)")

        # Save to canonical results file (for checkpointing)
        all_results = self._save_results_incrementally(results)
        logger.info(f"  ✓ Saved {len(results)} new results to canonical file (total: {len(all_results)})")

        # Also create timestamped copy for reference
        output_file = self.output_dir / f"question_qc_v3_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        logger.info(f"Saved timestamped copy to {output_file}")

        self._create_readable_csv(all_results, output_file)

        stats = calculate_pass_rate(all_results)
        logger.info(f"\nQuestion QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")

        return all_results

    def resume_batch(self, batch_id: str, questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        logger.info("\n" + "=" * 60)
        logger.info(f"RESUMING BATCH {batch_id}")
        logger.info("=" * 60)

        start_time = time.time()
        
        results = self.question_qc.resume_batch(batch_id, questions)
        
        elapsed = time.time() - start_time

        # Save results incrementally
        all_results = self._save_results_incrementally(results)
        logger.info(f"  ✓ Saved {len(results)} resumed results (total: {len(all_results)})")

        output_file = self.output_dir / f"question_qc_v3_resumed_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Saved resumed results to {output_file}")

        self._create_readable_csv(results, output_file)

        stats = calculate_pass_rate(results)
        logger.info(f"\nResumed Batch Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Time: {elapsed:.1f}s")

        return results

    async def _run_openai_checks(self, questions_needing_openai: List[Dict[str, Any]]) -> None:
        """Run OpenAI checks for questions that already have Claude checks."""
        if not self.openai_analyzer or not questions_needing_openai:
            return
        
        logger.info(f"\n" + "=" * 60)
        logger.info("RUNNING OPENAI CHECKS FOR EXISTING RESULTS")
        logger.info("=" * 60)
        logger.info(f"Processing {len(questions_needing_openai)} questions with OpenAI")
        
        start_time = time.time()
        
        # Run OpenAI checks only
        openai_results = await self.openai_analyzer.analyze_batch_openai_only(
            questions_needing_openai, 
            concurrency=5
        )
        
        elapsed = time.time() - start_time
        
        # Merge OpenAI results with existing Claude results
        merged_count = 0
        for openai_result in openai_results:
            q_id = openai_result.get('question_id')
            if q_id in self._existing_results_map:
                existing = self._existing_results_map[q_id]
                merged_checks = existing.get('checks', {}).copy()
                merged_checks.update(openai_result.get('checks', {}))
                
                # Recalculate scores
                passed = sum(1 for c in merged_checks.values() if c.get('score', 0) == 1)
                total = len(merged_checks)
                
                # Update existing result
                existing['checks'] = merged_checks
                existing['total_checks_run'] = total
                existing['total_checks_passed'] = passed
                existing['overall_score'] = passed / total if total > 0 else 0
                merged_count += 1
        
        # Save merged results
        self._save_results_incrementally(list(self._existing_results_map.values()))
        
        logger.info(f"Merged OpenAI checks for {merged_count} questions in {elapsed:.1f}s")

    def run(self):
        logger.info("=" * 60)
        logger.info("STARTING BATCH QC PIPELINE V3 (WITH CHECKPOINTING)")
        logger.info("=" * 60)
        logger.info(f"Input: {self.args.input}")
        logger.info(f"Output: {self.output_dir}")
        logger.info(f"Model: {self.args.claude_model}")
        logger.info(f"Cost: 50% of standard API pricing")
        if self.openai_client:
            logger.info(f"OpenAI: Enabled for supplementary checks")
        else:
            logger.info(f"OpenAI: Disabled (no API key)")
        logger.info(f"\n📁 Checking for existing results in output folder...")

        # Load completed questions from output - now returns 4 values
        (self._completed_question_ids, 
         self._existing_results, 
         self._needs_openai_ids, 
         self._existing_results_map) = self._load_completed_from_output()

        df = self.load_input_data()
        
        # Update prepare_questions to also track questions needing OpenAI
        questions = self.prepare_questions(df, skip_completed=True)
        
        # Prepare questions that need only OpenAI checks
        questions_needing_openai = []
        if self.openai_client and self._needs_openai_ids:
            for i, row in df.iterrows():
                question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
                if question_id in self._needs_openai_ids:
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
                    questions_needing_openai.append({
                        'question_id': question_id,
                        'question_type': row.get('question_type', 'MCQ'),
                        'passage_text': passage,
                        'grade': row.get('grade'),
                        'structured_content': structured_content
                    })

        start_time = time.time()

        # First, run OpenAI checks for questions that already have Claude results
        if questions_needing_openai:
            asyncio.run(self._run_openai_checks(questions_needing_openai))

        if self.args.resume and self.args.batch_id:
            # For resume, we need all questions (not just incomplete ones)
            all_questions = self.prepare_questions(df, skip_completed=False)
            results = self.resume_batch(self.args.batch_id, all_questions)
        elif questions:
            # Run Claude batch for questions needing Claude checks
            results = self.run_batch_qc(questions)
            
            # After Claude batch completes, run OpenAI checks for these questions too
            skip_openai = getattr(self.args, 'skip_openai', False)
            if not skip_openai and self.openai_client and questions:
                logger.info(f"\nRunning OpenAI checks for {len(questions)} newly processed questions...")
                asyncio.run(self._run_openai_checks(questions))
                # Reload results after OpenAI merge
                results = list(self._existing_results_map.values())
        else:
            # No Claude batch needed - use existing results (with merged OpenAI checks)
            logger.info("\n✓ All Claude checks already completed!")
            if questions_needing_openai:
                logger.info(f"  OpenAI checks were added to {len(questions_needing_openai)} existing results")
            results = list(self._existing_results_map.values())
            
            # Generate updated CSV with merged results
            output_file = self.output_dir / f"question_qc_v3_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w') as f:
                json.dump(results, f, indent=2)
            logger.info(f"Saved updated results to {output_file}")
            self._create_readable_csv(results, output_file)

        total_elapsed = time.time() - start_time

        self._create_summary_report(results, total_elapsed)

        logger.info("\n" + "=" * 60)
        logger.info("BATCH PIPELINE COMPLETED")
        logger.info("=" * 60)
        logger.info(f"Total time: {total_elapsed:.1f}s")
        logger.info(f"Results saved to {self.output_dir}")

    def _create_summary_report(self, results: List[Dict[str, Any]], elapsed: float):
        stats = calculate_pass_rate(results)
        
        batch_results = {}
        for r in results:
            br = r.get('batch_result', 'unknown')
            batch_results[br] = batch_results.get(br, 0) + 1

        summary = {
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'version': 'v3_batch',
            'total_time_seconds': elapsed,
            'cost_savings': '50% vs standard API',
            'question_qc': stats,
            'batch_results': batch_results
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
                'total': result.get('total_checks_run', 0),
                'batch_result': result.get('batch_result', 'unknown')
            }

            for check_name in all_checks:
                check = result.get('checks', {}).get(check_name, {})
                passed = check.get('score', 0) == 1
                row[check_name] = '✅' if passed else '❌'

            summary_rows.append(row)

        with open(summary_csv_file, 'w', newline='', encoding='utf-8') as f:
            fieldnames = ['question_id', 'score', 'status', 'passed', 'total', 'batch_result'] + list(all_checks)
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)

        logger.info(f"Saved summary CSV to {summary_csv_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Batch Quality Control Pipeline V3 with Checkpointing - 50% cost reduction via Message Batches API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Process all questions
    python pipeline_v3_batch.py --input questions.csv --output results/

    # Process only a specific article
    python pipeline_v3_batch.py --input questions.csv --output results/ --article-id article_101001

    # Process first 3 articles
    python pipeline_v3_batch.py --input questions.csv --output results/ --limit-articles 3

    # Process first 10 questions only
    python pipeline_v3_batch.py --input questions.csv --output results/ --limit 10
        """
    )

    parser.add_argument("--input", required=True, help="Input CSV file")
    parser.add_argument("--output", required=True, help="Output directory for results")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N questions (0 = all)")
    parser.add_argument("--claude-model", default="claude-sonnet-4-5-20250929", help="Claude model")
    
    # Article filtering
    parser.add_argument("--article-id", help="Process only questions from this specific article ID")
    parser.add_argument("--limit-articles", type=int, default=0, help="Process only first N articles (0 = all)")
    
    # OpenAI options
    parser.add_argument("--skip-openai", action="store_true", help="Skip OpenAI checks (too_close, difficulty_assessment)")
    
    # Resume options
    parser.add_argument("--resume", action="store_true", help="Resume a previously submitted batch")
    parser.add_argument("--batch-id", help="Batch ID to resume (use with --resume)")

    args = parser.parse_args()

    if args.resume and not args.batch_id:
        parser.error("--batch-id is required when using --resume")

    try:
        QCPipelineV3Batch(args).run()
    except KeyboardInterrupt:
        logger.info("Pipeline interrupted by user")
    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
