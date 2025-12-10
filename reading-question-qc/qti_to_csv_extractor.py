#!/usr/bin/env python3
"""
QTI to CSV Extractor

Extracts questions from QTI JSON format to a flat CSV format
that can be used for question bank extension and QC pipeline.

Usage:
    python qti_to_csv_extractor.py --input texts/qti_grade_3_data.json --output qti_existing_questions.csv
"""

import json
import csv
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional


def extract_choice_text(choices: List[Dict], identifier: str) -> str:
    """Extract choice text by identifier."""
    for choice in choices:
        if choice.get('identifier') == identifier:
            return choice.get('text', '')
    return ''


def extract_choice_feedback(choices: List[Dict], identifier: str) -> str:
    """Extract choice feedback by identifier."""
    for choice in choices:
        if choice.get('identifier') == identifier:
            return choice.get('feedback', '')
    return ''


def get_choice_by_index(choices: List[Dict], index: int) -> Dict:
    """Get choice by index (0-3 for A-D)."""
    if index < len(choices):
        return choices[index]
    return {}


def extract_questions_from_qti(qti_data: Dict) -> List[Dict]:
    """
    Extract all questions from QTI JSON into flat records.
    
    Returns list of dicts with columns matching QC pipeline format.
    """
    records = []
    
    for assessment in qti_data.get('assessments', []):
        article_id = assessment.get('identifier', '')
        article_title = assessment.get('title', '')
        
        for test_part in assessment.get('test_parts', []):
            for section in test_part.get('sections', []):
                section_id = section.get('identifier', '')
                section_title = section.get('title', '')
                section_sequence = section.get('sequence', 0)
                
                # Determine question type (guiding vs quiz)
                if 'guiding' in section_id.lower():
                    question_category = 'guiding'
                elif 'quiz' in section_id.lower():
                    question_category = 'quiz'
                else:
                    question_category = 'other'
                
                for item in section.get('items', []):
                    # Extract basic info
                    question_id = item.get('identifier', '')
                    item_title = item.get('title', '')
                    item_type = item.get('type', 'choice')
                    
                    # Extract metadata
                    metadata = item.get('metadata', {})
                    dok = metadata.get('DOK', '')
                    difficulty = metadata.get('difficulty', '')
                    ccss = metadata.get('CCSS', '')
                    
                    # Extract stimulus/passage
                    stimulus = item.get('stimulus', {})
                    if stimulus:
                        passage_text = stimulus.get('content_text', '')
                        stimulus_id = stimulus.get('identifier', '')
                        stimulus_metadata = stimulus.get('metadata', {})
                        lexile_level = stimulus_metadata.get('lexile_level', '')
                        course = stimulus_metadata.get('course', '')
                        module = stimulus_metadata.get('module', '')
                        section_number = stimulus_metadata.get('section_number', '')
                    else:
                        # Quiz questions may reference stimulus
                        stimulus_ref = item.get('stimulus_ref', {})
                        stimulus_id = stimulus_ref.get('identifier', '') if stimulus_ref else ''
                        passage_text = ''  # Will need to be filled from reference
                        lexile_level = ''
                        course = ''
                        module = ''
                        section_number = ''
                    
                    # Extract question prompt
                    prompt = item.get('prompt', '')
                    
                    # Extract choices (assume 4 choices: A, B, C, D)
                    choices = item.get('choices', [])
                    
                    # Map choices to A, B, C, D
                    choice_a = get_choice_by_index(choices, 0)
                    choice_b = get_choice_by_index(choices, 1)
                    choice_c = get_choice_by_index(choices, 2)
                    choice_d = get_choice_by_index(choices, 3)
                    
                    # Find correct answer
                    correct_answers = item.get('correct_answers', [])
                    correct_identifier = correct_answers[0] if correct_answers else ''
                    
                    # Map correct identifier to A/B/C/D
                    correct_letter = ''
                    for i, choice in enumerate(choices):
                        if choice.get('identifier') == correct_identifier:
                            correct_letter = chr(65 + i)  # A=65, B=66, etc.
                            break
                    
                    # Build record
                    record = {
                        # Identifiers
                        'article_id': article_id,
                        'article_title': article_title,
                        'section_id': section_id,
                        'section_sequence': section_sequence,
                        'question_id': question_id,
                        'question_category': question_category,  # guiding or quiz
                        
                        # Passage info
                        'stimulus_id': stimulus_id,
                        'passage_text': passage_text,
                        'lexile_level': lexile_level,
                        'course': course,
                        'module': module,
                        'section_number': section_number,
                        
                        # Question content
                        'question': prompt,
                        'question_type': 'MCQ',  # For QC pipeline
                        
                        # Choices (QC pipeline format)
                        'option_1': choice_a.get('text', ''),
                        'option_2': choice_b.get('text', ''),
                        'option_3': choice_c.get('text', ''),
                        'option_4': choice_d.get('text', ''),
                        
                        # Correct answer
                        'correct_answer': correct_letter,
                        
                        # Feedback/Explanations (QC pipeline format)
                        'option_1_explanation': choice_a.get('feedback', ''),
                        'option_2_explanation': choice_b.get('feedback', ''),
                        'option_3_explanation': choice_c.get('feedback', ''),
                        'option_4_explanation': choice_d.get('feedback', ''),
                        
                        # Metadata
                        'DOK': dok,
                        'difficulty': difficulty,
                        'CCSS': ccss,
                        'grade': 3,  # From qti metadata
                    }
                    
                    records.append(record)
    
    return records


def fill_quiz_passages(records: List[Dict]) -> List[Dict]:
    """
    Fill in passage_text for quiz questions that reference stimuli.
    Quiz questions reference passages from guiding sections.
    """
    # Build stimulus lookup from guiding questions
    stimulus_lookup = {}
    for record in records:
        if record['question_category'] == 'guiding' and record['passage_text']:
            stimulus_lookup[record['stimulus_id']] = record['passage_text']
    
    # For quiz questions, we need to combine all section passages
    # Group passages by article
    article_passages = {}
    for record in records:
        if record['question_category'] == 'guiding' and record['passage_text']:
            article_id = record['article_id']
            if article_id not in article_passages:
                article_passages[article_id] = []
            article_passages[article_id].append({
                'sequence': record['section_sequence'],
                'text': record['passage_text']
            })
    
    # Sort and combine passages for each article
    combined_passages = {}
    for article_id, passages in article_passages.items():
        sorted_passages = sorted(passages, key=lambda x: x['sequence'])
        combined_passages[article_id] = '\n\n---\n\n'.join(p['text'] for p in sorted_passages)
    
    # Fill quiz question passages
    for record in records:
        if record['question_category'] == 'quiz' and not record['passage_text']:
            record['passage_text'] = combined_passages.get(record['article_id'], '')
    
    return records


def main():
    parser = argparse.ArgumentParser(description='Extract QTI JSON to CSV format')
    parser.add_argument('--input', '-i', required=True, help='Input QTI JSON file')
    parser.add_argument('--output', '-o', required=True, help='Output CSV file')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    # Load QTI JSON
    print(f"Loading QTI data from {args.input}...")
    with open(args.input, 'r', encoding='utf-8') as f:
        qti_data = json.load(f)
    
    # Extract questions
    print("Extracting questions...")
    records = extract_questions_from_qti(qti_data)
    
    # Fill quiz passages
    print("Filling quiz passages...")
    records = fill_quiz_passages(records)
    
    # Count stats
    guiding_count = sum(1 for r in records if r['question_category'] == 'guiding')
    quiz_count = sum(1 for r in records if r['question_category'] == 'quiz')
    articles = len(set(r['article_id'] for r in records))
    
    print(f"\nExtracted:")
    print(f"  Articles: {articles}")
    print(f"  Guiding questions: {guiding_count}")
    print(f"  Quiz questions: {quiz_count}")
    print(f"  Total: {len(records)}")
    
    # Write CSV
    print(f"\nWriting to {args.output}...")
    
    fieldnames = [
        'article_id', 'article_title', 'section_id', 'section_sequence',
        'question_id', 'question_category', 'stimulus_id',
        'passage_text', 'lexile_level', 'course', 'module', 'section_number',
        'question', 'question_type',
        'option_1', 'option_2', 'option_3', 'option_4',
        'correct_answer',
        'option_1_explanation', 'option_2_explanation', 
        'option_3_explanation', 'option_4_explanation',
        'DOK', 'difficulty', 'CCSS', 'grade'
    ]
    
    with open(args.output, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)
    
    print(f"Done! Wrote {len(records)} records to {args.output}")
    
    if args.verbose:
        # Show sample
        print("\nSample record:")
        sample = records[0]
        for key, value in sample.items():
            if key == 'passage_text':
                print(f"  {key}: {value[:100]}..." if len(str(value)) > 100 else f"  {key}: {value}")
            elif key.endswith('_explanation'):
                print(f"  {key}: {value[:80]}..." if len(str(value)) > 80 else f"  {key}: {value}")
            else:
                print(f"  {key}: {value}")


if __name__ == '__main__':
    main()

