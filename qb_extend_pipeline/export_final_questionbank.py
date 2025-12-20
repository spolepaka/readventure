#!/usr/bin/env python3
"""
Export Final Question Bank
Combines QC-passed questions with their correct versions.
"""

import json
import pandas as pd
from pathlib import Path
import hashlib

def compute_content_hash(question_text: str, options: dict, correct_answer: str) -> str:
    """Compute content hash for a question - matches QC pipeline method."""
    content = {
        "question": question_text.strip() if question_text else "",
        "options": {k: v.strip() if v else "" for k, v in sorted(options.items())},
        "correct": correct_answer.strip() if correct_answer else ""
    }
    content_str = json.dumps(content, sort_keys=True)
    return hashlib.sha256(content_str.encode()).hexdigest()[:12]

def main():
    # Paths
    qc_path = Path("outputs/qc_results/question_qc_merged.json")
    csv_path = Path("outputs/qb_extended_combined.csv")
    output_path = Path("outputs/final_questionbank.csv")
    
    # Load data
    print("Loading QC results...")
    with open(qc_path, 'r') as f:
        qc_results = json.load(f)
    
    print("Loading questions CSV...")
    df = pd.read_csv(csv_path)
    
    # Create QC lookup by question_id
    qc_lookup = {q['question_id']: q for q in qc_results}
    
    # Stats
    total_questions = len(df)
    passing_count = 0
    failing_count = 0
    original_count = 0
    extended_count = 0
    
    # Prepare output data
    output_rows = []
    
    print(f"\nProcessing {total_questions} questions...")
    print("-" * 80)
    
    for idx, row in df.iterrows():
        question_id = row['question_id']
        is_extended = '_sibling_' in str(question_id)
        
        # Get QC result
        qc_result = qc_lookup.get(question_id, {})
        score = qc_result.get('overall_score', 0)
        passed_qc = score >= 0.8
        qc_hash = qc_result.get('content_hash', '')
        
        # Compute current content hash
        choices = {
            'A': row.get('option_1', ''),
            'B': row.get('option_2', ''),
            'C': row.get('option_3', ''),
            'D': row.get('option_4', '')
        }
        current_hash = compute_content_hash(
            str(row.get('question', '')),
            choices,
            str(row.get('correct_answer', ''))
        )
        
        # Check hash match
        hash_match = qc_hash == current_hash if qc_hash else "N/A"
        
        # Track stats
        if is_extended:
            extended_count += 1
        else:
            original_count += 1
            
        if passed_qc:
            passing_count += 1
            status = "PASS"
        else:
            failing_count += 1
            status = "FAIL"
        
        # Create output row
        output_row = {
            'question_id': question_id,
            'article_id': row.get('article_id', ''),
            'article_title': row.get('article_title', ''),
            'question': row.get('question', ''),
            'option_A': row.get('option_1', ''),
            'option_B': row.get('option_2', ''),
            'option_C': row.get('option_3', ''),
            'option_D': row.get('option_4', ''),
            'correct_answer': row.get('correct_answer', ''),
            'option_A_explanation': row.get('option_1_explanation', ''),
            'option_B_explanation': row.get('option_2_explanation', ''),
            'option_C_explanation': row.get('option_3_explanation', ''),
            'option_D_explanation': row.get('option_4_explanation', ''),
            'DOK': row.get('DOK', ''),
            'CCSS': row.get('CCSS', ''),
            'grade': row.get('grade', ''),
            'question_source': row.get('question_source', 'original' if not is_extended else 'extended'),
            'qc_score': f"{score:.2f}" if score else "N/A",
            'qc_passed': passed_qc,
            'content_hash': current_hash,
            'qc_hash': qc_hash,
            'hash_match': hash_match,
            'parent_question_id': row.get('parent_question_id', ''),
            'fix_timestamp': row.get('fix_timestamp', ''),
            'fix_strategy': row.get('fix_strategy', ''),
            'fix_run_id': row.get('fix_run_id', '')
        }
        
        output_rows.append(output_row)
    
    # Create output dataframe
    output_df = pd.DataFrame(output_rows)
    
    # Save full output
    output_df.to_csv(output_path, index=False)
    print(f"\nSaved full question bank to: {output_path}")
    
    # Create QC-passed only version
    passed_df = output_df[output_df['qc_passed'] == True]
    passed_path = Path("outputs/final_questionbank_passed.csv")
    passed_df.to_csv(passed_path, index=False)
    print(f"Saved QC-passed questions to: {passed_path}")
    
    # Print summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total questions: {total_questions}")
    print(f"  - Original: {original_count}")
    print(f"  - Extended (siblings): {extended_count}")
    print(f"\nQC Status:")
    print(f"  - Passing (>= 0.8): {passing_count} ({passing_count/total_questions*100:.1f}%)")
    print(f"  - Failing (< 0.8): {failing_count} ({failing_count/total_questions*100:.1f}%)")
    
    # Check hash matches
    hash_matches = output_df[output_df['hash_match'] == True]
    hash_mismatches = output_df[output_df['hash_match'] == False]
    print(f"\nHash Verification:")
    print(f"  - Matches: {len(hash_matches)}")
    print(f"  - Mismatches: {len(hash_mismatches)}")
    
    if len(hash_mismatches) > 0:
        print("\n  WARNING: Hash mismatches found (first 10):")
        for i, (_, row) in enumerate(hash_mismatches.head(10).iterrows()):
            print(f"    - {row['question_id']}: CSV={row['content_hash'][:8]}... QC={row['qc_hash'][:8] if row['qc_hash'] else 'N/A'}...")
    
    # Show failing questions if any
    if failing_count > 0:
        print(f"\nWARNING: Failing questions:")
        failing = output_df[output_df['qc_passed'] == False]
        for _, row in failing.iterrows():
            print(f"  - {row['question_id']}: {row['qc_score']}")
    
    print("\n" + "=" * 80)
    print("EXPORT COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()

