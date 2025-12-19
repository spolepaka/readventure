#!/usr/bin/env python3
"""
Unified Quality Control Pipeline V1

Main orchestration script that coordinates question QC, explanation QC,
distractor analysis, and difficulty assessment.

Usage:
  python pipeline.py --input questions.csv --output results/ --mode questions
  python pipeline.py --input questions_with_explanations.csv --output results/ --mode both
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

import pandas as pd
from dotenv import load_dotenv
import anthropic
from openai import AsyncOpenAI

from qc_pipeline.modules.question_qc import QuestionQCAnalyzer
from qc_pipeline.modules.explanation_qc import ExplanationQCAnalyzer
from qc_pipeline.utils import validate_env_vars, calculate_pass_rate

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class QCPipeline:
    """Main quality control pipeline orchestrator."""

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
            
            self.question_qc = QuestionQCAnalyzer(
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
                self.explanation_qc = ExplanationQCAnalyzer(
                    client=self.openai_client,
                    model=args.openai_model
                )
        else:
            self.explanation_qc = None

    def load_input_data(self) -> pd.DataFrame:
        logger.info(f"Loading input data from {self.args.input}")
        df = pd.read_csv(self.args.input)

        if self.args.limit and self.args.limit > 0:
            df = df.head(self.args.limit)
            logger.info(f"Limited to first {len(df)} rows")

        logger.info(f"Loaded {len(df)} questions")
        return df

    async def run_question_qc(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if not self.question_qc:
            return []
            
        logger.info("\n" + "=" * 60)
        logger.info("RUNNING QUESTION QUALITY CONTROL")
        logger.info("=" * 60)

        questions = []
        for i, row in df.iterrows():
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
                'question_id': row.get('question_id') or row.get('item_id', f'Q{i+1}'),
                'question_type': row.get('question_type', 'MCQ'),
                'passage_text': passage,
                'grade': row.get('grade'),
                'structured_content': structured_content
            }
            questions.append(question_item)

        results = await self.question_qc.analyze_batch(questions, self.args.concurrency)

        output_file = self.output_dir / f"question_qc_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Saved question QC results to {output_file}")
        
        self._create_readable_csv(results, output_file)

        stats = calculate_pass_rate(results)
        logger.info(f"\nQuestion QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")
        return results

    async def run_explanation_qc(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if not self.explanation_qc:
            return []

        logger.info("\n" + "=" * 60)
        logger.info("RUNNING EXPLANATION QUALITY CONTROL")
        logger.info("=" * 60)

        explanation_cols = [col for col in df.columns if 'explanation' in col.lower()]
        if not explanation_cols:
            logger.warning("No explanation columns found")
            return []

        explanations = []
        for i, row in df.iterrows():
            question_id = row.get('question_id') or row.get('item_id', f'Q{i+1}')
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

                    explanation_item = {
                        'question_id': question_id,
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
            logger.warning("No explanations found to evaluate")
            return []

        results = await self.explanation_qc.analyze_batch(explanations, self.args.concurrency)

        output_file = self.output_dir / f"explanation_qc_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Saved explanation QC results to {output_file}")

        stats = calculate_pass_rate(results)
        logger.info(f"\nExplanation QC Summary:")
        logger.info(f"  Total: {stats['total']}")
        logger.info(f"  Passed: {stats['passed']} ({stats['pass_rate']:.1%})")
        logger.info(f"  Failed: {stats['failed']}")
        logger.info(f"  Average Score: {stats['average_score']:.2f}")
        return results

    async def run(self):
        logger.info("=" * 60)
        logger.info("STARTING QC PIPELINE")
        logger.info("=" * 60)
        logger.info(f"Mode: {self.args.mode}")
        logger.info(f"Input: {self.args.input}")
        logger.info(f"Output: {self.output_dir}")

        df = self.load_input_data()

        question_results = []
        explanation_results = []

        if self.args.mode in ['questions', 'both']:
            question_results = await self.run_question_qc(df)

        if self.args.mode in ['explanations', 'both']:
            explanation_results = await self.run_explanation_qc(df)

        self._create_summary_report(question_results, explanation_results)

        logger.info("\n" + "=" * 60)
        logger.info("PIPELINE COMPLETED")
        logger.info("=" * 60)
        logger.info(f"Results saved to {self.output_dir}")

    def _create_summary_report(self, question_results, explanation_results):
        summary = {
            'timestamp': datetime.now().isoformat(),
            'input_file': self.args.input,
            'mode': self.args.mode,
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
                passed = check.get('score', 0) == 1
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
        description="Quality Control Pipeline for Reading Comprehension Assessment"
    )

    parser.add_argument("--input", required=True, help="Input CSV file")
    parser.add_argument("--output", required=True, help="Output directory for results")
    parser.add_argument("--mode", choices=['questions', 'explanations', 'both'], default='questions')
    parser.add_argument("--examples", help="CSV file with benchmark questions")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent API calls")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N questions (0 = all)")
    parser.add_argument("--claude-model", default="claude-sonnet-4-5-20250929", help="Claude model")
    parser.add_argument("--openai-model", default="gpt-4-turbo", help="OpenAI model")
    parser.add_argument("--skip-openai", action="store_true", help="Skip OpenAI checks")

    args = parser.parse_args()

    try:
        asyncio.run(QCPipeline(args).run())
    except KeyboardInterrupt:
        logger.info("Pipeline interrupted by user")
    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

