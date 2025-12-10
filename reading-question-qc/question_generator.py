#!/usr/bin/env python3
"""
Question Generation Script for CK Generation System

This script processes the ck_gen questions CSV file and generates questions
for each row using Claude Sonnet 4.0 with the appropriate prompts and examples.
"""

import pandas as pd
import json
import random
import anthropic
import os
from typing import Dict, List, Optional, Tuple
import argparse
import logging
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class QuestionGenerator:
    def __init__(self, api_key: str):
        """Initialize the question generator with Claude API key."""
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-sonnet-4-5-20250929"  # Claude Sonnet 4.5
        self.temperature = 0.4
        
        # Load data files
        self.prompts = self._load_prompts()
        self.ccss_standards = self._load_ccss_standards()
        self.examples = self._load_examples()
        self.questions_df = self._load_questions()
        
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
    
    def _load_questions(self) -> pd.DataFrame:
        """Load questions CSV."""
        try:
            return pd.read_csv('ck_gen - questions.csv')
        except Exception as e:
            logger.error(f"Error loading questions: {e}")
            raise
    
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
                # Found perfect match with difficulty
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
            # Return a random matching example
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
    
    def _get_existing_questions(self, passage_id: str) -> str:
        """Get existing questions for the same passage to avoid duplication."""
        existing = self.questions_df[self.questions_df['passage_id'] == passage_id]
        if existing.empty:
            return "None"
        
        # Format existing questions for the prompt
        questions_list = []
        for _, row in existing.iterrows():
            questions_list.append(f"- {row.get('question_text', 'N/A')}")
        
        return "\n".join(questions_list) if questions_list else "None"
    
    def _find_generation_prompt(self, question_type: str, dok: int) -> Optional[Dict]:
        """Find the appropriate generation prompt based on question type and DOK level."""
        # Map question types to prompt names
        type_mapping = {
            'MCQ': f'MCQ DOK {dok}',
            'SR': f'SR DOK {dok}',
            'MP': f'MP DOK {dok}' if dok >= 2 else f'MP DOK 2'  # MP only has DOK 2 and 3
        }
        
        target_name = type_mapping.get(question_type.upper())
        if not target_name:
            return None
        
        for prompt in self.prompts:
            if prompt.get('function') == 'generate' and prompt.get('name') == target_name:
                return prompt
        
        return None
    
    def _fill_prompt_variables(self, prompt_text: str, row: pd.Series, example: Optional[Dict]) -> str:
        """Fill in all variables in the prompt template."""
        standard_code = row.get('CCSS', '')
        variables = {
            'text_content': row.get('passage_text', ''),
            'standard_code': standard_code,
            'standard_description': self.ccss_standards.get(standard_code, ''),
            'existing_questions': self._get_existing_questions(row.get('passage_id', '')),
            'grade_level': self._extract_grade_level(standard_code)
        }
        
        # Add example variables if available
        if example:
            variables.update(example)
        else:
            # Provide empty fallbacks for example variables
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
    
    def generate_question(self, row: pd.Series) -> Optional[Dict]:
        """Generate a question for a single row."""
        try:
            # Extract row information
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
                prompt_config['prompt'], row, example
            )
            
            # Generate question using Claude
            logger.info(f"Generating {question_type} DOK {dok} question for {row.get('question_id', 'unknown')}")
            
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                temperature=self.temperature,
                messages=[
                    {
                        "role": "user", 
                        "content": filled_prompt
                    }
                ]
            )
            
            # Parse response
            # Extract text from response
            response_text = response.content[0].text
            
            # Try to parse JSON response if applicable
            result = {
                'question_id': row.get('question_id', ''),
                'passage_id': row.get('passage_id', ''),
                'passage_text': row.get('passage_text', ''),  # Add passage text for QC
                'question_type': question_type,
                'dok': dok,
                'standard': standard,
                'generated_content': response_text,
                'prompt_used': prompt_config['name'],
                'example_used': example is not None,
                'timestamp': datetime.now().isoformat()
            }
            
            # Try to extract JSON from response for structured questions
            try:
                if '```json' in response_text:
                    json_start = response_text.find('```json') + 7
                    json_end = response_text.find('```', json_start)
                    json_content = response_text[json_start:json_end].strip()
                    parsed_json = json.loads(json_content)
                    result['structured_content'] = parsed_json
            except (json.JSONDecodeError, ValueError):
                # If JSON parsing fails, keep the raw text
                pass
            
            return result
            
        except Exception as e:
            logger.error(f"Error generating question for {row.get('question_id', 'unknown')}: {e}")
            return None
    
    def generate_batch(self, start_idx: int = 0, batch_size: int = 10, output_file: str = None) -> List[Dict]:
        """Generate questions for a batch of rows."""
        if output_file is None:
            output_file = f"generated_questions_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        results = []
        end_idx = min(start_idx + batch_size, len(self.questions_df))
        
        logger.info(f"Processing rows {start_idx} to {end_idx-1} ({end_idx-start_idx} questions)")
        
        for idx in range(start_idx, end_idx):
            row = self.questions_df.iloc[idx]
            result = self.generate_question(row)
            
            if result:
                results.append(result)
                logger.info(f"Successfully generated question {idx+1}/{end_idx}")
            else:
                logger.warning(f"Failed to generate question for row {idx}")
        
        # Save results
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            logger.info(f"Results saved to {output_file}")
        except Exception as e:
            logger.error(f"Error saving results: {e}")
        
        return results

def main():
    parser = argparse.ArgumentParser(description="Generate questions using Claude Sonnet 4.0")
    parser.add_argument('--start', type=int, default=0, help='Starting row index')
    parser.add_argument('--batch-size', type=int, default=10, help='Number of questions to generate')
    parser.add_argument('--output', help='Output file name')
    
    args = parser.parse_args()
    
    # Get API key from environment variable
    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not found in environment variables. Please check your .env file.")
        return
    
    # Initialize generator
    generator = QuestionGenerator(api_key)
    
    # Generate questions
    results = generator.generate_batch(
        start_idx=args.start,
        batch_size=args.batch_size,
        output_file=args.output
    )
    
    logger.info(f"Generated {len(results)} questions successfully")

if __name__ == "__main__":
    main() 