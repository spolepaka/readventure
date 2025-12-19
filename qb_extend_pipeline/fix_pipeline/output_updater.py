#!/usr/bin/env python3
"""
Output Updater Module

Updates all output files after fixing questions:
- qb_extended_combined.csv - Main questions CSV
- question_qc_merged.json - QC results
- question_qc_merged_summary.csv - Summary CSV
- summary_report.json - Overall stats
"""

import json
import shutil
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd

logger = logging.getLogger(__name__)


def backup_files(
    questions_csv_path: str,
    qc_merged_path: str,
    backup_dir: Path
) -> None:
    """
    Create backups of files before modifying.
    
    Args:
        questions_csv_path: Path to questions CSV
        qc_merged_path: Path to QC merged JSON
        backup_dir: Directory to store backups
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    # Backup questions CSV
    if Path(questions_csv_path).exists():
        shutil.copy2(questions_csv_path, backup_dir / "qb_extended_combined.csv")
        logger.info(f"Backed up questions CSV to {backup_dir}")
    
    # Backup QC merged JSON
    if Path(qc_merged_path).exists():
        shutil.copy2(qc_merged_path, backup_dir / "question_qc_merged.json")
        logger.info(f"Backed up QC merged JSON to {backup_dir}")


def update_questions_csv(
    question_id: str,
    fixed_data: Dict[str, Any],
    csv_path: str,
    run_id: str
) -> bool:
    """
    Update a single question in the CSV file.
    
    Args:
        question_id: ID of question to update
        fixed_data: New data from LLM
        csv_path: Path to questions CSV
        run_id: Current fix run ID
    
    Returns:
        True if successful, False otherwise
    """
    try:
        df = pd.read_csv(csv_path)
        
        # Find the row
        mask = df['question_id'] == question_id
        if not mask.any():
            logger.error(f"Question {question_id} not found in CSV")
            return False
        
        idx = df[mask].index[0]
        strategy = fixed_data.get('fix_strategy', 'unknown')
        
        # Update based on strategy
        if strategy == 'full_regeneration':
            # Store original question
            df.loc[idx, 'original_question'] = df.loc[idx, 'question']
            # Update question
            if 'question' in fixed_data:
                df.loc[idx, 'question'] = fixed_data['question']
        
        # Update options (for both strategies)
        if 'option_A' in fixed_data:
            df.loc[idx, 'option_1'] = fixed_data['option_A']
        if 'option_B' in fixed_data:
            df.loc[idx, 'option_2'] = fixed_data['option_B']
        if 'option_C' in fixed_data:
            df.loc[idx, 'option_3'] = fixed_data['option_C']
        if 'option_D' in fixed_data:
            df.loc[idx, 'option_4'] = fixed_data['option_D']
        
        # Update correct answer (only for full regen)
        if strategy == 'full_regeneration' and 'correct_answer' in fixed_data:
            df.loc[idx, 'correct_answer'] = fixed_data['correct_answer']
        
        # Update explanations
        if 'option_A_explanation' in fixed_data:
            df.loc[idx, 'option_1_explanation'] = fixed_data['option_A_explanation']
        if 'option_B_explanation' in fixed_data:
            df.loc[idx, 'option_2_explanation'] = fixed_data['option_B_explanation']
        if 'option_C_explanation' in fixed_data:
            df.loc[idx, 'option_3_explanation'] = fixed_data['option_C_explanation']
        if 'option_D_explanation' in fixed_data:
            df.loc[idx, 'option_4_explanation'] = fixed_data['option_D_explanation']
        
        # Add fix metadata
        df.loc[idx, 'fix_timestamp'] = datetime.now().isoformat()
        df.loc[idx, 'fix_strategy'] = strategy
        df.loc[idx, 'fix_run_id'] = run_id
        
        # Save
        df.to_csv(csv_path, index=False)
        logger.debug(f"Updated question {question_id} in CSV")
        return True
        
    except Exception as e:
        logger.error(f"Failed to update CSV for {question_id}: {e}")
        return False


def update_qc_merged(
    question_id: str,
    new_qc_result: Dict[str, Any],
    json_path: str
) -> bool:
    """
    Update QC result for a question in the merged JSON.
    
    Args:
        question_id: ID of question to update
        new_qc_result: New QC result
        json_path: Path to merged QC JSON
    
    Returns:
        True if successful, False otherwise
    """
    try:
        with open(json_path, 'r') as f:
            results = json.load(f)
        
        # Find and update the question
        updated = False
        for i, result in enumerate(results):
            if result.get('question_id') == question_id:
                results[i] = new_qc_result
                updated = True
                break
        
        if not updated:
            # Add as new entry
            results.append(new_qc_result)
            logger.info(f"Added new QC result for {question_id}")
        
        with open(json_path, 'w') as f:
            json.dump(results, f, indent=2)
        
        logger.debug(f"Updated QC result for {question_id}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to update QC merged for {question_id}: {e}")
        return False


def regenerate_summary_csv(
    merged_json_path: str,
    csv_path: str
) -> bool:
    """
    Regenerate the summary CSV from merged JSON.
    
    Args:
        merged_json_path: Path to merged QC JSON
        csv_path: Path to output CSV
    
    Returns:
        True if successful, False otherwise
    """
    try:
        with open(merged_json_path, 'r') as f:
            results = json.load(f)
        
        # Build summary rows
        rows = []
        
        # Define check names for consistent ordering
        ALL_CHECK_NAMES = [
            'grammatical_parallel', 'plausibility', 'homogeneity', 
            'specificity_balance', 'standard_alignment', 'clarity_precision',
            'single_correct_answer', 'passage_reference', 'length_check',
            'too_close', 'difficulty_assessment'
        ]
        
        for result in results:
            checks = result.get('checks', {})
            
            # Calculate failed checks
            failed_checks = [
                name for name, data in checks.items()
                if isinstance(data, dict) and data.get('score', 1) == 0
            ]
            
            row = {
                'question_id': result.get('question_id', ''),
                'article_id': result.get('article_id', ''),
                'content_hash': result.get('content_hash', ''),
                'passage_title': result.get('passage_title', ''),
                'question_preview': result.get('question_preview', ''),
                'score': result.get('overall_score', 0),
                'status': 'PASS' if result.get('overall_score', 0) >= 0.8 else 'FAIL',
                'passed_total': f"{result.get('total_checks_passed', 0)}/{result.get('total_checks_run', 0)}",
                'failed_checks': ', '.join(failed_checks) if failed_checks else '',
                'run_id': result.get('run_id', '')
            }
            
            # Add individual check scores
            for check_name in ALL_CHECK_NAMES:
                check_data = checks.get(check_name, {})
                if isinstance(check_data, dict):
                    row[check_name] = check_data.get('score', '')
                else:
                    row[check_name] = ''
            
            rows.append(row)
        
        # Create DataFrame and save
        df = pd.DataFrame(rows)
        
        # Order columns
        column_order = [
            'question_id', 'article_id', 'content_hash', 'passage_title',
            'question_preview', 'score', 'status', 'passed_total', 'failed_checks', 'run_id'
        ] + ALL_CHECK_NAMES
        
        df = df[[c for c in column_order if c in df.columns]]
        df.to_csv(csv_path, index=False)
        
        logger.info(f"Regenerated summary CSV with {len(rows)} rows")
        return True
        
    except Exception as e:
        logger.error(f"Failed to regenerate summary CSV: {e}")
        return False


def regenerate_summary_report(
    merged_json_path: str,
    report_path: str,
    run_id: str
) -> bool:
    """
    Regenerate the summary report from merged JSON.
    
    Args:
        merged_json_path: Path to merged QC JSON
        report_path: Path to output report
        run_id: Current run ID
    
    Returns:
        True if successful, False otherwise
    """
    try:
        with open(merged_json_path, 'r') as f:
            results = json.load(f)
        
        # Calculate stats
        total = len(results)
        passed = sum(1 for r in results if r.get('overall_score', 0) >= 0.8)
        failed = total - passed
        avg_score = sum(r.get('overall_score', 0) for r in results) / total if total > 0 else 0
        
        # Per-article breakdown
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
        
        # Failed checks summary
        failed_checks_count = {}
        for r in results:
            for check_name, check_data in r.get('checks', {}).items():
                if isinstance(check_data, dict) and check_data.get('score', 1) == 0:
                    failed_checks_count[check_name] = failed_checks_count.get(check_name, 0) + 1
        
        report = {
            'run_id': run_id,
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_questions': total,
                'passed': passed,
                'failed': failed,
                'pass_rate': f"{100 * passed / total:.1f}%" if total > 0 else "0%",
                'average_score': round(avg_score, 3)
            },
            'by_article': by_article,
            'failed_checks_summary': dict(sorted(
                failed_checks_count.items(), 
                key=lambda x: -x[1]
            ))
        }
        
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        logger.info(f"Regenerated summary report")
        return True
        
    except Exception as e:
        logger.error(f"Failed to regenerate summary report: {e}")
        return False


def update_all_outputs(
    fixed_questions: List[Dict[str, Any]],
    new_qc_results: List[Dict[str, Any]],
    questions_csv_path: str,
    qc_merged_path: str,
    summary_csv_path: str,
    summary_report_path: str,
    run_id: str
) -> Dict[str, int]:
    """
    Update all output files after fixes.
    
    Returns:
        Dict with counts of successful updates
    """
    stats = {
        'csv_updated': 0,
        'qc_updated': 0
    }
    
    # Update CSV for each fixed question
    for fixed in fixed_questions:
        question_id = fixed.get('question_id')
        if question_id and update_questions_csv(question_id, fixed, questions_csv_path, run_id):
            stats['csv_updated'] += 1
    
    # Update QC merged for each new result
    for result in new_qc_results:
        question_id = result.get('question_id')
        if question_id and update_qc_merged(question_id, result, qc_merged_path):
            stats['qc_updated'] += 1
    
    # Regenerate summary files
    regenerate_summary_csv(qc_merged_path, summary_csv_path)
    regenerate_summary_report(qc_merged_path, summary_report_path, run_id)
    
    logger.info(f"Updated {stats['csv_updated']} CSV rows, {stats['qc_updated']} QC results")
    return stats


if __name__ == "__main__":
    # Test the module
    logging.basicConfig(level=logging.INFO)
    print("Output updater module loaded successfully")

