#!/usr/bin/env python3
"""
Generic QTI Course Extractor

This script extracts QTI assessment data from any Timeback course by:
1. Fetching the course syllabus via OneRoster/PowerPath API
2. Extracting all lessons (components) and their activities (resources)
3. For each QTI resource, fetching the full assessment test with items and stimuli

Usage:
    python extract_course_qti.py --course-id <course_id>
    python extract_course_qti.py --course-id <course_id> --limit-lessons 5
    python extract_course_qti.py --course-id <course_id> --limit-activities 10
    python extract_course_qti.py --list-courses

Output: A nested JSON file with the full course structure and QTI content.
"""

import os
import json
import requests
import argparse
from typing import Dict, List, Optional
from dotenv import load_dotenv
import time
import logging
from datetime import datetime
import sys

# Load environment variables
load_dotenv()

# API Configuration
QTI_API_BASE_URL = "https://qti.alpha-1edtech.ai/api"
ONEROSTER_API_BASE_URL = "https://api.alpha-1edtech.ai"  # Note: .ai domain, not .com
COGNITO_URL = "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token"

# Default credentials (can be overridden by environment variables)
# These credentials have scopes for: Caliper, QTI, and OneRoster APIs
CLIENT_ID = os.getenv("TIMEBACK_CLIENT_ID", "31rkusu8sloquan3cmcb9p8v33")
CLIENT_SECRET = os.getenv("TIMEBACK_CLIENT_SECRET", "1vv89lcl7lfu151ruccfts4hauefc0r1epdvaotbrgupvcif4cor")

# State tracking
STATE_FILE = "course_extraction_state.json"
LOG_FILE = "course_extraction.log"

# Global logger
logger = None
# Global token
access_token = None


def setup_logging():
    """Setup logging to both file and console."""
    log = logging.getLogger('course_extractor')
    log.setLevel(logging.DEBUG)
    log.handlers = []
    
    # File handler - detailed logging
    file_handler = logging.FileHandler(LOG_FILE, mode='a', encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(file_formatter)
    
    # Console handler - less verbose
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter('%(message)s')
    console_handler.setFormatter(console_formatter)
    
    log.addHandler(file_handler)
    log.addHandler(console_handler)
    
    return log


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
# OneRoster API Functions
# =============================================================================

def list_courses(limit: int = 50, offset: int = 0) -> List[Dict]:
    """
    List all available courses from OneRoster API.
    
    GET /ims/oneroster/rostering/v1p2/courses
    
    Note: This requires OneRoster API permissions which may differ from QTI API permissions.
    """
    logger.info(f"📚 Fetching courses (limit={limit}, offset={offset})...")
    
    url = f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses"
    params = {
        "limit": limit,
        "offset": offset
    }
    
    try:
        response = requests.get(url, headers=get_auth_headers(), params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        courses = data.get("courses", [])
        logger.info(f"✅ Found {len(courses)} courses")
        return courses
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            logger.error(f"❌ Unauthorized: Your credentials may not have OneRoster API access.")
            logger.error(f"   The QTI API and OneRoster API may require different permissions.")
            logger.error(f"   Try using --list-tests to list QTI assessment tests instead.")
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error fetching courses: {e}")
        raise


def list_assessment_tests(limit: int = 50, offset: int = 0, tool_name: Optional[str] = None) -> List[Dict]:
    """
    List assessment tests from QTI API.
    
    GET /api/assessment-tests
    
    This can be used as an alternative when OneRoster API is not accessible.
    """
    logger.info(f"📋 Fetching assessment tests (limit={limit}, offset={offset})...")
    
    url = f"{QTI_API_BASE_URL}/assessment-tests"
    params = {
        "limit": limit,
        "offset": offset
    }
    if tool_name:
        params["toolName"] = tool_name
    
    try:
        response = requests.get(url, headers=get_auth_headers(), params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        
        # The response might be a list or an object with a key
        if isinstance(data, list):
            tests = data
        else:
            tests = data.get("assessmentTests", data.get("tests", []))
        
        logger.info(f"✅ Found {len(tests)} assessment tests")
        return tests
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error fetching assessment tests: {e}")
        raise


def get_course(course_id: str) -> Optional[Dict]:
    """
    Get a single course by ID.
    
    GET /ims/oneroster/rostering/v1p2/courses/{courseId}
    """
    logger.info(f"📖 Fetching course: {course_id}")
    
    url = f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses/{course_id}"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        data = response.json()
        return data.get("course")
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error fetching course {course_id}: {e}")
        return None


def get_course_syllabus(course_id: str) -> Optional[Dict]:
    """
    Get the full course syllabus with nested structure.
    
    GET /powerpath/syllabus/{courseId}
    
    Returns the full nested structure with all components, componentResources, and linked resources.
    """
    logger.info(f"📋 Fetching course syllabus: {course_id}")
    
    url = f"{ONEROSTER_API_BASE_URL}/powerpath/syllabus/{course_id}"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=60)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error fetching syllabus for {course_id}: {e}")
        return None


def get_course_components(course_id: str) -> List[Dict]:
    """
    Get all components (units/lessons) for a course.
    
    GET /ims/oneroster/rostering/v1p2/courses/{courseId}/components
    """
    logger.info(f"📂 Fetching components for course: {course_id}")
    
    url = f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses/{course_id}/components"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=60)
        response.raise_for_status()
        data = response.json()
        components = data.get("courseComponents", [])
        logger.info(f"✅ Found {len(components)} components")
        return components
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error fetching components for {course_id}: {e}")
        return []


# =============================================================================
# QTI API Functions
# =============================================================================

def fetch_stimulus(stimulus_identifier: str) -> Optional[Dict]:
    """Fetch stimulus (passage) content from QTI API."""
    logger.debug(f"    📄 Fetching stimulus: {stimulus_identifier}")
    
    try:
        url = f"{QTI_API_BASE_URL}/stimuli/{stimulus_identifier}"
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        # Parse raw XML if present
        raw_xml = data.get('rawXml', '')
        parsed_content = parse_stimulus_from_xml(raw_xml) if raw_xml else {}
        
        return {
            "identifier": data.get('identifier'),
            "title": data.get('title'),
            "metadata": data.get('metadata', {}),
            **parsed_content
        }
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            logger.warning(f"    ⚠️ Stimulus not found: {stimulus_identifier}")
            return None
        raise
    except Exception as e:
        logger.error(f"    ❌ Error fetching stimulus {stimulus_identifier}: {e}")
        return None


def parse_stimulus_from_xml(raw_xml: str) -> Dict:
    """Extract stimulus content from rawXml."""
    import xml.etree.ElementTree as ET
    
    try:
        # Remove namespace for easier parsing
        xml_str = raw_xml.replace(' xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"', '')
        root = ET.fromstring(xml_str)
        
        stimulus_body = root.find('.//qti-stimulus-body')
        if stimulus_body is not None:
            content = ET.tostring(stimulus_body, encoding='unicode', method='html')
            return {
                "content_html": content,
                "content_text": ''.join(stimulus_body.itertext()).strip() if stimulus_body.itertext() else None
            }
    except Exception as e:
        logger.debug(f"    ⚠️ Error parsing stimulus XML: {e}")
    
    return {"content_html": None, "content_text": None}


def parse_item_from_xml(raw_xml: str) -> Dict:
    """Extract question data from rawXml."""
    import xml.etree.ElementTree as ET
    
    try:
        xml_str = raw_xml.replace(' xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"', '')
        root = ET.fromstring(xml_str)
        
        result = {
            "prompt": None,
            "interaction_type": None,
            "choices": [],
            "correct_answers": [],
            "stimulus_ref": None
        }
        
        # Extract correct answer(s)
        correct_response = root.find('.//qti-response-declaration/qti-correct-response')
        if correct_response is not None:
            result["correct_answers"] = [
                value.text for value in correct_response.findall('qti-value') if value.text
            ]
        
        # Extract stimulus reference if present
        stimulus_ref = root.find('.//qti-assessment-stimulus-ref')
        if stimulus_ref is not None:
            result["stimulus_ref"] = {
                "identifier": stimulus_ref.get('identifier'),
                "href": stimulus_ref.get('href'),
                "title": stimulus_ref.get('title')
            }
        
        # Extract prompt and choices from choice interaction
        choice_interaction = root.find('.//qti-choice-interaction')
        if choice_interaction is not None:
            result["interaction_type"] = "choice"
            
            prompt = choice_interaction.find('qti-prompt')
            if prompt is not None:
                result["prompt"] = ''.join(prompt.itertext()).strip()
            
            for choice in choice_interaction.findall('qti-simple-choice'):
                choice_id = choice.get('identifier')
                choice_texts = []
                feedback_text = None
                
                for elem in choice:
                    if elem.tag == 'qti-feedback-inline':
                        feedback_text = ''.join(elem.itertext()).strip()
                    else:
                        choice_texts.append(elem.text or '')
                
                if choice.text:
                    choice_texts.insert(0, choice.text.strip())
                
                result["choices"].append({
                    "identifier": choice_id,
                    "text": ''.join(choice_texts).strip(),
                    "feedback": feedback_text,
                    "is_correct": choice_id in result["correct_answers"]
                })
        
        # Handle text entry interactions
        text_entry = root.find('.//qti-text-entry-interaction')
        if text_entry is not None:
            result["interaction_type"] = "text_entry"
            prompt = root.find('.//qti-item-body')
            if prompt is not None:
                result["prompt"] = ''.join(prompt.itertext()).strip()
        
        # Handle extended text interactions (essay)
        extended_text = root.find('.//qti-extended-text-interaction')
        if extended_text is not None:
            result["interaction_type"] = "extended_text"
            prompt = root.find('.//qti-item-body')
            if prompt is not None:
                result["prompt"] = ''.join(prompt.itertext()).strip()
        
        return result
    
    except Exception as e:
        logger.debug(f"    ⚠️ Error parsing item XML: {e}")
        return {"error": str(e), "prompt": None, "choices": [], "correct_answers": []}


def fetch_assessment_item(item_identifier: str) -> Optional[Dict]:
    """Fetch and parse a single assessment item (question)."""
    logger.debug(f"    ❓ Fetching item: {item_identifier}")
    
    try:
        url = f"{QTI_API_BASE_URL}/assessment-items/{item_identifier}"
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        
        data = response.json()
        raw_xml = data.get('rawXml', '')
        
        # Parse the item XML
        parsed_data = parse_item_from_xml(raw_xml) if raw_xml else {}
        
        # Fetch stimulus if referenced
        stimulus_data = None
        if parsed_data.get('stimulus_ref'):
            stimulus_identifier = parsed_data['stimulus_ref']['identifier']
            stimulus_data = fetch_stimulus(stimulus_identifier)
        
        return {
            "identifier": data.get('identifier'),
            "title": data.get('title'),
            "type": data.get('type'),
            "metadata": data.get('metadata', {}),
            "stimulus": stimulus_data,
            **parsed_data
        }
    
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            logger.warning(f"    ⚠️ Item not found: {item_identifier}")
            return None
        raise
    except Exception as e:
        logger.error(f"    ❌ Error fetching item {item_identifier}: {e}")
        return None


def fetch_assessment_test(test_identifier: str) -> Optional[Dict]:
    """Fetch complete assessment test with all sections and items."""
    logger.info(f"  📋 Fetching assessment test: {test_identifier}")
    
    try:
        url = f"{QTI_API_BASE_URL}/assessment-tests/{test_identifier}"
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        test_result = {
            "identifier": data.get('identifier'),
            "title": data.get('title'),
            "qtiVersion": data.get('qtiVersion'),
            "metadata": data.get('metadata', {}),
            "test_parts": []
        }
        
        # Process test parts and sections
        for test_part in data.get('qti-test-part', []):
            part_result = {
                "identifier": test_part.get('identifier'),
                "navigationMode": test_part.get('navigationMode'),
                "submissionMode": test_part.get('submissionMode'),
                "sections": []
            }
            
            for section in test_part.get('qti-assessment-section', []):
                logger.info(f"    📂 Section: {section.get('title')}")
                
                section_result = {
                    "identifier": section.get('identifier'),
                    "title": section.get('title'),
                    "sequence": section.get('sequence'),
                    "items": []
                }
                
                # Process items in section
                for item_ref in section.get('qti-assessment-item-ref', []):
                    item_id = item_ref.get('identifier')
                    item_data = fetch_assessment_item(item_id)
                    if item_data:
                        section_result['items'].append(item_data)
                    time.sleep(0.1)  # Rate limiting
                
                part_result['sections'].append(section_result)
            
            test_result['test_parts'].append(part_result)
        
        logger.info(f"  ✅ Completed: {test_identifier}")
        return test_result
    
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            logger.warning(f"  ⚠️ Assessment test not found: {test_identifier}")
            return None
        raise
    except Exception as e:
        logger.error(f"  ❌ Error fetching test {test_identifier}: {e}")
        return None


# =============================================================================
# Main Extraction Functions
# =============================================================================

def extract_qti_from_resource(resource: Dict) -> Optional[Dict]:
    """
    Extract QTI content from a resource if it's a QTI type.
    
    Returns the full assessment test data if the resource points to QTI content.
    """
    metadata = resource.get('metadata', {})
    resource_type = metadata.get('type', '')
    sub_type = metadata.get('subType', '')
    vendor_resource_id = resource.get('vendorResourceId', '')
    
    # Check if this is a QTI resource
    if resource_type == 'qti' or sub_type in ['qti-test', 'qti-stimulus']:
        # Try to get the test identifier
        test_id = vendor_resource_id or resource.get('sourcedId', '')
        
        if test_id:
            return fetch_assessment_test(test_id)
    
    # Check for alpha-read-article type
    lesson_type = metadata.get('lessonType', '')
    if lesson_type == 'alpha-read-article':
        test_id = vendor_resource_id or resource.get('sourcedId', '')
        if test_id:
            return fetch_assessment_test(test_id)
    
    # Check for quiz type
    if lesson_type == 'quiz':
        test_id = vendor_resource_id or resource.get('sourcedId', '')
        if test_id:
            return fetch_assessment_test(test_id)
    
    # Check for powerpath-100 type
    if lesson_type == 'powerpath-100':
        test_id = vendor_resource_id or resource.get('sourcedId', '')
        if test_id:
            return fetch_assessment_test(test_id)
    
    return None


def extract_course_content(
    course_id: str,
    limit_lessons: Optional[int] = None,
    limit_activities: Optional[int] = None
) -> Dict:
    """
    Extract all content from a course including QTI assessments.
    
    Args:
        course_id: The course sourcedId
        limit_lessons: Optional limit on number of lessons to extract
        limit_activities: Optional limit on activities per lesson
    
    Returns:
        Dict with full course content
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"EXTRACTING COURSE: {course_id}")
    logger.info(f"{'='*60}")
    
    # Get course info
    course = get_course(course_id)
    if not course:
        logger.error(f"Could not find course: {course_id}")
        return {}
    
    logger.info(f"📚 Course: {course.get('title', 'Unknown')}")
    
    # Get syllabus (includes full nested structure)
    syllabus = get_course_syllabus(course_id)
    
    result = {
        "metadata": {
            "course_id": course_id,
            "course_title": course.get('title'),
            "extraction_date": datetime.now().isoformat(),
            "qti_api_url": QTI_API_BASE_URL,
            "oneroster_api_url": ONEROSTER_API_BASE_URL,
            "limit_lessons": limit_lessons,
            "limit_activities": limit_activities
        },
        "course": course,
        "units": []
    }
    
    # If syllabus available, use it for nested structure
    if syllabus:
        logger.info(f"✅ Using syllabus data")
        
        # The API returns: {"syllabus": {"course": {...}, "subComponents": [...]}}
        syllabus_data = syllabus.get('syllabus', syllabus)
        result["syllabus"] = syllabus_data
        
        # Get course info from syllabus if available
        if syllabus_data.get('course'):
            result["course"] = syllabus_data['course']
            logger.info(f"📚 Course from syllabus: {syllabus_data['course'].get('title', 'Unknown')}")
        
        # Process syllabus structure - try different possible keys
        components = (
            syllabus_data.get('subComponents') or 
            syllabus_data.get('courseComponents') or 
            syllabus_data.get('components') or 
            []
        )
        logger.info(f"📂 Found {len(components)} top-level units/components")
        result["units"] = process_syllabus_components(components, limit_lessons, limit_activities)
    else:
        # Fallback: Get components separately
        logger.info(f"ℹ️ Syllabus not available, fetching components separately")
        components = get_course_components(course_id)
        result["units"] = process_components(components, limit_lessons, limit_activities)
    
    # Calculate statistics - handle both old (lessons) and new (articles) structure
    total_articles = sum(len(unit.get('articles', [])) for unit in result['units'])
    total_lessons = sum(len(unit.get('lessons', [])) for unit in result['units'])
    
    # Count QTI items from articles (new structure)
    total_qti_from_articles = sum(
        1 for unit in result['units']
        for article in unit.get('articles', [])
        if article.get('qti_content')
    )
    
    # Count QTI items from old structure (fallback)
    total_qti_from_lessons = sum(
        1 for unit in result['units']
        for lesson in unit.get('lessons', [])
        for activity in lesson.get('activities', [])
        if activity.get('qti_content')
    )
    
    result['metadata']['statistics'] = {
        'total_units': len(result['units']),
        'total_articles': total_articles,
        'total_lessons': total_lessons,
        'total_qti_assessments': total_qti_from_articles + total_qti_from_lessons
    }
    
    return result


def process_syllabus_components(
    sub_components: List[Dict],
    limit_units: Optional[int] = None,
    limit_articles: Optional[int] = None
) -> List[Dict]:
    """
    Process syllabus subComponents from the PowerPath API.
    
    Structure from API:
    {
        "sourcedId": "...",
        "title": "Classic Tales",
        "componentResources": [
            {
                "sourcedId": "article_101001",
                "title": "Aladdin...",
                "resource": {
                    "type": "qti",
                    "metadata": {"url": "https://qti.alpha-1edtech.ai/..."}
                }
            }
        ]
    }
    """
    results = []
    total_articles_processed = 0
    
    for i, unit in enumerate(sub_components):
        if limit_units and i >= limit_units:
            logger.info(f"⏹️ Reached unit limit ({limit_units})")
            break
            
        unit_id = unit.get('sourcedId', 'unknown')
        unit_title = unit.get('title', 'Untitled Unit')
        
        logger.info(f"\n📁 Unit {i+1}: {unit_title}")
        
        unit_data = {
            "sourcedId": unit_id,
            "title": unit_title,
            "sortOrder": unit.get('sortOrder'),
            "metadata": unit.get('metadata', {}),
            "articles": []
        }
        
        # Process componentResources (articles/lessons)
        comp_resources = unit.get('componentResources', [])
        logger.info(f"   📎 {len(comp_resources)} articles in this unit")
        
        for j, comp_res in enumerate(comp_resources):
            # Check global article limit
            if limit_articles and total_articles_processed >= limit_articles:
                logger.info(f"   ⏹️ Reached total article limit ({limit_articles})")
                break
            
            resource = comp_res.get('resource', {})
            article_id = comp_res.get('sourcedId', resource.get('sourcedId', 'unknown'))
            article_title = comp_res.get('title', resource.get('title', 'Untitled'))
            
            logger.info(f"   📄 Article {j+1}: {article_title}")
            
            article_data = {
                "sourcedId": article_id,
                "title": article_title,
                "sortOrder": comp_res.get('sortOrder'),
                "resource_type": resource.get('type'),
                "lesson_type": resource.get('metadata', {}).get('lessonType'),
                "xp": resource.get('metadata', {}).get('xp'),
                "qti_url": resource.get('metadata', {}).get('url'),
                "qti_content": None
            }
            
            # Fetch QTI content if this is a QTI resource
            if resource.get('type') == 'qti':
                # Get the test ID from the resource
                test_id = article_id
                if test_id:
                    qti_content = fetch_assessment_test(test_id)
                    if qti_content:
                        article_data['qti_content'] = qti_content
                        logger.info(f"      ✅ QTI content fetched")
                    else:
                        logger.warning(f"      ⚠️ Could not fetch QTI content")
                time.sleep(0.2)  # Rate limiting
            
            unit_data['articles'].append(article_data)
            total_articles_processed += 1
        
        results.append(unit_data)
    
    logger.info(f"\n📊 Processed {len(results)} units, {total_articles_processed} articles total")
    return results


def process_components(
    components: List[Dict],
    limit_lessons: Optional[int] = None,
    limit_activities: Optional[int] = None,
    depth: int = 0
) -> List[Dict]:
    """
    Process components recursively (fallback for non-syllabus endpoints).
    
    Components can be:
    - Units (contain child components)
    - Lessons (contain resources/activities)
    """
    results = []
    lesson_count = 0
    
    for component in components:
        # Check if we've hit the lesson limit
        if limit_lessons and lesson_count >= limit_lessons:
            logger.info(f"  ⏹️ Reached lesson limit ({limit_lessons})")
            break
        
        comp_id = component.get('sourcedId', component.get('identifier', 'unknown'))
        comp_title = component.get('title', 'Untitled')
        
        indent = "  " * depth
        logger.info(f"{indent}📁 Component: {comp_title}")
        
        unit_data = {
            "sourcedId": comp_id,
            "title": comp_title,
            "metadata": component.get('metadata', {}),
            "lessons": [],
            "child_units": []
        }
        
        # Check for child components (nested units)
        child_components = component.get('childComponents', component.get('children', []))
        if child_components:
            # This is a unit with nested components
            unit_data['child_units'] = process_components(
                child_components, 
                limit_lessons - lesson_count if limit_lessons else None,
                limit_activities,
                depth + 1
            )
        
        # Check for component resources (activities)
        comp_resources = component.get('componentResources', [])
        if comp_resources:
            logger.info(f"{indent}  📎 Found {len(comp_resources)} activities")
            lesson_count += 1
            
            activities = []
            activity_count = 0
            
            for comp_res in comp_resources:
                if limit_activities and activity_count >= limit_activities:
                    logger.info(f"{indent}    ⏹️ Reached activity limit ({limit_activities})")
                    break
                
                resource = comp_res.get('resource', {})
                res_title = resource.get('title', comp_res.get('title', 'Untitled'))
                
                logger.info(f"{indent}    📄 Activity: {res_title}")
                
                activity_data = {
                    "sourcedId": comp_res.get('sourcedId'),
                    "title": res_title,
                    "sortOrder": comp_res.get('sortOrder'),
                    "lessonType": comp_res.get('lessonType'),
                    "resource": resource,
                    "qti_content": None
                }
                
                # Try to extract QTI content
                if resource:
                    qti_content = extract_qti_from_resource(resource)
                    if qti_content:
                        activity_data['qti_content'] = qti_content
                        logger.info(f"{indent}      ✅ QTI content extracted")
                
                activities.append(activity_data)
                activity_count += 1
                
                time.sleep(0.2)  # Rate limiting
            
            unit_data['lessons'].append({
                "sourcedId": comp_id,
                "title": comp_title,
                "activities": activities
            })
        
        results.append(unit_data)
    
    return results


def display_courses(courses: List[Dict]):
    """Display a formatted list of courses."""
    print("\n" + "="*80)
    print("AVAILABLE COURSES")
    print("="*80)
    
    for i, course in enumerate(courses, 1):
        print(f"\n{i}. {course.get('title', 'Untitled')}")
        print(f"   ID: {course.get('sourcedId', 'N/A')}")
        print(f"   Grades: {', '.join(course.get('grades', []))}")
        print(f"   Subjects: {', '.join(course.get('subjects', []))}")
        print(f"   Status: {course.get('status', 'N/A')}")
        
        metadata = course.get('metadata', {})
        if metadata:
            pub_status = metadata.get('publishStatus', metadata.get('alphaLearn', {}).get('publishStatus'))
            if pub_status:
                print(f"   Publish Status: {pub_status}")
    
    print("\n" + "="*80)


def display_tests(tests: List[Dict]):
    """Display a formatted list of assessment tests."""
    print("\n" + "="*80)
    print("AVAILABLE QTI ASSESSMENT TESTS")
    print("="*80)
    
    for i, test in enumerate(tests, 1):
        print(f"\n{i}. {test.get('title', 'Untitled')}")
        print(f"   Identifier: {test.get('identifier', 'N/A')}")
        
        metadata = test.get('metadata', {})
        if metadata:
            if metadata.get('subject'):
                print(f"   Subject: {metadata.get('subject')}")
            if metadata.get('grade'):
                print(f"   Grade: {metadata.get('grade')}")
        
        if test.get('toolName'):
            print(f"   Tool: {test.get('toolName')}")
    
    print("\n" + "="*80)
    print(f"\nTo extract a test, run:")
    print(f"  python extract_course_qti.py --test-id <identifier>")
    print("="*80)


def extract_single_test(test_id: str) -> Dict:
    """
    Extract a single assessment test with all its items and stimuli.
    
    Args:
        test_id: The assessment test identifier
    
    Returns:
        Dict with the full test content
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"EXTRACTING TEST: {test_id}")
    logger.info(f"{'='*60}")
    
    test_data = fetch_assessment_test(test_id)
    
    if not test_data:
        return {}
    
    # Calculate statistics
    total_sections = sum(
        len(part.get('sections', []))
        for part in test_data.get('test_parts', [])
    )
    total_items = sum(
        len(section.get('items', []))
        for part in test_data.get('test_parts', [])
        for section in part.get('sections', [])
    )
    
    result = {
        "metadata": {
            "test_id": test_id,
            "extraction_date": datetime.now().isoformat(),
            "qti_api_url": QTI_API_BASE_URL,
            "statistics": {
                "total_sections": total_sections,
                "total_items": total_items
            }
        },
        "assessment": test_data
    }
    
    return result


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Extract QTI assessment data from a Timeback course',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all available courses (requires OneRoster API access)
  python extract_course_qti.py --list-courses

  # List QTI assessment tests (uses QTI API)
  python extract_course_qti.py --list-tests
  python extract_course_qti.py --list-tests --limit 20

  # Extract a single assessment test by ID
  python extract_course_qti.py --test-id article_101001

  # Extract all content from a course (requires OneRoster API access)
  python extract_course_qti.py --course-id my-course-id

  # Extract with limits
  python extract_course_qti.py --course-id my-course-id --limit-lessons 5 --limit-activities 3

  # Custom output file
  python extract_course_qti.py --course-id my-course-id --output my_course_data.json
        """
    )
    
    parser.add_argument('--course-id', type=str,
                        help='Course sourcedId to extract')
    parser.add_argument('--test-id', type=str,
                        help='QTI Assessment test identifier to extract directly')
    parser.add_argument('--list-courses', action='store_true',
                        help='List all available courses (requires OneRoster API access)')
    parser.add_argument('--list-tests', action='store_true',
                        help='List available QTI assessment tests')
    parser.add_argument('--limit-lessons', type=int, default=None,
                        help='Limit number of lessons to extract')
    parser.add_argument('--limit-activities', type=int, default=None,
                        help='Limit number of activities per lesson')
    parser.add_argument('--limit', type=int, default=None,
                        help='Limit number of tests when using --list-tests or extracting')
    parser.add_argument('--output', type=str, default=None,
                        help='Output JSON file name')
    parser.add_argument('--client-id', type=str, default=None,
                        help='OAuth client ID (overrides env/default)')
    parser.add_argument('--client-secret', type=str, default=None,
                        help='OAuth client secret (overrides env/default)')
    
    args = parser.parse_args()
    
    # Override credentials if provided
    global CLIENT_ID, CLIENT_SECRET
    if args.client_id:
        CLIENT_ID = args.client_id
    if args.client_secret:
        CLIENT_SECRET = args.client_secret
    
    # Initialize logging
    global logger
    logger = setup_logging()
    
    logger.info("="*60)
    logger.info("GENERIC QTI COURSE EXTRACTOR")
    logger.info("="*60)
    
    try:
        # List courses mode (requires OneRoster API access)
        if args.list_courses:
            courses = list_courses(limit=args.limit or 100)
            display_courses(courses)
            return
        
        # List tests mode (uses QTI API directly)
        if args.list_tests:
            tests = list_assessment_tests(limit=args.limit or 50)
            display_tests(tests)
            return
        
        # Direct test extraction mode
        if args.test_id:
            output_file = args.output or f"test_{args.test_id}_data.json"
            result = extract_single_test(args.test_id)
            
            if not result:
                logger.error("No content extracted")
                sys.exit(1)
            
            logger.info(f"\n💾 Saving results to: {output_file}")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            logger.info(f"✅ Extraction Complete!")
            logger.info(f"   Output: {output_file}")
            logger.info(f"   File size: {os.path.getsize(output_file) / 1024:.1f} KB")
            return
        
        # Require course-id for full course extraction
        if not args.course_id:
            parser.error("--course-id or --test-id is required (or use --list-courses / --list-tests)")
        
        # Determine output filename
        output_file = args.output or f"course_{args.course_id}_data.json"
        
        # Extract course content
        result = extract_course_content(
            args.course_id,
            limit_lessons=args.limit_lessons,
            limit_activities=args.limit_activities
        )
        
        if not result:
            logger.error("No content extracted")
            sys.exit(1)
        
        # Save results
        logger.info(f"\n💾 Saving results to: {output_file}")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        # Display summary
        stats = result.get('metadata', {}).get('statistics', {})
        logger.info(f"\n✅ Extraction Complete!")
        logger.info(f"{'='*60}")
        logger.info(f"   Course: {result.get('metadata', {}).get('course_title')}")
        logger.info(f"   Units: {stats.get('total_units', 0)}")
        logger.info(f"   Lessons: {stats.get('total_lessons', 0)}")
        logger.info(f"   Activities: {stats.get('total_activities', 0)}")
        logger.info(f"   QTI Assessments: {stats.get('total_qti_assessments', 0)}")
        logger.info(f"   Output: {output_file}")
        logger.info(f"   File size: {os.path.getsize(output_file) / 1024:.1f} KB")
        logger.info(f"{'='*60}")
    
    except KeyboardInterrupt:
        logger.warning("\n⚠️ Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"\n❌ Error: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
