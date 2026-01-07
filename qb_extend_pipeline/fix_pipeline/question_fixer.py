#!/usr/bin/env python3
"""
Question Fixer Module

Uses LLM (OpenRouter) to fix failed questions.
- Distractor fix: Regenerate only the wrong answer options
- Full regeneration: Regenerate the entire question
"""

import json
import logging
import asyncio
from typing import Dict, Any, Optional
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# OpenRouter configuration
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = "anthropic/claude-sonnet-4"


def create_openrouter_client(api_key: str) -> AsyncOpenAI:
    """Create an OpenRouter client."""
    return AsyncOpenAI(
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL
    )


def build_distractor_fix_prompt(
    context: Dict[str, Any],
    failure_details: Dict[str, Any]
) -> str:
    """Build prompt for fixing only the distractors."""
    
    # Get correct option info
    correct_answer = context.get('correct_answer', '')
    options = context.get('options', {})
    
    # Map to letter
    letter_map = {'1': 'A', '2': 'B', '3': 'C', '4': 'D', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}
    correct_letter = letter_map.get(str(correct_answer).upper(), 'A')
    correct_text = options.get(correct_letter, '')
    
    # Format failure reasoning
    failure_reasoning = ""
    for check_name, check_data in failure_details.get('failed_checks', {}).items():
        reasoning = check_data.get('reasoning', 'No details')
        failure_reasoning += f"### {check_name} - FAILED\n{reasoning}\n\n"
    
    prompt = f"""You are fixing the distractors (incorrect answer choices) for a reading comprehension question.

## Passage:
{context.get('passage_text', '')[:3000]}

## Question:
{context.get('question_text', '')}

## Correct Answer:
{correct_letter}) {correct_text}

## Current Options:
A) {options.get('A', '')}
B) {options.get('B', '')}
C) {options.get('C', '')}
D) {options.get('D', '')}

(The correct answer is {correct_letter})

---

## QC FAILURE ANALYSIS - These are the EXACT issues found:

{failure_reasoning}

---

## Your Task:
Generate 3 NEW distractors that FIX the issues above. Keep the correct answer ({correct_letter}) unchanged.

Requirements:
1. Address EACH specific issue mentioned in the failure analysis
2. Keep distractors plausible but clearly incorrect
3. Match the grammatical structure of the correct answer
4. Keep similar length to the correct answer (within 20%)
5. Ensure all options belong to the same conceptual category
6. Make distractors distinct from each other AND from the correct answer

Return ONLY valid JSON (no markdown, no explanation outside JSON):
{{
  "option_A": "{correct_text if correct_letter == 'A' else 'new distractor for A'}",
  "option_B": "{correct_text if correct_letter == 'B' else 'new distractor for B'}",
  "option_C": "{correct_text if correct_letter == 'C' else 'new distractor for C'}",
  "option_D": "{correct_text if correct_letter == 'D' else 'new distractor for D'}",
  "option_A_explanation": "Why A is correct/incorrect",
  "option_B_explanation": "Why B is correct/incorrect",
  "option_C_explanation": "Why C is correct/incorrect",
  "option_D_explanation": "Why D is correct/incorrect",
  "fix_reasoning": "Brief explanation of how you addressed each issue"
}}"""

    return prompt


def build_full_regeneration_prompt(
    context: Dict[str, Any],
    failure_details: Dict[str, Any]
) -> str:
    """Build prompt for full question regeneration."""
    
    # Format failure reasoning
    failure_reasoning = ""
    for check_name, check_data in failure_details.get('failed_checks', {}).items():
        reasoning = check_data.get('reasoning', 'No details')
        failure_reasoning += f"### {check_name} - FAILED\n{reasoning}\n\n"
    
    # Format existing questions
    existing_formatted = context.get('formatted_existing', 'No other questions for this article.')
    
    options = context.get('options', {})
    
    prompt = f"""You are regenerating a failed reading comprehension question.

## Passage:
{context.get('passage_text', '')[:3000]}

## FAILED Question (DO NOT reuse this - it has quality issues):
Question: {context.get('question_text', '')}
A) {options.get('A', '')}
B) {options.get('B', '')}
C) {options.get('C', '')}
D) {options.get('D', '')}
Correct Answer: {context.get('correct_answer', '')}

---

## QC FAILURE ANALYSIS - These are the EXACT issues found:

{failure_reasoning}

---

## EXISTING Questions for this Article (your new question must be DIFFERENT from all of these):
{existing_formatted}

---

## Requirements:
- Standard: {context.get('CCSS', '')}
- DOK Level: {context.get('DOK', '')}
- Grade Level: {context.get('grade', '')}
- Question Type: Multiple Choice (4 options, 1 correct)

## Your Task:
Generate a COMPLETELY NEW question that:
1. Addresses ALL the issues mentioned in the failure analysis
2. Is DIFFERENT from all existing questions listed above
3. Properly assesses the {context.get('CCSS', '')} standard
4. Matches DOK level {context.get('DOK', '')}
5. Has clear, unambiguous wording
6. Has exactly ONE correct answer
7. Has plausible, well-crafted distractors
8. All options follow the same grammatical pattern and are similar in length
9. ONLY references events, characters, and details EXPLICITLY STATED in the passage (students only see this excerpt, not the full story)

Return ONLY valid JSON (no markdown, no explanation outside JSON):
{{
  "question": "New question text",
  "option_A": "Option A text",
  "option_B": "Option B text",
  "option_C": "Option C text",
  "option_D": "Option D text",
  "correct_answer": "A or B or C or D",
  "option_A_explanation": "Why A is correct/incorrect",
  "option_B_explanation": "Why B is correct/incorrect",
  "option_C_explanation": "Why C is correct/incorrect",
  "option_D_explanation": "Why D is correct/incorrect",
  "fix_reasoning": "How this new question addresses the original failures"
}}"""

    return prompt


async def call_llm(
    client: AsyncOpenAI,
    prompt: str,
    max_retries: int = 3
) -> Optional[Dict[str, Any]]:
    """
    Call OpenRouter LLM and parse JSON response.
    
    Returns:
        Parsed JSON dict, or None on failure
    """
    for attempt in range(max_retries):
        try:
            response = await client.chat.completions.create(
                model=OPENROUTER_MODEL,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                extra_headers={
                    "HTTP-Referer": "https://github.com/playcademy",
                    "X-Title": "Question Fix Pipeline"
                }
            )
            
            response_text = response.choices[0].message.content
            
            # Parse JSON
            try:
                result = json.loads(response_text)
                return result
            except json.JSONDecodeError:
                # Try to extract JSON from response
                import re
                json_match = re.search(r'\{[\s\S]*\}', response_text)
                if json_match:
                    result = json.loads(json_match.group())
                    return result
                else:
                    logger.warning(f"Failed to parse JSON on attempt {attempt + 1}")
                    
        except Exception as e:
            logger.warning(f"LLM call failed on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
    
    return None


async def fix_distractors(
    context: Dict[str, Any],
    failure_details: Dict[str, Any],
    client: AsyncOpenAI
) -> Optional[Dict[str, Any]]:
    """
    Fix only the distractors for a question.
    
    Returns:
        Dict with new options and explanations, or None on failure
    """
    question_id = failure_details.get('question_id', 'unknown')
    logger.info(f"Fixing distractors for {question_id}")
    
    prompt = build_distractor_fix_prompt(context, failure_details)
    result = await call_llm(client, prompt)
    
    if result:
        result['fix_strategy'] = 'distractor_fix'
        result['question_id'] = question_id
        logger.info(f"Successfully generated distractor fix for {question_id}")
    else:
        logger.error(f"Failed to generate distractor fix for {question_id}")
    
    return result


async def regenerate_question(
    context: Dict[str, Any],
    failure_details: Dict[str, Any],
    client: AsyncOpenAI
) -> Optional[Dict[str, Any]]:
    """
    Fully regenerate a question.
    
    Returns:
        Dict with new question, options, and explanations, or None on failure
    """
    question_id = failure_details.get('question_id', 'unknown')
    logger.info(f"Regenerating full question for {question_id}")
    
    prompt = build_full_regeneration_prompt(context, failure_details)
    result = await call_llm(client, prompt)
    
    if result:
        result['fix_strategy'] = 'full_regeneration'
        result['question_id'] = question_id
        # Store original question for reference
        result['original_question'] = context.get('question_text', '')
        logger.info(f"Successfully regenerated question for {question_id}")
    else:
        logger.error(f"Failed to regenerate question for {question_id}")
    
    return result


async def fix_question(
    context: Dict[str, Any],
    failure_details: Dict[str, Any],
    client: AsyncOpenAI
) -> Optional[Dict[str, Any]]:
    """
    Fix a question using the appropriate strategy.
    
    Args:
        context: Question context from context_gatherer
        failure_details: Failure analysis from failure_analyzer
        client: OpenRouter client
    
    Returns:
        Dict with fixed question data, or None on failure
    """
    strategy = failure_details.get('fix_strategy', 'full_regeneration')
    
    if strategy == 'distractor_fix':
        return await fix_distractors(context, failure_details, client)
    else:
        return await regenerate_question(context, failure_details, client)


if __name__ == "__main__":
    # Test the module
    import os
    import sys
    from dotenv import load_dotenv
    
    logging.basicConfig(level=logging.INFO)
    
    # Load environment
    load_dotenv()
    api_key = os.getenv('OPENROUTER_API_KEY')
    
    if not api_key:
        print("OPENROUTER_API_KEY not set")
        sys.exit(1)
    
    # Simple test
    client = create_openrouter_client(api_key)
    
    test_context = {
        'passage_text': 'The rabbit ran through the forest quickly...',
        'question_text': 'What did the rabbit do?',
        'options': {'A': 'Ran away', 'B': 'Slept', 'C': 'Ate food', 'D': 'Danced'},
        'correct_answer': 'A',
        'DOK': '1',
        'CCSS': 'RL.3.1',
        'grade': '3',
        'formatted_existing': 'No other questions'
    }
    
    test_failure = {
        'question_id': 'test_001',
        'fix_strategy': 'distractor_fix',
        'failed_checks': {
            'homogeneity': {'reasoning': 'Options span different categories'}
        }
    }
    
    async def test():
        result = await fix_question(test_context, test_failure, client)
        print(json.dumps(result, indent=2))
    
    asyncio.run(test())

