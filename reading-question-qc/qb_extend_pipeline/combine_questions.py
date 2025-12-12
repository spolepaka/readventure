#!/usr/bin/env python3
"""
Combine original questions with extended/sibling questions into a single CSV.

This script:
1. Reads the extended questions CSV (test_extended.csv)
2. Extracts the parent question IDs to find originals
3. Reads the original questions from qti_existing_questions.csv
4. Combines both into a new CSV with all questions
"""

import pandas as pd
import argparse
from pathlib import Path


def combine_questions(
    extended_csv: str,
    original_csv: str,
    output_csv: str
) -> None:
    """
    Combine original and extended questions into a single CSV.
    
    Args:
        extended_csv: Path to the extended questions CSV
        original_csv: Path to the original questions CSV  
        output_csv: Path for the combined output CSV
    """
    print(f"Reading extended questions from: {extended_csv}")
    extended_df = pd.read_csv(extended_csv)
    print(f"  Found {len(extended_df)} extended questions")
    
    # Get unique parent question IDs
    parent_ids = extended_df['parent_question_id'].dropna().unique()
    print(f"  Found {len(parent_ids)} unique parent question IDs")
    
    print(f"\nReading original questions from: {original_csv}")
    original_df = pd.read_csv(original_csv)
    print(f"  Total original questions: {len(original_df)}")
    
    # Filter to only the parent questions that were extended
    original_parents_df = original_df[original_df['question_id'].isin(parent_ids)].copy()
    print(f"  Matched parent questions: {len(original_parents_df)}")
    
    # Add columns that exist in extended but not in original (fill with empty)
    extended_only_cols = [col for col in extended_df.columns if col not in original_df.columns]
    for col in extended_only_cols:
        original_parents_df[col] = ''
    
    # Mark question source for clarity
    original_parents_df['question_source'] = 'original'
    extended_df['question_source'] = 'extended'
    
    # Get all columns (union of both dataframes plus question_source)
    all_columns = list(extended_df.columns) + ['question_source']
    # Remove duplicates while preserving order
    all_columns = list(dict.fromkeys(all_columns))
    
    # Reorder both dataframes to have the same columns
    original_parents_df = original_parents_df.reindex(columns=all_columns)
    extended_df = extended_df.reindex(columns=all_columns)
    
    # Combine: originals first, then their extended siblings
    # Sort by section_id and question_id to keep related questions together
    combined_df = pd.concat([original_parents_df, extended_df], ignore_index=True)
    
    # Sort to group originals with their siblings
    combined_df = combined_df.sort_values(
        by=['article_id', 'section_sequence', 'question_id'],
        key=lambda x: x.astype(str)
    ).reset_index(drop=True)
    
    # Save combined CSV
    print(f"\nSaving combined questions to: {output_csv}")
    combined_df.to_csv(output_csv, index=False)
    print(f"  Total questions in combined file: {len(combined_df)}")
    print(f"    - Original questions: {len(original_parents_df)}")
    print(f"    - Extended questions: {len(extended_df)}")
    
    # Print summary by article
    print("\n--- Summary by Article ---")
    summary = combined_df.groupby(['article_id', 'question_source']).size().unstack(fill_value=0)
    print(summary)


def main():
    parser = argparse.ArgumentParser(
        description='Combine original and extended questions into a single CSV'
    )
    parser.add_argument(
        '--extended', '-e',
        type=str,
        default='outputs/test_extended.csv',
        help='Path to extended questions CSV (default: outputs/test_extended.csv)'
    )
    parser.add_argument(
        '--original', '-o',
        type=str,
        default='inputs/qti_existing_questions.csv',
        help='Path to original questions CSV (default: inputs/qti_existing_questions.csv)'
    )
    parser.add_argument(
        '--output', '-out',
        type=str,
        default='outputs/test_combined.csv',
        help='Path for output combined CSV (default: outputs/test_combined.csv)'
    )
    
    args = parser.parse_args()
    
    # Resolve paths relative to script location
    script_dir = Path(__file__).parent
    extended_path = script_dir / args.extended if not Path(args.extended).is_absolute() else Path(args.extended)
    original_path = script_dir / args.original if not Path(args.original).is_absolute() else Path(args.original)
    output_path = script_dir / args.output if not Path(args.output).is_absolute() else Path(args.output)
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    combine_questions(
        extended_csv=str(extended_path),
        original_csv=str(original_path),
        output_csv=str(output_path)
    )
    
    print("\n✓ Done!")


if __name__ == '__main__':
    main()

