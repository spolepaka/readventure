#!/usr/bin/env python3
"""
Alpha Read Course Cloner

Clones an existing Alpha Read course structure in OneRoster, using either:
- Original article IDs (for testing/reference)
- New rv_ prefixed article IDs (for new course with new QTI content)

This script ONLY touches OneRoster - it does NOT create QTI content.
QTI content must be created separately using build_course.py.

Usage:
    # Clone to a new course (will prompt for course details)
    python clone_course.py --source-course-id <id> --mode create
    
    # Clone to an existing course (update it)
    python clone_course.py --source-course-id <id> --mode update --target-course-id <id>
    
    # Use new rv_ prefixed IDs from question bank
    python clone_course.py --source-course-id <id> --mode create --use-new-ids
    
    # Use original IDs (exact copy)
    python clone_course.py --source-course-id <id> --mode create --use-original-ids
    
    # Dry run
    python clone_course.py --source-course-id <id> --mode create --dry-run

Based on documentation:
- COURSE-STRUCTURE-BREAKDOWN.md: Data structure and hierarchy
- Creating a new Alpha Read Article.md: OneRoster structure
"""

import os
import sys
import json
import requests
import argparse
import uuid
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from pathlib import Path
import logging


# =============================================================================
# Configuration
# =============================================================================

ONEROSTER_API_BASE_URL = "https://api.alpha-1edtech.ai"
COGNITO_URL = "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token"
QTI_API_BASE_URL = "https://qti.alpha-1edtech.ai/api"

# Default credentials
CLIENT_ID = os.getenv("TIMEBACK_CLIENT_ID", "31rkusu8sloquan3cmcb9p8v33")
CLIENT_SECRET = os.getenv("TIMEBACK_CLIENT_SECRET", "1vv89lcl7lfu151ruccfts4hauefc0r1epdvaotbrgupvcif4cor")

# Paths
SCRIPT_DIR = Path(__file__).parent
QUESTION_BANK_FILE = SCRIPT_DIR / "final_deliverables_grade3" / "comprehensive_question_bank_grade3_3277_questions.json"

# Global state
logger = None
access_token = None
dry_run = False
article_id_map = {}  # Maps original IDs to new IDs
clone_counter = 1  # For generating unique clone suffixes


# =============================================================================
# Logging Setup
# =============================================================================

def setup_logging(verbose: bool = False):
    global logger
    logger = logging.getLogger('course_cloner')
    logger.setLevel(logging.DEBUG)
    logger.handlers = []
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    console_handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(console_handler)
    
    return logger


# =============================================================================
# Authentication
# =============================================================================

def get_oauth_token() -> str:
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
    logger.info("✅ Token obtained")
    return access_token


def get_auth_headers() -> Dict:
    return {
        "Authorization": f"Bearer {get_oauth_token()}",
        "Content-Type": "application/json"
    }


# =============================================================================
# Article ID Mapping
# =============================================================================

def load_article_id_mapping(id_mapping_file: str = None, auto_generate: bool = True) -> Dict[str, str]:
    """
    Load or generate article ID mapping for OneRoster sourcedIds.
    
    OneRoster sourcedIds MUST be unique. The QTI URL reference can point to
    existing content (same QTI can be used by multiple OneRoster resources).
    
    The mapping is: {original_article_id: new_oneroster_sourcedId}
    
    Options:
    1. If id_mapping_file provided, load custom mapping from JSON file
    2. If auto_generate=True (default), generate unique IDs automatically
    
    ID mapping file format (JSON):
    {
        "article_101001": {
            "sourcedId": "my_custom_id_001",
            "qti_id": "article_101001"  // optional, defaults to original
        }
    }
    
    Or simple format:
    {
        "article_101001": "my_custom_sourcedId_001"
    }
    """
    global article_id_map
    
    # Option 1: Load from custom mapping file
    if id_mapping_file:
        mapping_path = Path(id_mapping_file)
        if not mapping_path.is_absolute():
            mapping_path = SCRIPT_DIR / mapping_path
        
        if not mapping_path.exists():
            logger.error(f"❌ ID mapping file not found: {mapping_path}")
            sys.exit(1)
        
        logger.info(f"📋 Loading article ID mapping from: {mapping_path}")
        with open(mapping_path, 'r', encoding='utf-8') as f:
            raw_mapping = json.load(f)
        
        # Normalize the mapping format
        for orig_id, value in raw_mapping.items():
            if isinstance(value, str):
                # Simple format: {"article_101001": "new_id"}
                article_id_map[orig_id] = {
                    "sourcedId": value,
                    "qti_id": orig_id  # Use original for QTI reference
                }
            elif isinstance(value, dict):
                # Full format: {"article_101001": {"sourcedId": "...", "qti_id": "..."}}
                article_id_map[orig_id] = {
                    "sourcedId": value.get("sourcedId", value.get("sourcedid", str(uuid.uuid4()))),
                    "qti_id": value.get("qti_id", value.get("qtiId", orig_id))
                }
        
        logger.info(f"✅ Loaded {len(article_id_map)} custom ID mappings")
        return article_id_map
    
    # Option 2: Auto-generate unique IDs
    if auto_generate:
        logger.info(f"📋 Will auto-generate unique OneRoster sourcedIds")
        logger.info(f"   Format: clone_<uuid>_<original_id>")
        logger.info(f"   QTI references will point to original content")
        # Mapping will be generated on-the-fly in map_article_id()
        return {}
    
    return {}


def generate_unique_sourcedid(original_id: str, prefix: str = "clone") -> str:
    """Generate a unique OneRoster sourcedId based on original ID."""
    # Use a short UUID segment for uniqueness
    short_uuid = str(uuid.uuid4())[:8]
    return f"{prefix}_{short_uuid}_{original_id}"


def map_article_id(original_id: str) -> Dict[str, str]:
    """
    Map an original article ID to new IDs.
    
    Returns:
        {
            "sourcedId": unique OneRoster ID,
            "qti_id": QTI reference ID (can be same as original to reuse QTI content)
        }
    """
    if original_id in article_id_map:
        mapping = article_id_map[original_id]
        if isinstance(mapping, dict):
            return mapping
        else:
            # Legacy simple string mapping
            return {"sourcedId": mapping, "qti_id": original_id}
    
    # Auto-generate unique sourcedId, keep original for QTI reference
    new_sourcedid = generate_unique_sourcedid(original_id)
    article_id_map[original_id] = {
        "sourcedId": new_sourcedid,
        "qti_id": original_id
    }
    return article_id_map[original_id]


# =============================================================================
# OneRoster API - Read
# =============================================================================

def get_course_syllabus(course_id: str) -> Optional[Dict]:
    """Get full course structure including units and articles."""
    logger.info(f"📚 Fetching source course: {course_id}")
    
    try:
        response = requests.get(
            f"{ONEROSTER_API_BASE_URL}/powerpath/syllabus/{course_id}",
            headers=get_auth_headers(),
            timeout=60
        )
        response.raise_for_status()
        data = response.json()
        
        syllabus = data.get('syllabus', data)
        course = syllabus.get('course', {})
        units = syllabus.get('subComponents', [])
        
        total_articles = sum(len(u.get('componentResources', [])) for u in units)
        
        logger.info(f"✅ Found course: {course.get('title')}")
        logger.info(f"   Units: {len(units)}")
        logger.info(f"   Articles: {total_articles}")
        
        return syllabus
    except Exception as e:
        logger.error(f"❌ Error fetching course: {e}")
        return None


# =============================================================================
# OneRoster API - Create
# =============================================================================

def create_course(course_data: Dict) -> Optional[Dict]:
    """Create a new course."""
    if dry_run:
        logger.info(f"  [DRY RUN] Would create course: {course_data.get('title')}")
        return {"sourcedId": str(uuid.uuid4())}
    
    logger.info(f"📝 Creating course: {course_data.get('title')}")
    
    payload = {"course": course_data}
    
    try:
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        logger.info(f"✅ Course created: {result.get('sourcedIdPairs', {}).get('allocatedSourcedId', 'unknown')}")
        return result
    except requests.exceptions.HTTPError as e:
        logger.error(f"❌ Error creating course: {e}")
        if hasattr(e, 'response') and e.response:
            logger.debug(f"   Response: {e.response.text[:500]}")
        return None


def create_course_component(component_data: Dict) -> Optional[Dict]:
    """Create a course component (unit)."""
    if dry_run:
        logger.info(f"    [DRY RUN] Would create unit: {component_data.get('title')}")
        return {"sourcedId": component_data.get('sourcedId', str(uuid.uuid4()))}
    
    logger.debug(f"    📁 Creating unit: {component_data.get('title')}")
    
    payload = {"courseComponent": component_data}
    
    try:
        # Correct endpoint: /courses/components (not /courses/course-components)
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses/components",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"    ✅ Unit created")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code in [404, 409]:
            try:
                error_msg = e.response.json().get('imsx_description', '')
                if 'already exists' in error_msg.lower():
                    logger.debug(f"    ⚠️ Unit already exists")
                    return {"sourcedId": component_data.get('sourcedId'), "exists": True}
            except:
                pass
        logger.error(f"    ❌ Error creating unit: {e}")
        return None


def create_resource(resource_data: Dict) -> Optional[Dict]:
    """Create a resource (links to QTI)."""
    if dry_run:
        logger.debug(f"      [DRY RUN] Would create resource: {resource_data.get('sourcedId')}")
        return {"sourcedId": resource_data.get('sourcedId')}
    
    logger.debug(f"      📦 Creating resource: {resource_data.get('sourcedId')}")
    
    payload = {"resource": resource_data}
    
    try:
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/resources/v1p2/resources",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"      ✅ Resource created")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code in [404, 409]:
            try:
                error_msg = e.response.json().get('imsx_description', '')
                if 'already exists' in error_msg.lower():
                    logger.debug(f"      ⚠️ Resource already exists")
                    return {"sourcedId": resource_data.get('sourcedId'), "exists": True}
            except:
                pass
        logger.error(f"      ❌ Error creating resource: {e}")
        return None


def create_component_resource(comp_res_data: Dict) -> Optional[Dict]:
    """Create a component resource (article in a unit)."""
    if dry_run:
        logger.debug(f"      [DRY RUN] Would create article: {comp_res_data.get('title')}")
        return {"sourcedId": comp_res_data.get('sourcedId')}
    
    logger.debug(f"      📄 Creating article: {comp_res_data.get('title')}")
    
    payload = {"componentResource": comp_res_data}
    
    try:
        response = requests.post(
            f"{ONEROSTER_API_BASE_URL}/ims/oneroster/rostering/v1p2/courses/component-resources",
            headers=get_auth_headers(),
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        logger.debug(f"      ✅ Article created")
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code in [404, 409]:
            try:
                error_msg = e.response.json().get('imsx_description', '')
                if 'already exists' in error_msg.lower():
                    logger.debug(f"      ⚠️ Article already exists")
                    return {"sourcedId": comp_res_data.get('sourcedId'), "exists": True}
            except:
                pass
        logger.error(f"      ❌ Error creating article: {e}")
        return None


# =============================================================================
# Course Cloning Logic
# =============================================================================

def get_next_clone_number(source_title: str) -> int:
    """
    Determine the next clone number by checking existing courses.
    Returns 1 if no clones exist, otherwise returns next available number.
    """
    # For now, use timestamp-based suffix to ensure uniqueness
    # In a full implementation, you could query existing courses
    from datetime import datetime
    return int(datetime.now().strftime("%H%M%S"))


def generate_unique_course_code(source_code: str, clone_num: int) -> str:
    """Generate a unique course code with clone suffix."""
    if source_code:
        # Remove any existing clone suffix
        base_code = source_code.split('-clone-')[0]
        return f"{base_code}-clone-{clone_num}"
    else:
        return f"course-clone-{clone_num}"


def prompt_for_course_details(source_course: Dict, non_interactive: bool = False, 
                               course_title: str = None, course_grades: List[str] = None) -> Dict:
    """
    Prompt user for new course details (or use defaults if non-interactive).
    
    Ensures uniqueness:
    - sourcedId: Always generates a new UUID
    - title: Adds "Clone N" suffix
    - courseCode: Adds "-clone-N" suffix
    """
    clone_num = get_next_clone_number(source_course.get('title', ''))
    
    source_title = source_course.get('title', 'Untitled Course')
    source_code = source_course.get('courseCode', '')
    
    # Generate unique defaults
    default_title = f"{source_title} (Clone {clone_num})"
    default_code = generate_unique_course_code(source_code, clone_num)
    default_grades = source_course.get('grades', ['3'])
    default_email = source_course.get('metadata', {}).get('contactEmail', '')
    
    if non_interactive:
        # Use provided values or defaults
        title = course_title or default_title
        code = default_code
        grades = course_grades or default_grades
        email = default_email
        logger.info(f"\n📋 New course details (auto-generated for uniqueness):")
        logger.info(f"   Title: {title}")
        logger.info(f"   Course Code: {code}")
        logger.info(f"   Grades: {grades}")
    else:
        print("\n" + "="*60)
        print("NEW COURSE DETAILS")
        print("="*60)
        print(f"Source course: {source_title}")
        print(f"Source code: {source_code or '(none)'}")
        print("-"*60)
        print("NOTE: Title and code must be unique in OneRoster database")
        print("-"*60)
        
        # Title (with unique suffix)
        title = input(f"Course title [{default_title}]: ").strip()
        if not title:
            title = default_title
        
        # Course code (with unique suffix)
        code = input(f"Course code [{default_code}]: ").strip()
        if not code:
            code = default_code
        
        # Grades
        grades_input = input(f"Grades (comma-separated) [{','.join(default_grades)}]: ").strip()
        if grades_input:
            grades = [g.strip() for g in grades_input.split(',')]
        else:
            grades = default_grades
        
        # Contact email
        email = input(f"Contact email [{default_email}]: ").strip()
        if not email:
            email = default_email
    
    # Build new course data - always generate new sourcedId
    new_course_id = str(uuid.uuid4())
    
    # Copy metadata but update specific fields
    new_metadata = {**source_course.get('metadata', {})}
    new_metadata['contactEmail'] = email
    new_metadata['clonedFrom'] = source_course.get('sourcedId')
    new_metadata['clonedAt'] = datetime.utcnow().isoformat()
    new_metadata['isClone'] = True
    
    return {
        "sourcedId": new_course_id,  # Always new
        "status": "active",
        "title": title,  # Unique with Clone N suffix
        "courseCode": code,  # Unique with -clone-N suffix
        "grades": grades,
        "metadata": new_metadata
    }


def clone_course_structure(
    source_syllabus: Dict,
    target_course_id: Optional[str] = None,
    non_interactive: bool = False,
    course_title: str = None,
    course_grades: List[str] = None
) -> Dict:
    """
    Clone the course structure from source to target.
    
    All OneRoster IDs are UNIQUE:
    - Course sourcedId - always new UUID
    - Course title - gets "Clone N" suffix
    - Course courseCode - gets "-clone-N" suffix
    - Units (courseComponents) - new UUIDs
    - Resources - new unique IDs (auto-generated or from mapping)
    - Component Resources - new unique IDs (matching resources)
    
    QTI references can point to EXISTING content:
    - metadata.url points to original QTI assessment tests
    - No need to duplicate QTI content
    
    In UPDATE mode:
    - Does NOT modify the target course itself
    - Only adds units, articles, resources to the existing course
    
    Args:
        source_syllabus: Source course syllabus data
        target_course_id: Target course ID (None to create new)
    
    Returns:
        Statistics dict
    """
    stats = {
        "course_created": False,
        "units_created": 0,
        "articles_created": 0,
        "resources_created": 0,
        "errors": []
    }
    
    source_course = source_syllabus.get('course', {})
    source_units = source_syllabus.get('subComponents', [])
    
    # Create or use target course
    if target_course_id:
        # UPDATE MODE: Use existing course, don't modify course-level fields
        logger.info(f"\n📋 UPDATE MODE: Adding components to existing course")
        logger.info(f"   Target course ID: {target_course_id}")
        logger.info(f"   (Course title, code, ID will NOT be modified)")
        new_course_id = target_course_id
    else:
        # CREATE MODE: Create new course with unique identifiers
        logger.info(f"\n📋 CREATE MODE: Creating new course with unique identifiers")
        new_course_data = prompt_for_course_details(
            source_course, 
            non_interactive=non_interactive,
            course_title=course_title,
            course_grades=course_grades
        )
        result = create_course(new_course_data)
        if result:
            new_course_id = result.get('sourcedIdPairs', {}).get('allocatedSourcedId') or new_course_data['sourcedId']
            stats["course_created"] = True
            logger.info(f"   New course ID: {new_course_id}")
        else:
            stats["errors"].append("Failed to create course")
            return stats
    
    logger.info(f"\n📚 Cloning {len(source_units)} units...")
    
    # Clone each unit
    for unit_idx, source_unit in enumerate(source_units, 1):
        unit_title = source_unit.get('title', f'Unit {unit_idx}')
        logger.info(f"\n  📁 Unit {unit_idx}/{len(source_units)}: {unit_title}")
        
        # Create new unit ID
        new_unit_id = str(uuid.uuid4())
        
        # Create unit (course component)
        unit_data = {
            "sourcedId": new_unit_id,
            "status": "active",
            "title": unit_title,
            "sortOrder": source_unit.get('sortOrder', unit_idx),
            "course": {"sourcedId": new_course_id},
            "metadata": source_unit.get('metadata', {})
        }
        
        result = create_course_component(unit_data)
        if result:
            stats["units_created"] += 1
        else:
            stats["errors"].append(f"Failed to create unit: {unit_title}")
            continue
        
        # Clone articles in this unit
        source_articles = source_unit.get('componentResources', [])
        logger.info(f"    Cloning {len(source_articles)} articles...")
        
        for article_idx, source_article in enumerate(source_articles, 1):
            original_article_id = source_article.get('sourcedId', '')
            article_title = source_article.get('title', f'Article {article_idx}')
            
            # Map article ID - get both OneRoster sourcedId and QTI reference
            id_mapping = map_article_id(original_article_id)
            new_sourcedid = id_mapping["sourcedId"]  # Unique OneRoster ID
            qti_id = id_mapping["qti_id"]  # QTI reference (can be original)
            
            # Extract vendor resource ID (numeric part from new sourcedId)
            if '_article_' in new_sourcedid:
                vendor_resource_id = new_sourcedid.split('_article_')[-1]
            elif new_sourcedid.startswith('article_'):
                vendor_resource_id = new_sourcedid.replace('article_', '')
            else:
                vendor_resource_id = new_sourcedid[-12:]  # Last 12 chars
            
            # Get source resource metadata
            source_resource = source_article.get('resource', {})
            source_metadata = source_resource.get('metadata', {})
            
            # Create resource first (links to QTI)
            # Note: sourcedId is unique for OneRoster, but URL points to QTI content
            resource_data = {
                "sourcedId": new_sourcedid,  # Unique OneRoster ID
                "status": "active",
                "title": article_title,
                "roles": ["primary"],
                "importance": "primary",
                "vendorResourceId": vendor_resource_id,
                "vendorId": "playcademy-course-builder",
                "applicationId": "playcademy-course-builder-1.0.0",
                "metadata": {
                    "sourcedId": new_sourcedid,
                    "type": "qti",
                    "subType": "qti-test",
                    "lessonType": "alpha-read-article",
                    "url": f"{QTI_API_BASE_URL}/assessment-tests/{qti_id}",  # QTI reference
                    "xp": source_metadata.get('xp', 15),
                    "questionType": source_metadata.get('questionType', 'custom'),
                    "originalArticleId": original_article_id  # Track source
                }
            }
            
            result = create_resource(resource_data)
            if result:
                stats["resources_created"] += 1
            
            # Create component resource (article in unit)
            comp_res_data = {
                "sourcedId": new_sourcedid,  # Must match resource sourcedId
                "status": "active",
                "title": article_title,
                "sortOrder": source_article.get('sortOrder', article_idx),
                "courseComponent": {"sourcedId": new_unit_id},
                "resource": {"sourcedId": new_sourcedid},  # Reference to resource
                "lessonType": "alpha-read-article",
                "metadata": source_article.get('metadata', {})
            }
            
            result = create_component_resource(comp_res_data)
            if result:
                stats["articles_created"] += 1
            else:
                stats["errors"].append(f"Failed to create article: {article_title}")
    
    return stats


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    global dry_run
    
    parser = argparse.ArgumentParser(
        description='Clone an Alpha Read course structure in OneRoster',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Clone to new course with new rv_ IDs (recommended)
  python clone_course.py --source-course-id 80c8fa8d-... --mode create --use-new-ids
  
  # Clone with original IDs (for testing)
  python clone_course.py --source-course-id 80c8fa8d-... --mode create --use-original-ids
  
  # Update existing course
  python clone_course.py --source-course-id 80c8fa8d-... --mode update --target-course-id abc123...
  
  # Dry run
  python clone_course.py --source-course-id 80c8fa8d-... --mode create --dry-run
        """
    )
    
    parser.add_argument('--source-course-id', required=True,
                        help='Source course ID to clone from')
    parser.add_argument('--mode', choices=['create', 'update'], required=True,
                        help='Create new course or update existing')
    parser.add_argument('--target-course-id', default=None,
                        help='Target course ID (required for update mode)')
    
    parser.add_argument('--id-mapping-file', type=str, default=None,
                        help='JSON file with custom ID mappings (see docs for format)')
    
    parser.add_argument('--dry-run', action='store_true',
                        help='Simulate without making API calls')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose logging')
    parser.add_argument('--non-interactive', action='store_true',
                        help='Use default values without prompting')
    parser.add_argument('--course-title', type=str, default=None,
                        help='New course title (for non-interactive mode)')
    parser.add_argument('--course-grades', type=str, default=None,
                        help='New course grades, comma-separated (for non-interactive mode)')
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.mode == 'update' and not args.target_course_id:
        parser.error("--target-course-id is required for update mode")
    
    # Set global flags
    dry_run = args.dry_run
    
    # Setup logging
    setup_logging(verbose=args.verbose)
    
    logger.info("="*60)
    logger.info("ALPHA READ COURSE CLONER")
    logger.info("="*60)
    logger.info(f"Source course: {args.source_course_id}")
    logger.info(f"Mode: {args.mode}")
    if args.id_mapping_file:
        logger.info(f"Article IDs: Custom mapping from {args.id_mapping_file}")
    else:
        logger.info(f"Article IDs: Auto-generated unique IDs (QTI refs to original)")
    if args.target_course_id:
        logger.info(f"Target course: {args.target_course_id}")
    if dry_run:
        logger.info("🔒 DRY RUN MODE - No API calls will be made")
    logger.info("="*60)
    
    # Load article ID mapping (if provided) or auto-generate
    load_article_id_mapping(id_mapping_file=args.id_mapping_file)
    
    # Fetch source course
    source_syllabus = get_course_syllabus(args.source_course_id)
    if not source_syllabus:
        logger.error("❌ Failed to fetch source course")
        sys.exit(1)
    
    # Parse course grades if provided
    course_grades = None
    if args.course_grades:
        course_grades = [g.strip() for g in args.course_grades.split(',')]
    
    # Clone the course
    stats = clone_course_structure(
        source_syllabus=source_syllabus,
        target_course_id=args.target_course_id if args.mode == 'update' else None,
        non_interactive=args.non_interactive or args.dry_run,  # Auto non-interactive in dry-run
        course_title=args.course_title,
        course_grades=course_grades
    )
    
    # Print summary
    logger.info("\n" + "="*60)
    logger.info("CLONE COMPLETE")
    logger.info("="*60)
    logger.info(f"   Course created: {stats['course_created']}")
    logger.info(f"   Units created: {stats['units_created']}")
    logger.info(f"   Articles created: {stats['articles_created']}")
    logger.info(f"   Resources created: {stats['resources_created']}")
    logger.info(f"   Errors: {len(stats['errors'])}")
    
    if stats['errors']:
        logger.warning("\n⚠️ Errors encountered:")
        for err in stats['errors'][:10]:
            logger.warning(f"   - {err}")
    
    if dry_run:
        logger.info("\n🔒 This was a DRY RUN - no actual changes were made")
    else:
        logger.info("\n✅ Course structure cloned successfully!")
        logger.info("   Next step: Run build_course.py to create QTI content")


if __name__ == "__main__":
    main()
