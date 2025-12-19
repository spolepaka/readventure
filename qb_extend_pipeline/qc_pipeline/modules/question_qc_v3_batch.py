#!/usr/bin/env python3
"""
Question Quality Control Module V3 - Batch Processing

Uses Claude's Message Batches API for:
- 50% cost reduction on all API calls
- Higher throughput for large-scale QC
- Prompt caching to share article/passage text across questions

Reference: https://platform.claude.com/docs/en/build-with-claude/batch-processing
"""

import asyncio
import logging
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict
import pandas as pd

import anthropic

logger = logging.getLogger(__name__)

# Batch API configuration
BATCH_POLL_INTERVAL = 30  # seconds between status checks
BATCH_MAX_WAIT_TIME = 3600  # 1 hour max wait (batches typically complete within this)
BATCH_SIZE_LIMIT = 100000  # Max requests per batch
BATCH_MB_LIMIT = 256  # Max batch size in MB

# Claude checks to run
CLAUDE_CHECKS = [
    'grammatical_parallel',
    'plausibility',
    'homogeneity',
    'specificity_balance',
    'standard_alignment',
    'clarity_precision',
    'single_correct_answer',
    'passage_reference'
]

# Schema for structured output
CLAUDE_QC_SCHEMA = {
    "type": "object",
    "properties": {
        check: {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "enum": [0, 1]},
                "reasoning": {"type": "string"}
            },
            "required": ["score", "reasoning"]
        }
        for check in CLAUDE_CHECKS
    },
    "required": CLAUDE_CHECKS
}


class QuestionQCAnalyzerV3Batch:
    """
    Batch-based question QC analyzer using Claude's Message Batches API.
    
    Benefits:
    - 50% cost reduction vs standard API
    - Higher throughput for large-scale processing
    - Prompt caching for shared article content
    
    Usage:
        analyzer = QuestionQCAnalyzerV3Batch(client, model)
        results = await analyzer.analyze_batch(questions)
    """

    def __init__(
        self,
        claude_client: anthropic.Anthropic,  # Sync client for batch API
        claude_model: str = "claude-sonnet-4-5-20250929",
        output_dir: Optional[Path] = None
    ):
        """
        Initialize the batch QC analyzer.
        
        Args:
            claude_client: Synchronous Anthropic client (batch API uses sync)
            claude_model: Claude model to use
            output_dir: Directory to save batch results
        """
        self.client = claude_client
        self.model = claude_model
        self.output_dir = output_dir or Path("./batch_results")
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _build_qc_prompt(
        self,
        question_data: Dict[str, Any],
        passage_text: str,
        grade: Optional[int] = None
    ) -> str:
        """Build prompt for QC checks (without the passage - that goes in system with caching)."""
        choices = question_data.get('choices', {})
        question = question_data.get('question', '')
        correct_answer = question_data.get('correct_answer', '')
        standard_code = question_data.get('CCSS', '')
        standard_description = question_data.get('CCSS_description', '')
        dok = question_data.get('DOK', '')

        return f"""Analyze the following multiple-choice question and evaluate it on ALL quality checks.

## Question:
{question}

## Answer Choices:
A) {choices.get('A', '')}
B) {choices.get('B', '')}
C) {choices.get('C', '')}
D) {choices.get('D', '')}

## Correct Answer: {correct_answer}

## Metadata:
- Standard: {standard_code} - {standard_description}
- DOK Level: {dok}
- Grade: {grade or 'Not specified'}

---

## Quality Checks to Evaluate:

### 1. grammatical_parallel
Do all answer choices follow the same grammatical pattern/structure?
- PASS (1): All choices have consistent grammatical structure
- FAIL (0): Choices have inconsistent structures

### 2. plausibility
Are all INCORRECT choices believable distractors (not obviously wrong)?
- PASS (1): All distractors are plausible
- FAIL (0): Any distractor is obviously wrong or unrelated

### 3. homogeneity
Do all choices belong to the same conceptual category?
- PASS (1): All choices are the same type of answer
- FAIL (0): Choices span different categories

### 4. specificity_balance
Are all choices at similar levels of detail/specificity?
- PASS (1): Similar levels of detail across choices
- FAIL (0): Significant differences in specificity

### 5. standard_alignment
Does this question properly assess the assigned learning standard ({standard_code})?
- PASS (1): Question directly assesses the standard
- FAIL (0): Question assesses a different skill

### 6. clarity_precision
Is the question clearly written and unambiguous?
- PASS (1): Clear, precise, one interpretation
- FAIL (0): Ambiguous, confusing, or unclear

### 7. single_correct_answer
Is there exactly one defensibly correct answer?
- PASS (1): One clear correct answer
- FAIL (0): Multiple answers could be correct, or none

### 8. passage_reference
Are any specific passage references (paragraph numbers, quotes, etc.) accurate?
- PASS (1): All references are accurate OR no specific references made
- FAIL (0): Any reference is inaccurate

Provide your assessment for each check."""

    def _build_system_prompt_with_passage(self, passage_text: str) -> List[Dict[str, Any]]:
        """
        Build system prompt with passage text cached for reuse.
        
        Uses prompt caching to share the passage across multiple questions
        about the same article/text.
        
        Note: Batch API processes requests asynchronously, so cache hits are
        "best-effort". Using extended cache duration improves hit rates.
        
        See: https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration
        """
        return [
            {
                "type": "text",
                "text": "You are a quality control expert for reading comprehension assessment items. Evaluate questions based on the provided passage and quality criteria."
            },
            {
                "type": "text",
                "text": f"""## Passage for Reference:

{passage_text[:8000] if passage_text else "No passage provided"}

---

Use this passage to evaluate questions about it. The passage content is shared across multiple questions for efficiency.""",
                # Use 1-hour cache duration for better hit rates in batch processing
                # "ephemeral" = 5 min default, but batch processing benefits from longer duration
                "cache_control": {"type": "ephemeral"}
            }
        ]

    def _group_questions_by_passage(
        self,
        questions: List[Dict[str, Any]]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Group questions by their passage/article for efficient caching.
        
        Questions with the same passage will share cached content.
        """
        grouped = defaultdict(list)
        
        for q in questions:
            # Create a hash of the passage for grouping
            passage = q.get('passage_text', '')
            # Use first 500 chars as key (enough to identify unique passages)
            passage_key = passage[:500] if passage else "no_passage"
            grouped[passage_key].append(q)
        
        return grouped

    def create_batch_requests(
        self,
        questions: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        """
        Create batch requests for all questions.
        
        Groups questions by passage to maximize cache hits.
        
        Returns:
            Tuple of (batch_requests, question_map)
            - batch_requests: List of requests for the Batch API
            - question_map: Map of custom_id to question data for result processing
        """
        batch_requests = []
        question_map = {}
        
        # Group by passage for caching efficiency
        grouped = self._group_questions_by_passage(questions)
        
        logger.info(f"Grouped {len(questions)} questions into {len(grouped)} passage groups")
        
        for passage_key, passage_questions in grouped.items():
            # Get the full passage from the first question in group
            passage_text = passage_questions[0].get('passage_text', '')
            system_prompt = self._build_system_prompt_with_passage(passage_text)
            
            for q in passage_questions:
                question_id = q.get('question_id', f'Q{len(batch_requests)+1}')
                custom_id = f"qc_{question_id}"
                
                question_data = q.get('structured_content', {})
                grade = q.get('grade')
                
                # Build the user prompt (question-specific)
                user_prompt = self._build_qc_prompt(question_data, passage_text, grade)
                
                # Create batch request
                request = {
                    "custom_id": custom_id,
                    "params": {
                        "model": self.model,
                        "max_tokens": 2000,
                        "system": system_prompt,
                        "tools": [{
                            "name": "submit_qc_results",
                            "description": "Submit quality control check results",
                            "input_schema": CLAUDE_QC_SCHEMA
                        }],
                        "tool_choice": {"type": "tool", "name": "submit_qc_results"},
                        "messages": [{"role": "user", "content": user_prompt}]
                    }
                }
                
                batch_requests.append(request)
                question_map[custom_id] = q
        
        return batch_requests, question_map

    def submit_batch(self, batch_requests: List[Dict[str, Any]]) -> str:
        """
        Submit a batch of requests to the Message Batches API.
        
        Args:
            batch_requests: List of request objects
            
        Returns:
            Batch ID for polling status
        """
        logger.info(f"Submitting batch with {len(batch_requests)} requests...")
        
        # Convert to the format expected by the API
        from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
        from anthropic.types.messages.batch_create_params import Request
        
        formatted_requests = []
        for req in batch_requests:
            formatted_requests.append(
                Request(
                    custom_id=req["custom_id"],
                    params=MessageCreateParamsNonStreaming(**req["params"])
                )
            )
        
        message_batch = self.client.messages.batches.create(
            requests=formatted_requests
        )
        
        logger.info(f"Batch created: {message_batch.id}")
        logger.info(f"Status: {message_batch.processing_status}")
        
        return message_batch.id

    def poll_batch_status(self, batch_id: str) -> Dict[str, Any]:
        """
        Poll for batch completion status.
        
        Args:
            batch_id: The batch ID to check
            
        Returns:
            Batch status object
        """
        start_time = time.time()
        
        while True:
            elapsed = time.time() - start_time
            
            if elapsed > BATCH_MAX_WAIT_TIME:
                logger.error(f"Batch {batch_id} timed out after {BATCH_MAX_WAIT_TIME}s")
                raise TimeoutError(f"Batch processing exceeded {BATCH_MAX_WAIT_TIME}s")
            
            batch = self.client.messages.batches.retrieve(batch_id)
            status = batch.processing_status
            
            logger.info(f"Batch {batch_id} status: {status} (elapsed: {elapsed:.0f}s)")
            
            if status == "ended":
                logger.info(f"Batch completed in {elapsed:.0f}s")
                return {
                    "id": batch.id,
                    "status": status,
                    "request_counts": {
                        "succeeded": batch.request_counts.succeeded,
                        "errored": batch.request_counts.errored,
                        "canceled": batch.request_counts.canceled,
                        "expired": batch.request_counts.expired,
                        "processing": batch.request_counts.processing
                    },
                    "created_at": batch.created_at,
                    "ended_at": batch.ended_at
                }
            
            if status == "canceled":
                raise RuntimeError(f"Batch {batch_id} was canceled")
            
            # Wait before next poll
            logger.info(f"Waiting {BATCH_POLL_INTERVAL}s before next status check...")
            time.sleep(BATCH_POLL_INTERVAL)

    def retrieve_batch_results(
        self,
        batch_id: str,
        question_map: Dict[str, Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Retrieve and process batch results.
        
        Args:
            batch_id: The completed batch ID
            question_map: Map of custom_id to original question data
            
        Returns:
            List of QC results for each question
        """
        logger.info(f"Retrieving results for batch {batch_id}...")
        
        results = []
        
        # Stream results from the batch
        for result in self.client.messages.batches.results(batch_id):
            custom_id = result.custom_id
            question_data = question_map.get(custom_id, {})
            question_id = question_data.get('question_id', custom_id.replace('qc_', ''))
            
            if result.result.type == "succeeded":
                # Parse the tool use response
                message = result.result.message
                check_results = {}
                
                for block in message.content:
                    if block.type == "tool_use" and block.name == "submit_qc_results":
                        for check_name in CLAUDE_CHECKS:
                            check_data = block.input.get(check_name, {})
                            check_results[check_name] = {
                                'score': check_data.get('score', 0),
                                'response': check_data.get('reasoning', 'No reasoning'),
                                'category': 'distractor' if check_name in ['grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance'] else 'question'
                            }
                        break
                
                # Add length check (local, no API)
                structured_content = question_data.get('structured_content', {})
                length_score, length_response = self._run_length_check(structured_content)
                check_results['length_check'] = {
                    'score': length_score,
                    'response': length_response,
                    'category': 'distractor'
                }
                
                # Calculate overall score
                total_score = sum(r['score'] for r in check_results.values())
                total_checks = len(check_results)
                overall_score = (total_score / total_checks) if total_checks > 0 else 0
                
                results.append({
                    'question_id': question_id,
                    'question_type': question_data.get('question_type', 'MCQ'),
                    'overall_score': overall_score,
                    'total_checks_passed': total_score,
                    'total_checks_run': total_checks,
                    'checks': check_results,
                    'batch_result': 'succeeded',
                    'timestamp': datetime.now().isoformat()
                })
                
            elif result.result.type == "errored":
                error = result.result.error
                logger.error(f"Request {custom_id} errored: {error.type} - {error.message}")
                results.append({
                    'question_id': question_id,
                    'overall_score': 0,
                    'error': f"{error.type}: {error.message}",
                    'batch_result': 'errored',
                    'checks': {},
                    'timestamp': datetime.now().isoformat()
                })
                
            elif result.result.type == "expired":
                logger.warning(f"Request {custom_id} expired")
                results.append({
                    'question_id': question_id,
                    'overall_score': 0,
                    'error': 'Request expired',
                    'batch_result': 'expired',
                    'checks': {},
                    'timestamp': datetime.now().isoformat()
                })
                
            elif result.result.type == "canceled":
                results.append({
                    'question_id': question_id,
                    'overall_score': 0,
                    'error': 'Request canceled',
                    'batch_result': 'canceled',
                    'checks': {},
                    'timestamp': datetime.now().isoformat()
                })
        
        logger.info(f"Retrieved {len(results)} results")
        return results

    def _run_length_check(self, question_data: Dict[str, Any]) -> Tuple[int, str]:
        """Check if answer choice lengths are balanced (local, no API)."""
        try:
            choices = question_data.get('choices', {})
            correct_answer = question_data.get('correct_answer', '')

            if not choices or not correct_answer:
                return 0, "Missing choices or correct answer"

            choice_texts = []
            correct_text = ""

            for key, text in choices.items():
                choice_texts.append(text)
                if key == correct_answer:
                    correct_text = text

            if not correct_text:
                return 0, f"Correct answer '{correct_answer}' not found"

            word_counts = [len(str(text).split()) for text in choice_texts]
            correct_word_count = len(str(correct_text).split())

            if all(count <= 3 for count in word_counts):
                return 1, "All choices are 3 words or less"

            distractor_counts = [
                len(str(choices[key]).split())
                for key in choices
                if key != correct_answer
            ]

            if not distractor_counts:
                return 0, "No distractors found"

            longest_distractor = max(distractor_counts)
            shortest_distractor = min(distractor_counts)

            if correct_word_count > 1.1 * longest_distractor:
                return 0, f"Correct answer ({correct_word_count} words) too long"

            if shortest_distractor > 1.1 * correct_word_count:
                return 0, f"Shortest distractor ({shortest_distractor} words) too long"

            return 1, "Choice lengths are balanced"

        except Exception as e:
            logger.error(f"Error in length check: {e}")
            return 0, f"Error: {str(e)}"

    def analyze_batch(
        self,
        questions: List[Dict[str, Any]],
        save_results: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Analyze a batch of questions using the Message Batches API.
        
        This is the main entry point for batch processing.
        
        Args:
            questions: List of question items to analyze
            save_results: Whether to save intermediate results to disk
            
        Returns:
            List of QC results for each question
        """
        if not questions:
            return []
        
        logger.info(f"Starting batch QC for {len(questions)} questions")
        logger.info(f"Using batch API with 50% cost reduction")
        
        start_time = time.time()
        
        # Step 1: Create batch requests
        batch_requests, question_map = self.create_batch_requests(questions)
        
        # Save requests for debugging
        if save_results:
            requests_file = self.output_dir / f"batch_requests_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(requests_file, 'w') as f:
                json.dump([{
                    "custom_id": r["custom_id"],
                    "model": r["params"]["model"]
                } for r in batch_requests], f, indent=2)
            logger.info(f"Saved batch requests to {requests_file}")
        
        # Step 2: Submit batch
        batch_id = self.submit_batch(batch_requests)
        
        # Save batch ID for recovery
        if save_results:
            batch_info_file = self.output_dir / f"batch_info_{batch_id}.json"
            with open(batch_info_file, 'w') as f:
                json.dump({
                    "batch_id": batch_id,
                    "num_requests": len(batch_requests),
                    "submitted_at": datetime.now().isoformat()
                }, f, indent=2)
        
        # Step 3: Poll for completion
        batch_status = self.poll_batch_status(batch_id)
        
        # Step 4: Retrieve results
        results = self.retrieve_batch_results(batch_id, question_map)
        
        elapsed = time.time() - start_time
        
        # Calculate stats
        succeeded = sum(1 for r in results if r.get('batch_result') == 'succeeded')
        failed = len(results) - succeeded
        
        logger.info(f"\n{'='*60}")
        logger.info(f"BATCH QC COMPLETE")
        logger.info(f"{'='*60}")
        logger.info(f"Total questions: {len(questions)}")
        logger.info(f"Succeeded: {succeeded}")
        logger.info(f"Failed/Expired: {failed}")
        logger.info(f"Total time: {elapsed:.0f}s")
        logger.info(f"Throughput: {len(questions) / elapsed:.1f} questions/sec")
        logger.info(f"Cost savings: 50% vs standard API")
        
        # Save final results
        if save_results:
            results_file = self.output_dir / f"batch_results_{batch_id}.json"
            with open(results_file, 'w') as f:
                json.dump(results, f, indent=2)
            logger.info(f"Saved results to {results_file}")
        
        return results

    def resume_batch(self, batch_id: str, questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Resume processing a previously submitted batch.
        
        Use this if the script was interrupted after batch submission.
        
        Args:
            batch_id: The batch ID to resume
            questions: Original list of questions (for mapping results)
            
        Returns:
            List of QC results
        """
        logger.info(f"Resuming batch {batch_id}...")
        
        # Recreate question map
        _, question_map = self.create_batch_requests(questions)
        
        # Poll for completion (in case it's still processing)
        batch_status = self.poll_batch_status(batch_id)
        
        # Retrieve results
        return self.retrieve_batch_results(batch_id, question_map)

