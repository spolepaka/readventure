#!/usr/bin/env python3
"""
QC Results JSON to CSV Converter

Converts QC pipeline JSON results to a readable CSV format.

Usage:
    python qc_results_to_csv.py --input qc_results/question_qc_*.json --output qc_results_readable.csv
    python qc_results_to_csv.py --input qc_results/question_qc_20251209_160232.json
"""

import argparse
import json
import csv
import glob
import os
from pathlib import Path
from typing import Dict, List, Any


def load_qc_results(input_path: str) -> List[Dict[str, Any]]:
    """Load QC results from JSON file."""
    with open(input_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_input_csv(csv_path: str) -> Dict[str, Dict]:
    """Load original input CSV to get question details."""
    import pandas as pd
    try:
        df = pd.read_csv(csv_path)
        questions = {}
        for _, row in df.iterrows():
            q_id = row.get('question_id', '')
            questions[q_id] = {
                'question_text': row.get('question', ''),
                'option_1': row.get('option_1', ''),
                'option_2': row.get('option_2', ''),
                'option_3': row.get('option_3', ''),
                'option_4': row.get('option_4', ''),
                'correct_answer': row.get('correct_answer', ''),
                'passage_preview': str(row.get('passage', ''))[:200] + '...' if row.get('passage') else '',
                'CCSS': row.get('CCSS', ''),
                'DOK': row.get('DOK', '')
            }
        return questions
    except Exception as e:
        print(f"Warning: Could not load input CSV: {e}")
        return {}


def truncate_text(text: str, max_length: int = 300) -> str:
    """Truncate text to max length."""
    if not text:
        return ""
    text = str(text).replace('\n', ' ').replace('\r', ' ')
    if len(text) > max_length:
        return text[:max_length] + "..."
    return text


def convert_to_csv(qc_results: List[Dict], output_path: str, input_csv: str = None):
    """Convert QC results to CSV format."""
    
    # Load original questions if available
    questions_data = {}
    if input_csv and os.path.exists(input_csv):
        questions_data = load_input_csv(input_csv)
    
    # Collect all unique check names
    all_checks = set()
    for result in qc_results:
        all_checks.update(result.get('checks', {}).keys())
    all_checks = sorted(all_checks)
    
    # Build CSV rows
    rows = []
    
    for result in qc_results:
        q_id = result.get('question_id', '')
        q_data = questions_data.get(q_id, {})
        
        # Base row with question info
        row = {
            'question_id': q_id,
            'question_type': result.get('question_type', ''),
            'overall_score': f"{result.get('overall_score', 0):.0%}",
            'checks_passed': result.get('total_checks_passed', 0),
            'checks_total': result.get('total_checks_run', 0),
            'status': '✅ PASSED' if result.get('overall_score', 0) >= 0.7 else '❌ FAILED',
            'question_text': truncate_text(q_data.get('question_text', ''), 200),
            'option_A': truncate_text(q_data.get('option_1', ''), 100),
            'option_B': truncate_text(q_data.get('option_2', ''), 100),
            'option_C': truncate_text(q_data.get('option_3', ''), 100),
            'option_D': truncate_text(q_data.get('option_4', ''), 100),
            'correct_answer': q_data.get('correct_answer', ''),
            'CCSS': q_data.get('CCSS', ''),
            'DOK': q_data.get('DOK', ''),
        }
        
        # Add check results
        checks = result.get('checks', {})
        for check_name in all_checks:
            if check_name in checks:
                check = checks[check_name]
                score = check.get('score', 0)
                response = truncate_text(check.get('response', ''), 300)
                row[f'{check_name}_status'] = '✅' if score == 1 else '❌'
                row[f'{check_name}_reason'] = response
            else:
                row[f'{check_name}_status'] = 'N/A'
                row[f'{check_name}_reason'] = ''
        
        rows.append(row)
    
    # Define column order
    base_columns = [
        'question_id', 'status', 'overall_score', 'checks_passed', 'checks_total',
        'question_text', 'option_A', 'option_B', 'option_C', 'option_D', 
        'correct_answer', 'CCSS', 'DOK', 'question_type'
    ]
    
    check_columns = []
    for check in all_checks:
        check_columns.append(f'{check}_status')
        check_columns.append(f'{check}_reason')
    
    all_columns = base_columns + check_columns
    
    # Write CSV
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=all_columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Wrote {len(rows)} rows to {output_path}")
    return rows


def create_summary_view(qc_results: List[Dict], output_path: str):
    """Create a simplified summary CSV with just pass/fail for each check."""
    
    # Collect all unique check names
    all_checks = set()
    for result in qc_results:
        all_checks.update(result.get('checks', {}).keys())
    all_checks = sorted(all_checks)
    
    rows = []
    for result in qc_results:
        row = {
            'question_id': result.get('question_id', ''),
            'score': f"{result.get('overall_score', 0):.0%}",
            'status': '✅' if result.get('overall_score', 0) >= 0.7 else '❌',
        }
        
        checks = result.get('checks', {})
        for check_name in all_checks:
            if check_name in checks:
                row[check_name] = '✅' if checks[check_name].get('score', 0) == 1 else '❌'
            else:
                row[check_name] = '-'
        
        rows.append(row)
    
    columns = ['question_id', 'score', 'status'] + list(all_checks)
    
    # Put summary in same directory as output
    output_dir = Path(output_path).parent
    base_name = Path(output_path).stem.replace('_readable', '')
    summary_path = str(output_dir / f"{base_name}_summary.csv")
    with open(summary_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Wrote summary to {summary_path}")


def find_latest_qc_file(qc_dir: str = 'qc_results') -> str:
    """Find the latest question_qc JSON file."""
    pattern = os.path.join(qc_dir, 'question_qc_*.json')
    files = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def main():
    parser = argparse.ArgumentParser(
        description="Convert QC results JSON to readable CSV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert latest QC results
  python qc_results_to_csv.py
  
  # Convert specific file
  python qc_results_to_csv.py --input qc_results/question_qc_20251209_160232.json
  
  # Specify output and include original question data
  python qc_results_to_csv.py --input qc_results/question_qc_*.json --output results.csv --questions qti_sample_1_article.csv
        """
    )
    
    parser.add_argument(
        '--input', '-i',
        help='Path to QC results JSON file (default: latest in qc_results/)'
    )
    
    parser.add_argument(
        '--output', '-o',
        help='Output CSV file path (default: qc_results_readable.csv)'
    )
    
    parser.add_argument(
        '--questions', '-q',
        default='qti_sample_1_article.csv',
        help='Original questions CSV to get question text (default: qti_sample_1_article.csv)'
    )
    
    parser.add_argument(
        '--summary-only', '-s',
        action='store_true',
        help='Only create summary view (no detailed reasons)'
    )
    
    args = parser.parse_args()
    
    # Find input file
    input_path = args.input
    if not input_path:
        input_path = find_latest_qc_file()
        if not input_path:
            print("Error: No QC results found in qc_results/")
            return
        print(f"Using latest QC results: {input_path}")
    
    # Set output path - default to same directory as input file
    output_path = args.output
    if not output_path:
        input_dir = Path(input_path).parent
        base_name = Path(input_path).stem
        output_path = str(input_dir / f"{base_name}_readable.csv")
    
    # Load and convert
    print(f"Loading QC results from: {input_path}")
    qc_results = load_qc_results(input_path)
    print(f"Found {len(qc_results)} question results")
    
    if args.summary_only:
        create_summary_view(qc_results, output_path)
    else:
        convert_to_csv(qc_results, output_path, args.questions)
        create_summary_view(qc_results, output_path)
    
    print("\nDone!")


if __name__ == "__main__":
    main()

