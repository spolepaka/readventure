#!/usr/bin/env python3
"""
Question Fix Pipeline - Main Orchestrator

Automatically fixes failed QC questions by:
1. Analyzing failure reasons from QC results
2. Determining fix strategy (distractor-only vs full regeneration)
3. Using LLM to generate fixes
4. Running QC on fixed questions
5. Updating all output files
6. Generating before/after comparison report

Usage:
    python -m fix_pipeline.fix_pipeline \
        --qc-results outputs/qc_results/question_qc_merged.json \
        --questions outputs/qb_extended_combined.csv \
        --output outputs/fix_results \
        --provider openrouter
"""

import os
import sys
import json
import asyncio
import argparse
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

import pandas as pd
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from fix_pipeline.failure_analyzer import (
    load_qc_results,
    get_failed_extended_questions,
    analyze_question,
    format_failure_reasoning
)
from fix_pipeline.context_gatherer import (
    load_questions_csv,
    get_question_context
)
from fix_pipeline.question_fixer import (
    create_openrouter_client,
    fix_question
)
from fix_pipeline.output_updater import (
    backup_files,
    update_questions_csv,
    update_qc_merged,
    regenerate_summary_csv,
    regenerate_summary_report
)
from fix_pipeline.comparison_tracker import ComparisonTracker

# Load environment variables
ENV_FILE = Path(__file__).parent.parent / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class QuestionFixPipeline:
    """Main pipeline for fixing failed questions."""
    
    def __init__(
        self,
        qc_results_path: str,
        questions_csv_path: str,
        output_dir: str,
        article_ids: Optional[List[str]] = None
    ):
        self.qc_results_path = Path(qc_results_path)
        self.questions_csv_path = Path(questions_csv_path)
        self.output_dir = Path(output_dir)
        self.article_ids = article_ids
        
        # Generate run ID
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_dir = self.output_dir / f"fix_run_{self.run_id}"
        
        # Create output directories
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "backup").mkdir(exist_ok=True)
        
        # Get OpenRouter API key
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY not set in environment")
        
        # Initialize client
        self.client = create_openrouter_client(self.api_key)
        
        # Initialize tracker
        self.tracker = ComparisonTracker(self.run_dir, self.run_id)
        
        # Stats
        self.stats = {
            'total_failed': 0,
            'attempted': 0,
            'fix_success': 0,
            'fix_failed': 0
        }
    
    def load_data(self):
        """Load QC results and questions CSV."""
        logger.info("Loading data...")
        
        # Load QC results
        self.qc_results = load_qc_results(str(self.qc_results_path))
        logger.info(f"Loaded {len(self.qc_results)} QC results")
        
        # Load questions CSV
        self.questions_df = load_questions_csv(str(self.questions_csv_path))
        logger.info(f"Loaded {len(self.questions_df)} questions from CSV")
        
        # Get failed extended questions
        failed = get_failed_extended_questions(self.qc_results)
        
        # Filter by article IDs if specified
        if self.article_ids:
            # Build a map of question_id -> article_id
            qid_to_article = dict(zip(
                self.questions_df['question_id'],
                self.questions_df['article_id']
            ))
            failed = [
                q for q in failed
                if qid_to_article.get(q['question_id']) in self.article_ids
            ]
            logger.info(f"Filtered to {len(failed)} questions from articles: {self.article_ids}")
        
        self.failed_questions = failed
        self.stats['total_failed'] = len(failed)
        
        return failed
    
    def create_backups(self):
        """Create backups of files before modifying."""
        logger.info("Creating backups...")
        backup_dir = self.run_dir / "backup"
        backup_files(
            str(self.questions_csv_path),
            str(self.qc_results_path),
            backup_dir
        )
    
    def save_config(self):
        """Save run configuration."""
        config = {
            'run_id': self.run_id,
            'timestamp': datetime.now().isoformat(),
            'qc_results_path': str(self.qc_results_path),
            'questions_csv_path': str(self.questions_csv_path),
            'output_dir': str(self.output_dir),
            'article_ids': self.article_ids,
            'total_failed': self.stats['total_failed']
        }
        
        with open(self.run_dir / "config.json", 'w') as f:
            json.dump(config, f, indent=2)
    
    async def fix_single_question(
        self,
        qc_result: Dict[str, Any],
        question_num: int,
        total: int
    ) -> Optional[Dict[str, Any]]:
        """
        Fix a single question.
        
        Returns:
            Fixed question data, or None on failure
        """
        question_id = qc_result.get('question_id', 'unknown')
        logger.info(f"[{question_num}/{total}] Processing {question_id}")
        
        # Analyze failure
        failure_details = analyze_question(qc_result)
        logger.info(f"  Strategy: {failure_details['fix_strategy']}")
        logger.info(f"  Failed checks: {failure_details['failed_check_names']}")
        
        # Get context
        context = get_question_context(question_id, self.questions_df)
        if context is None:
            logger.error(f"  Could not get context for {question_id}")
            self.tracker.record_fix_attempt(question_id, failure_details['fix_strategy'], None, False)
            return None
        
        # Record before state
        self.tracker.record_before_state(question_id, qc_result, context.get('question_data'))
        
        # Fix the question
        try:
            fixed_data = await fix_question(context, failure_details, self.client)
            
            if fixed_data:
                logger.info(f"  ✓ Fix generated successfully")
                self.tracker.record_fix_attempt(
                    question_id, 
                    failure_details['fix_strategy'],
                    fixed_data,
                    True
                )
                
                # Update CSV immediately
                update_questions_csv(
                    question_id,
                    fixed_data,
                    str(self.questions_csv_path),
                    self.run_id
                )
                
                self.stats['fix_success'] += 1
                return fixed_data
            else:
                logger.error(f"  ✗ Fix generation failed")
                self.tracker.record_fix_attempt(
                    question_id,
                    failure_details['fix_strategy'],
                    None,
                    False
                )
                self.stats['fix_failed'] += 1
                return None
                
        except Exception as e:
            logger.error(f"  ✗ Error fixing question: {e}")
            self.tracker.record_fix_attempt(
                question_id,
                failure_details['fix_strategy'],
                None,
                False
            )
            self.stats['fix_failed'] += 1
            return None
    
    async def run_qc_on_fixed(self, fixed_question_ids: List[str]) -> List[Dict[str, Any]]:
        """
        Run QC on all fixed questions.
        
        Uses V2 pipeline with OpenRouter.
        """
        if not fixed_question_ids:
            return []
        
        logger.info(f"\nRunning QC on {len(fixed_question_ids)} fixed questions...")
        
        # Import QC modules
        from qc_pipeline.modules.question_qc_v2_openrouter import QuestionQCAnalyzerV2OpenRouter
        
        # Get OpenAI key for supplementary checks
        openai_key = os.getenv('OPENAI_API_KEY')
        if not openai_key:
            openai_keys = []
            i = 1
            while True:
                key = os.getenv(f'OPENAI_API_KEY_{i}')
                if key:
                    openai_keys.append(key)
                    i += 1
                else:
                    break
            openai_key = openai_keys[0] if openai_keys else None
        
        from openai import AsyncOpenAI
        openai_client = AsyncOpenAI(api_key=openai_key) if openai_key else None
        
        # Create analyzer
        analyzer = QuestionQCAnalyzerV2OpenRouter(
            openrouter_client=self.client,
            openai_client=openai_client,
            skip_openai=(openai_client is None)
        )
        
        # Prepare questions for QC
        questions_to_qc = []
        for qid in fixed_question_ids:
            context = get_question_context(qid, self.questions_df, include_existing=False)
            if context:
                questions_to_qc.append({
                    'question_id': qid,
                    'question_type': context.get('question_type', 'MCQ'),
                    'passage_text': context.get('passage_text', ''),
                    'grade': context.get('grade'),
                    'structured_content': {
                        'question': context.get('question_text', ''),
                        'choices': context.get('options', {}),
                        'correct_answer': context.get('correct_answer', ''),
                        'CCSS': context.get('CCSS', ''),
                        'CCSS_description': '',
                        'DOK': context.get('DOK', '')
                    }
                })
        
        # Run QC
        results = await analyzer.analyze_batch(questions_to_qc, concurrency=10)
        
        # Add metadata
        for result in results:
            result['run_id'] = self.run_id
            result['article_id'] = self.questions_df[
                self.questions_df['question_id'] == result['question_id']
            ].iloc[0].get('article_id', '') if len(self.questions_df[
                self.questions_df['question_id'] == result['question_id']
            ]) > 0 else ''
        
        logger.info(f"QC complete for {len(results)} questions")
        return results
    
    async def run(self):
        """Run the fix pipeline."""
        logger.info("=" * 60)
        logger.info("QUESTION FIX PIPELINE")
        logger.info("=" * 60)
        logger.info(f"Run ID: {self.run_id}")
        logger.info(f"Output: {self.run_dir}")
        
        # Load data
        failed = self.load_data()
        
        if not failed:
            logger.info("No failed extended questions to fix!")
            return
        
        # Create backups
        self.create_backups()
        
        # Save config
        self.save_config()
        
        # Save before state
        for qc_result in failed:
            question_id = qc_result.get('question_id')
            context = get_question_context(question_id, self.questions_df, include_existing=False)
            if context:
                self.tracker.record_before_state(
                    question_id,
                    qc_result,
                    context.get('question_data')
                )
        self.tracker.save_before_state()
        
        # Fix each question one at a time
        logger.info(f"\nFixing {len(failed)} questions one at a time...")
        
        fixed_questions = []
        fixed_question_ids = []
        
        for i, qc_result in enumerate(failed, 1):
            self.stats['attempted'] += 1
            
            fixed = await self.fix_single_question(qc_result, i, len(failed))
            
            if fixed:
                fixed_questions.append(fixed)
                fixed_question_ids.append(qc_result.get('question_id'))
            
            # Small delay between questions
            await asyncio.sleep(0.5)
        
        # Run QC on fixed questions
        if fixed_question_ids:
            # Reload questions CSV to get updated data
            self.questions_df = load_questions_csv(str(self.questions_csv_path))
            
            new_qc_results = await self.run_qc_on_fixed(fixed_question_ids)
            
            # Record after state and update QC files
            for result in new_qc_results:
                question_id = result.get('question_id')
                self.tracker.record_after_state(question_id, result)
                
                # Update QC merged
                update_qc_merged(
                    question_id,
                    result,
                    str(self.qc_results_path)
                )
            
            # Save new QC results
            with open(self.run_dir / "after_qc.json", 'w') as f:
                json.dump(new_qc_results, f, indent=2)
        
        # Regenerate summary files
        qc_dir = self.qc_results_path.parent
        regenerate_summary_csv(
            str(self.qc_results_path),
            str(qc_dir / "question_qc_merged_summary.csv")
        )
        regenerate_summary_report(
            str(self.qc_results_path),
            str(qc_dir / "summary_report.json"),
            self.run_id
        )
        
        # Generate comparison report
        self.tracker.save_comparison_report()
        
        # Final summary
        logger.info("\n" + "=" * 60)
        logger.info("FIX PIPELINE COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Total failed: {self.stats['total_failed']}")
        logger.info(f"Attempted: {self.stats['attempted']}")
        logger.info(f"Fix success: {self.stats['fix_success']}")
        logger.info(f"Fix failed: {self.stats['fix_failed']}")
        logger.info(f"\nResults saved to: {self.run_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Fix failed QC questions automatically",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Fix all failed extended questions
    python -m fix_pipeline.fix_pipeline \\
        --qc-results outputs/qc_results/question_qc_merged.json \\
        --questions outputs/qb_extended_combined.csv \\
        --output outputs/fix_results

    # Fix only specific articles
    python -m fix_pipeline.fix_pipeline \\
        --qc-results outputs/qc_results/question_qc_merged.json \\
        --questions outputs/qb_extended_combined.csv \\
        --output outputs/fix_results \\
        --article-ids article_101006,article_101007
        """
    )
    
    parser.add_argument(
        "--qc-results",
        required=True,
        help="Path to QC merged JSON (e.g., outputs/qc_results/question_qc_merged.json)"
    )
    parser.add_argument(
        "--questions",
        required=True,
        help="Path to questions CSV (e.g., outputs/qb_extended_combined.csv)"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output directory for fix results"
    )
    parser.add_argument(
        "--article-ids",
        help="Comma-separated list of article IDs to fix (optional, fixes all if not specified)"
    )
    
    args = parser.parse_args()
    
    # Parse article IDs
    article_ids = None
    if args.article_ids:
        article_ids = [aid.strip() for aid in args.article_ids.split(',')]
    
    # Create and run pipeline
    try:
        pipeline = QuestionFixPipeline(
            qc_results_path=args.qc_results,
            questions_csv_path=args.questions,
            output_dir=args.output,
            article_ids=article_ids
        )
        
        asyncio.run(pipeline.run())
        
    except KeyboardInterrupt:
        logger.info("\nPipeline interrupted by user")
    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

