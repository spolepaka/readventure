#!/usr/bin/env python3
"""
Convert flat question bank CSV/JSON to nested QTI JSON format for Readventure game.

Input: comprehensive_question_bank_grade3_3277_questions.csv
Output: qti_grade_3_data.json (game-ready format)
"""

import json
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def load_csv_data(csv_path: str) -> list[dict]:
    """Load question bank from CSV file."""
    questions = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            questions.append(row)
    return questions


def convert_to_qti_format(questions: list[dict]) -> dict:
    """
    Convert flat question list to nested QTI format.
    
    Target structure:
    {
      "metadata": {...},
      "assessments": [
        {
          "identifier": "article_101001",
          "title": "...",
          "qtiVersion": "3.0",
          "test_parts": [
            {
              "sections": [
                {"title": "Guiding Questions", "items": [...]},
                {"title": "Quiz", "items": [...]}
              ]
            }
          ]
        }
      ]
    }
    """
    
    # Group questions by article
    articles = defaultdict(list)
    for q in questions:
        article_id = q['article_id']
        articles[article_id].append(q)
    
    # Build assessments list
    assessments = []
    
    for article_id in sorted(articles.keys()):
        article_questions = articles[article_id]
        
        # Get article metadata from first question
        first_q = article_questions[0]
        
        # Convert article_id from rv_article_101001 to article_101001
        clean_article_id = article_id.replace('rv_', '')
        
        # Separate guiding and quiz questions
        guiding_questions = [q for q in article_questions if q['question_category'] == 'guiding']
        quiz_questions = [q for q in article_questions if q['question_category'] == 'quiz']
        
        # Sort by section_sequence
        guiding_questions.sort(key=lambda x: int(x['section_sequence']) if x['section_sequence'] else 0)
        quiz_questions.sort(key=lambda x: int(x['article_question_sequence']) if x['article_question_sequence'] else 0)
        
        # Build sections
        sections = []
        
        # Add guiding question sections (one per section)
        for gq in guiding_questions:
            section = build_guiding_section(gq)
            sections.append(section)
        
        # Add quiz section with all quiz questions
        if quiz_questions:
            quiz_section = build_quiz_section(quiz_questions)
            sections.append(quiz_section)
        
        # Build assessment
        assessment = {
            "identifier": clean_article_id,
            "title": first_q['article_title'],
            "qtiVersion": "3.0",
            "metadata": {},
            "test_parts": [
                {
                    "identifier": "test_part_0",
                    "navigationMode": "linear",
                    "submissionMode": "individual",
                    "sections": sections
                }
            ]
        }
        
        assessments.append(assessment)
    
    # Build final QTI structure
    qti_data = {
        "metadata": {
            "total_tests": len(assessments),
            "extraction_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": "comprehensive_question_bank_grade3_3277_questions.csv",
            "total_questions": len(questions),
            "grade_filter": 3
        },
        "assessments": assessments
    }
    
    return qti_data


def build_guiding_section(q: dict) -> dict:
    """Build a guiding question section from a question dict."""
    
    # Extract section identifier
    section_id = q['section_id'].replace('rv_', '')
    stimulus_id = q['stimulus_id'].replace('rv_', '') if q['stimulus_id'] else section_id
    question_id = q['question_id'].replace('rv_', '')
    
    # Build choices
    choices = build_choices(q)
    
    # Find correct answer index (A=1, B=2, C=3, D=4)
    correct_map = {'A': '1', 'B': '2', 'C': '3', 'D': '4', '1': '1', '2': '2', '3': '3', '4': '4'}
    correct_idx = correct_map.get(q['correct_answer'], '1')
    correct_answer_id = f"answer_60010{correct_idx}"
    
    section = {
        "identifier": section_id,
        "title": "Guiding Questions",
        "sequence": int(q['section_sequence']) if q['section_sequence'] else 1,
        "items": [
            {
                "identifier": question_id,
                "title": f"Section {q['section_number']} - Guiding Question" if q['section_number'] else "Guiding Question",
                "type": "choice",
                "metadata": {
                    "DOK": int(q['DOK']) if q['DOK'] else 1,
                    "difficulty": q['difficulty'] or "medium",
                    "CCSS": q['CCSS'] or "",
                    "learningObjectiveSet": []
                },
                "stimulus": {
                    "identifier": stimulus_id,
                    "title": f"Section {int(float(q['section_number']))}" if q['section_number'] else "Section",
                    "metadata": {
                        "lexile_level": int(float(q['lexile_level'])) if q['lexile_level'] else None,
                        "course": q['course'] or "",
                        "module": q['module'] or "",
                        "section_number": int(float(q['section_number'])) if q['section_number'] else 1
                    },
                    "content_html": f"<qti-stimulus-body><div>{q['passage_text']}</div></qti-stimulus-body>",
                    "content_text": q['passage_text']
                },
                "prompt": q['question'],
                "interaction_type": "choice",
                "choices": choices,
                "correct_answers": [correct_answer_id],
                "stimulus_ref": {
                    "identifier": stimulus_id,
                    "href": f"stimuli/{stimulus_id}",
                    "title": f"Section {int(float(q['section_number']))}" if q['section_number'] else "Section"
                }
            }
        ]
    }
    
    return section


def build_quiz_section(quiz_questions: list[dict]) -> dict:
    """Build a quiz section from multiple quiz question dicts."""
    
    items = []
    for q in quiz_questions:
        question_id = q['question_id'].replace('rv_', '')
        
        # Build choices
        choices = build_choices(q)
        
        # Find correct answer index
        correct_map = {'A': '1', 'B': '2', 'C': '3', 'D': '4', '1': '1', '2': '2', '3': '3', '4': '4'}
        correct_idx = correct_map.get(q['correct_answer'], '1')
        correct_answer_id = f"answer_quiz_{correct_idx}"
        
        item = {
            "identifier": question_id,
            "title": "Quiz Question",
            "type": "choice",
            "metadata": {
                "DOK": int(q['DOK']) if q['DOK'] else 2,
                "difficulty": q['difficulty'] or "medium",
                "CCSS": q['CCSS'] or "",
                "question_source": q.get('question_source', 'original')
            },
            "prompt": q['question'],
            "interaction_type": "choice",
            "choices": choices,
            "correct_answers": [correct_answer_id]
        }
        
        items.append(item)
    
    # Get full passage from first quiz question (they all have the same combined passage)
    first_q = quiz_questions[0]
    
    section = {
        "identifier": "test_quiz",
        "title": "Quiz",
        "sequence": 5,
        "stimulus": {
            "identifier": "quiz_stimulus",
            "title": "Full Article",
            "content_text": first_q['passage_text'],
            "content_html": f"<qti-stimulus-body><div>{first_q['passage_text']}</div></qti-stimulus-body>"
        },
        "items": items
    }
    
    return section


def build_choices(q: dict) -> list[dict]:
    """Build choice list from question dict."""
    choices = []
    
    # Map correct answer to index
    correct_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, '1': 0, '2': 1, '3': 2, '4': 3}
    correct_idx = correct_map.get(q['correct_answer'], 0)
    
    for i in range(1, 5):
        option_text = q.get(f'option_{i}', '')
        explanation = q.get(f'option_{i}_explanation', '')
        
        if option_text:  # Only add if option exists
            choice = {
                "identifier": f"answer_60010{i}",
                "text": option_text,
                "feedback": explanation,
                "is_correct": (i - 1) == correct_idx
            }
            choices.append(choice)
    
    return choices


def main():
    """Main conversion process."""
    # Paths
    script_dir = Path(__file__).parent
    input_csv = script_dir / "final_deliverables_grade3" / "comprehensive_question_bank_grade3_3277_questions.csv"
    output_json = script_dir.parent / "readventure-playcademy" / "public" / "texts" / "qti_grade_3_data.json"
    
    # Also create a backup
    backup_json = script_dir.parent / "readventure-playcademy" / "public" / "texts" / "qti_grade_3_data_backup.json"
    
    print(f"Loading questions from: {input_csv}")
    questions = load_csv_data(str(input_csv))
    print(f"Loaded {len(questions)} questions")
    
    # Count unique articles
    articles = set(q['article_id'] for q in questions)
    print(f"Found {len(articles)} unique articles")
    
    # Count by category
    guiding = sum(1 for q in questions if q['question_category'] == 'guiding')
    quiz = sum(1 for q in questions if q['question_category'] == 'quiz')
    print(f"Guiding questions: {guiding}, Quiz questions: {quiz}")
    
    print("\nConverting to QTI format...")
    qti_data = convert_to_qti_format(questions)
    
    print(f"\nCreated {qti_data['metadata']['total_tests']} assessments")
    
    # Backup existing file if it exists
    if output_json.exists():
        print(f"\nBacking up existing file to: {backup_json}")
        import shutil
        shutil.copy(output_json, backup_json)
    
    # Write output
    print(f"\nWriting QTI JSON to: {output_json}")
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(qti_data, f, indent=2, ensure_ascii=False)
    
    print(f"\nDone! Output file size: {output_json.stat().st_size / 1024:.1f} KB")
    
    # Verify structure
    print("\nVerifying output structure...")
    with open(output_json, 'r') as f:
        verify_data = json.load(f)
    
    first_article = verify_data['assessments'][0]
    print(f"First article: {first_article['identifier']} - {first_article['title']}")
    sections = first_article['test_parts'][0]['sections']
    print(f"  Sections: {len(sections)}")
    for s in sections:
        print(f"    - {s['title']}: {len(s['items'])} items")


if __name__ == "__main__":
    main()
