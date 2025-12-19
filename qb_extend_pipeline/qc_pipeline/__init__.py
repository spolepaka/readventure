"""
Unified Quality Control Pipeline for Reading Comprehension Assessment

This package provides comprehensive quality control for:
- Question validation (MCQ and MP question types)
- Explanation validation (correct answers and distractors)

Pipeline Versions:
- V1: Sequential API calls, baseline implementation
- V2: Optimized with batched API calls per question (2 calls vs 8-10)
- V3: Batch API processing for large-scale QC (50% cost reduction)
"""

__version__ = "3.0.0"
__author__ = "Reading QC Team"

# V1 - Original sequential analyzers
from .modules.question_qc import QuestionQCAnalyzer
from .modules.explanation_qc import ExplanationQCAnalyzer

# V2 - Optimized concurrent analyzers
from .modules.question_qc_v2 import QuestionQCAnalyzerV2
from .modules.explanation_qc_v2 import ExplanationQCAnalyzerV2

# V3 - Batch API analyzers (50% cost reduction)
from .modules.question_qc_v3_batch import QuestionQCAnalyzerV3Batch

__all__ = [
    # V1
    "QuestionQCAnalyzer",
    "ExplanationQCAnalyzer",
    # V2
    "QuestionQCAnalyzerV2",
    "ExplanationQCAnalyzerV2",
    # V3
    "QuestionQCAnalyzerV3Batch",
]

