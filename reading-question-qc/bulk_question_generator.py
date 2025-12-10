#!/usr/bin/env python3
"""
Bulk Question Generation Script for CK Generation System

This script processes a questions CSV file and generates all missing questions
using parallel processing for both generation and quality control, with retry logic.
"""

import pandas as pd
import json
import anthropic
import os
from typing import Dict, List, Optional, Tuple, Set
import argparse
import logging
from datetime import datetime
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import random
from collections import defaultdict
import copy

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class BulkQuestionGenerator:
    def __init__(self, api_key: str, max_workers: int = 5):
        """Initialize the bulk question generator."""
        self.api_key = api_key
        self.model = "claude-sonnet-4-5-20250929"  # Claude Sonnet 4.5
        self.temperature = 0.6
        self.max_workers = max_workers
        self.max_retries = 3
        self.base_delay = 1  # Base delay for exponential backoff
        
        # Load data files
        self.prompts = self._load_prompts()
        self.ccss_standards = self._load_ccss_standards()
        self.examples = self._load_examples()
        self.qc_prompts = self._get_quality_control_prompts()
        
    def _load_prompts(self) -> List[Dict]:
        """Load prompts from JSON file."""
        try:
            with open('ck_gen - prompts.json', 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading prompts: {e}")
            raise
    
    def _load_ccss_standards(self) -> Dict[str, str]:
        """Load CCSS standards mapping."""
        try:
            df = pd.read_csv('ck_gen - ccss.csv')
            return dict(zip(df['standard_code'], df['standard_description']))
        except Exception as e:
            logger.error(f"Error loading CCSS standards: {e}")
            raise
    
    def _load_examples(self) -> pd.DataFrame:
        """Load examples CSV."""
        try:
            return pd.read_csv('ck_gen - examples.csv')
        except Exception as e:
            logger.error(f"Error loading examples: {e}")
            raise
    
    def _get_quality_control_prompts(self) -> Dict[str, Dict]:
        """Extract quality control prompts organized by name."""
        try:
            qc_prompts = {p['name']: p for p in self.prompts if p['function'] == 'quality_control'}
            logger.info(f"Loaded {len(qc_prompts)} quality control prompts")
            return qc_prompts
        except Exception as e:
            logger.error(f"Error extracting QC prompts: {e}")
            return {}
    
    def _extract_grade_level(self, standard_code: str) -> str:
        """
        Extract grade level from CCSS standard code.
        
        Examples:
            RL.3.1 → "grade 3"
            RI.5.2 → "grade 5"
            RL.9-10.3 → "grades 9-10"
            RI.11-12.4 → "grades 11-12"
            RL.K.1 → "kindergarten"
        
        Returns formatted grade level string for use in prompts.
        """
        if not standard_code:
            return "grade 3"  # Default fallback
        
        try:
            # Standard format: PREFIX.GRADE.SKILL (e.g., RL.3.1, RI.9-10.2)
            parts = standard_code.split('.')
            if len(parts) < 2:
                return "grade 3"  # Default fallback
            
            grade_part = parts[1]
            
            # Handle kindergarten
            if grade_part.upper() == 'K':
                return "kindergarten"
            
            # Handle grade bands (e.g., "9-10", "11-12")
            if '-' in grade_part:
                return f"grades {grade_part}"
            
            # Handle single grades
            return f"grade {grade_part}"
            
        except Exception as e:
            logger.warning(f"Could not extract grade from standard '{standard_code}': {e}")
            return "grade 3"  # Default fallback
    
    def _find_matching_example(self, standard: str, dok: int, question_type: str, difficulty: str = None) -> Optional[Dict]:
        """Find a matching example based on standard, DOK level, question type, and difficulty."""
        # First Priority: Exact match including difficulty
        if difficulty:
            matches = self.examples[
                (self.examples['Standard'] == standard) & 
                (self.examples['DOK'] == dok) &
                (self.examples['Difficulty'].str.lower() == difficulty.lower())
            ]
            
            if not matches.empty:
                example = matches.sample(n=1).iloc[0]
                return {
                    'example_question': example['question'],
                    'example_choice_a': example['answer_A'],
                    'example_choice_b': example['answer_B'],
                    'example_choice_c': example['answer_C'],
                    'example_choice_d': example['answer_D'],
                    'example_correct': example['correct_answer']
                }
        
        # Second Priority: Standard and DOK match (any difficulty)
        matches = self.examples[
            (self.examples['Standard'] == standard) & 
            (self.examples['DOK'] == dok)
        ]
        
        if matches.empty:
            # Third Priority: Same standard but different DOK, matching difficulty if specified
            if difficulty:
                matches = self.examples[
                    (self.examples['Standard'] == standard) &
                    (self.examples['Difficulty'].str.lower() == difficulty.lower())
                ]
            
            if matches.empty:
                # Fourth Priority: Same standard (any DOK, any difficulty)
                matches = self.examples[self.examples['Standard'] == standard]
        
        if matches.empty:
            # Fifth Priority: Same standard family with matching difficulty if specified
            standard_family = standard.split('.')[0]  # RL or RI
            if difficulty:
                matches = self.examples[
                    (self.examples['Standard'].str.startswith(standard_family)) &
                    (self.examples['Difficulty'].str.lower() == difficulty.lower())
                ]
            
            if matches.empty:
                # Last Priority: Same standard family (any difficulty)
                matches = self.examples[self.examples['Standard'].str.startswith(standard_family)]
        
        if not matches.empty:
            example = matches.sample(n=1).iloc[0]
            return {
                'example_question': example['question'],
                'example_choice_a': example['answer_A'],
                'example_choice_b': example['answer_B'],
                'example_choice_c': example['answer_C'],
                'example_choice_d': example['answer_D'],
                'example_correct': example['correct_answer']
            }
        
        return None
    
    def _get_existing_questions(self, df: pd.DataFrame, passage_id: str, exclude_question_id: Optional[str] = None) -> str:
        """Get existing questions for the same passage to avoid duplication."""
        existing = df[df['passage_id'] == passage_id]
        if existing.empty:
            return "None"
        
        questions_list = []
        for _, row in existing.iterrows():
            # Skip the current question being generated to avoid self-reference
            if exclude_question_id and row.get('question_id') == exclude_question_id:
                continue
                
            question_text = row.get('question_text', '')
            if question_text and str(question_text).strip():
                questions_list.append(f"- {str(question_text).strip()}")
        
        return "\n".join(questions_list) if questions_list else "None"
    
    def _find_generation_prompt(self, question_type: str, dok: int) -> Optional[Dict]:
        """Find the appropriate generation prompt based on question type and DOK level."""
        type_mapping = {
            'MCQ': f'MCQ DOK {dok}',
            'SR': f'SR DOK {dok}',
            'MP': f'MP DOK {dok}' if dok >= 2 else f'MP DOK 2'
        }
        
        target_name = type_mapping.get(question_type.upper())
        if not target_name:
            return None
        
        for prompt in self.prompts:
            if prompt.get('function') == 'generate' and prompt.get('name') == target_name:
                return prompt
        
        return None
    
    def _fill_prompt_variables(self, prompt_text: str, row: pd.Series, df: pd.DataFrame, example: Optional[Dict]) -> str:
        """Fill in all variables in the prompt template."""
        standard_code = row.get('CCSS', '')
        variables = {
            'text_content': row.get('passage_text', ''),
            'standard_code': standard_code,
            'standard_description': self.ccss_standards.get(standard_code, ''),
            'existing_questions': self._get_existing_questions(df, row.get('passage_id', ''), str(row.get('question_id', ''))),
            'grade_level': self._extract_grade_level(standard_code)
        }
        
        # Add example variables if available
        if example:
            variables.update(example)
        else:
            variables.update({
                'example_question': '[No matching example found]',
                'example_choice_a': '',
                'example_choice_b': '',
                'example_choice_c': '',
                'example_choice_d': '',
                'example_correct': ''
            })
        
        # Replace variables in prompt
        filled_prompt = prompt_text
        for var, value in variables.items():
            placeholder = f'{{{var}}}'
            filled_prompt = filled_prompt.replace(placeholder, str(value))
        
        return filled_prompt
    
    def _make_api_call_with_retry(self, messages: List[Dict], max_tokens: int = 2000, temperature: float = None) -> str:
        """Make API call with exponential backoff retry logic."""
        if temperature is None:
            temperature = self.temperature
            
        for attempt in range(self.max_retries):
            try:
                client = anthropic.Anthropic(api_key=self.api_key)
                response = client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    messages=messages
                )
                return response.content[0].text
                
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise e
                
                # Exponential backoff with jitter
                delay = (self.base_delay * (2 ** attempt)) + random.uniform(0, 1)
                logger.warning(f"API call failed (attempt {attempt + 1}/{self.max_retries}), retrying in {delay:.2f}s: {e}")
                time.sleep(delay)
        
        raise Exception("Max retries exceeded")
    
    def _parse_generated_question(self, generated_content: str) -> Optional[Dict]:
        """Parse generated question content to extract structured data."""
        try:
            if '```json' in generated_content:
                json_start = generated_content.find('```json') + 7
                json_end = generated_content.find('```', json_start)
                json_content = generated_content[json_start:json_end].strip()
                return json.loads(json_content)
            
            try:
                return json.loads(generated_content)
            except json.JSONDecodeError:
                logger.warning("Could not parse generated content as structured question")
                return None
                
        except Exception as e:
            logger.error(f"Error parsing generated question: {e}")
            return None
    
    def _extract_question_components(self, question_data: Dict) -> Tuple[str, str, str, str, str, str]:
        """Extract question components for CSV output."""
        if 'part_a' in question_data and 'part_b' in question_data:
            # Multipart question - combine both parts
            part_a = question_data['part_a']
            part_b = question_data['part_b']
            
            question = f"Part A: {part_a.get('question', '')}\nPart B: {part_b.get('question', '')}"
            
            # For MP questions, we'll use Part A choices as the main choices
            choices = part_a.get('choices', {})
            correct_answer_key = part_a.get('correct_answer', 'A')
            
        else:
            # Regular MCQ or SR question
            question = question_data.get('question', '')
            choices = question_data.get('choices', {})
            correct_answer_key = question_data.get('correct_answer', 'A')
        
        option_a = choices.get('A', '')
        option_b = choices.get('B', '')
        option_c = choices.get('C', '')
        option_d = choices.get('D', '')
        
        # Get the full text of the correct answer
        correct_answer = choices.get(correct_answer_key, '')
        
        return question, option_a, option_b, option_c, option_d, correct_answer
    
    def _extract_mp_question_parts(self, question_data: Dict) -> Tuple[Tuple[str, str, str, str, str, str], Tuple[str, str, str, str, str, str]]:
        """Extract both parts of an MP question separately."""
        if 'part_a' not in question_data or 'part_b' not in question_data:
            raise ValueError("Not a valid MP question with both parts")
        
        # Extract Part A
        part_a = question_data['part_a']
        part_a_question = f"Part A: {part_a.get('question', '')}"
        part_a_choices = part_a.get('choices', {})
        part_a_correct_key = part_a.get('correct_answer', 'A')
        
        part_a_option_a = part_a_choices.get('A', '')
        part_a_option_b = part_a_choices.get('B', '')
        part_a_option_c = part_a_choices.get('C', '')
        part_a_option_d = part_a_choices.get('D', '')
        part_a_correct_answer = part_a_choices.get(part_a_correct_key, '')
        
        # Extract Part B
        part_b = question_data['part_b']
        part_b_question = f"Part B: {part_b.get('question', '')}"
        part_b_choices = part_b.get('choices', {})
        part_b_correct_key = part_b.get('correct_answer', 'A')
        
        part_b_option_a = part_b_choices.get('A', '')
        part_b_option_b = part_b_choices.get('B', '')
        part_b_option_c = part_b_choices.get('C', '')
        part_b_option_d = part_b_choices.get('D', '')
        part_b_correct_answer = part_b_choices.get(part_b_correct_key, '')
        
        return (
            (part_a_question, part_a_option_a, part_a_option_b, part_a_option_c, part_a_option_d, part_a_correct_answer),
            (part_b_question, part_b_option_a, part_b_option_b, part_b_option_c, part_b_option_d, part_b_correct_answer)
        )
    
    def generate_single_question(self, row: pd.Series, df: pd.DataFrame) -> Optional[Dict]:
        """Generate a question for a single row."""
        try:
            question_type = row.get('question_type', 'MCQ')
            dok = int(row.get('DOK', 1))
            standard = row.get('CCSS', '')
            
            # Find appropriate prompt
            prompt_config = self._find_generation_prompt(question_type, dok)
            if not prompt_config:
                logger.warning(f"No prompt found for {question_type} DOK {dok}")
                return None
            
            # Find matching example (for MCQ questions)
            example = None
            if question_type.upper() == 'MCQ':
                difficulty = row.get('difficulty', '')
                example = self._find_matching_example(standard, dok, question_type, difficulty)
            
            # Fill prompt variables
            filled_prompt = self._fill_prompt_variables(
                prompt_config['prompt'], row, df, example
            )
            
            # Generate question using Claude
            logger.info(f"Generating {question_type} DOK {dok} question for {row.get('question_id', 'unknown')}")
            
            response_text = self._make_api_call_with_retry([
                {"role": "user", "content": filled_prompt}
            ])
            
            # Parse response
            result = {
                'question_id': row.get('question_id', ''),
                'passage_id': row.get('passage_id', ''),
                'passage_text': row.get('passage_text', ''),
                'question_type': question_type,
                'dok': dok,
                'standard': standard,
                'generated_content': response_text,
                'prompt_used': prompt_config['name'],
                'example_used': example is not None,
                'timestamp': datetime.now().isoformat()
            }
            
            # Try to extract JSON from response for structured questions
            parsed_json = self._parse_generated_question(response_text)
            if parsed_json:
                result['structured_content'] = parsed_json
            
            return result
            
        except Exception as e:
            logger.error(f"Error generating question for {row.get('question_id', 'unknown')}: {e}")
            return None
    
    def _fill_qc_prompt_variables(self, prompt_text: str, question_data: Dict, passage_text: str = "") -> str:
        """Fill variables in quality control prompts."""
        if 'part_a' in question_data and 'part_b' in question_data:
            # For MP questions, focus on part_a for individual question checks
            part_data = question_data.get('part_a', {})
            variables = {
                'question': part_data.get('question', ''),
                'passage': passage_text,
                'choice_A': part_data.get('choices', {}).get('A', ''),
                'choice_B': part_data.get('choices', {}).get('B', ''),
                'choice_C': part_data.get('choices', {}).get('C', ''),
                'choice_D': part_data.get('choices', {}).get('D', ''),
                'correct_answer': part_data.get('correct_answer', ''),
                'standard_code': part_data.get('CCSS', question_data.get('CCSS', '')),
                'standard_description': question_data.get('CCSS_description', ''),
                'dok': str(part_data.get('DOK', question_data.get('DOK', ''))),
            }
        else:
            # Standard MCQ/SR structure
            variables = {
                'question': question_data.get('question', ''),
                'passage': passage_text,
                'choice_A': question_data.get('choices', {}).get('A', ''),
                'choice_B': question_data.get('choices', {}).get('B', ''),
                'choice_C': question_data.get('choices', {}).get('C', ''),
                'choice_D': question_data.get('choices', {}).get('D', ''),
                'correct_answer': question_data.get('correct_answer', ''),
                'standard_code': question_data.get('CCSS', ''),
                'standard_description': question_data.get('CCSS_description', ''),
                'dok': str(question_data.get('DOK', '')),
            }
        
        # Replace variables in prompt
        filled_prompt = prompt_text
        for var, value in variables.items():
            placeholder = f'{{{var}}}'
            filled_prompt = filled_prompt.replace(placeholder, str(value))
        
        return filled_prompt
    
    def _parse_qc_response(self, response_text: str) -> Tuple[int, str]:
        """Parse QC response looking for XML format first, then fallback to old format."""
        try:
            import re
            import xml.etree.ElementTree as ET
            
            # First try XML parsing
            if '<quality_check>' in response_text:
                xml_match = re.search(r'<quality_check>(.*?)</quality_check>', response_text, re.DOTALL)
                if not xml_match:
                    xml_match = re.search(r'<quality_check>(.*)', response_text, re.DOTALL)
                
                if xml_match:
                    xml_content = xml_match.group(1)
                    
                    # Try to parse as complete XML first
                    if '</quality_check>' in response_text:
                        try:
                            full_xml = f"<quality_check>{xml_content}</quality_check>"
                            root = ET.fromstring(full_xml)
                            score_elem = root.find('score')
                            reasoning_elem = root.find('reasoning')
                            
                            if score_elem is not None and score_elem.text:
                                score = int(score_elem.text.strip())
                                reasoning = reasoning_elem.text.strip() if reasoning_elem is not None and reasoning_elem.text else "No reasoning provided"
                                score = 1 if score > 0 else 0
                                return score, reasoning
                        except ET.ParseError:
                            pass
                    
                    # Try partial XML parsing
                    score_match = re.search(r'<score>(\d+)</score>', xml_content)
                    reasoning_match = re.search(r'<reasoning>(.*?)(?:</reasoning>|$)', xml_content, re.DOTALL)
                    
                    if score_match:
                        score = int(score_match.group(1))
                        score = 1 if score > 0 else 0
                        reasoning = reasoning_match.group(1).strip() if reasoning_match else "XML format: Score found but reasoning incomplete"
                        return score, reasoning
            
            # Fallback to old parsing methods
            if '[1]' in response_text:
                return 1, "Legacy format: Contains [1]"
            elif '[0]' in response_text:
                return 0, "Legacy format: Contains [0]"
            else:
                numbers = re.findall(r'\b[01]\b', response_text)
                if numbers:
                    score = int(numbers[-1])
                    return score, f"Legacy format: Found {score} in text"
                else:
                    response_lower = response_text.lower()
                    if any(word in response_lower for word in ['correct', 'good', 'appropriate', 'yes', 'passes']):
                        return 1, "Legacy format: Positive keywords detected"
                    else:
                        return 0, "Legacy format: No clear positive indicators"
            
        except Exception as e:
            logger.warning(f"Could not parse QC response: {e}")
            return 0, f"Parse error: {str(e)}"
    
    def _run_quality_check(self, check_name: str, question_data: Dict, passage_text: str = "") -> Tuple[int, str]:
        """Run a single quality control check."""
        try:
            if check_name not in self.qc_prompts:
                logger.error(f"Quality check '{check_name}' not found")
                return 0, f"Check '{check_name}' not available"
            
            prompt_config = self.qc_prompts[check_name]
            filled_prompt = self._fill_qc_prompt_variables(prompt_config['prompt'], question_data, passage_text)
            
            response_text = self._make_api_call_with_retry(
                messages=[{"role": "user", "content": filled_prompt}],
                max_tokens=500,
                temperature=0  # Zero temperature for consistent quality control
            )
            
            # Parse the response
            score, reasoning = self._parse_qc_response(response_text)
            return score, reasoning
            
        except Exception as e:
            logger.error(f"Error running quality check '{check_name}': {e}")
            return 0, f"Error: {str(e)}"
    
    def _run_length_check(self, question_data: Dict, passage_text: str = "") -> Tuple[int, str]:
        """Run length check on MCQ/MP question choices."""
        try:
            choices = question_data.get('choices', {})
            correct_answer = question_data.get('correct_answer', '')
            
            if not choices or not correct_answer:
                return 0, "Missing choices or correct answer"
            
            # Get all choice texts
            choice_texts = []
            correct_text = ""
            
            for key, text in choices.items():
                choice_texts.append(text)
                if key == correct_answer:
                    correct_text = text
            
            if not correct_text:
                return 0, f"Correct answer '{correct_answer}' not found in choices"
            
            # Count words in each choice
            word_counts = [len(text.split()) for text in choice_texts]
            
            # Check if all choices are < 4 words (automatic pass)
            if all(count < 4 for count in word_counts):
                return 1, "All choices are less than 4 words"
            
            # Get distractor texts and character lengths (exclude correct answer)
            distractor_texts = []
            distractor_char_lengths = []
            for key, text in choices.items():
                if key != correct_answer:
                    distractor_texts.append(text)
                    distractor_char_lengths.append(len(text))
            
            if not distractor_char_lengths:
                return 0, "No distractors found"
            
            correct_char_length = len(correct_text)
            longest_distractor_char_length = max(distractor_char_lengths)
            shortest_distractor_char_length = min(distractor_char_lengths)
            
            # Check if correct answer is too long compared to longest distractor (more than 10%)
            if correct_char_length > 1.1 * longest_distractor_char_length:
                return 0, f"Correct answer ({correct_char_length} chars) is too long compared to longest distractor ({longest_distractor_char_length} chars)"
            
            # Check if correct answer is too short compared to shortest distractor (more than 30%)
            if correct_char_length < 0.7 * shortest_distractor_char_length:
                return 0, f"Correct answer ({correct_char_length} chars) is too short compared to shortest distractor ({shortest_distractor_char_length} chars)"
            
            return 1, "Choice lengths are appropriately balanced"
            
        except Exception as e:
            logger.error(f"Error running length check: {e}")
            return 0, f"Error: {str(e)}"
    
    def _run_length_check_on_mp_part(self, part_data: Dict, passage_text: str = "", part_name: str = "part_a") -> Tuple[int, str]:
        """Run length check on a specific part of an MP question."""
        try:
            score, reasoning = self._run_length_check(part_data, passage_text)
            return score, f"[{part_name}] {reasoning}"
            
        except Exception as e:
            logger.error(f"Error running length check on {part_name}: {e}")
            return 0, f"Error on {part_name}: {str(e)}"
    
    def run_quality_control(self, generated_item: Dict) -> Dict:
        """Run quality control on a generated question."""
        try:
            # Parse the generated content
            if 'structured_content' in generated_item:
                question_data = generated_item['structured_content']
            else:
                question_data = self._parse_generated_question(generated_item.get('generated_content', ''))
            
            if not question_data:
                return {
                    'question_id': generated_item.get('question_id', ''),
                    'overall_score': 0,
                    'error': 'Could not parse generated question content',
                    'checks': {},
                    'passed_checks': 0,
                    'total_checks': 0
                }
            
            passage_text = generated_item.get('passage_text', '') or ''
            question_type = generated_item.get('question_type', 'MCQ')
            
            # Define which checks to run based on question type
            if question_type.upper() == 'SR':
                # Short Response questions - no distractor checks needed
                checks_to_run = [
                    'standard_alignment',
                    'clarity_precision', 
                    'text_dependency',
                    'passage_reference'
                ]
            else:
                # MCQ and MP questions - run all checks including distractors
                checks_to_run = [
                    'grammatical_parallel',
                    'plausibility', 
                    'homogeneity',
                    'specificity_balance',
                    # 'standard_alignment',
                    'clarity_precision',
                    # 'text_dependency',
                    'single_correct_answer',
                    'passage_reference'
                ]
            
            # Run all applicable checks
            results = {}
            total_score = 0
            total_checks = 0
            
            for check_name in checks_to_run:
                if check_name in self.qc_prompts:
                    score, response = self._run_quality_check(check_name, question_data, passage_text)
                    results[check_name] = {
                        'score': score,
                        'response': response
                    }
                    total_score += score
                    total_checks += 1
            
            # Add length check for MCQ and MP questions (skip for SR questions)
            if question_type.upper() in ['MCQ', 'MP']:
                # Handle MP questions with part_a and part_b structure
                if question_type.upper() == 'MP' and 'part_a' in question_data and 'part_b' in question_data:
                    # Check Part A
                    score, response = self._run_length_check_on_mp_part(question_data['part_a'], passage_text, "part_a")
                    results['length_check_part_a'] = {
                        'score': score,
                        'response': response
                    }
                    total_score += score
                    total_checks += 1
                    
                    # Check Part B
                    score, response = self._run_length_check_on_mp_part(question_data['part_b'], passage_text, "part_b")
                    results['length_check_part_b'] = {
                        'score': score,
                        'response': response
                    }
                    total_score += score
                    total_checks += 1
                else:
                    # Regular MCQ question or MP question without part structure
                    score, response = self._run_length_check(question_data, passage_text)
                    results['length_check'] = {
                        'score': score,
                        'response': response
                    }
                    total_score += score
                    total_checks += 1
            
            return {
                'question_id': generated_item.get('question_id', ''),
                'passage_id': generated_item.get('passage_id', ''),
                'question_type': question_type,
                'overall_score': (total_score / total_checks) if total_checks > 0 else 0,
                'passed_checks': total_score,
                'total_checks': total_checks,
                'checks': results,
                'question_data': question_data
            }
            
        except Exception as e:
            logger.error(f"Error running QC on question {generated_item.get('question_id', 'unknown')}: {e}")
            return {
                'question_id': generated_item.get('question_id', ''),
                'overall_score': 0,
                'error': str(e),
                'checks': {},
                'passed_checks': 0,
                'total_checks': 0
            }
    
    def process_questions_batch(self, input_file: str, output_file: str = None) -> None:
        """Process all questions in a CSV file with parallel generation and QC."""
        # Read input CSV
        logger.info(f"Reading input file: {input_file}")
        df = pd.read_csv(input_file)
        
        if output_file is None:
            base_name = input_file.replace('.csv', '')
            output_file = f"{base_name}_generated.csv"
        
        logger.info(f"Processing {len(df)} questions")
        
        # Track which questions need to be generated
        questions_to_generate = list(df.index)
        completed_questions = {}
        failed_attempts = defaultdict(int)
        
        # Create an updated dataframe that will include completed questions for context
        # Start with original dataframe
        updated_df = df.copy()
        
        # Add columns for tracking completed questions if they don't exist
        if 'question_text' not in updated_df.columns:
            updated_df['question_text'] = ''
        
        # Main processing loop
        max_loops = 10  # Prevent infinite loops
        loop_count = 0
        
        while questions_to_generate and loop_count < max_loops:
            loop_count += 1
            logger.info(f"Processing loop {loop_count}, {len(questions_to_generate)} questions remaining")
            
            # Generate questions with passage-aware batching to prevent same-passage conflicts
            logger.info("Phase 1: Generating questions...")
            generated_questions = {}
            
            # Group questions by passage to ensure sequential processing within passages
            passage_groups = {}
            for idx in questions_to_generate:
                passage_id = df.iloc[idx].get('passage_id', 'unknown')
                if passage_id not in passage_groups:
                    passage_groups[passage_id] = []
                passage_groups[passage_id].append(idx)
            
            logger.info(f"Processing {len(passage_groups)} passages with questions to generate")
            
            # Process passages in parallel, but questions within each passage sequentially
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                # Submit one task per passage
                future_to_passage = {
                    executor.submit(self._process_passage_questions, passage_id, passage_question_indices, df, updated_df): passage_id
                    for passage_id, passage_question_indices in passage_groups.items()
                }
                
                for future in as_completed(future_to_passage):
                    passage_id = future_to_passage[future]
                    try:
                        passage_results = future.result()
                        
                        # Add successful completions to our tracking
                        for idx, result_data in passage_results['completed'].items():
                            completed_questions[idx] = result_data
                            logger.info(f"Passage {passage_id}: Question {idx} completed successfully")
                        
                        # Add failed questions to retry list
                        for idx, result_data in passage_results['failed_qc'].items():
                            generated_questions[idx] = result_data
                            logger.info(f"Passage {passage_id}: Question {idx} failed QC, will retry")
                        
                        # Track generation failures
                        for idx in passage_results['failed_generation']:
                            failed_attempts[idx] += 1
                            logger.warning(f"Passage {passage_id}: Failed to generate question {idx}")
                            
                    except Exception as e:
                        logger.error(f"Exception processing passage {passage_id}: {e}")
                        # Mark all questions in this passage for retry
                        for idx in passage_groups[passage_id]:
                            failed_attempts[idx] += 1
            
            # Update the main dataframe with all completed questions from this round
            # so that subsequent loops can see them
            if completed_questions:
                self._update_dataframe_with_completed_questions(updated_df, completed_questions)
            
            # Questions that failed QC should be regenerated, not re-checked
            # Add them directly to the retry list for the next generation loop
            
            # Determine which questions still need to be retried
            questions_to_retry = list(generated_questions.keys())
            
            # Update questions to generate for next loop
            # Only retry if we haven't exceeded max attempts
            questions_to_generate = [
                idx for idx in questions_to_retry 
                if failed_attempts[idx] < self.max_retries
            ]
            
            # Remove questions that have exceeded max attempts
            for idx in questions_to_retry:
                if failed_attempts[idx] >= self.max_retries:
                    logger.warning(f"Question {idx} exceeded max retry attempts ({self.max_retries}), giving up")
        
        # Generate output CSV
        logger.info(f"Generating output CSV with {len(completed_questions)} completed questions")
        self._generate_output_csv(df, completed_questions, output_file)
        
        logger.info(f"Processing complete. Output saved to {output_file}")
        logger.info(f"Successfully completed: {len(completed_questions)}/{len(df)} questions")
    
    def _generate_output_csv(self, original_df: pd.DataFrame, completed_questions: Dict, output_file: str) -> None:
        """Generate the final output CSV with all required columns."""
        # Create a copy of the original dataframe
        output_df = original_df.copy()
        
        # Add new columns
        output_df['passage'] = ''
        output_df['option_a'] = ''
        output_df['option_b'] = ''
        output_df['option_c'] = ''
        output_df['option_d'] = ''
        output_df['correct_answer'] = ''
        output_df['question_text'] = ''
        output_df['qc_passed_checks'] = 0
        output_df['qc_total_checks'] = 0
        output_df['qc_failed_checks'] = ''
        
        # Keep track of rows inserted for MP questions to adjust indices
        rows_inserted = 0
        
        # Sort completed questions by index to process in order
        sorted_completed = sorted(completed_questions.items())
        
        # Fill in data for completed questions
        for original_idx, data in sorted_completed:
            generated = data['generated']
            qc = data['qc']
            question_data = qc.get('question_data', {})
            
            # Adjust the actual index based on previously inserted rows
            current_idx = original_idx + rows_inserted
            
            if question_data:
                question_type = generated.get('question_type', 'MCQ')
                
                # Check if this is an MP question with both parts
                if (question_type.upper() == 'MP' and 
                    'part_a' in question_data and 'part_b' in question_data):
                    
                    try:
                        # Extract both parts of the MP question
                        part_a_data, part_b_data = self._extract_mp_question_parts(question_data)
                        
                        # Fill Part A row (current row)
                        output_df.at[current_idx, 'passage'] = generated.get('passage_text', '')
                        output_df.at[current_idx, 'question_text'] = part_a_data[0]
                        output_df.at[current_idx, 'option_a'] = part_a_data[1]
                        output_df.at[current_idx, 'option_b'] = part_a_data[2]
                        output_df.at[current_idx, 'option_c'] = part_a_data[3]
                        output_df.at[current_idx, 'option_d'] = part_a_data[4]
                        output_df.at[current_idx, 'correct_answer'] = part_a_data[5]
                        
                        # QC data for Part A
                        output_df.at[current_idx, 'qc_passed_checks'] = qc.get('passed_checks', 0)
                        output_df.at[current_idx, 'qc_total_checks'] = qc.get('total_checks', 0)
                        
                        # Record which checks failed for Part A
                        failed_checks_a = []
                        for check_name, check_result in qc.get('checks', {}).items():
                            if check_result.get('score', 0) == 0:
                                # Include part-specific failures
                                if 'part_a' in check_name:
                                    failed_checks_a.append(check_name)
                                elif 'part_b' not in check_name:
                                    # General failures apply to both parts
                                    failed_checks_a.append(check_name)
                        
                        output_df.at[current_idx, 'qc_failed_checks'] = '; '.join(failed_checks_a)
                        
                        # Create a new row for Part B by copying the current row
                        new_row = output_df.iloc[current_idx].copy()
                        
                        # Fill Part B data in the new row
                        new_row['passage'] = generated.get('passage_text', '')
                        new_row['question_text'] = part_b_data[0]
                        new_row['option_a'] = part_b_data[1]
                        new_row['option_b'] = part_b_data[2]
                        new_row['option_c'] = part_b_data[3]
                        new_row['option_d'] = part_b_data[4]
                        new_row['correct_answer'] = part_b_data[5]
                        
                        # QC data for Part B (same as Part A since they're evaluated together)
                        new_row['qc_passed_checks'] = qc.get('passed_checks', 0)
                        new_row['qc_total_checks'] = qc.get('total_checks', 0)
                        
                        # Record which checks failed for Part B
                        failed_checks_b = []
                        for check_name, check_result in qc.get('checks', {}).items():
                            if check_result.get('score', 0) == 0:
                                # Include part-specific failures
                                if 'part_b' in check_name:
                                    failed_checks_b.append(check_name)
                                elif 'part_a' not in check_name:
                                    # General failures apply to both parts
                                    failed_checks_b.append(check_name)
                        
                        new_row['qc_failed_checks'] = '; '.join(failed_checks_b)
                        
                        # Insert the new row right after the current row
                        insert_idx = current_idx + 1
                        
                        # Split the dataframe and insert the new row
                        df_before = output_df.iloc[:insert_idx]
                        df_after = output_df.iloc[insert_idx:]
                        
                        # Convert the new row to a DataFrame
                        new_row_df = pd.DataFrame([new_row])
                        
                        # Concatenate the parts with the new row
                        output_df = pd.concat([df_before, new_row_df, df_after], ignore_index=True)
                        
                        # Increment the counter for inserted rows
                        rows_inserted += 1
                        
                    except Exception as e:
                        logger.error(f"Error processing MP question {current_idx}: {e}")
                        # Fall back to regular processing
                        question, option_a, option_b, option_c, option_d, correct_answer = self._extract_question_components(question_data)
                        
                        output_df.at[current_idx, 'passage'] = generated.get('passage_text', '')
                        output_df.at[current_idx, 'question_text'] = question
                        output_df.at[current_idx, 'option_a'] = option_a
                        output_df.at[current_idx, 'option_b'] = option_b
                        output_df.at[current_idx, 'option_c'] = option_c
                        output_df.at[current_idx, 'option_d'] = option_d
                        output_df.at[current_idx, 'correct_answer'] = correct_answer
                        output_df.at[current_idx, 'qc_passed_checks'] = qc.get('passed_checks', 0)
                        output_df.at[current_idx, 'qc_total_checks'] = qc.get('total_checks', 0)
                        
                        # Record which checks failed
                        failed_checks = []
                        for check_name, check_result in qc.get('checks', {}).items():
                            if check_result.get('score', 0) == 0:
                                failed_checks.append(check_name)
                        
                        output_df.at[current_idx, 'qc_failed_checks'] = '; '.join(failed_checks)
                
                else:
                    # Regular MCQ or SR question
                    question, option_a, option_b, option_c, option_d, correct_answer = self._extract_question_components(question_data)
                    
                    output_df.at[current_idx, 'passage'] = generated.get('passage_text', '')
                    output_df.at[current_idx, 'question_text'] = question
                    output_df.at[current_idx, 'option_a'] = option_a
                    output_df.at[current_idx, 'option_b'] = option_b
                    output_df.at[current_idx, 'option_c'] = option_c
                    output_df.at[current_idx, 'option_d'] = option_d
                    output_df.at[current_idx, 'correct_answer'] = correct_answer
                    output_df.at[current_idx, 'qc_passed_checks'] = qc.get('passed_checks', 0)
                    output_df.at[current_idx, 'qc_total_checks'] = qc.get('total_checks', 0)
                    
                    # Record which checks failed
                    failed_checks = []
                    for check_name, check_result in qc.get('checks', {}).items():
                        if check_result.get('score', 0) == 0:
                            failed_checks.append(check_name)
                    
                    output_df.at[current_idx, 'qc_failed_checks'] = '; '.join(failed_checks)
        
        # Save to CSV
        output_df.to_csv(output_file, index=False)
    
    def _process_passage_questions(self, passage_id: str, question_indices: List[int], df: pd.DataFrame, updated_df: pd.DataFrame) -> Dict:
        """Process all questions for a single passage sequentially to maintain context."""
        completed = {}
        failed_qc = {}
        failed_generation = []
        
        logger.info(f"Processing passage {passage_id} with {len(question_indices)} questions")
        
        # Create a local copy of the updated_df for this thread to modify
        # We'll need to be careful about thread safety when updating the main dataframe
        local_updated_df = updated_df.copy()
        
        for idx in question_indices:
            try:
                result = self.generate_single_question(df.iloc[idx], local_updated_df)
                if result:
                    # Immediately run QC on this question
                    qc_result = self.run_quality_control(result)
                    failed_checks = qc_result['total_checks'] - qc_result['passed_checks']
                    
                    if failed_checks == 0:
                        # Accept immediately and update local context
                        result_data = {
                            'generated': result,
                            'qc': qc_result
                        }
                        completed[idx] = result_data
                        logger.info(f"Question {idx} ({result['question_id']}) completed successfully")
                        
                        # Update local context so next question in this passage can see this one
                        self._update_single_question_in_dataframe(local_updated_df, idx, result_data)
                    else:
                        # Failed QC - add to retry list
                        failed_qc[idx] = result
                        logger.info(f"Question {idx} ({result['question_id']}) failed {failed_checks} checks, will retry")
                else:
                    failed_generation.append(idx)
                    logger.warning(f"Failed to generate question {idx}")
            except Exception as e:
                failed_generation.append(idx)
                logger.error(f"Exception generating question {idx}: {e}")
        
        return {
            'completed': completed,
            'failed_qc': failed_qc,
            'failed_generation': failed_generation
        }
    
    def _update_single_question_in_dataframe(self, updated_df: pd.DataFrame, idx: int, result_data: Dict) -> None:
        """Update a single question in the dataframe for local context tracking."""
        generated = result_data['generated']
        qc = result_data['qc']
        question_data = qc.get('question_data', {})
        
        if question_data:
            # Extract question text for this completion
            question_type = generated.get('question_type', 'MCQ')
            
            if (question_type.upper() == 'MP' and 
                'part_a' in question_data and 'part_b' in question_data):
                # For MP questions, combine both parts
                part_a = question_data['part_a']
                part_b = question_data['part_b']
                combined_question = f"Part A: {part_a.get('question', '')}\nPart B: {part_b.get('question', '')}"
                updated_df.at[idx, 'question_text'] = combined_question
            else:
                # Regular MCQ or SR question
                updated_df.at[idx, 'question_text'] = question_data.get('question', '')
    
    def _update_dataframe_with_completed_questions(self, updated_df: pd.DataFrame, completed_questions: Dict) -> None:
        """Update the dataframe with completed question texts so future generations can see them."""
        for idx, data in completed_questions.items():
            self._update_single_question_in_dataframe(updated_df, idx, data)

def main():
    parser = argparse.ArgumentParser(description="Bulk generate questions with parallel processing and QC")
    parser.add_argument('input_file', help='Input CSV file path')
    parser.add_argument('--output', help='Output CSV file path')
    parser.add_argument('--max-workers', type=int, default=5, help='Maximum number of parallel workers')
    
    args = parser.parse_args()
    
    # Get API key from environment variable
    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not found in environment variables. Please check your .env file.")
        return
    
    # Initialize generator
    generator = BulkQuestionGenerator(api_key, max_workers=args.max_workers)
    
    # Process questions
    generator.process_questions_batch(args.input_file, args.output)

if __name__ == "__main__":
    main() 