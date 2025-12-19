#!/usr/bin/env python3
"""
Comparison Tracker Module

Tracks before/after state for each fixed question.
Generates comparison reports.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class ComparisonTracker:
    """Tracks before/after state for fixed questions."""
    
    def __init__(self, run_dir: Path, run_id: str):
        self.run_dir = run_dir
        self.run_id = run_id
        self.before_state: Dict[str, Dict[str, Any]] = {}
        self.after_state: Dict[str, Dict[str, Any]] = {}
        self.fix_attempts: List[Dict[str, Any]] = []
        
        # Create run directory
        self.run_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize fix log file
        self.fix_log_path = self.run_dir / "fix_log.jsonl"
    
    def record_before_state(
        self,
        question_id: str,
        qc_result: Dict[str, Any],
        question_data: Optional[Dict[str, Any]] = None
    ) -> None:
        """Record the state before fixing."""
        self.before_state[question_id] = {
            'score': qc_result.get('overall_score', 0),
            'total_checks': qc_result.get('total_checks_run', 0),
            'passed_checks': qc_result.get('total_checks_passed', 0),
            'failed_checks': self._get_failed_check_names(qc_result),
            'failed_reasons': self._get_failed_reasons(qc_result),
            'question_text': question_data.get('question', '') if question_data else '',
            'options': {
                'A': question_data.get('option_1', '') if question_data else '',
                'B': question_data.get('option_2', '') if question_data else '',
                'C': question_data.get('option_3', '') if question_data else '',
                'D': question_data.get('option_4', '') if question_data else ''
            }
        }
    
    def record_after_state(
        self,
        question_id: str,
        qc_result: Dict[str, Any]
    ) -> None:
        """Record the state after fixing."""
        self.after_state[question_id] = {
            'score': qc_result.get('overall_score', 0),
            'total_checks': qc_result.get('total_checks_run', 0),
            'passed_checks': qc_result.get('total_checks_passed', 0),
            'failed_checks': self._get_failed_check_names(qc_result),
            'failed_reasons': self._get_failed_reasons(qc_result)
        }
    
    def record_fix_attempt(
        self,
        question_id: str,
        fix_strategy: str,
        fixed_data: Optional[Dict[str, Any]],
        success: bool
    ) -> None:
        """Record a fix attempt."""
        attempt = {
            'question_id': question_id,
            'timestamp': datetime.now().isoformat(),
            'fix_strategy': fix_strategy,
            'success': success,
            'fixed_data': fixed_data
        }
        
        self.fix_attempts.append(attempt)
        
        # Append to log file (streaming)
        with open(self.fix_log_path, 'a') as f:
            f.write(json.dumps(attempt) + '\n')
    
    def _get_failed_check_names(self, qc_result: Dict[str, Any]) -> List[str]:
        """Extract names of failed checks."""
        failed = []
        for check_name, check_data in qc_result.get('checks', {}).items():
            if isinstance(check_data, dict) and check_data.get('score', 1) == 0:
                failed.append(check_name)
        return failed
    
    def _get_failed_reasons(self, qc_result: Dict[str, Any]) -> Dict[str, str]:
        """Extract failure reasons."""
        reasons = {}
        for check_name, check_data in qc_result.get('checks', {}).items():
            if isinstance(check_data, dict) and check_data.get('score', 1) == 0:
                reasons[check_name] = check_data.get('response', check_data.get('reasoning', ''))
        return reasons
    
    def save_before_state(self) -> None:
        """Save before state to file."""
        path = self.run_dir / "before_state.json"
        with open(path, 'w') as f:
            json.dump(self.before_state, f, indent=2)
        logger.info(f"Saved before state for {len(self.before_state)} questions")
    
    def generate_comparison_report(self) -> Dict[str, Any]:
        """Generate the comparison report."""
        
        # Calculate per-question comparisons
        questions = []
        
        for question_id in self.before_state:
            before = self.before_state.get(question_id, {})
            after = self.after_state.get(question_id, {})
            
            before_score = before.get('score', 0)
            after_score = after.get('score', 0)
            
            # Find the fix attempt for this question
            fix_attempt = next(
                (a for a in self.fix_attempts if a['question_id'] == question_id),
                {}
            )
            
            questions.append({
                'question_id': question_id,
                'fix_strategy': fix_attempt.get('fix_strategy', 'unknown'),
                'before': {
                    'score': before_score,
                    'failed_checks': before.get('failed_checks', []),
                    'failed_reasons': before.get('failed_reasons', {})
                },
                'after': {
                    'score': after_score,
                    'failed_checks': after.get('failed_checks', []),
                    'failed_reasons': after.get('failed_reasons', {})
                },
                'improved': after_score > before_score,
                'now_passing': after_score >= 0.8,
                'score_delta': round(after_score - before_score, 3)
            })
        
        # Calculate summary stats
        total = len(questions)
        distractor_fixes = sum(1 for q in questions if q['fix_strategy'] == 'distractor_fix')
        full_regenerations = sum(1 for q in questions if q['fix_strategy'] == 'full_regeneration')
        now_passing = sum(1 for q in questions if q['now_passing'])
        still_failing = total - now_passing
        improved = sum(1 for q in questions if q['improved'])
        
        avg_before = sum(q['before']['score'] for q in questions) / total if total > 0 else 0
        avg_after = sum(q['after']['score'] for q in questions) / total if total > 0 else 0
        
        # Calculate per-check improvement
        check_improvement = {}
        for q in questions:
            before_failed = set(q['before']['failed_checks'])
            after_failed = set(q['after']['failed_checks'])
            
            for check in before_failed:
                if check not in check_improvement:
                    check_improvement[check] = {'before_failures': 0, 'after_failures': 0, 'fixed': 0}
                check_improvement[check]['before_failures'] += 1
                if check not in after_failed:
                    check_improvement[check]['fixed'] += 1
            
            for check in after_failed:
                if check not in check_improvement:
                    check_improvement[check] = {'before_failures': 0, 'after_failures': 0, 'fixed': 0}
                check_improvement[check]['after_failures'] += 1
        
        report = {
            'run_id': self.run_id,
            'timestamp': datetime.now().isoformat(),
            'config': {
                'provider': 'openrouter',
                'model': 'anthropic/claude-sonnet-4',
                'questions_fixed': 'extended_only'
            },
            'summary': {
                'total_failed_extended': total,
                'distractor_fixes_attempted': distractor_fixes,
                'full_regenerations_attempted': full_regenerations,
                'now_passing': now_passing,
                'still_failing': still_failing,
                'improvement_rate': f"{100 * now_passing / total:.1f}%" if total > 0 else "0%",
                'questions_improved': improved,
                'avg_score_before': round(avg_before, 3),
                'avg_score_after': round(avg_after, 3),
                'avg_score_improvement': round(avg_after - avg_before, 3)
            },
            'by_check_improvement': check_improvement,
            'questions': questions
        }
        
        return report
    
    def save_comparison_report(self) -> str:
        """Generate and save the comparison report."""
        report = self.generate_comparison_report()
        
        path = self.run_dir / "comparison_report.json"
        with open(path, 'w') as f:
            json.dump(report, f, indent=2)
        
        logger.info(f"Saved comparison report to {path}")
        
        # Print summary
        summary = report['summary']
        logger.info("=" * 60)
        logger.info("FIX PIPELINE RESULTS")
        logger.info("=" * 60)
        logger.info(f"Total questions fixed: {summary['total_failed_extended']}")
        logger.info(f"  - Distractor fixes: {summary['distractor_fixes_attempted']}")
        logger.info(f"  - Full regenerations: {summary['full_regenerations_attempted']}")
        logger.info(f"Now passing: {summary['now_passing']} ({summary['improvement_rate']})")
        logger.info(f"Still failing: {summary['still_failing']}")
        logger.info(f"Average score: {summary['avg_score_before']:.2f} → {summary['avg_score_after']:.2f} (+{summary['avg_score_improvement']:.2f})")
        
        return str(path)


if __name__ == "__main__":
    # Test the module
    logging.basicConfig(level=logging.INFO)
    
    from datetime import datetime
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = Path(f"/tmp/fix_test_{run_id}")
    
    tracker = ComparisonTracker(run_dir, run_id)
    
    # Simulate before state
    tracker.record_before_state(
        "test_001",
        {'overall_score': 0.67, 'checks': {'plausibility': {'score': 0, 'response': 'Bad option'}}},
        {'question': 'Test question?', 'option_1': 'A', 'option_2': 'B', 'option_3': 'C', 'option_4': 'D'}
    )
    
    # Simulate fix
    tracker.record_fix_attempt("test_001", "distractor_fix", {'option_A': 'New A'}, True)
    
    # Simulate after state
    tracker.record_after_state(
        "test_001",
        {'overall_score': 0.89, 'checks': {'plausibility': {'score': 1, 'response': 'Good'}}}
    )
    
    tracker.save_before_state()
    tracker.save_comparison_report()
    
    print(f"Test files saved to {run_dir}")

