#!/usr/bin/env python3
"""
Unified Quality Control Pipeline V3 - Batch Processing

Uses Claude's Message Batches API for maximum efficiency:
- 50% cost reduction on all Claude API calls
- Higher throughput for large-scale QC
- Prompt caching to share article/passage content across questions

Reference: https://platform.claude.com/docs/en/build-with-claude/batch-processing

Usage:
  # Process all questions in a CSV
  python pipeline_v3_batch.py --input questions.csv --output results/

  # Resume a previously submitted batch
  python pipeline_v3_batch.py --resume --batch-id msgbatch_xxx --input questions.csv --output results/
"""

import argparse
import csv
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

import pandas as pd
from dotenv import load_dotenv
import anthropic

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from qc_pipeline.modules.question_qc_v3_batch import QuestionQCAnalyzerV3Batch
from qc_pipeline.utils import validate_env_vars, calculate_pass_rate

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class QCPipelineV3Batch:
    """
    Batch-based QC pipeline using Claude's Message Batches API.
    
    Key Features:
    - 50% cost reduction via batch API pricing
    - Prompt caching for shared article content
    - Resume capability for interrupted batches
    - Automatic grouping by passage for cache efficiency
    """

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.output_dir = Path(args.output)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Validate env vars
        env_vars = validate_env_vars('ANTHROPIC_API_KEY')
        
        # Use sync client for batch API
        self.claude_client = anthropic.Anthropic(api_key=env_vars['ANTHROPIC_API_KEY'])

        # Initialize batch analyzer
        self.question_qc = QuestionQCAnalyzerV3Batch(
            claude_client=self.claude_client,
            claude_model=args.claude_model,
            output_dir=self.output_dir / "batch_data"
        )

    def load_input_data(self) -> pd.DataFrame:
        """Load and validate input data."""
        logger.info(f"Loading input data from {self.args.input}")
        df = pd.read_csv(self.args.input)

        if self.args.limit and self.args.limit > 0:
            df = df.head(self.args.limit)
            logger.info(f"Limited to first {len(df)} rows")

        logger.info(f"Loaded {len(df)} questions")
        return df

    def prepare_questions(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Convert DataFrame rows to question items."""
        questions = []
        
        for i, row in df.iterrows():
            # Handle different column naming conventions
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

            # Handle passage column naming
            passage = row.get('passage_text') or row.get('passage') or row.get('stimulus', '')

            question_item = {
                'question_id': row.get('question_id') or row.get('item_id', f'Q{i+1}'),
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'grade': row.get('grade'),
                'structured_content': structured_content,
                # Include article ID if available for better grouping
                'article_id': row.get('article_id', '')
            }
            questions.append(question_item)

        return questions

    def run_batch_qc(self, questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run batch question QC."""
        logger.info("\n" + "=" * 60)
        logger.info("RUNNING QUESTION QC (BATCH V3)")
        logger.info("=" * 60)
        logger.info(f"Processing {len(questions)} questions via Message Batches API")
        logger.info(f"Expected cost: 50% of standard API pricing")

        start_time = time.time()
        
        results = self.question_qc.analyze_batch(questions, save_results=True)
        
        elapsed = time.time() - start_time

        logger.info(f"\nCompleted in {elapsed:.1f}s ({len(questions) / elapsed:.1f} questions/sec)")

        # Save results
        output_file = self.output_dir / f"question_qc_v3_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Saved question QC results to {output_file}")

        # Generate readable CSV
        self._create_readable_csv(results, output_file)

        stats = calculate_pass_rate(results)
        logger.info(f"\nQuestion QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")

        return results

    def resume_batch(self, batch_id: str, questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Resume a previously submitted batch."""
        logger.info("\n" + "=" * 60)
        logger.info(f"RESUMING BATCH {batch_id}")
        logger.info("=" * 60)

        start_time = time.time()
        
        results = self.question_qc.resume_batch(batch_id, questions)
        
        elapsed = time.time() - start_time

        # Save results
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

    def run(self):
        """Execute the batch pipeline."""
        logger.info("=" * 60)
        logger.info("STARTING BATCH QC PIPELINE V3")
        logger.info("=" * 60)
        logger.info(f"Input: {self.args.input}")
        logger.info(f"Output: {self.output_dir}")
        logger.info(f"Model: {self.args.claude_model}")
        logger.info(f"Cost: 50% of standard API pricing")

        df = self.load_input_data()
        questions = self.prepare_questions(df)

        start_time = time.time()

        if self.args.resume and self.args.batch_id:
            results = self.resume_batch(self.args.batch_id, questions)
        else:
            results = self.run_batch_qc(questions)

        total_elapsed = time.time() - start_time

        self._create_summary_report(results, total_elapsed)

        logger.info("\n" + "=" * 60)
        logger.info("BATCH PIPELINE COMPLETED")
        logger.info("=" * 60)
        logger.info(f"Total time: {total_elapsed:.1f}s")
        logger.info(f"Results saved to {self.output_dir}")

    def _create_summary_report(self, results: List[Dict[str, Any]], elapsed: float):
        """Create a consolidated summary report."""
        stats = calculate_pass_rate(results)
        
        # Count batch result types
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
        """Create readable CSV files from QC results."""
        if not qc_results:
            return

        # Load original questions for context
        questions_data = {}
        try:
            df = pd.read_csv(self.args.input)
            for _, row in df.iterrows():
                q_id = row.get('question_id', '')
                questions_data[q_id] = {
                    'question_text': str(row.get('question', ''))[:200],
                    'option_A': str(row.get('option_1', ''))[:100],
                    'option_B': str(row.get('option_2', ''))[:100],
                    'option_C': str(row.get('option_3', ''))[:100],
                    'option_D': str(row.get('option_4', ''))[:100],
                    'correct_answer': str(row.get('correct_answer', '')),
                    'CCSS': str(row.get('CCSS', '')),
                    'DOK': str(row.get('DOK', ''))
                }
        except Exception as e:
            logger.warning(f"Could not load input CSV for context: {e}")

        # Collect all check names
        all_checks = set()
        for result in qc_results:
            all_checks.update(result.get('checks', {}).keys())
        all_checks = sorted(all_checks)

        # Create summary CSV
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
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Batch Quality Control Pipeline V3 - 50% cost reduction via Message Batches API"
    )

    parser.add_argument("--input", required=True, help="Input CSV file")
    parser.add_argument("--output", required=True, help="Output directory for results")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N questions (0 = all)")
    parser.add_argument("--claude-model", default="claude-sonnet-4-5-20250929", help="Claude model")
    
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









