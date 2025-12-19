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
  # Sequential (single API key, direct Anthropic API)
  python pipeline_v2.py --input questions.csv --output results/ --mode questions

  # Use OpenRouter for higher rate limits
  python pipeline_v2.py --input questions.csv --output results/ --provider openrouter

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

  # OpenRouter key (for --provider openrouter)
  OPENROUTER_API_KEY=sk-or-...
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
from qc_pipeline.modules.question_qc_v2_openrouter import QuestionQCAnalyzerV2OpenRouter
from qc_pipeline.modules.explanation_qc_v2 import ExplanationQCAnalyzerV2
from qc_pipeline.utils import (
    validate_env_vars, 
    calculate_pass_rate,
    compute_content_hash,
    truncate_text,
    extract_passage_title,
    get_run_id,
    archive_old_runs,
    get_failed_checks_list
)

# OpenRouter configuration
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_CLAUDE_MODEL = "anthropic/claude-sonnet-4"  # OpenRouter model ID for Claude Sonnet 4

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
        
        # Create runs directory for timestamped outputs (like V3)
        self.runs_dir = self.output_dir / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate run ID for this execution (like V3)
        self.run_id = get_run_id()
        logger.info(f"Run ID: {self.run_id}")

        skip_openai = getattr(args, 'skip_openai', False)
        provider = getattr(args, 'provider', 'anthropic')
        
        # Determine which provider to use for Claude calls
        self.provider = provider
        
        if provider == 'openrouter':
            # Use OpenRouter for Claude calls
            openrouter_key = os.getenv('OPENROUTER_API_KEY')
            if not openrouter_key:
                raise ValueError("OPENROUTER_API_KEY not set in environment. Add it to .env file.")
            
            # OpenRouter uses OpenAI-compatible API
            self.openrouter_client = AsyncOpenAI(
                api_key=openrouter_key,
                base_url=OPENROUTER_BASE_URL
            )
            self.claude_client = None  # Not used with OpenRouter
            
            # Set model name for OpenRouter
            claude_model = args.claude_model
            if not claude_model.startswith('anthropic/'):
                # Convert Anthropic model name to OpenRouter format
                claude_model = OPENROUTER_CLAUDE_MODEL
            
            logger.info(f"Using OpenRouter provider")
            logger.info(f"  Base URL: {OPENROUTER_BASE_URL}")
            logger.info(f"  Model: {claude_model}")
            logger.info(f"  Benefits: Higher rate limits, fewer concurrency restrictions")
            
            # OpenAI client for supplementary checks (too_close, difficulty_assessment)
            if skip_openai:
                self.openai_client = None
                logger.info("Skipping OpenAI checks (--skip-openai flag set)")
            else:
                openai_key = os.getenv('OPENAI_API_KEY')
                if openai_key:
                    self.openai_client = AsyncOpenAI(api_key=openai_key)
                else:
                    logger.warning("OPENAI_API_KEY not set - OpenAI checks will be skipped")
                    self.openai_client = None
                    skip_openai = True
            
            # Create OpenRouter-based analyzer with higher concurrency
            openrouter_concurrency = getattr(args, 'openrouter_concurrency', 25)
            openrouter_rate = getattr(args, 'openrouter_rate', 25)
            
            if args.mode in ['questions', 'both']:
                examples_df = pd.read_csv(args.examples) if args.examples else None
                if examples_df is not None:
                    logger.info(f"Loaded {len(examples_df)} benchmark questions")

                self.question_qc = QuestionQCAnalyzerV2OpenRouter(
                    openrouter_client=self.openrouter_client,
                    openai_client=self.openai_client,
                    claude_model=claude_model,
                    openai_model=args.openai_model,
                    examples_df=examples_df,
                    skip_openai=skip_openai,
                    initial_rate=openrouter_rate,
                    max_concurrent=openrouter_concurrency
                )
                logger.info(f"  Concurrency: {openrouter_concurrency}")
                logger.info(f"  Initial rate: {openrouter_rate} req/min (adaptive)")
            else:
                self.question_qc = None
                
        else:
            # Use direct Anthropic API (default)
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
            if skip_openai or self.openai_client is None:
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
        self._existing_results_map: Dict[str, Dict[str, Any]] = {}
        self._hash_map: Dict[str, str] = {}  # For content change detection (like V3)
        self._run_stats: Dict[str, Any] = {}  # For richer summary reports (like V3)

    def _get_results_file(self, qc_type: str) -> Path:
        """Get the path to the results file for a given QC type."""
        return self.output_dir / f"{qc_type}_qc_v2_results.json"
    
    def _get_merged_file(self) -> Path:
        """Get the path to the merged results file (like V3)."""
        return self.output_dir / "question_qc_merged.json"
    
    def _get_run_file(self, suffix: str = ".json") -> Path:
        """Get the path for current run's output file (like V3)."""
        return self.runs_dir / f"qc_run_{self.run_id}{suffix}"

    # Check names by provider
    CLAUDE_CHECKS = {
        'grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance',
        'standard_alignment', 'clarity_precision', 'single_correct_answer', 'passage_reference'
    }
    OPENAI_CHECKS = {'too_close', 'difficulty_assessment'}
    LOCAL_CHECKS = {'length_check'}

    def _load_completed_from_output(self, qc_type: str, expected_checks: int) -> tuple[Set[str], List[Dict[str, Any]], Set[str], Dict[str, Dict[str, Any]], Dict[str, str]]:
        """
        Load completed item IDs from the output folder (like V3).
        
        Returns:
            Tuple of (fully_completed_ids, existing_results, needs_openai_ids, results_map, hash_map)
            - fully_completed_ids: Questions with all checks done
            - existing_results: All loaded results  
            - needs_openai_ids: Questions that have Claude checks but missing OpenAI checks
            - results_map: Map of question_id to result for merging
            - hash_map: Map of question_id to content_hash for change detection
        """
        fully_completed_ids = set()
        needs_openai_ids = set()
        existing_results = []
        results_map = {}
        hash_map = {}  # For content change detection (like V3)
        
        # Try merged file first (like V3), then fall back to legacy file
        results_file = self._get_merged_file()
        if not results_file.exists():
            results_file = self._get_results_file(qc_type)
        
        if not results_file.exists():
            return fully_completed_ids, existing_results, needs_openai_ids, results_map, hash_map
        
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
            
            for result in results:
                item_id = result.get('question_id', '')
                checks = result.get('checks', {})
                check_names = set(checks.keys())
                content_hash = result.get('content_hash', '')
                
                # Check what's present
                has_claude = len(check_names & self.CLAUDE_CHECKS) >= len(self.CLAUDE_CHECKS) - 1  # Allow 1 missing
                has_openai = len(check_names & self.OPENAI_CHECKS) >= 1
                has_local = 'length_check' in check_names
                
                existing_results.append(result)
                results_map[item_id] = result
                if content_hash:
                    hash_map[item_id] = content_hash
                
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
        
        return fully_completed_ids, existing_results, needs_openai_ids, results_map, hash_map

    def _save_results_incrementally(self, new_results: List[Dict[str, Any]], qc_type: str):
        """Save results incrementally to the merged output file (like V3)."""
        # Use merged file as primary (like V3)
        results_file = self._get_merged_file()
        
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
        
        # Save all results to merged file
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

        # Filter by multiple article IDs (comma-separated)
        elif hasattr(self.args, 'article_ids') and self.args.article_ids:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --article-ids filter")
            else:
                article_id_list = [aid.strip() for aid in self.args.article_ids.split(',')]
                df = df[df['article_id'].isin(article_id_list)]
                if len(df) == 0:
                    logger.error(f"No questions found for article_ids: {article_id_list}")
                    raise ValueError(f"Article IDs not found: {article_id_list}")
                logger.info(f"Filtered to {len(article_id_list)} articles: {len(df)} questions")
                logger.info(f"  Articles: {article_id_list}")

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

        # Load completed questions from output - now returns 5 values (like V3)
        (self._completed_question_ids, 
         self._existing_results, 
         needs_openai_ids,
         self._existing_results_map,
         self._hash_map) = self._load_completed_from_output(
            'question', self.EXPECTED_QUESTION_CHECKS
        )

        questions_full = []  # Need all checks
        questions_openai_only = []  # Only need OpenAI checks
        skipped_complete = 0
        skipped_has_claude = 0
        rerun_modified = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            
            choices = {
                'A': str(row.get('option_1') or row.get('choice_A', '') or ''),
                'B': str(row.get('option_2') or row.get('choice_B', '') or ''),
                'C': str(row.get('option_3') or row.get('choice_C', '') or ''),
                'D': str(row.get('option_4') or row.get('choice_D', '') or '')
            }
            
            question_text = str(row.get('question', '') or '')
            correct_answer = str(row.get('correct_answer', '') or '')
            
            # Compute content hash for change detection (like V3)
            content_hash = compute_content_hash(question_text, choices, correct_answer)
            
            # Check if question exists and if content has changed (like V3)
            existing_hash = self._hash_map.get(question_id, '')
            content_changed = existing_hash and existing_hash != content_hash
            
            if content_changed:
                logger.info(f"  ⚠️ Question {question_id} content changed - will re-run QC")
                rerun_modified += 1
                # Remove from completed sets so it gets processed
                self._completed_question_ids.discard(question_id)
                needs_openai_ids.discard(question_id)
            
            # Skip if fully completed AND content unchanged
            if question_id in self._completed_question_ids and not content_changed:
                skipped_complete += 1
                continue
            
            # Skip if already has Claude checks (only needs OpenAI) AND content unchanged
            if question_id in needs_openai_ids and not content_changed:
                skipped_has_claude += 1
                # Still need to add to questions_openai_only if OpenAI is enabled
                if not skip_openai and self.openai_client:
                    pass  # Will handle below
                else:
                    continue

            structured_content = {
                'question': question_text,
                'choices': choices,
                'correct_answer': correct_answer,
                'CCSS': str(row.get('CCSS', '') or ''),
                'CCSS_description': str(row.get('CCSS_description', '') or ''),
                'DOK': row.get('DOK', '')
            }

            passage = str(row.get('passage_text') or row.get('passage') or row.get('stimulus', '') or '')

            # Enriched question item (like V3)
            question_item = {
                'question_id': question_id,
                'article_id': str(row.get('article_id', '') or ''),
                'content_hash': content_hash,
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'passage_title': extract_passage_title(passage, max_length=50),
                'question_preview': truncate_text(question_text, max_length=60),
                'grade': row.get('grade'),
                'structured_content': structured_content,
                'run_id': self.run_id
            }
            
            # Check if this question only needs OpenAI checks
            if question_id in needs_openai_ids and not skip_openai and self.openai_client and not content_changed:
                questions_openai_only.append(question_item)
            elif question_id not in needs_openai_ids or content_changed:
                questions_full.append(question_item)
            # else: already has Claude, skip_openai is True, so skip
        
        # Store stats for summary report (like V3)
        self._run_stats = {
            'total_in_input': len(df),
            'skipped_complete': skipped_complete,
            'skipped_has_claude': skipped_has_claude,
            'rerun_modified': rerun_modified,
            'need_full_checks': len(questions_full),
            'need_openai_only': len(questions_openai_only)
        }

        logger.info(f"\n📋 PROGRESS STATUS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Total in input:       {len(df)}")
        logger.info(f"  Fully completed:      {skipped_complete}")
        if rerun_modified > 0:
            logger.info(f"  ⚠️ Modified (re-run):  {rerun_modified}")
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
                
                # Add enriched fields to results (like V3)
                for r in batch_results:
                    q_match = next((q for q in batch_questions if q['question_id'] == r.get('question_id')), {})
                    if q_match:
                        r['article_id'] = q_match.get('article_id', '')
                        r['content_hash'] = q_match.get('content_hash', '')
                        r['passage_title'] = q_match.get('passage_title', '')
                        r['question_preview'] = q_match.get('question_preview', '')
                        r['run_id'] = self.run_id
                
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
                    if q_id in self._existing_results_map:
                        # Merge checks
                        existing = self._existing_results_map[q_id]
                        merged_checks = existing.get('checks', {}).copy()
                        merged_checks.update(openai_result.get('checks', {}))
                        
                        # Recalculate scores
                        passed = sum(1 for c in merged_checks.values() if c.get('score', 0) == 1)
                        total = len(merged_checks)
                        
                        # Find matching question for enriched fields
                        q_match = next((q for q in batch_questions if q['question_id'] == q_id), {})
                        
                        merged_result = {
                            **existing,
                            'checks': merged_checks,
                            'total_checks_run': total,
                            'total_checks_passed': passed,
                            'overall_score': passed / total if total > 0 else 0,
                            # Add enriched fields (like V3)
                            'article_id': q_match.get('article_id', existing.get('article_id', '')),
                            'content_hash': q_match.get('content_hash', existing.get('content_hash', '')),
                            'passage_title': q_match.get('passage_title', existing.get('passage_title', '')),
                            'question_preview': q_match.get('question_preview', existing.get('question_preview', '')),
                            'run_id': self.run_id
                        }
                        all_new_results.append(merged_result)
                        self._existing_results_map[q_id] = merged_result
                
                # Save incrementally
                all_results = self._save_results_incrementally(
                    [self._existing_results_map[q.get('question_id')] for q in batch_questions if q.get('question_id') in self._existing_results_map],
                    'question'
                )
                logger.info(f"  ✓ Merged OpenAI checks for {len(batch_questions)} questions")

        elapsed = (datetime.now() - start_time).total_seconds()

        # Combine with existing results
        all_results = self._existing_results + all_new_results
        
        # Deduplicate by question_id (keep latest)
        results_map = {r.get('question_id'): r for r in all_results}
        all_results = list(results_map.values())

        total_processed = len(questions_full) + len(questions_openai_only)
        if total_processed > 0 and elapsed > 0:
            logger.info(f"\nCompleted in {elapsed:.1f}s ({total_processed / elapsed:.1f} questions/sec)")
        else:
            logger.info(f"\nCompleted in {elapsed:.1f}s")

        # Save to runs folder (like V3)
        run_file = self._get_run_file(".json")
        with open(run_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        logger.info(f"Saved run results to {run_file}")

        # Create summary CSV (like V3)
        self._create_readable_csv(all_results, run_file)
        
        # Archive old runs (keep latest 5, like V3)
        archive_old_runs(self.output_dir, keep_latest=5)

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
        """Create detailed summary report with per-article breakdown (like V3)."""
        stats = calculate_pass_rate(question_results) if question_results else {'total': 0, 'passed': 0, 'failed': 0, 'pass_rate': 0, 'average_score': 0}
        
        # Per-article breakdown (like V3)
        by_article = {}
        for r in (question_results or []):
            article_id = r.get('article_id', 'unknown')
            if article_id not in by_article:
                by_article[article_id] = {'total': 0, 'passed': 0, 'failed': 0}
            by_article[article_id]['total'] += 1
            if r.get('overall_score', 0) >= 0.8:
                by_article[article_id]['passed'] += 1
            else:
                by_article[article_id]['failed'] += 1
        
        # Failed checks summary - which checks fail most often (like V3)
        failed_checks_summary = {}
        for r in (question_results or []):
            for check_name, check_data in r.get('checks', {}).items():
                if isinstance(check_data, dict) and check_data.get('score', 0) != 1:
                    failed_checks_summary[check_name] = failed_checks_summary.get(check_name, 0) + 1
        
        # Sort by failure count
        failed_checks_summary = dict(sorted(failed_checks_summary.items(), key=lambda x: -x[1]))

        summary = {
            'run_id': self.run_id,
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'mode': self.args.mode,
            'version': 'v2_optimized',
            
            'stats': {
                'total_processed': stats['total'],
                'skipped_complete': self._run_stats.get('skipped_complete', 0),
                'skipped_has_claude': self._run_stats.get('skipped_has_claude', 0),
                'rerun_modified': self._run_stats.get('rerun_modified', 0),
                'new_questions': self._run_stats.get('need_full_checks', 0),
                'passed': stats['passed'],
                'failed': stats['failed'],
                'pass_rate': stats['pass_rate'],
                'average_score': stats['average_score']
            },
            
            'by_article': by_article,
            'failed_checks_summary': failed_checks_summary,
            
            'timing': {
                'total_seconds': elapsed,
                'questions_per_second': stats['total'] / elapsed if elapsed > 0 else 0
            },
            
            'question_qc': stats,
            'explanation_qc': calculate_pass_rate(explanation_results) if explanation_results else None
        }

        # Save to runs folder with timestamp (like V3)
        run_report_file = self._get_run_file("_report.json")
        with open(run_report_file, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"Saved run report to {run_report_file}")

        # Also save latest summary to main output folder
        summary_file = self.output_dir / "summary_report.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"Saved summary report to {summary_file}")

    # All possible check names (like V3)
    ALL_CHECK_NAMES = [
        'clarity_precision', 'difficulty_assessment', 'grammatical_parallel',
        'homogeneity', 'length_check', 'passage_reference', 'plausibility',
        'single_correct_answer', 'specificity_balance', 'standard_alignment', 'too_close'
    ]

    def _create_readable_csv(self, qc_results: List[Dict[str, Any]], json_file: Path):
        """Create summary CSV with both compact summary and individual check columns (like V3)."""
        if not qc_results:
            return

        summary_csv_file = json_file.with_name(json_file.stem + '_summary.csv')
        summary_rows = []

        for result in qc_results:
            q_id = result.get('question_id', '')
            article_id = result.get('article_id', '')
            content_hash = result.get('content_hash', '')
            passage_title = result.get('passage_title', '')
            question_preview = result.get('question_preview', '')
            run_id = result.get('run_id', '')
            
            # Get failed checks as comma-separated list (like V3)
            checks = result.get('checks', {})
            failed_checks = get_failed_checks_list(checks)
            
            passed = result.get('total_checks_passed', 0)
            total = result.get('total_checks_run', 0)
            
            row = {
                'question_id': q_id,
                'article_id': article_id,
                'content_hash': content_hash,
                'passage_title': passage_title,
                'question_preview': question_preview,
                'score': f"{result.get('overall_score', 0):.0%}",
                'status': '✅' if result.get('overall_score', 0) >= 0.8 else '❌',
                'passed_total': f"{passed}/{total}",
                'failed_checks': failed_checks,
                'run_id': run_id
            }
            
            # Add individual check columns (like V3)
            for check_name in self.ALL_CHECK_NAMES:
                check_data = checks.get(check_name, {})
                if isinstance(check_data, dict):
                    score = check_data.get('score', '')
                    if score == 1:
                        row[check_name] = '✅'
                    elif score == 0:
                        row[check_name] = '❌'
                    else:
                        row[check_name] = ''  # Not run
                else:
                    row[check_name] = ''

            summary_rows.append(row)

        fieldnames = [
            'question_id', 'article_id', 'content_hash', 'passage_title', 
            'question_preview', 'score', 'status', 'passed_total', 
            'failed_checks', 'run_id'
        ] + self.ALL_CHECK_NAMES
        
        with open(summary_csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)

        logger.info(f"Saved summary CSV to {summary_csv_file}")
        
        # Also save to merged summary CSV (like V3)
        merged_csv_file = self.output_dir / "question_qc_merged_summary.csv"
        with open(merged_csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)
        logger.info(f"Saved merged summary CSV to {merged_csv_file}")


class ConcurrentQCPipelineV2:
    """
    Concurrent QC pipeline using multiple API keys for parallel processing.
    
    Each API key processes questions independently, providing N-times throughput
    where N is the number of API keys.
    """

    EXPECTED_QUESTION_CHECKS = 8
    
    # Check names by provider (like V3)
    CLAUDE_CHECKS = {
        'grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance',
        'standard_alignment', 'clarity_precision', 'single_correct_answer', 'passage_reference'
    }
    OPENAI_CHECKS = {'too_close', 'difficulty_assessment'}
    LOCAL_CHECKS = {'length_check'}
    
    # All possible check names (like V3)
    ALL_CHECK_NAMES = [
        'clarity_precision', 'difficulty_assessment', 'grammatical_parallel',
        'homogeneity', 'length_check', 'passage_reference', 'plausibility',
        'single_correct_answer', 'specificity_balance', 'standard_alignment', 'too_close'
    ]

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
        
        # Create runs directory (like V3)
        self.runs_dir = self.output_dir / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate run ID (like V3)
        self.run_id = get_run_id()
        logger.info(f"Run ID: {self.run_id}")

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
        self._existing_results_map: Dict[str, Dict[str, Any]] = {}
        self._hash_map: Dict[str, str] = {}  # For content change detection (like V3)
        self._run_stats: Dict[str, Any] = {}  # For richer summary reports (like V3)
        
        logger.info(f"Initialized concurrent QC pipeline with {self.num_workers} workers")

    def _get_results_file(self) -> Path:
        """Get the path to the results file."""
        return self.output_dir / "question_qc_v2_results.json"
    
    def _get_merged_file(self) -> Path:
        """Get the path to the merged results file (like V3)."""
        return self.output_dir / "question_qc_merged.json"
    
    def _get_run_file(self, suffix: str = ".json") -> Path:
        """Get the path for current run's output file (like V3)."""
        return self.runs_dir / f"qc_run_{self.run_id}{suffix}"

    def _load_completed_from_output(self) -> Tuple[Set[str], List[Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, str]]:
        """Load completed question IDs from the output folder (like V3)."""
        completed_ids = set()
        existing_results = []
        results_map = {}
        hash_map = {}
        
        # Try merged file first (like V3)
        results_file = self._get_merged_file()
        if not results_file.exists():
            results_file = self._get_results_file()
        
        if not results_file.exists():
            return completed_ids, existing_results, results_map, hash_map
        
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
            
            for result in results:
                question_id = result.get('question_id', '')
                checks = result.get('checks', {})
                content_hash = result.get('content_hash', '')
                check_names = set(checks.keys())
                
                # Check what's present (like V3)
                has_claude = len(check_names & self.CLAUDE_CHECKS) >= len(self.CLAUDE_CHECKS) - 1
                has_openai = len(check_names & self.OPENAI_CHECKS) >= 1
                has_local = 'length_check' in check_names
                
                existing_results.append(result)
                results_map[question_id] = result
                if content_hash:
                    hash_map[question_id] = content_hash
                
                if has_claude and has_openai and has_local:
                    completed_ids.add(question_id)
            
            if completed_ids:
                logger.info(f"  Found {len(completed_ids)} completed question results in output")
                
        except Exception as e:
            logger.warning(f"  Could not read existing results: {e}")
        
        return completed_ids, existing_results, results_map, hash_map

    def _save_results_thread_safe(self, new_results: List[Dict[str, Any]]):
        """Save results in a thread-safe manner to merged file (like V3)."""
        with self._output_lock:
            # Use merged file as primary (like V3)
            results_file = self._get_merged_file()
            
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
                
                # Add enriched fields to result (like V3)
                result['article_id'] = question.get('article_id', '')
                result['content_hash'] = question.get('content_hash', '')
                result['passage_title'] = question.get('passage_title', '')
                result['question_preview'] = question.get('question_preview', '')
                result['run_id'] = question.get('run_id', self.run_id)
                
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

        # Filter by multiple article IDs (comma-separated)
        elif hasattr(self.args, 'article_ids') and self.args.article_ids:
            if 'article_id' not in df.columns:
                logger.warning("No 'article_id' column found - ignoring --article-ids filter")
            else:
                article_id_list = [aid.strip() for aid in self.args.article_ids.split(',')]
                df = df[df['article_id'].isin(article_id_list)]
                if len(df) == 0:
                    logger.error(f"No questions found for article_ids: {article_id_list}")
                    raise ValueError(f"Article IDs not found: {article_id_list}")
                logger.info(f"Filtered to {len(article_id_list)} articles: {len(df)} questions")
                logger.info(f"  Articles: {article_id_list}")

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
        """Prepare questions, skipping completed ones and detecting modified questions (like V3)."""
        questions = []
        skipped_complete = 0
        rerun_modified = 0
        
        for i, row in df.iterrows():
            question_id = str(row.get('question_id') or row.get('item_id', f'Q{i+1}'))
            
            choices = {
                'A': str(row.get('option_1') or row.get('choice_A', '') or ''),
                'B': str(row.get('option_2') or row.get('choice_B', '') or ''),
                'C': str(row.get('option_3') or row.get('choice_C', '') or ''),
                'D': str(row.get('option_4') or row.get('choice_D', '') or '')
            }
            
            question_text = str(row.get('question', '') or '')
            correct_answer = str(row.get('correct_answer', '') or '')
            
            # Compute content hash for change detection (like V3)
            content_hash = compute_content_hash(question_text, choices, correct_answer)
            
            # Check if question exists and if content has changed (like V3)
            existing_hash = self._hash_map.get(question_id, '')
            content_changed = existing_hash and existing_hash != content_hash
            
            if content_changed:
                logger.info(f"  ⚠️ Question {question_id} content changed - will re-run QC")
                rerun_modified += 1
                completed_ids.discard(question_id)
            
            if question_id in completed_ids and not content_changed:
                skipped_complete += 1
                continue

            structured_content = {
                'question': question_text,
                'choices': choices,
                'correct_answer': correct_answer,
                'CCSS': str(row.get('CCSS', '') or ''),
                'CCSS_description': str(row.get('CCSS_description', '') or ''),
                'DOK': row.get('DOK', '')
            }

            passage = str(row.get('passage_text') or row.get('passage') or row.get('stimulus', '') or '')

            # Enriched question item (like V3)
            question_item = {
                'question_id': question_id,
                'article_id': str(row.get('article_id', '') or ''),
                'content_hash': content_hash,
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'passage_title': extract_passage_title(passage, max_length=50),
                'question_preview': truncate_text(question_text, max_length=60),
                'grade': row.get('grade'),
                'structured_content': structured_content,
                'run_id': self.run_id
            }
            questions.append(question_item)
        
        # Store stats for summary report (like V3)
        self._run_stats = {
            'total_in_input': len(df),
            'skipped_complete': skipped_complete,
            'rerun_modified': rerun_modified,
            'need_processing': len(questions)
        }

        logger.info(f"\n📋 PROGRESS STATUS")
        logger.info(f"{'─'*40}")
        logger.info(f"  Total in input:     {len(df)}")
        logger.info(f"  Already completed:  {skipped_complete}")
        if rerun_modified > 0:
            logger.info(f"  ⚠️ Modified (re-run): {rerun_modified}")
        logger.info(f"  To process:         {len(questions)}")

        return questions

    def run(self):
        logger.info("\n" + "=" * 60)
        logger.info("CONCURRENT QC PIPELINE V2")
        logger.info(f"Run ID: {self.run_id}")
        logger.info(f"Workers: {self.num_workers}")
        logger.info("=" * 60)

        # Load completed from output (like V3, returns 4 values now)
        logger.info(f"\n📁 Checking for existing results in output folder...")
        (completed_ids, 
         self._existing_results, 
         self._existing_results_map,
         self._hash_map) = self._load_completed_from_output()

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
        """Create detailed final report with per-article breakdown (like V3)."""
        total_elapsed = time.time() - self._start_time if self._start_time else 0

        # Add enriched fields to results that don't have them yet
        for r in results:
            if 'run_id' not in r:
                r['run_id'] = self.run_id

        # Save to merged file (like V3)
        merged_file = self._get_merged_file()
        results_map = {r.get('question_id'): r for r in results}
        with open(merged_file, 'w') as f:
            json.dump(list(results_map.values()), f, indent=2)
        logger.info(f"Saved to merged file: {merged_file}")

        # Save to runs folder (like V3)
        run_file = self._get_run_file(".json")
        with open(run_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Saved run results to {run_file}")

        # Create CSV summary
        self._create_readable_csv(results, run_file)
        
        # Archive old runs (keep latest 5, like V3)
        archive_old_runs(self.output_dir, keep_latest=5)

        # Stats
        stats = calculate_pass_rate(results)
        
        # Per-article breakdown (like V3)
        by_article = {}
        for r in results:
            article_id = r.get('article_id', 'unknown')
            if article_id not in by_article:
                by_article[article_id] = {'total': 0, 'passed': 0, 'failed': 0}
            by_article[article_id]['total'] += 1
            if r.get('overall_score', 0) >= 0.8:
                by_article[article_id]['passed'] += 1
            else:
                by_article[article_id]['failed'] += 1
        
        # Failed checks summary (like V3)
        failed_checks_summary = {}
        for r in results:
            for check_name, check_data in r.get('checks', {}).items():
                if isinstance(check_data, dict) and check_data.get('score', 0) != 1:
                    failed_checks_summary[check_name] = failed_checks_summary.get(check_name, 0) + 1
        failed_checks_summary = dict(sorted(failed_checks_summary.items(), key=lambda x: -x[1]))

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
        logger.info(f"  {run_file}")

        # Save richer summary (like V3)
        summary = {
            'run_id': self.run_id,
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'mode': 'concurrent',
            'workers': self.num_workers,
            'version': 'v2_concurrent',
            
            'stats': {
                'total_processed': stats['total'],
                'skipped_complete': self._run_stats.get('skipped_complete', 0),
                'rerun_modified': self._run_stats.get('rerun_modified', 0),
                'new_questions': self._run_stats.get('need_processing', 0),
                'passed': stats['passed'],
                'failed': stats['failed'],
                'pass_rate': stats['pass_rate'],
                'average_score': stats['average_score']
            },
            
            'by_article': by_article,
            'failed_checks_summary': failed_checks_summary,
            
            'timing': {
                'total_seconds': total_elapsed,
                'questions_per_second': self._completed_questions / total_elapsed if total_elapsed > 0 else 0
            },
            
            'question_qc': stats
        }
        
        # Save to runs folder with timestamp (like V3)
        run_report_file = self._get_run_file("_report.json")
        with open(run_report_file, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"Saved run report to {run_report_file}")
        
        # Also save latest summary to main output folder
        summary_file = self.output_dir / "summary_report.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)

    def _create_readable_csv(self, qc_results: List[Dict[str, Any]], json_file: Path):
        """Create summary CSV with both compact summary and individual check columns (like V3)."""
        if not qc_results:
            return

        summary_csv_file = json_file.with_name(json_file.stem + '_summary.csv')
        summary_rows = []

        for result in qc_results:
            q_id = result.get('question_id', '')
            article_id = result.get('article_id', '')
            content_hash = result.get('content_hash', '')
            passage_title = result.get('passage_title', '')
            question_preview = result.get('question_preview', '')
            run_id = result.get('run_id', '')
            
            # Get failed checks as comma-separated list (like V3)
            checks = result.get('checks', {})
            failed_checks = get_failed_checks_list(checks)
            
            passed = result.get('total_checks_passed', 0)
            total = result.get('total_checks_run', 0)
            
            row = {
                'question_id': q_id,
                'article_id': article_id,
                'content_hash': content_hash,
                'passage_title': passage_title,
                'question_preview': question_preview,
                'score': f"{result.get('overall_score', 0):.0%}",
                'status': '✅' if result.get('overall_score', 0) >= 0.8 else '❌',
                'passed_total': f"{passed}/{total}",
                'failed_checks': failed_checks,
                'run_id': run_id
            }
            
            # Add individual check columns (like V3)
            for check_name in self.ALL_CHECK_NAMES:
                check_data = checks.get(check_name, {})
                if isinstance(check_data, dict):
                    score = check_data.get('score', '')
                    if score == 1:
                        row[check_name] = '✅'
                    elif score == 0:
                        row[check_name] = '❌'
                    else:
                        row[check_name] = ''  # Not run
                else:
                    row[check_name] = ''

            summary_rows.append(row)

        fieldnames = [
            'question_id', 'article_id', 'content_hash', 'passage_title', 
            'question_preview', 'score', 'status', 'passed_total', 
            'failed_checks', 'run_id'
        ] + self.ALL_CHECK_NAMES
        
        with open(summary_csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)

        logger.info(f"Saved summary CSV to {summary_csv_file}")
        
        # Also save to merged summary CSV (like V3)
        merged_csv_file = self.output_dir / "question_qc_merged_summary.csv"
        with open(merged_csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(summary_rows)
        logger.info(f"Saved merged summary CSV to {merged_csv_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Optimized Quality Control Pipeline V2 with Checkpointing and Concurrency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Sequential mode (single API key, direct Anthropic)
    python pipeline_v2.py --input questions.csv --output results/ --mode questions

    # Use OpenRouter for higher rate limits (recommended for large batches)
    python pipeline_v2.py --input questions.csv --output results/ --provider openrouter

    # OpenRouter with higher concurrency
    python pipeline_v2.py --input questions.csv --output results/ --provider openrouter --concurrency 20

    # Process only a specific article
    python pipeline_v2.py --input questions.csv --output results/ --article-id article_101001

    # Process first 3 articles
    python pipeline_v2.py --input questions.csv --output results/ --limit-articles 3

    # Concurrent mode with multiple API keys (Anthropic only)
    python pipeline_v2.py --input questions.csv --output results/ --concurrent

    # Concurrent with specific worker count
    python pipeline_v2.py --input questions.csv --output results/ --concurrent --max-workers 3

Providers:
    --provider anthropic (default):
        Uses direct Anthropic API. Requires ANTHROPIC_API_KEY.
        Standard rate limits apply (lower concurrency).
    
    --provider openrouter:
        Uses OpenRouter API (OpenAI-compatible). Requires OPENROUTER_API_KEY.
        Benefits: Higher rate limits, fewer concurrency restrictions.
        Model: anthropic/claude-sonnet-4 (auto-converted)
        
        OpenRouter-specific options:
        --openrouter-concurrency 25  # Max concurrent requests (default: 25)
        --openrouter-rate 25         # Initial req/min (default: 25, adapts automatically)
        
        Example for high throughput:
        python pipeline_v2.py --input questions.csv --output results/ \\
            --provider openrouter --openrouter-concurrency 50 --openrouter-rate 40

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
    
    For OpenRouter:
        OPENROUTER_API_KEY=sk-or-...
    
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
    parser.add_argument("--article-ids", help="Comma-separated list of article IDs to process (e.g., article_101006,article_101007)")
    parser.add_argument("--limit-articles", type=int, default=0, help="Process only first N articles (0 = all)")
    
    # Provider selection
    parser.add_argument("--provider", choices=['anthropic', 'openrouter'], default='anthropic',
                       help="API provider for Claude calls (default: anthropic). Use 'openrouter' for higher rate limits.")
    parser.add_argument("--openrouter-concurrency", type=int, default=25,
                       help="Concurrency for OpenRouter requests (default: 25). OpenRouter supports higher concurrency than Anthropic.")
    parser.add_argument("--openrouter-rate", type=int, default=25,
                       help="Initial requests per minute for OpenRouter (default: 25). Rate adapts automatically based on API responses.")
    parser.add_argument("--claude-model", default="claude-sonnet-4-5-20250929", help="Claude model (auto-converted for OpenRouter)")
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
