"""
Unified Quality Control Pipeline for Reading Comprehension Assessment

This package provides comprehensive quality control for:
- Question validation (MCQ and MP question types)
- Explanation validation (correct answers and distractors)
"""

__version__ = "1.0.0"
__author__ = "Reading QC Team"

from .modules.question_qc import QuestionQCAnalyzer
from .modules.explanation_qc import ExplanationQCAnalyzer

__all__ = [
    "QuestionQCAnalyzer",
    "ExplanationQCAnalyzer",
]
