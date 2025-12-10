#!/usr/bin/env python3
"""
Shared utility functions for the QC pipeline.
"""

import json
import logging
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


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
