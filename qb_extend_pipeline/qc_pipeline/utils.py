#!/usr/bin/env python3
"""
Shared utility functions for the QC pipeline.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

logger = logging.getLogger(__name__)


# =============================================================================
# CONTENT HASH FUNCTIONS
# =============================================================================

def compute_content_hash(question_text: str, options: Dict[str, str], correct_answer: str) -> str:
    """
    Create a unique 12-character fingerprint of question content.
    If question text, options, or correct answer change, the hash changes.
    
    Args:
        question_text: The question stem
        options: Dict of option labels to option text (e.g., {"A": "...", "B": "..."})
        correct_answer: The correct option label (e.g., "A")
        
    Returns:
        12-character hash string
    """
    content = {
        "question": question_text.strip() if question_text else "",
        "options": {k: v.strip() if v else "" for k, v in sorted(options.items())},
        "correct": correct_answer.strip() if correct_answer else ""
    }
    content_str = json.dumps(content, sort_keys=True)
    return hashlib.sha256(content_str.encode()).hexdigest()[:12]


# =============================================================================
# TEXT TRUNCATION HELPERS
# =============================================================================

def truncate_text(text: str, max_length: int = 60, suffix: str = "...") -> str:
    """
    Truncate text to max_length, adding suffix if truncated.
    
    Args:
        text: Text to truncate
        max_length: Maximum length before truncation
        suffix: Suffix to add if truncated (default "...")
        
    Returns:
        Truncated text
    """
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)].rstrip() + suffix


def extract_passage_title(passage_text: str, max_length: int = 50) -> str:
    """
    Extract first line of passage as title, truncated to max_length.
    
    Args:
        passage_text: Full passage text
        max_length: Maximum length for title
        
    Returns:
        First line of passage, truncated with "..."
    """
    if not passage_text:
        return ""
    
    # Split by newlines and get first non-empty line
    lines = passage_text.strip().split('\n')
    first_line = ""
    for line in lines:
        line = line.strip()
        if line:
            first_line = line
            break
    
    if not first_line:
        # No newlines, take first sentence or chunk
        first_line = passage_text.strip()[:200]
    
    return truncate_text(first_line, max_length)


# =============================================================================
# OUTPUT FILE MANAGEMENT
# =============================================================================

def get_run_id() -> str:
    """Generate a run ID based on current timestamp."""
    return datetime.now().strftime('%Y%m%d_%H%M%S')


def archive_old_runs(output_dir: Path, keep_latest: int = 5) -> None:
    """
    Move old run files to archive folder, keeping only the latest N runs.
    
    Args:
        output_dir: The QC results output directory
        keep_latest: Number of recent runs to keep in main folder
    """
    runs_dir = output_dir / "runs"
    archive_dir = output_dir / "archive"
    
    if not runs_dir.exists():
        return
    
    archive_dir.mkdir(parents=True, exist_ok=True)
    
    # Find all run files (by timestamp pattern)
    run_files = sorted(runs_dir.glob("qc_run_*.json"), reverse=True)
    
    # Group by run_id (same timestamp)
    run_ids = set()
    for f in run_files:
        # Extract run_id from filename like qc_run_20251219_150000.json
        match = re.search(r'qc_run_(\d{8}_\d{6})', f.name)
        if match:
            run_ids.add(match.group(1))
    
    run_ids = sorted(run_ids, reverse=True)
    
    # Archive older runs
    if len(run_ids) > keep_latest:
        old_run_ids = run_ids[keep_latest:]
        for old_id in old_run_ids:
            for pattern in [f"qc_run_{old_id}*"]:
                for f in runs_dir.glob(pattern):
                    dest = archive_dir / f.name
                    logger.info(f"Archiving {f.name}")
                    shutil.move(str(f), str(dest))


def get_failed_checks_list(checks: Dict[str, Any]) -> str:
    """
    Get comma-separated list of failed check names.
    
    Args:
        checks: Dict of check_name -> check_result
        
    Returns:
        Comma-separated string of failed check names, or empty string if all passed
    """
    failed = []
    for check_name, check_data in checks.items():
        score = check_data.get('score', 0) if isinstance(check_data, dict) else 0
        if score != 1:
            failed.append(check_name)
    return ", ".join(sorted(failed)) if failed else ""


def load_prompts(prompts_file: Optional[str] = None) -> Dict[str, Any]:
    """
    Load prompts from the unified prompts.json file.

    Args:
        prompts_file: Path to prompts file. If None, uses default location.

    Returns:
        Dictionary containing all prompts
    """
    if prompts_file is None:
        # Default location relative to this file
        base_dir = Path(__file__).parent
        prompts_file = base_dir / "config" / "prompts.json"

    try:
        with open(prompts_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading prompts from {prompts_file}: {e}")
        raise


def parse_xml_response(response_text: str) -> Tuple[int, str]:
    """
    Parse QC response in XML format from Claude API.

    Expected format:
    <quality_check>
      <score>0|1</score>
      <reasoning>...</reasoning>
    </quality_check>

    Args:
        response_text: Raw response text from API

    Returns:
        Tuple of (score, reasoning)
    """
    try:
        # First try complete XML parsing
        if '<quality_check>' in response_text:
            if '</quality_check>' in response_text:
                # Complete XML found
                xml_match = re.search(r'<quality_check>(.*?)</quality_check>',
                                     response_text, re.DOTALL)
            else:
                # Incomplete XML - try to find score at least
                xml_match = re.search(r'<quality_check>(.*)',
                                     response_text, re.DOTALL)

            if xml_match:
                xml_content = xml_match.group(1)

                # Try complete XML parsing first
                if '</quality_check>' in response_text:
                    try:
                        full_xml = f"<quality_check>{xml_content}</quality_check>"
                        root = ET.fromstring(full_xml)
                        score_elem = root.find('score')
                        reasoning_elem = root.find('reasoning')

                        if score_elem is not None and score_elem.text:
                            score = int(score_elem.text.strip())
                            reasoning = (reasoning_elem.text.strip()
                                       if reasoning_elem is not None and reasoning_elem.text
                                       else "No reasoning provided")

                            # Ensure score is 0 or 1
                            score = 1 if score > 0 else 0
                            return score, reasoning
                    except ET.ParseError:
                        pass  # Fall through to partial parsing

                # Try partial XML parsing for incomplete responses
                score_match = re.search(r'<score>(\d+)</score>', xml_content)
                reasoning_match = re.search(r'<reasoning>(.*?)(?:</reasoning>|$)',
                                          xml_content, re.DOTALL)

                if score_match:
                    score = int(score_match.group(1))
                    score = 1 if score > 0 else 0

                    reasoning = (reasoning_match.group(1).strip()
                               if reasoning_match
                               else "XML format: Score found but reasoning incomplete")

                    return score, reasoning

        # Fallback to legacy parsing methods
        if '[1]' in response_text:
            return 1, "Legacy format: Contains [1]"
        elif '[0]' in response_text:
            return 0, "Legacy format: Contains [0]"
        else:
            # Try to find numbers in the response
            numbers = re.findall(r'\b[01]\b', response_text)
            if numbers:
                score = int(numbers[-1])  # Take the last 0 or 1 found
                return score, f"Legacy format: Found {score} in text"
            else:
                # Last resort: look for keywords
                response_lower = response_text.lower()
                if any(word in response_lower for word in
                      ['correct', 'good', 'appropriate', 'yes', 'passes']):
                    return 1, "Legacy format: Positive keywords detected"
                else:
                    return 0, "Legacy format: No clear positive indicators"

    except Exception as e:
        logger.warning(f"Could not parse QC response: {e}")
        logger.warning(f"Response text: {response_text[:300]}...")
        return 0, f"Parse error: {str(e)}"


def parse_json_response(response_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse JSON response from OpenAI API.

    Args:
        response_text: Raw response text from API

    Returns:
        Parsed JSON dict or None on failure
    """
    try:
        # Try to extract JSON from code blocks first
        if '```json' in response_text:
            json_start = response_text.find('```json') + 7
            json_end = response_text.find('```', json_start)
            json_content = response_text[json_start:json_end].strip()
            return json.loads(json_content)

        # Try parsing entire content as JSON
        return json.loads(response_text)
    except json.JSONDecodeError as e:
        logger.warning(f"Could not parse JSON response: {e}")
        return None


def fill_prompt_variables(prompt_template: str, variables: Dict[str, Any]) -> str:
    """
    Fill variables in prompt template.

    Supports both {variable} and [VARIABLE] placeholder formats.

    Args:
        prompt_template: Template string with placeholders
        variables: Dictionary of variable values

    Returns:
        Filled prompt string
    """
    filled = prompt_template

    for var, value in variables.items():
        # Handle {variable} format
        filled = filled.replace(f'{{{var}}}', str(value))
        # Handle [VARIABLE] format
        filled = filled.replace(f'[{var.upper()}]', str(value))

    return filled


def clamp_grade_to_band(grade: int) -> str:
    """
    Convert numeric grade to grade band.

    Args:
        grade: Numeric grade level

    Returns:
        Grade band: "elementary", "middle", or "high"
    """
    if grade < 3:
        return "elementary"
    elif 3 <= grade <= 5:
        return "elementary"
    elif 6 <= grade <= 8:
        return "middle"
    else:  # 9-12 and above
        return "high"


def validate_env_vars(*var_names: str) -> Dict[str, str]:
    """
    Validate that required environment variables are set.

    Args:
        *var_names: Variable names to check

    Returns:
        Dictionary of variable name -> value

    Raises:
        SystemExit if any variable is missing
    """
    missing = []
    values = {}

    for var in var_names:
        value = os.getenv(var)
        if not value:
            missing.append(var)
        else:
            values[var] = value

    if missing:
        logger.error(f"Missing required environment variables: {', '.join(missing)}")
        raise SystemExit(f"Missing environment variables: {', '.join(missing)}")

    return values


def strip_html(text: str) -> str:
    """
    Strip HTML tags from text while preserving structure.

    Args:
        text: Text potentially containing HTML

    Returns:
        Cleaned text
    """
    if not isinstance(text, str):
        return ""

    # Convert br tags to newlines
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    # Remove all other HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Squeeze whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def format_question_for_display(question_data: Dict[str, Any]) -> str:
    """
    Format question data into a readable string for logging/display.

    Args:
        question_data: Dictionary containing question information

    Returns:
        Formatted string
    """
    question_id = question_data.get('question_id', 'unknown')
    question_type = question_data.get('question_type', 'MCQ')
    grade = question_data.get('grade', 'N/A')

    return f"Question {question_id} (Type: {question_type}, Grade: {grade})"


def calculate_pass_rate(results: list) -> Dict[str, Any]:
    """
    Calculate summary statistics from QC results.

    Args:
        results: List of result dictionaries with 'overall_score' key

    Returns:
        Dictionary with summary statistics
    """
    if not results:
        return {
            'total': 0,
            'passed': 0,
            'failed': 0,
            'pass_rate': 0.0,
            'average_score': 0.0
        }

    total = len(results)
    passed = sum(1 for r in results if r.get('overall_score', 0) >= 0.8)
    failed = total - passed
    average_score = sum(r.get('overall_score', 0) for r in results) / total

    return {
        'total': total,
        'passed': passed,
        'failed': failed,
        'pass_rate': passed / total if total > 0 else 0.0,
        'average_score': average_score
    }

