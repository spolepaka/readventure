#!/usr/bin/env python3
"""
Context Gatherer Module

Gathers all necessary context for fixing a question:
- Original question data from CSV
- Existing questions for uniqueness checking
- Passage text
- Metadata (DOK, CCSS, grade)
"""

import logging
from typing import Dict, Any, List, Optional
import pandas as pd

logger = logging.getLogger(__name__)


def load_questions_csv(csv_path: str) -> pd.DataFrame:
    """Load the questions CSV file."""
    df = pd.read_csv(csv_path)
    logger.info(f"Loaded {len(df)} questions from {csv_path}")
    return df


def get_question_data(question_id: str, questions_df: pd.DataFrame) -> Optional[Dict[str, Any]]:
    """
    Get full question data from CSV by question_id.
    
    Returns:
        Dict with all question fields, or None if not found
    """
    mask = questions_df['question_id'] == question_id
    matches = questions_df[mask]
    
    if len(matches) == 0:
        logger.warning(f"Question {question_id} not found in CSV")
        return None
    
    row = matches.iloc[0]
    return row.to_dict()


def get_existing_questions(
    article_id: str,
    questions_df: pd.DataFrame,
    exclude_question_id: Optional[str] = None,
    dok: Optional[str] = None,
    ccss: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Get existing questions for an article (for uniqueness checking).
    
    Args:
        article_id: The article ID to filter by
        questions_df: The questions DataFrame
        exclude_question_id: Question ID to exclude (the one being fixed)
        dok: Optional DOK level to filter by
        ccss: Optional CCSS standard to filter by
    
    Returns:
        List of question dicts
    """
    mask = questions_df['article_id'] == article_id
    
    if exclude_question_id:
        mask &= questions_df['question_id'] != exclude_question_id
    
    if dok:
        mask &= questions_df['DOK'].astype(str) == str(dok)
    
    if ccss:
        mask &= questions_df['CCSS'] == ccss
    
    existing = questions_df[mask]
    
    result = []
    for _, row in existing.iterrows():
        result.append({
            'question_id': row.get('question_id', ''),
            'question': row.get('question', ''),
            'DOK': row.get('DOK', ''),
            'CCSS': row.get('CCSS', ''),
            'correct_answer': row.get('correct_answer', ''),
            'option_1': row.get('option_1', ''),
            'option_2': row.get('option_2', ''),
            'option_3': row.get('option_3', ''),
            'option_4': row.get('option_4', '')
        })
    
    logger.debug(f"Found {len(result)} existing questions for article {article_id}")
    return result


def format_existing_questions(existing_questions: List[Dict[str, Any]]) -> str:
    """
    Format existing questions for inclusion in prompt.
    
    Returns:
        Formatted string listing all existing questions
    """
    if not existing_questions:
        return "No existing questions for this article."
    
    lines = []
    for i, q in enumerate(existing_questions, 1):
        question_text = q.get('question', '')[:100]  # Truncate long questions
        if len(q.get('question', '')) > 100:
            question_text += "..."
        
        lines.append(f"{i}. [{q.get('DOK', '?')}] [{q.get('CCSS', '?')}] {question_text}")
    
    return "\n".join(lines)


def get_question_context(
    question_id: str,
    questions_df: pd.DataFrame,
    include_existing: bool = True
) -> Dict[str, Any]:
    """
    Get complete context for a question.
    
    Returns:
        Dict with:
        - question_data: All fields from CSV
        - passage_text: The passage text
        - existing_questions: Other questions for same article (if include_existing)
        - formatted_existing: Formatted string of existing questions
    """
    question_data = get_question_data(question_id, questions_df)
    
    if question_data is None:
        return None
    
    context = {
        'question_data': question_data,
        'passage_text': question_data.get('passage_text', ''),
        'article_id': question_data.get('article_id', ''),
        'question_text': question_data.get('question', ''),
        'options': {
            'A': question_data.get('option_1', ''),
            'B': question_data.get('option_2', ''),
            'C': question_data.get('option_3', ''),
            'D': question_data.get('option_4', '')
        },
        'correct_answer': question_data.get('correct_answer', ''),
        'explanations': {
            'A': question_data.get('option_1_explanation', ''),
            'B': question_data.get('option_2_explanation', ''),
            'C': question_data.get('option_3_explanation', ''),
            'D': question_data.get('option_4_explanation', '')
        },
        'DOK': question_data.get('DOK', ''),
        'CCSS': question_data.get('CCSS', ''),
        'grade': question_data.get('grade', ''),
        'parent_question_id': question_data.get('parent_question_id', ''),
        'question_type': question_data.get('question_type', 'MCQ')
    }
    
    if include_existing:
        existing = get_existing_questions(
            article_id=context['article_id'],
            questions_df=questions_df,
            exclude_question_id=question_id
        )
        context['existing_questions'] = existing
        context['formatted_existing'] = format_existing_questions(existing)
    
    return context


def get_correct_option_info(context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get information about the correct answer option.
    
    Returns:
        Dict with correct_letter, correct_text, distractors
    """
    correct_answer = context.get('correct_answer', '')
    options = context.get('options', {})
    
    # Map correct_answer to letter (could be "A", "B", "1", "2", etc.)
    letter_map = {'1': 'A', '2': 'B', '3': 'C', '4': 'D', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}
    correct_letter = letter_map.get(str(correct_answer).upper(), correct_answer)
    
    correct_text = options.get(correct_letter, '')
    
    distractors = {
        letter: text
        for letter, text in options.items()
        if letter != correct_letter
    }
    
    return {
        'correct_letter': correct_letter,
        'correct_text': correct_text,
        'distractors': distractors
    }


if __name__ == "__main__":
    # Test the module
    import sys
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 3:
        print("Usage: python context_gatherer.py <questions.csv> <question_id>")
        sys.exit(1)
    
    df = load_questions_csv(sys.argv[1])
    context = get_question_context(sys.argv[2], df)
    
    if context:
        print(f"\nContext for {sys.argv[2]}:")
        print(f"  Article: {context['article_id']}")
        print(f"  Question: {context['question_text'][:80]}...")
        print(f"  Correct: {context['correct_answer']}")
        print(f"  DOK: {context['DOK']}, CCSS: {context['CCSS']}")
        print(f"  Existing questions: {len(context.get('existing_questions', []))}")
    else:
        print(f"Question {sys.argv[2]} not found")

