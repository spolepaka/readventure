#!/usr/bin/env python3
"""
QTI Assessment Data Extractor

This script queries the QTI API to extract assessment test data including:
- Test and section metadata
- Assessment items (questions)
- Stimuli (reading passages/articles)
- Question prompts, options, feedback, and correct answers

Output: A nested JSON file organized by assessment test -> sections -> items
"""

import os
import json
import csv
import requests
import xml.etree.ElementTree as ET
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
API_BASE_URL = "https://qti.alpha-1edtech.ai/api"
COGNITO_URL = "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token"
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")

# QTI namespace
QTI_NS = {"qti": "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"}

# State tracking
STATE_FILE = "extraction_state.json"
LOG_FILE = "extraction.log"


def setup_logging():
    """Setup logging to both file and console."""
    # Create logger
    logger = logging.getLogger('qti_extractor')
    logger.setLevel(logging.DEBUG)
    
    # Clear any existing handlers
    logger.handlers = []
    
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
    
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


logger = None  # Will be initialized in main()


def get_oauth_token() -> str:
    """Get OAuth access token from Cognito."""
    print("🔑 Obtaining OAuth token...")

    response = requests.post(
        COGNITO_URL,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET
        }
    )
    response.raise_for_status()
    token = response.json()["access_token"]
    print("✅ Token obtained successfully")
    return token


def parse_stimulus_from_xml(raw_xml: str) -> Dict:
    """Extract stimulus content from rawXml."""
    try:
        # Remove namespace for easier parsing
        xml_str = raw_xml.replace(' xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"', '')
        root = ET.fromstring(xml_str)

        stimulus_body = root.find('.//qti-stimulus-body')
        if stimulus_body is not None:
            # Get the HTML content as string
            content = ET.tostring(stimulus_body, encoding='unicode', method='html')
            return {
                "content_html": content,
                "content_text": stimulus_body.itertext() and ''.join(stimulus_body.itertext()).strip()
            }
    except Exception as e:
        print(f"  ⚠️  Error parsing stimulus XML: {e}")

    return {"content_html": None, "content_text": None}


def parse_item_from_xml(raw_xml: str) -> Dict:
    """
    Extract question data from rawXml including:
    - Prompt
    - Choices with identifiers
    - Feedback for each choice
    - Correct answer(s)
    """
    try:
        # Remove namespace for easier parsing
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

        # Extract prompt and choices from interaction
        choice_interaction = root.find('.//qti-choice-interaction')
        if choice_interaction is not None:
            result["interaction_type"] = "choice"

            # Get prompt
            prompt = choice_interaction.find('qti-prompt')
            if prompt is not None:
                result["prompt"] = ''.join(prompt.itertext()).strip()

            # Get all choices
            for choice in choice_interaction.findall('qti-simple-choice'):
                choice_id = choice.get('identifier')

                # Extract choice text (excluding feedback)
                choice_texts = []
                feedback_text = None

                for elem in choice:
                    if elem.tag == 'qti-feedback-inline':
                        feedback_text = ''.join(elem.itertext()).strip()
                    else:
                        choice_texts.append(elem.text or '')

                # Get direct text content
                if choice.text:
                    choice_texts.insert(0, choice.text.strip())

                choice_text = ''.join(choice_texts).strip()

                result["choices"].append({
                    "identifier": choice_id,
                    "text": choice_text,
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
        print(f"  ⚠️  Error parsing item XML: {e}")
        return {
            "error": str(e),
            "prompt": None,
            "choices": [],
            "correct_answers": []
        }


def fetch_stimulus(stimulus_identifier: str) -> Optional[Dict]:
    """Fetch stimulus content from API."""
    try:
        url = f"{API_BASE_URL}/stimuli/{stimulus_identifier}"
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        data = response.json()
        raw_xml = data.get('rawXml', '')

        return {
            "identifier": data.get('identifier'),
            "title": data.get('title'),
            "metadata": data.get('metadata', {}),
            **parse_stimulus_from_xml(raw_xml)
        }
    except requests.exceptions.RequestException as e:
        error_msg = f"Network error fetching stimulus {stimulus_identifier}: {e}"
        logger.error(error_msg)
        raise Exception(error_msg)
    except Exception as e:
        error_msg = f"Error fetching stimulus {stimulus_identifier}: {e}"
        logger.error(error_msg)
        raise Exception(error_msg)


def fetch_assessment_item(item_identifier: str) -> Dict:
    """Fetch and parse a single assessment item."""
    try:
        url = f"{API_BASE_URL}/assessment-items/{item_identifier}"
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        data = response.json()
        raw_xml = data.get('rawXml', '')

        # Parse the item XML
        parsed_data = parse_item_from_xml(raw_xml)

        # Fetch stimulus if referenced
        stimulus_data = None
        if parsed_data.get('stimulus_ref'):
            stimulus_identifier = parsed_data['stimulus_ref']['identifier']
            logger.info(f"    📄 Fetching stimulus: {stimulus_identifier}")
            stimulus_data = fetch_stimulus(stimulus_identifier)

        return {
            "identifier": data.get('identifier'),
            "title": data.get('title'),
            "type": data.get('type'),
            "metadata": data.get('metadata', {}),
            "stimulus": stimulus_data,
            **parsed_data
        }

    except requests.exceptions.RequestException as e:
        error_msg = f"Network error fetching item {item_identifier}: {e}"
        logger.error(error_msg)
        raise Exception(error_msg)
    except Exception as e:
        error_msg = f"Error fetching item {item_identifier}: {e}"
        logger.error(error_msg)
        raise Exception(error_msg)


def fetch_assessment_test(test_identifier: str) -> Dict:
    """Fetch complete assessment test with all sections and items."""
    logger.info(f"\n📋 Processing assessment test: {test_identifier}")

    try:
        url = f"{API_BASE_URL}/assessment-tests/{test_identifier}"
        response = requests.get(url, timeout=30)
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

            # Process sections
            for section in test_part.get('qti-assessment-section', []):
                logger.info(f"  📂 Section: {section.get('title')}")

                section_result = {
                    "identifier": section.get('identifier'),
                    "title": section.get('title'),
                    "sequence": section.get('sequence'),
                    "items": []
                }

                # Process items in section
                for item_ref in section.get('qti-assessment-item-ref', []):
                    item_id = item_ref.get('identifier')
                    logger.info(f"    ❓ Fetching item: {item_id}")

                    item_data = fetch_assessment_item(item_id)
                    section_result['items'].append(item_data)

                    # Small delay to avoid rate limiting
                    time.sleep(0.1)

                part_result['sections'].append(section_result)

            test_result['test_parts'].append(part_result)

        logger.info(f"✅ Completed: {test_identifier}")
        return test_result

    except requests.exceptions.RequestException as e:
        error_msg = f"Network error fetching test {test_identifier}: {e}"
        logger.error(f"❌ {error_msg}")
        raise Exception(error_msg)
    except Exception as e:
        error_msg = f"Error fetching test {test_identifier}: {e}"
        logger.error(f"❌ {error_msg}")
        raise Exception(error_msg)


def extract_grade_from_course(course: str) -> Optional[int]:
    """Extract grade number from course field."""
    import re
    # Match patterns like "Grade 3/3", "Grade 4/4", "Grade 9 Reading", etc.
    match = re.search(r'Grade\s+(\d+)', course)
    if match:
        return int(match.group(1))
    return None


def load_state(state_file: str) -> Dict:
    """Load extraction state from file."""
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not load state file: {e}. Starting fresh.")
            return {"completed": [], "errors": {}, "last_updated": None}
    return {"completed": [], "errors": {}, "last_updated": None}


def save_state(state_file: str, state: Dict):
    """Save extraction state to file."""
    state["last_updated"] = datetime.now().isoformat()
    try:
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        logger.debug(f"State saved: {len(state['completed'])} completed, {len(state['errors'])} errors")
    except Exception as e:
        logger.error(f"Failed to save state: {e}")


def validate_assessment(assessment: Dict) -> tuple[bool, Optional[str]]:
    """
    Validate that an assessment is complete and valid.
    Returns (is_valid, error_message)
    """
    if not assessment:
        return False, "Assessment is empty"
    
    if "error" in assessment:
        return False, f"Assessment contains error: {assessment.get('error')}"
    
    # Check required fields
    required_fields = ["identifier", "title", "test_parts"]
    for field in required_fields:
        if field not in assessment:
            return False, f"Missing required field: {field}"
    
    # Check if test_parts is empty
    if not assessment.get("test_parts"):
        return False, "No test parts found"
    
    # Check sections
    for part in assessment.get("test_parts", []):
        if not part.get("sections"):
            return False, "Test part has no sections"
        
        for section in part.get("sections", []):
            # Check if section has items
            if "items" not in section:
                return False, f"Section {section.get('identifier')} has no items"
            
            # Validate each item
            for item in section.get("items", []):
                if "error" in item:
                    return False, f"Item {item.get('identifier')} has error: {item.get('error')}"
                
                # Check if item has basic data
                if not item.get("identifier"):
                    return False, "Item missing identifier"
    
    return True, None


def validate_json_file(filepath: str) -> tuple[bool, Optional[str]]:
    """
    Validate that a JSON file is valid and complete.
    Returns (is_valid, error_message)
    """
    if not os.path.exists(filepath):
        return False, "File does not exist"
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"
    except Exception as e:
        return False, f"Error reading file: {e}"
    
    # Check structure
    if not isinstance(data, dict):
        return False, "JSON root is not an object"
    
    if "metadata" not in data:
        return False, "Missing metadata"
    
    if "assessments" not in data:
        return False, "Missing assessments array"
    
    if not isinstance(data["assessments"], list):
        return False, "Assessments is not an array"
    
    return True, None


def get_completed_from_json(filepath: str) -> Dict[str, Dict]:
    """
    Extract completed assessments from existing JSON file.
    Returns dict mapping article_id to assessment data.
    """
    completed = {}
    
    if not os.path.exists(filepath):
        logger.info(f"No existing output file found at {filepath}")
        return completed
    
    # Validate file first
    is_valid, error = validate_json_file(filepath)
    if not is_valid:
        logger.warning(f"Existing file validation failed: {error}. Will start fresh.")
        return completed
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        logger.info(f"Found existing file with {len(data.get('assessments', []))} assessments")
        
        # Validate each assessment
        for assessment in data.get('assessments', []):
            article_id = assessment.get('identifier')
            if not article_id:
                continue
            
            is_valid, error = validate_assessment(assessment)
            if is_valid:
                completed[article_id] = assessment
                logger.debug(f"✓ Valid: {article_id}")
            else:
                logger.warning(f"✗ Invalid: {article_id} - {error}")
        
        logger.info(f"Loaded {len(completed)} valid assessments from existing file")
        
    except Exception as e:
        logger.error(f"Error reading existing file: {e}")
        return {}
    
    return completed


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Extract assessment data from QTI API',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process first 5 tests (testing mode)
  python3 extract_qti_assessments.py --limit 5

  # Process all tests
  python3 extract_qti_assessments.py --all

  # Process all Grade 3 tests
  python3 extract_qti_assessments.py --grade 3 --all

  # Process first 20 Grade 5 tests
  python3 extract_qti_assessments.py --grade 5 --limit 20
        """
    )
    parser.add_argument('--limit', type=int, default=5,
                        help='Number of tests to process (default: 5)')
    parser.add_argument('--all', action='store_true',
                        help='Process all tests in the CSV file')
    parser.add_argument('--grade', type=int, choices=range(3, 13),
                        help='Filter by grade level (3-12)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output JSON file name (default: qti_grade_X_data.json or qti_assessment_data.json)')

    args = parser.parse_args()

    # Initialize logging
    global logger
    logger = setup_logging()
    
    logger.info("=" * 60)
    logger.info("QTI ASSESSMENT DATA EXTRACTOR")
    logger.info("=" * 60)
    logger.info(f"Log file: {LOG_FILE}")
    logger.info(f"State file: {STATE_FILE}")

    # Determine output filename first (needed for resume)
    if args.output:
        output_file = args.output
    elif args.grade:
        output_file = f"qti_grade_{args.grade}_data.json"
    else:
        output_file = "qti_assessment_data.json"
    
    logger.info(f"\n📁 Output file: {output_file}")
    
    # Load existing state and completed assessments
    state = load_state(STATE_FILE)
    completed_assessments = get_completed_from_json(output_file)
    
    if completed_assessments:
        logger.info(f"🔄 Resume mode: Found {len(completed_assessments)} already completed assessments")
    
    # Read CSV file
    csv_file = "article_ids - Sheet1 (1).csv"
    logger.info(f"\n📂 Reading CSV file: {csv_file}")

    assessment_ids = []
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            course = row.get('course', '')
            grade = extract_grade_from_course(course)
            
            # Filter by grade if specified
            if args.grade and grade != args.grade:
                continue
            
            assessment_ids.append({
                "course": course,
                "title": row.get('title'),
                "article_id": row.get('article_id'),
                "grade": grade
            })

    total_available = len(assessment_ids)

    # Display filter info
    if args.grade:
        logger.info(f"🎯 Filtering for Grade {args.grade} only")
        logger.info(f"📊 Found {total_available} Grade {args.grade} assessment tests")
    
    # Apply limit unless --all is specified
    if not args.all:
        assessment_ids = assessment_ids[:args.limit]
        grade_info = f" (Grade {args.grade})" if args.grade else ""
        logger.info(f"📊 Processing {len(assessment_ids)} of {total_available} assessment tests{grade_info} (limited to {args.limit} for testing)")
    else:
        grade_info = f" Grade {args.grade}" if args.grade else ""
        logger.info(f"📊 Processing ALL {len(assessment_ids)}{grade_info} assessment tests")

    # Initialize results structure
    # Start with completed assessments if resuming
    results = {
        "metadata": {
            "total_tests": len(assessment_ids),
            "extraction_date": time.strftime("%Y-%m-%d %H:%M:%S"),
            "api_base_url": API_BASE_URL,
            "grade_filter": args.grade if args.grade else "all"
        },
        "assessments": list(completed_assessments.values())
    }

    # Track statistics
    new_fetches = 0
    skipped = 0
    errors_occurred = 0
    
    # Process each assessment
    try:
        for i, assessment_info in enumerate(assessment_ids, 1):
            article_id = assessment_info['article_id']
            
            logger.info(f"\n[{i}/{len(assessment_ids)}] {assessment_info['title']}")
            logger.info(f"   Article ID: {article_id}")
            
            # Check if already completed
            if article_id in completed_assessments:
                logger.info(f"   ⏭️  Already completed - skipping")
                skipped += 1
                continue
            
            # Check if previously errored
            if article_id in state.get('errors', {}):
                prev_error = state['errors'][article_id]
                logger.warning(f"   ⚠️  Previously failed with: {prev_error}")
                logger.info(f"   🔄 Retrying...")
            
            try:
                # Fetch the assessment
                test_data = fetch_assessment_test(article_id)
                test_data['csv_metadata'] = {
                    "course": assessment_info['course'],
                    "title": assessment_info['title'],
                    "grade": assessment_info['grade']
                }
                
                # Validate the fetched data
                is_valid, validation_error = validate_assessment(test_data)
                if not is_valid:
                    raise Exception(f"Validation failed: {validation_error}")
                
                # Add to results
                results['assessments'].append(test_data)
                new_fetches += 1
                
                # Mark as completed in state
                if article_id not in state['completed']:
                    state['completed'].append(article_id)
                
                # Remove from errors if it was there
                if article_id in state.get('errors', {}):
                    del state['errors'][article_id]
                
                # Save progress after each successful fetch
                save_state(STATE_FILE, state)
                
                # Save JSON file periodically (every 10 assessments)
                if new_fetches % 10 == 0:
                    logger.info(f"   💾 Saving progress checkpoint...")
                    with open(output_file, 'w', encoding='utf-8') as f:
                        json.dump(results, f, indent=2, ensure_ascii=False)
                
                logger.info(f"   ✅ Success! ({new_fetches} new, {skipped} skipped)")
                
                # Delay between tests
                time.sleep(0.5)
                
            except Exception as e:
                errors_occurred += 1
                error_msg = str(e)
                logger.error(f"   ❌ ERROR: {error_msg}")
                
                # Record error in state
                state['errors'][article_id] = error_msg
                save_state(STATE_FILE, state)
                
                # Save current progress before stopping
                logger.info(f"\n💾 Saving progress before stopping...")
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(results, f, indent=2, ensure_ascii=False)
                
                # Log summary
                logger.error(f"\n" + "=" * 60)
                logger.error(f"EXTRACTION STOPPED DUE TO ERROR")
                logger.error(f"=" * 60)
                logger.error(f"Failed on: {article_id} - {assessment_info['title']}")
                logger.error(f"Error: {error_msg}")
                logger.error(f"\nProgress saved to: {output_file}")
                logger.error(f"State saved to: {STATE_FILE}")
                logger.error(f"\nStatistics:")
                logger.error(f"  • New assessments fetched: {new_fetches}")
                logger.error(f"  • Assessments skipped (already done): {skipped}")
                logger.error(f"  • Total completed: {len(state['completed'])}")
                logger.error(f"  • Total errors: {len(state['errors'])}")
                logger.error(f"\nTo resume, run the same command again.")
                logger.error(f"=" * 60)
                
                # Exit with error code
                sys.exit(1)
    
    except KeyboardInterrupt:
        # Handle Ctrl+C gracefully
        logger.warning(f"\n\n⚠️  Interrupted by user (Ctrl+C)")
        logger.info(f"💾 Saving progress...")
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        save_state(STATE_FILE, state)
        
        logger.info(f"\nProgress saved. Run the command again to resume.")
        sys.exit(0)
    
    logger.info(f"\n💾 Saving final results to: {output_file}")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    # Save final results
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    # Save final state
    save_state(STATE_FILE, state)
    
    # Calculate statistics
    total_items = sum(
        len(section['items'])
        for test in results['assessments']
        for part in test.get('test_parts', [])
        for section in part.get('sections', [])
    )

    grade_info = f" (Grade {args.grade})" if args.grade else ""
    logger.info(f"\n✅ Complete! Extraction Summary:")
    logger.info(f"=" * 60)
    logger.info(f"   • Grade filter: {results['metadata']['grade_filter']}")
    logger.info(f"   • New assessments fetched: {new_fetches}")
    logger.info(f"   • Assessments skipped (already done): {skipped}")
    logger.info(f"   • Total assessments in file: {len(results['assessments'])}{grade_info}")
    logger.info(f"   • Total items extracted: {total_items}")
    logger.info(f"   • Errors encountered: {len(state.get('errors', {}))}")
    logger.info(f"   • Output file: {output_file}")
    logger.info(f"   • File size: {os.path.getsize(output_file) / 1024:.1f} KB")
    logger.info(f"   • Log file: {LOG_FILE}")
    
    if state.get('errors'):
        logger.warning(f"\n⚠️  {len(state['errors'])} assessment(s) had errors:")
        for err_id, err_msg in list(state['errors'].items())[:5]:
            logger.warning(f"   • {err_id}: {err_msg}")
        if len(state['errors']) > 5:
            logger.warning(f"   ... and {len(state['errors']) - 5} more (see {LOG_FILE})")
    
    logger.info("=" * 60)
    logger.info("🎉 Extraction completed successfully!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
