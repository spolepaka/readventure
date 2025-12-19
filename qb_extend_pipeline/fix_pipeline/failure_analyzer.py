#!/usr/bin/env python3
"""
Failure Analyzer Module

Analyzes failed QC questions and determines the appropriate fix strategy.
"""

import json
import logging
from typing import Dict, Any, List, Tuple, Set
from pathlib import Path

logger = logging.getLogger(__name__)

# Check categories
CRITICAL_CHECKS = {
    'single_correct_answer',  # Multiple answers could be correct - fundamental issue
    'passage_reference',      # References non-existent content
    'standard_alignment'      # Tests wrong skill
}

DISTRACTOR_CHECKS = {
    'grammatical_parallel',   # Grammar mismatch between options
    'plausibility',           # Implausible distractor
    'homogeneity',            # Mixed categories in options
    'specificity_balance',    # Uneven detail levels
    'too_close',              # Distractor too similar to correct
    'length_check'            # Length imbalance
}

QUESTION_CLARITY_CHECKS = {
    'clarity_precision',      # Ambiguous wording
    'difficulty_assessment'   # Wrong difficulty level
}

# Pass threshold
PASS_THRESHOLD = 0.8


def load_qc_results(qc_results_path: str) -> List[Dict[str, Any]]:
    """Load QC results from JSON file."""
    with open(qc_results_path, 'r') as f:
        return json.load(f)


def get_failed_extended_questions(qc_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter to only failed extended (sibling) questions.
    
    Returns:
        List of failed question results (only those with '_sibling_' in ID)
    """
    failed_extended = [
        q for q in qc_results
        if '_sibling_' in q.get('question_id', '')
        and q.get('overall_score', 1.0) < PASS_THRESHOLD
    ]
    
    logger.info(f"Found {len(failed_extended)} failed extended questions")
    return failed_extended


def get_failed_checks(question_result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Get all failed checks with their details.
    
    Returns:
        Dict mapping check_name -> {score, response/reasoning}
    """
    checks = question_result.get('checks', {})
    failed = {}
    
    for check_name, check_data in checks.items():
        if isinstance(check_data, dict):
            score = check_data.get('score', 1)
            if score == 0:
                failed[check_name] = {
                    'score': score,
                    'reasoning': check_data.get('response', check_data.get('reasoning', 'No reasoning provided'))
                }
    
    return failed


def determine_fix_strategy(failed_checks: Dict[str, Dict[str, Any]]) -> str:
    """
    Determine the fix strategy based on which checks failed.
    
    Returns:
        'distractor_fix' or 'full_regeneration'
    """
    failed_check_names = set(failed_checks.keys())
    
    # If any critical check failed, need full regeneration
    if failed_check_names & CRITICAL_CHECKS:
        critical_failed = failed_check_names & CRITICAL_CHECKS
        logger.debug(f"Critical checks failed: {critical_failed} -> full_regeneration")
        return 'full_regeneration'
    
    # If clarity/precision failed, need full regeneration
    if 'clarity_precision' in failed_check_names:
        logger.debug("clarity_precision failed -> full_regeneration")
        return 'full_regeneration'
    
    # Count distractor-related failures
    distractor_failures = failed_check_names & DISTRACTOR_CHECKS
    
    # If 3+ distractor issues, full regeneration is cleaner
    if len(distractor_failures) >= 3:
        logger.debug(f"{len(distractor_failures)} distractor checks failed -> full_regeneration")
        return 'full_regeneration'
    
    # Otherwise, just fix the distractors
    logger.debug(f"{len(distractor_failures)} distractor checks failed -> distractor_fix")
    return 'distractor_fix'


def analyze_question(question_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze a single failed question and prepare fix details.
    
    Returns:
        Dict with question_id, failed_checks, fix_strategy, and formatted failure details
    """
    question_id = question_result.get('question_id', 'unknown')
    
    # Get failed checks with reasoning
    failed_checks = get_failed_checks(question_result)
    
    # Determine strategy
    fix_strategy = determine_fix_strategy(failed_checks)
    
    # Categorize failures
    failed_distractor = set(failed_checks.keys()) & DISTRACTOR_CHECKS
    failed_critical = set(failed_checks.keys()) & CRITICAL_CHECKS
    failed_clarity = set(failed_checks.keys()) & QUESTION_CLARITY_CHECKS
    
    return {
        'question_id': question_id,
        'original_score': question_result.get('overall_score', 0),
        'total_checks': question_result.get('total_checks_run', 0),
        'passed_checks': question_result.get('total_checks_passed', 0),
        'fix_strategy': fix_strategy,
        'failed_checks': failed_checks,
        'failed_check_names': list(failed_checks.keys()),
        'failed_distractor_checks': list(failed_distractor),
        'failed_critical_checks': list(failed_critical),
        'failed_clarity_checks': list(failed_clarity),
        'all_checks': question_result.get('checks', {})
    }


def format_failure_reasoning(failed_checks: Dict[str, Dict[str, Any]]) -> str:
    """
    Format the failure reasoning for use in prompts.
    
    Returns:
        Formatted string with each failed check and its reasoning
    """
    lines = []
    for check_name, check_data in failed_checks.items():
        reasoning = check_data.get('reasoning', 'No reasoning provided')
        lines.append(f"### {check_name} - FAILED")
        lines.append(reasoning)
        lines.append("")
    
    return "\n".join(lines)


def analyze_all_failures(qc_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Analyze all failed extended questions.
    
    Returns:
        List of analysis results for each failed question
    """
    failed_extended = get_failed_extended_questions(qc_results)
    
    analyses = []
    strategy_counts = {'distractor_fix': 0, 'full_regeneration': 0}
    
    for question_result in failed_extended:
        analysis = analyze_question(question_result)
        analyses.append(analysis)
        strategy_counts[analysis['fix_strategy']] += 1
    
    logger.info(f"Analysis complete:")
    logger.info(f"  - Distractor fixes needed: {strategy_counts['distractor_fix']}")
    logger.info(f"  - Full regenerations needed: {strategy_counts['full_regeneration']}")
    
    return analyses


if __name__ == "__main__":
    # Test the module
    import sys
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python failure_analyzer.py <qc_results.json>")
        sys.exit(1)
    
    qc_results = load_qc_results(sys.argv[1])
    analyses = analyze_all_failures(qc_results)
    
    print(f"\nFound {len(analyses)} failed extended questions:")
    for a in analyses[:5]:  # Show first 5
        print(f"  {a['question_id']}: {a['fix_strategy']} ({len(a['failed_check_names'])} failures)")

