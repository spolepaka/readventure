"""
Create Comprehensive Question Bank - Grade 3

Combines:
1. Guiding questions (original from QTI)
2. Quiz questions (original + extended siblings with Grade 3 explanations)

Organized sequentially by article, then by section sequence.
"""

import pandas as pd
import json
from datetime import datetime
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
INPUTS_DIR = SCRIPT_DIR.parent.parent / "inputs"
OUTPUTS_DIR = SCRIPT_DIR

# Input files
ORIGINAL_QUESTIONS = INPUTS_DIR / "qti_existing_questions.csv"
QUIZ_QUESTION_BANK = OUTPUTS_DIR / "question_bank_grade3_2766_questions.csv"

def load_guiding_questions():
    """Load guiding questions from original QTI data."""
    print("Loading original questions...")
    df = pd.read_csv(ORIGINAL_QUESTIONS)
    
    # Filter to guiding questions only
    guiding_df = df[df['question_category'] == 'guiding'].copy()
    print(f"  Found {len(guiding_df)} guiding questions")
    
    return guiding_df

def load_quiz_questions():
    """Load quiz questions from the Grade 3 question bank."""
    print("Loading quiz question bank...")
    df = pd.read_csv(QUIZ_QUESTION_BANK)
    print(f"  Found {len(df)} quiz questions")
    
    return df

def merge_question_banks(guiding_df, quiz_df):
    """Merge guiding and quiz questions into a single dataframe."""
    print("\nMerging question banks...")
    
    # Get the columns from quiz_df (the more comprehensive schema)
    quiz_columns = quiz_df.columns.tolist()
    
    # Ensure guiding_df has all columns (fill missing with empty)
    for col in quiz_columns:
        if col not in guiding_df.columns:
            guiding_df[col] = ""
    
    # Reorder guiding_df to match quiz_df columns
    guiding_df = guiding_df[quiz_columns]
    
    # Combine both dataframes
    combined_df = pd.concat([guiding_df, quiz_df], ignore_index=True)
    print(f"  Combined: {len(combined_df)} total questions")
    
    return combined_df

def sort_questions(df):
    """Sort questions by article_id and section_sequence."""
    print("\nSorting questions by article and section...")
    
    # Extract numeric part of article_id for proper sorting (e.g., article_101001 -> 101001)
    df['article_num'] = df['article_id'].str.extract(r'(\d+)').astype(int)
    
    # Sort by article number, then section sequence
    df = df.sort_values(
        by=['article_num', 'section_sequence', 'question_id'],
        ascending=[True, True, True]
    )
    
    # Drop the temporary sorting column
    df = df.drop(columns=['article_num'])
    
    # Reset index
    df = df.reset_index(drop=True)
    
    return df

def add_sequence_numbers(df):
    """Add global sequence number and per-article sequence number."""
    print("\nAdding sequence numbers...")
    
    # Global sequence number (1-based)
    df['global_sequence'] = range(1, len(df) + 1)
    
    # Per-article sequence number
    df['article_question_sequence'] = df.groupby('article_id').cumcount() + 1
    
    # Move these columns to the front (after article_id and article_title)
    cols = df.columns.tolist()
    cols.remove('global_sequence')
    cols.remove('article_question_sequence')
    cols.insert(2, 'global_sequence')
    cols.insert(3, 'article_question_sequence')
    df = df[cols]
    
    return df

def generate_summary(df):
    """Generate summary statistics for the question bank."""
    print("\nGenerating summary...")
    
    summary = {
        "generation_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_questions": len(df),
        "guiding_questions": len(df[df['question_category'] == 'guiding']),
        "quiz_questions": len(df[df['question_category'] == 'quiz']),
        "quiz_original": len(df[(df['question_category'] == 'quiz') & (df['question_source'] == 'original')]),
        "quiz_extended": len(df[(df['question_category'] == 'quiz') & (df['question_source'] == 'extended')]),
        "total_articles": df['article_id'].nunique(),
        "articles": []
    }
    
    # Per-article breakdown
    for article_id in sorted(df['article_id'].unique(), key=lambda x: int(x.split('_')[1])):
        article_df = df[df['article_id'] == article_id]
        article_title = article_df['article_title'].iloc[0]
        
        article_info = {
            "article_id": article_id,
            "article_title": article_title,
            "total_questions": len(article_df),
            "guiding_questions": len(article_df[article_df['question_category'] == 'guiding']),
            "quiz_questions": len(article_df[article_df['question_category'] == 'quiz']),
            "sections": article_df['section_sequence'].nunique()
        }
        summary["articles"].append(article_info)
    
    return summary

def save_outputs(df, summary):
    """Save the comprehensive question bank and summary."""
    timestamp = datetime.now().strftime("%Y%m%d")
    total_questions = len(df)
    
    # CSV output
    csv_filename = f"comprehensive_question_bank_grade3_{total_questions}_questions.csv"
    csv_path = OUTPUTS_DIR / csv_filename
    df.to_csv(csv_path, index=False)
    print(f"\nSaved: {csv_path}")
    
    # JSON output (for database upload)
    json_filename = f"comprehensive_question_bank_grade3_{total_questions}_questions.json"
    json_path = OUTPUTS_DIR / json_filename
    
    # Convert to list of records for JSON
    records = df.to_dict(orient='records')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    print(f"Saved: {json_path}")
    
    # Summary JSON
    summary_filename = "comprehensive_qb_summary.json"
    summary_path = OUTPUTS_DIR / summary_filename
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Saved: {summary_path}")
    
    return csv_path, json_path

def print_summary(summary):
    """Print summary to console."""
    print("\n" + "="*60)
    print("COMPREHENSIVE QUESTION BANK SUMMARY")
    print("="*60)
    print(f"Total Questions: {summary['total_questions']}")
    print(f"  - Guiding Questions: {summary['guiding_questions']}")
    print(f"  - Quiz Questions: {summary['quiz_questions']}")
    print(f"    - Original: {summary['quiz_original']}")
    print(f"    - Extended (Siblings): {summary['quiz_extended']}")
    print(f"\nTotal Articles: {summary['total_articles']}")
    print("\nPer-Article Breakdown (first 10):")
    print("-"*60)
    
    for article in summary['articles'][:10]:
        print(f"  {article['article_id']}: {article['article_title'][:40]}...")
        print(f"    Guiding: {article['guiding_questions']} | Quiz: {article['quiz_questions']} | Total: {article['total_questions']}")
    
    if len(summary['articles']) > 10:
        print(f"  ... and {len(summary['articles']) - 10} more articles")
    print("="*60)

def main():
    print("="*60)
    print("Creating Comprehensive Question Bank - Grade 3")
    print("="*60)
    
    # Load data
    guiding_df = load_guiding_questions()
    quiz_df = load_quiz_questions()
    
    # Merge
    combined_df = merge_question_banks(guiding_df, quiz_df)
    
    # Sort
    sorted_df = sort_questions(combined_df)
    
    # Add sequence numbers
    final_df = add_sequence_numbers(sorted_df)
    
    # Generate summary
    summary = generate_summary(final_df)
    
    # Save outputs
    csv_path, json_path = save_outputs(final_df, summary)
    
    # Print summary
    print_summary(summary)
    
    print("\nDone! Files ready for database upload.")
    return final_df, summary

if __name__ == "__main__":
    main()
