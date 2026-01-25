#!/usr/bin/env python3
"""
Alpha Read Course Builder

This script builds or updates an Alpha Read course in Timeback by:
1. Reading question bank data from final_deliverables_grade3/
2. Creating/updating QTI content (stimuli, assessment items, assessment tests)
3. Creating/updating OneRoster course structure (course, components, resources)

Usage:
    # Build new course from scratch
    python build_course.py --mode create --grade 3
    
    # Update existing course with new questions
    python build_course.py --mode update --course-id <course_id>
    
    # Dry run (no API calls)
    python build_course.py --mode create --grade 3 --dry-run
    
    # Limit articles for testing
    python build_course.py --mode create --grade 3 --limit-articles 5

Based on documentation:
- COURSE-STRUCTURE-BREAKDOWN.md: Data structure and hierarchy
- Creating a new Alpha Read Article.md: ID conventions and Alpha Read patterns
- TIMEBACK_QTI_POWERPATH_GUIDE.md: API endpoints and payloads
"""

import os
import json
import requests
import argparse
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import time
import logging
import sys
from pathlib import Path


# =============================================================================
# Configuration
# =============================================================================

# API Configuration
QTI_API_BASE_URL = "https://qti.alpha-1edtech.ai/api"
ONEROSTER_API_BASE_URL = "https://api.alpha-1edtech.ai"
COGNITO_URL = "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token"

# Default credentials (can be overridden by environment variables)
CLIENT_ID = os.getenv("TIMEBACK_CLIENT_ID", "31rkusu8sloquan3cmcb9p8v33")
CLIENT_SECRET = os.getenv("TIMEBACK_CLIENT_SECRET", "1vv89lcl7lfu151ruccfts4hauefc0r1epdvaotbrgupvcif4cor")

# Paths
SCRIPT_DIR = Path(__file__).parent
DELIVERABLES_DIR = SCRIPT_DIR / "final_deliverables_grade3"
QUESTION_BANK_FILE = DELIVERABLES_DIR / "comprehensive_question_bank_grade3_3277_questions.json"
SUMMARY_FILE = DELIVERABLES_DIR / "comprehensive_qb_summary.json"

# Logging
LOG_FILE = SCRIPT_DIR / "build_course.log"

# Global state
logger = None
access_token = None
dry_run = False


# =============================================================================
# Logging Setup
# =============================================================================

def setup_logging(verbose: bool = False):
    """Setup logging to both file and console."""
    global logger
    logger = logging.getLogger('course_builder')
    logger.setLevel(logging.DEBUG)
    logger.handlers = []
    
    # File handler
    file_handler = logging.FileHandler(LOG_FILE, mode='a', encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    console_handler.setFormatter(logging.Formatter('%(message)s'))
    
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


# =============================================================================
# Authentication
# =============================================================================

def get_oauth_token() -> str:
    """Get OAuth access token from Cognito."""
    global access_token
    
    if access_token:
        return access_token
    
    logger.info("🔑 Obtaining OAuth token...")
    
    response = requests.post(
        COGNITO_URL,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET
        },
        timeout=30
    )
    response.raise_for_status()
    access_token = response.json()["access_token"]
    logger.info("✅ Token obtained successfully")
    return access_token


def get_auth_headers() -> Dict:
    """Get authorization headers for API requests."""
    token = get_oauth_token()
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


# =============================================================================
# Data Loading
# =============================================================================

def load_question_bank() -> List[Dict]:
    """Load the comprehensive question bank JSON."""
    logger.info(f"📂 Loading question bank from {QUESTION_BANK_FILE}")
    
    with open(QUESTION_BANK_FILE, 'r', encoding='utf-8') as f:
        questions = json.load(f)
    
    logger.info(f"✅ Loaded {len(questions)} questions")
    return questions


def load_summary() -> Dict:
    """Load the question bank summary."""
    with open(SUMMARY_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def group_questions_by_article(questions: List[Dict]) -> Dict[str, Dict]:
    """
    Group questions by article and organize into Alpha Read structure.
    
    Returns:
        {
            "article_101001": {
                "article_id": "article_101001",
                "article_title": "Aladdin...",
                "guiding_questions": [list of guiding questions by section],
                "quiz_questions": [list of quiz questions],
                "stimuli": {section_id: passage_text, ...}
            }
        }
    """
    articles = {}
    
    for q in questions:
        article_id = q['article_id']
        
        if article_id not in articles:
            articles[article_id] = {
                "article_id": article_id,
                "article_title": q.get('article_title', ''),
                "course": q.get('course', ''),
                "module": q.get('module', ''),
                "guiding_questions": [],
                "quiz_questions": [],
                "stimuli": {}
            }
        
        article = articles[article_id]
        
        if q['question_category'] == 'guiding':
            article['guiding_questions'].append(q)
            # Store stimulus text for this section
            stimulus_id = q.get('stimulus_id', '')
            if stimulus_id and q.get('passage_text'):
                article['stimuli'][stimulus_id] = q['passage_text']
        else:
            article['quiz_questions'].append(q)
    
    # Sort questions within each article
    for article in articles.values():
        article['guiding_questions'].sort(key=lambda x: int(x.get('section_sequence', 0)))
        article['quiz_questions'].sort(key=lambda x: int(x.get('article_question_sequence', 0)))
    
    logger.info(f"📊 Organized questions into {len(articles)} articles")
    return articles


# =============================================================================
# ID Conversion Helpers
# =============================================================================

def correct_answer_to_identifier(correct_answer: str, question_id: str) -> str:
    """
    Convert correct answer (A/B/C/D or 1/2/3/4) to answer identifier.
    
    Alpha Read convention: answer_<6-digit-number>
    We derive from question_id to ensure uniqueness.
    """
    # Extract numeric part from question_id
    # e.g., "guiding_21014_302001" -> base is 302001
    # e.g., "quiz_302005" -> base is 302005
    parts = question_id.split('_')
    if len(parts) >= 2:
        base_num = int(parts[-1])
    else:
        base_num = hash(question_id) % 900000 + 100000
    
    # Map A/B/C/D or 1/2/3/4 to offset
    answer_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, '1': 0, '2': 1, '3': 2, '4': 3}
    offset = answer_map.get(str(correct_answer).upper(), 0)
    
    # Generate answer identifiers (base * 10 + offset for uniqueness)
    return f"answer_{base_num * 10 + offset}"


def get_answer_identifiers(question_id: str) -> List[str]:
    """Generate 4 answer identifiers for a question."""
    parts = question_id.split('_')
    if len(parts) >= 2:
        base_num = int(parts[-1])
    else:
        base_num = hash(question_id) % 900000 + 100000
    
    return [f"answer_{base_num * 10 + i}" for i in range(4)]


# =============================================================================
# QTI API Functions - Create
# =============================================================================

def create_stimulus(stimulus_id: str, title: str, content: str, metadata: Dict = None) -> Optional[Dict]:
    """
    Create a QTI stimulus (reading passage).
    
    Endpoint: POST /api/stimuli
    """
    if dry_run:
        logger.debug(f"    [DRY RUN] Would create stimulus: {stimulus_id}")
        return {"identifier": stimulus_id, "title": title}
    
    logger.debug(f"    📄 Creating stimulus: {stimulus_id}")
    
    # Format content as HTML
    html_content = format_stimulus_html(content, title)
    
    payload = {
        "format": "json",
        "identifier": stimulus_id,
        "title": title,
        "content": html_content,
        "metadata": metadata or {}
    }
    
    try:
        response = requests.post(
            f"{QTI_API_BASE_URL}/stimuli",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"    ✅ Stimulus created: {stimulus_id}")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 409:  # Conflict - already exists
            logger.debug(f"    ⚠️ Stimulus already exists: {stimulus_id}")
            return {"identifier": stimulus_id, "title": title, "exists": True}
        logger.error(f"    ❌ Error creating stimulus {stimulus_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"    ❌ Error creating stimulus {stimulus_id}: {e}")
        return None


def format_stimulus_html(content: str, title: str = "") -> str:
    """Format plain text content as HTML for stimulus."""
    # Clean up the content
    content = content.strip()
    
    # Split into paragraphs
    paragraphs = content.split('\n\n')
    if len(paragraphs) == 1:
        paragraphs = content.split('\n')
    
    # Build HTML
    html_parts = ['<div class="stimulus-content">']
    
    for i, para in enumerate(paragraphs):
        para = para.strip()
        if para and para != '---':
            # Check if it looks like a title (first paragraph, short)
            if i == 0 and len(para) < 100 and '\n' not in para:
                html_parts.append(f'<h2>{para}</h2>')
            else:
                html_parts.append(f'<p>{para}</p>')
    
    html_parts.append('</div>')
    return '\n'.join(html_parts)


def create_assessment_item(question: Dict, stimulus_ref: Optional[str] = None) -> Optional[Dict]:
    """
    Create a QTI assessment item (question).
    
    Endpoint: POST /api/assessment-items
    """
    question_id = question['question_id']
    
    if dry_run:
        logger.debug(f"    [DRY RUN] Would create assessment item: {question_id}")
        return {"identifier": question_id}
    
    logger.debug(f"    ❓ Creating assessment item: {question_id}")
    
    # Get answer identifiers
    answer_ids = get_answer_identifiers(question_id)
    
    # Determine correct answer identifier
    correct_answer = question.get('correct_answer', 'A')
    correct_id = correct_answer_to_identifier(correct_answer, question_id)
    
    # Build choices
    choices = []
    for i in range(4):
        option_key = f"option_{i+1}"
        explanation_key = f"option_{i+1}_explanation"
        
        option_text = question.get(option_key, f"Option {i+1}")
        explanation = question.get(explanation_key, "")
        
        choices.append({
            "identifier": answer_ids[i],
            "content": option_text,
            "feedbackInline": explanation,
            "feedbackOutcomeIdentifier": "FEEDBACK-INLINE"
        })
    
    # Build payload
    payload = {
        "format": "json",
        "identifier": question_id,
        "type": "choice",
        "title": question.get('question', '')[:100],  # Title limited
        "metadata": {
            "CCSS": question.get('CCSS', ''),
            "DOK": question.get('DOK', ''),
            "difficulty": question.get('difficulty', ''),
            "grade": question.get('grade', '3'),
            "question_category": question.get('question_category', '')
        },
        "interaction": {
            "type": "choice",
            "responseIdentifier": "RESPONSE",
            "shuffle": False,
            "maxChoices": 1,
            "questionStructure": {
                "prompt": question.get('question', ''),
                "choices": choices
            }
        },
        "responseDeclarations": [
            {
                "identifier": "RESPONSE",
                "cardinality": "single",
                "baseType": "identifier",
                "correctResponse": {
                    "value": [correct_id]
                }
            }
        ],
        "outcomeDeclarations": [
            {"identifier": "FEEDBACK", "cardinality": "single", "baseType": "identifier"},
            {"identifier": "FEEDBACK-INLINE", "cardinality": "single", "baseType": "identifier"}
        ],
        "responseProcessing": {
            "templateType": "match_correct",
            "responseDeclarationIdentifier": "RESPONSE",
            "outcomeIdentifier": "FEEDBACK",
            "correctResponseIdentifier": "CORRECT",
            "incorrectResponseIdentifier": "INCORRECT"
        },
        "feedbackBlock": [],
        "rubrics": []
    }
    
    # Add stimulus reference for guiding questions
    if stimulus_ref:
        payload["stimulus"] = {"identifier": stimulus_ref}
    
    try:
        response = requests.post(
            f"{QTI_API_BASE_URL}/assessment-items",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"    ✅ Assessment item created: {question_id}")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 409:
            logger.debug(f"    ⚠️ Assessment item already exists: {question_id}")
            return {"identifier": question_id, "exists": True}
        logger.error(f"    ❌ Error creating assessment item {question_id}: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.debug(f"    Response: {e.response.text[:500]}")
        return None
    except Exception as e:
        logger.error(f"    ❌ Error creating assessment item {question_id}: {e}")
        return None


def create_assessment_test(article: Dict) -> Optional[Dict]:
    """
    Create a QTI assessment test (article).
    
    Endpoint: POST /api/assessment-tests
    """
    article_id = article['article_id']
    
    if dry_run:
        logger.info(f"  [DRY RUN] Would create assessment test: {article_id}")
        return {"identifier": article_id}
    
    logger.info(f"  📋 Creating assessment test: {article_id}")
    
    # Build sections
    sections = []
    
    # Add guiding question sections
    guiding_by_stimulus = {}
    for q in article['guiding_questions']:
        stimulus_id = q.get('stimulus_id', '')
        if stimulus_id not in guiding_by_stimulus:
            guiding_by_stimulus[stimulus_id] = []
        guiding_by_stimulus[stimulus_id].append(q)
    
    sequence = 1
    for stimulus_id, questions in sorted(guiding_by_stimulus.items()):
        section = {
            "identifier": f"test_{stimulus_id}",
            "title": "Guiding Questions",
            "visible": True,
            "required": True,
            "fixed": False,
            "sequence": sequence,
            "qti-assessment-item-ref": [
                {"identifier": q['question_id']} for q in questions
            ]
        }
        sections.append(section)
        sequence += 1
    
    # Add quiz section
    if article['quiz_questions']:
        quiz_section = {
            "identifier": "test_quiz",
            "title": "Quiz",
            "visible": True,
            "required": True,
            "fixed": False,
            "sequence": sequence,
            "qti-assessment-item-ref": [
                {"identifier": q['question_id']} for q in article['quiz_questions']
            ]
        }
        sections.append(quiz_section)
    
    # Build payload
    payload = {
        "identifier": article_id,
        "title": article['article_title'],
        "toolName": "playcademy-course-builder",
        "toolVersion": "1.0.0",
        "qtiVersion": "3.0",
        "metadata": {
            "grade": "3",
            "course": article.get('course', ''),
            "module": article.get('module', '')
        },
        "qti-test-part": [
            {
                "identifier": "test_part_0",
                "navigationMode": "linear",
                "submissionMode": "individual",
                "qti-assessment-section": sections
            }
        ],
        "qti-outcome-declaration": [
            {"identifier": "SCORE", "cardinality": "single", "baseType": "float"}
        ]
    }
    
    try:
        response = requests.post(
            f"{QTI_API_BASE_URL}/assessment-tests",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.info(f"  ✅ Assessment test created: {article_id}")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 409:
            logger.info(f"  ⚠️ Assessment test already exists: {article_id}")
            return {"identifier": article_id, "exists": True}
        logger.error(f"  ❌ Error creating assessment test {article_id}: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.debug(f"  Response: {e.response.text[:500]}")
        return None
    except Exception as e:
        logger.error(f"  ❌ Error creating assessment test {article_id}: {e}")
        return None


# =============================================================================
# OneRoster API Functions
# =============================================================================

def create_oneroster_resource(article: Dict, xp: int = 15) -> Optional[Dict]:
    """
    Create a OneRoster resource pointing to the QTI assessment test.
    
    Endpoint: POST /ims/oneroster/resources/v1p2/resources/
    """
    article_id = article['article_id']
    
    if dry_run:
        logger.debug(f"    [DRY RUN] Would create resource: {article_id}")
        return {"sourcedId": article_id}
    
    logger.debug(f"    📦 Creating resource: {article_id}")
    
    # Extract numeric ID from article_id (e.g., "article_101001" -> "101001")
    vendor_resource_id = article_id.replace("article_", "")
    
    payload = {
        "resource": {
            "sourcedId": article_id,
            "status": "active",
            "title": article['article_title'],
            "roles": ["primary"],
            "importance": "primary",
            "vendorResourceId": vendor_resource_id,
            "vendorId": "playcademy-course-builder",
            "applicationId": "playcademy-course-builder-1.0.0",
            "metadata": {
                "type": "qti",
                "subType": "qti-test",
                "lessonType": "alpha-read-article",
                "url": f"{QTI_API_BASE_URL}/assessment-tests/{article_id}",
                "xp": xp,
                "questionType": "custom"
            }
        }
    }
    
    try:
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/resources/v1p2/resources",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"    ✅ Resource created: {article_id}")
        return response.json()
    except requests.exceptions.HTTPError as e:
        # API returns 404 or 409 when resource already exists
        if e.response.status_code in [404, 409]:
            try:
                error_msg = e.response.json().get('imsx_description', '')
                if 'already exists' in error_msg.lower():
                    logger.debug(f"    ⚠️ Resource already exists: {article_id}")
                    return {"sourcedId": article_id, "exists": True}
            except:
                pass
        logger.error(f"    ❌ Error creating resource {article_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"    ❌ Error creating resource {article_id}: {e}")
        return None


def create_component_resource(
    article: Dict,
    component_id: str,
    sort_order: int
) -> Optional[Dict]:
    """
    Create a OneRoster component resource linking article to course component.
    
    Endpoint: POST /ims/oneroster/rostering/v1p2/courses/component-resources
    """
    article_id = article['article_id']
    comp_res_id = f"compres_{article_id}"
    
    if dry_run:
        logger.debug(f"    [DRY RUN] Would create component resource: {comp_res_id}")
        return {"sourcedId": comp_res_id}
    
    logger.debug(f"    🔗 Creating component resource: {comp_res_id}")
    
    payload = {
        "componentResource": {
            "sourcedId": comp_res_id,
            "status": "active",
            "title": article['article_title'],
            "sortOrder": sort_order,
            "courseComponent": {"sourcedId": component_id},
            "resource": {"sourcedId": article_id},
            "lessonType": "alpha-read-article"
        }
    }
    
    try:
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses/component-resources",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"    ✅ Component resource created: {comp_res_id}")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 409:
            logger.debug(f"    ⚠️ Component resource already exists: {comp_res_id}")
            return {"sourcedId": comp_res_id, "exists": True}
        logger.error(f"    ❌ Error creating component resource {comp_res_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"    ❌ Error creating component resource {comp_res_id}: {e}")
        return None


def get_course_syllabus(course_id: str) -> Optional[Dict]:
    """Get existing course syllabus to check current state."""
    logger.info(f"📋 Fetching course syllabus: {course_id}")
    
    try:
        response = requests.get(
            f"{ONEROSTER_API_BASE_URL}/powerpath/syllabus/{course_id}",
            headers=get_auth_headers(),
            timeout=60
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            logger.warning(f"⚠️ Course not found: {course_id}")
            return None
        logger.error(f"❌ Error fetching syllabus: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Error fetching syllabus: {e}")
        return None


# =============================================================================
# Main Build Functions
# =============================================================================

def build_article_qti(article: Dict) -> Dict:
    """
    Build all QTI content for a single article.
    
    Creates:
    1. Stimuli for each section (guiding questions)
    2. Assessment items for all questions
    3. Assessment test grouping everything
    
    Returns statistics dict.
    """
    article_id = article['article_id']
    stats = {
        "article_id": article_id,
        "stimuli_created": 0,
        "items_created": 0,
        "test_created": False,
        "errors": []
    }
    
    logger.info(f"\n📚 Building article: {article['article_title']}")
    logger.info(f"   Article ID: {article_id}")
    logger.info(f"   Guiding questions: {len(article['guiding_questions'])}")
    logger.info(f"   Quiz questions: {len(article['quiz_questions'])}")
    
    # 1. Create stimuli
    for stimulus_id, content in article['stimuli'].items():
        section_num = stimulus_id.split('_')[-1] if '_' in stimulus_id else "1"
        result = create_stimulus(
            stimulus_id=stimulus_id,
            title=f"Section {section_num}",
            content=content,
            metadata={"article_id": article_id}
        )
        if result:
            stats["stimuli_created"] += 1
        else:
            stats["errors"].append(f"Failed to create stimulus: {stimulus_id}")
        time.sleep(0.1)  # Rate limiting
    
    # 2. Create assessment items for guiding questions
    for q in article['guiding_questions']:
        stimulus_ref = q.get('stimulus_id', '')
        result = create_assessment_item(q, stimulus_ref=stimulus_ref if stimulus_ref else None)
        if result:
            stats["items_created"] += 1
        else:
            stats["errors"].append(f"Failed to create item: {q['question_id']}")
        time.sleep(0.1)
    
    # 3. Create assessment items for quiz questions
    for q in article['quiz_questions']:
        result = create_assessment_item(q, stimulus_ref=None)
        if result:
            stats["items_created"] += 1
        else:
            stats["errors"].append(f"Failed to create item: {q['question_id']}")
        time.sleep(0.1)
    
    # 4. Create assessment test
    result = create_assessment_test(article)
    if result:
        stats["test_created"] = True
    else:
        stats["errors"].append(f"Failed to create assessment test: {article_id}")
    
    return stats


def build_course(
    questions: List[Dict],
    course_id: Optional[str] = None,
    limit_articles: Optional[int] = None
) -> Dict:
    """
    Build a complete Alpha Read course.
    
    Args:
        questions: List of all questions from question bank
        course_id: Existing course ID to update (None for new course)
        limit_articles: Limit number of articles to process (for testing)
    
    Returns:
        Summary statistics
    """
    global dry_run
    
    logger.info("\n" + "="*60)
    logger.info("ALPHA READ COURSE BUILDER")
    logger.info("="*60)
    
    # Group questions by article
    articles = group_questions_by_article(questions)
    article_list = list(articles.values())
    
    if limit_articles:
        article_list = article_list[:limit_articles]
        logger.info(f"📊 Limited to {limit_articles} articles for testing")
    
    # Track overall statistics
    overall_stats = {
        "total_articles": len(article_list),
        "total_stimuli": 0,
        "total_items": 0,
        "tests_created": 0,
        "resources_created": 0,
        "errors": [],
        "dry_run": dry_run
    }
    
    # Get existing course structure if updating
    existing_articles = set()
    if course_id:
        syllabus = get_course_syllabus(course_id)
        if syllabus:
            # Extract existing article IDs
            syllabus_data = syllabus.get('syllabus', syllabus)
            for comp in syllabus_data.get('subComponents', []):
                for res in comp.get('componentResources', []):
                    existing_articles.add(res.get('sourcedId', ''))
            logger.info(f"📊 Found {len(existing_articles)} existing articles in course")
    
    # Process each article
    for i, article in enumerate(article_list, 1):
        article_id = article['article_id']
        
        # Skip if already exists (in update mode)
        if course_id and article_id in existing_articles:
            logger.info(f"\n⏭️ Skipping existing article ({i}/{len(article_list)}): {article_id}")
            continue
        
        logger.info(f"\n{'='*40}")
        logger.info(f"Processing article {i}/{len(article_list)}")
        logger.info(f"{'='*40}")
        
        # Build QTI content
        stats = build_article_qti(article)
        
        overall_stats["total_stimuli"] += stats["stimuli_created"]
        overall_stats["total_items"] += stats["items_created"]
        if stats["test_created"]:
            overall_stats["tests_created"] += 1
        overall_stats["errors"].extend(stats["errors"])
        
        # Create OneRoster resource (if not dry run)
        if not dry_run:
            resource_result = create_oneroster_resource(article)
            if resource_result:
                overall_stats["resources_created"] += 1
        
        # Small delay between articles
        time.sleep(0.5)
    
    return overall_stats


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    global dry_run
    
    parser = argparse.ArgumentParser(
        description='Build or update an Alpha Read course in Timeback',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create new course content (dry run first)
  python build_course.py --mode create --grade 3 --dry-run
  
  # Create with limited articles for testing
  python build_course.py --mode create --grade 3 --limit-articles 5
  
  # Update existing course with new content
  python build_course.py --mode update --course-id 80c8fa8d-744d-4df4-937b-2c93fb0cb93e
  
  # Full create (all 131 articles)
  python build_course.py --mode create --grade 3
        """
    )
    
    parser.add_argument('--mode', choices=['create', 'update'], required=True,
                        help='Create new content or update existing course')
    parser.add_argument('--grade', type=int, default=3,
                        help='Grade level (default: 3)')
    parser.add_argument('--course-id', type=str, default=None,
                        help='Course ID to update (required for update mode)')
    parser.add_argument('--limit-articles', type=int, default=None,
                        help='Limit number of articles to process (for testing)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Simulate without making API calls')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose logging')
    parser.add_argument('--output', type=str, default=None,
                        help='Output file for results JSON')
    
    args = parser.parse_args()
    
    # Set global dry run flag
    dry_run = args.dry_run
    
    # Setup logging
    setup_logging(verbose=args.verbose)
    
    # Validate arguments
    if args.mode == 'update' and not args.course_id:
        parser.error("--course-id is required for update mode")
    
    logger.info("="*60)
    logger.info("ALPHA READ COURSE BUILDER")
    logger.info("="*60)
    logger.info(f"Mode: {args.mode}")
    logger.info(f"Grade: {args.grade}")
    if args.course_id:
        logger.info(f"Course ID: {args.course_id}")
    if args.limit_articles:
        logger.info(f"Article limit: {args.limit_articles}")
    if dry_run:
        logger.info("🔒 DRY RUN MODE - No API calls will be made")
    logger.info("="*60)
    
    try:
        # Load question bank
        questions = load_question_bank()
        summary = load_summary()
        
        logger.info(f"\n📊 Question Bank Summary:")
        logger.info(f"   Total questions: {summary['total_questions']}")
        logger.info(f"   Guiding questions: {summary['guiding_questions']}")
        logger.info(f"   Quiz questions: {summary['quiz_questions']}")
        logger.info(f"   Total articles: {summary['total_articles']}")
        
        # Build course
        results = build_course(
            questions=questions,
            course_id=args.course_id,
            limit_articles=args.limit_articles
        )
        
        # Print summary
        logger.info("\n" + "="*60)
        logger.info("BUILD COMPLETE")
        logger.info("="*60)
        logger.info(f"   Articles processed: {results['total_articles']}")
        logger.info(f"   Stimuli created: {results['total_stimuli']}")
        logger.info(f"   Assessment items created: {results['total_items']}")
        logger.info(f"   Assessment tests created: {results['tests_created']}")
        logger.info(f"   Resources created: {results['resources_created']}")
        logger.info(f"   Errors: {len(results['errors'])}")
        
        if results['errors']:
            logger.warning("\n⚠️ Errors encountered:")
            for err in results['errors'][:10]:
                logger.warning(f"   - {err}")
            if len(results['errors']) > 10:
                logger.warning(f"   ... and {len(results['errors']) - 10} more")
        
        if dry_run:
            logger.info("\n🔒 This was a DRY RUN - no actual changes were made")
        
        # Save results
        output_file = args.output or f"build_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        logger.info(f"\n💾 Results saved to: {output_file}")
        
    except KeyboardInterrupt:
        logger.warning("\n⚠️ Interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n❌ Error: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
