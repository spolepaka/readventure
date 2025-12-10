#!/usr/bin/env python3
"""
QTI JSON to QC Pipeline CSV Converter

Converts QTI grade data JSON files to CSV format compatible with qc_pipeline.

Usage:
    python qti_to_csv.py --input texts/qti_grade_3_data.json --output questions.csv
    python qti_to_csv.py --input texts/qti_grade_3_data.json --output questions.csv --start-article article_101001 --num-articles 5
    python qti_to_csv.py --input texts/qti_grade_3_data.json --output questions.csv --start-index 10 --num-articles 3
"""

import argparse
import json
import csv
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any


def strip_html(html_text: str) -> str:
    """Remove HTML tags and clean up text."""
    if not html_text:
        return ""
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', html_text)
    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_questions_from_assessment(assessment: Dict[str, Any], grade: int = 3) -> List[Dict[str, Any]]:
    """Extract all questions from an assessment (article)."""
    questions = []
    article_id = assessment.get('identifier', '')
    article_title = assessment.get('title', '')
    
    # First pass: collect all passages from guiding questions to build combined passage
    all_passages = []
    for test_part in assessment.get('test_parts', []):
        for section in test_part.get('sections', []):
            for item in section.get('items', []):
                stimulus = item.get('stimulus') or {}
                passage_text = stimulus.get('content_text', '') or strip_html(stimulus.get('content_html', ''))
                if passage_text and passage_text.strip():
                    all_passages.append(passage_text.strip())
    
    # Combined passage for questions without their own stimulus (e.g., quiz questions)
    combined_passage = "\n\n".join(all_passages) if all_passages else ""
    
    # Second pass: extract questions
    for test_part in assessment.get('test_parts', []):
        for section in test_part.get('sections', []):
            for item in section.get('items', []):
                # Only process choice-type questions (MCQ)
                if item.get('type') != 'choice':
                    continue
                
                question_data = extract_question_data(item, article_id, article_title, grade, combined_passage)
                if question_data:
                    questions.append(question_data)
    
    return questions


def extract_question_data(item: Dict[str, Any], article_id: str, article_title: str, grade: int, combined_passage: str = "") -> Optional[Dict[str, Any]]:
    """Extract question data from a QTI item."""
    choices = item.get('choices', [])
    if len(choices) < 2:
        return None
    
    # Get metadata
    metadata = item.get('metadata', {}) or {}
    
    # Get stimulus (passage) text - handle None case
    stimulus = item.get('stimulus') or {}
    passage_text = stimulus.get('content_text', '') or strip_html(stimulus.get('content_html', ''))
    
    # If no passage for this item, use the combined passage from all sections
    if not passage_text or not passage_text.strip():
        passage_text = combined_passage
    
    # Find correct answer and map choices to A, B, C, D
    correct_answers = item.get('correct_answers', [])
    correct_letter = None
    
    # Build options and explanations
    options = {}
    explanations = {}
    
    for i, choice in enumerate(choices[:4]):  # Limit to 4 choices
        letter = chr(65 + i)  # A, B, C, D
        options[f'option_{i+1}'] = choice.get('text', '')
        explanations[f'option_{i+1}_explanation'] = choice.get('feedback', '')
        
        # Check if this is the correct answer
        if choice.get('is_correct', False) or choice.get('identifier') in correct_answers:
            correct_letter = letter
    
    # If no correct answer found, skip this question
    if not correct_letter:
        return None
    
    return {
        'question_id': item.get('identifier', ''),
        'question': item.get('prompt', ''),
        'question_type': 'MCQ',
        **options,
        'correct_answer': correct_letter,
        'passage': passage_text,
        'CCSS': metadata.get('CCSS', ''),
        'DOK': metadata.get('DOK', ''),
        'grade': grade,
        **explanations
    }


def load_qti_json(input_path: str) -> Dict[str, Any]:
    """Load QTI JSON file."""
    with open(input_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_article_index(assessments: List[Dict], article_id: str) -> Optional[int]:
    """Find the index of an article by its identifier."""
    for i, assessment in enumerate(assessments):
        if assessment.get('identifier') == article_id:
            return i
    return None


def convert_qti_to_csv(
    input_path: str,
    output_path: str,
    start_article: Optional[str] = None,
    start_index: Optional[int] = None,
    num_articles: Optional[int] = None,
    grade: int = 3
) -> Dict[str, Any]:
    """
    Convert QTI JSON to CSV format for qc_pipeline.
    
    Args:
        input_path: Path to QTI JSON file
        output_path: Path for output CSV file
        start_article: Article identifier to start from (e.g., "article_101001")
        start_index: Index to start from (0-based), alternative to start_article
        num_articles: Number of articles to process (None = all)
        grade: Grade level to set in output
    
    Returns:
        Dictionary with statistics about the conversion
    """
    # Load JSON
    print(f"Loading QTI data from: {input_path}")
    data = load_qti_json(input_path)
    
    assessments = data.get('assessments', [])
    total_articles = len(assessments)
    print(f"Found {total_articles} articles in the file")
    
    # Determine start index
    if start_article:
        idx = get_article_index(assessments, start_article)
        if idx is None:
            print(f"Error: Article '{start_article}' not found")
            print(f"Available article IDs: {[a.get('identifier') for a in assessments[:10]]}...")
            sys.exit(1)
        start_idx = idx
        print(f"Starting from article '{start_article}' (index {start_idx})")
    elif start_index is not None:
        if start_index < 0 or start_index >= total_articles:
            print(f"Error: Start index {start_index} out of range (0-{total_articles-1})")
            sys.exit(1)
        start_idx = start_index
        print(f"Starting from index {start_idx}")
    else:
        start_idx = 0
    
    # Determine end index
    if num_articles is not None:
        end_idx = min(start_idx + num_articles, total_articles)
        print(f"Processing {end_idx - start_idx} articles (indices {start_idx} to {end_idx - 1})")
    else:
        end_idx = total_articles
        print(f"Processing all remaining articles ({end_idx - start_idx} articles)")
    
    # Extract questions from selected articles
    all_questions = []
    articles_processed = 0
    
    for i in range(start_idx, end_idx):
        assessment = assessments[i]
        article_id = assessment.get('identifier', f'article_{i}')
        questions = extract_questions_from_assessment(assessment, grade)
        
        if questions:
            all_questions.extend(questions)
            articles_processed += 1
            print(f"  [{i}] {article_id}: {len(questions)} questions")
    
    if not all_questions:
        print("No questions found in the selected articles")
        return {'articles_processed': 0, 'questions_extracted': 0}
    
    # Define CSV columns (in order) - only columns needed by qc_pipeline
    columns = [
        'question_id',
        'question',
        'question_type',
        'option_1',
        'option_2',
        'option_3',
        'option_4',
        'correct_answer',
        'passage',
        'CCSS',
        'DOK',
        'grade',
        'option_1_explanation',
        'option_2_explanation',
        'option_3_explanation',
        'option_4_explanation'
    ]
    
    # Write CSV
    print(f"\nWriting {len(all_questions)} questions to: {output_path}")
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_questions)
    
    # Print summary
    stats = {
        'articles_processed': articles_processed,
        'questions_extracted': len(all_questions),
        'start_index': start_idx,
        'end_index': end_idx - 1,
        'output_file': output_path
    }
    
    print(f"\n{'='*50}")
    print("CONVERSION COMPLETE")
    print(f"{'='*50}")
    print(f"Articles processed: {stats['articles_processed']}")
    print(f"Questions extracted: {stats['questions_extracted']}")
    print(f"Output file: {stats['output_file']}")
    print(f"\nThe CSV includes explanation columns (option_X_explanation)")
    print("and is ready for qc_pipeline with --mode both")
    
    return stats


def list_articles(input_path: str, limit: int = 20):
    """List available articles in the QTI JSON file."""
    data = load_qti_json(input_path)
    assessments = data.get('assessments', [])
    
    print(f"\nAvailable articles ({len(assessments)} total):\n")
    print(f"{'Index':<8} {'Article ID':<20} {'Title'}")
    print("-" * 80)
    
    for i, assessment in enumerate(assessments[:limit]):
        article_id = assessment.get('identifier', '')
        title = assessment.get('title', '')[:50]
        print(f"{i:<8} {article_id:<20} {title}")
    
    if len(assessments) > limit:
        print(f"\n... and {len(assessments) - limit} more articles")
    
    print(f"\nUse --start-article <article_id> or --start-index <index> to specify starting point")


def main():
    parser = argparse.ArgumentParser(
        description="Convert QTI JSON to CSV format for qc_pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert all articles
  python qti_to_csv.py --input texts/qti_grade_3_data.json --output all_questions.csv

  # Convert first 5 articles
  python qti_to_csv.py --input texts/qti_grade_3_data.json --output sample.csv --num-articles 5

  # Start from specific article ID, get 10 articles
  python qti_to_csv.py --input texts/qti_grade_3_data.json --output batch.csv --start-article article_101005 --num-articles 10

  # Start from index 20, get 5 articles
  python qti_to_csv.py --input texts/qti_grade_3_data.json --output batch.csv --start-index 20 --num-articles 5

  # List available articles
  python qti_to_csv.py --input texts/qti_grade_3_data.json --list-articles
        """
    )
    
    parser.add_argument(
        '--input', '-i',
        required=True,
        help='Path to QTI JSON file'
    )
    
    parser.add_argument(
        '--output', '-o',
        help='Path for output CSV file (required unless --list-articles)'
    )
    
    parser.add_argument(
        '--start-article',
        help='Article identifier to start from (e.g., "article_101001")'
    )
    
    parser.add_argument(
        '--start-index',
        type=int,
        help='Index to start from (0-based), alternative to --start-article'
    )
    
    parser.add_argument(
        '--num-articles', '-n',
        type=int,
        help='Number of articles to process (default: all remaining)'
    )
    
    parser.add_argument(
        '--grade', '-g',
        type=int,
        default=3,
        help='Grade level to set in output (default: 3)'
    )
    
    parser.add_argument(
        '--list-articles', '-l',
        action='store_true',
        help='List available articles and exit'
    )
    
    parser.add_argument(
        '--list-limit',
        type=int,
        default=20,
        help='Number of articles to show when listing (default: 20)'
    )
    
    args = parser.parse_args()
    
    # Validate input file exists
    if not Path(args.input).exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # List articles mode
    if args.list_articles:
        list_articles(args.input, args.list_limit)
        return
    
    # Normal conversion mode
    if not args.output:
        print("Error: --output is required (unless using --list-articles)")
        sys.exit(1)
    
    if args.start_article and args.start_index is not None:
        print("Error: Cannot use both --start-article and --start-index")
        sys.exit(1)
    
    convert_qti_to_csv(
        input_path=args.input,
        output_path=args.output,
        start_article=args.start_article,
        start_index=args.start_index,
        num_articles=args.num_articles,
        grade=args.grade
    )


if __name__ == "__main__":
    main()

