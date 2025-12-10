# Prompt Comparison: All Generation Systems

This document contains the **complete prompts** used by all question generation systems.

> **Last Updated:** December 10, 2024
> 
> **Recent Improvements:**
> - Dynamic `{grade_level}` placeholder (extracted from CCSS standard code)
> - Enhanced Quality Requirements (Homogeneity, Specificity Balance, Semantic Distance)
> - Quality Verification in output format
> - New QC prompts: `too_close`, `difficulty_assessment`

---

# Table of Contents

1. [Generation Prompts (from ck_gen - prompts.json)](#generation-prompts)
   - [MCQ DOK 1](#mcq-dok-1)
   - [MCQ DOK 2](#mcq-dok-2)
   - [MCQ DOK 3](#mcq-dok-3)
   - [SR DOK 1](#sr-dok-1)
   - [SR DOK 2](#sr-dok-2)
   - [SR DOK 3](#sr-dok-3)
   - [SR DOK 4](#sr-dok-4)
   - [MP DOK 2](#mp-dok-2)
   - [MP DOK 3](#mp-dok-3)
2. [Quality Control Prompts](#quality-control-prompts)
   - [Grammatical Parallel](#grammatical-parallel)
   - [Plausibility](#plausibility)
   - [Homogeneity](#homogeneity)
   - [Specificity Balance](#specificity-balance)
   - [Too Close (NEW)](#too-close)
   - [Standard Alignment](#standard-alignment)
   - [Clarity Precision](#clarity-precision)
   - [Text Dependency](#text-dependency)
   - [Single Correct Answer](#single-correct-answer)
   - [Passage Reference](#passage-reference)
   - [Difficulty Assessment (NEW)](#difficulty-assessment)
   - [Skill Integration](#skill-integration)
3. [Question Bank Extender Prompt](#question-bank-extender-prompt)
4. [Comparison Summary](#comparison-summary)
5. [Variable Reference](#variable-reference)

---

# Generation Prompts

These prompts are used by `question_generator.py` and `bulk_question_generator.py`.

> **Note on `{grade_level}`:** This variable is dynamically extracted from the CCSS standard code:
> - `RL.3.1` → "grade 3"
> - `RI.5.2` → "grade 5"
> - `RL.9-10.3` → "grades 9-10"
> - `RL.K.1` → "kindergarten"

## MCQ DOK 1

```
You are generating a DOK 1 multiple choice question for {grade_level} reading assessment using a provided example as a template.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 1 (Recall and Reproduction)
Question Type: Multiple Choice

Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}

Existing Questions to Avoid Duplication:
{existing_questions}

Task: Use the example question as a template to create a new question for the provided text.

Template Analysis Instructions:
1. Question Structure: Identify the question pattern and phrasing style from the example
2. Content Focus: Note what specific type of information the example asks for
3. Answer Choice Pattern: Observe the structure and style of the example's choices
4. Cognitive Level: Ensure your question matches the same DOK 1 recall level

DOK 1 Requirements:
- Test recall of basic facts, definitions, or details
- Require simple recognition or identification
- Ask for information directly stated in the text
- No inference or analysis required

Adaptation Process:
1. Identify the question type and structure from the example
2. Find equivalent information in your provided text
3. Adapt the question wording to fit your text content
4. Create answer choices that match the example's style and structure
5. Ensure one choice is clearly correct based on the text
6. Make distractors plausible but clearly wrong

## Quality Requirements (CRITICAL - All Must Be Met)

### Question Quality:
1. **Template Fidelity**: Follow the example's question structure and style
2. **Text Dependency**: Must require reading the passage to answer - cannot be answered with general knowledge alone
3. **Grade Appropriate**: Use vocabulary and concepts suitable for {grade_level}
4. **Clear and Precise**: Unambiguous question with one correct answer
5. **Standard Alignment**: Question must directly assess the specific skill in the target standard

### Answer Choice Quality:
6. **Plausible Distractors**: Wrong answers should be believable but clearly incorrect
7. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
8. **Homogeneity**: All choices MUST belong to the same conceptual category
   - If asking about word meaning → all choices must be possible definitions
   - If asking about a character → all choices must be character-related (traits, actions, feelings)
   - If asking about main idea → all choices must be potential main ideas
   - Do NOT mix character traits with setting details, or themes with specific facts
9. **Specificity Balance**: All choices MUST have similar levels of detail
   - GOOD: "happy", "sad", "angry", "worried" (all single emotion words)
   - BAD: "sad" vs "experiencing deep melancholy" vs "feeling blue" (different detail levels)
   - Do NOT have one overly specific choice among general ones
10. **Length Balance**: Choices should maintain similar character length
    - The correct answer must NOT be the longest option
    - The correct answer must NOT be significantly shorter than all distractors (aim for 70-110% of distractor lengths)
11. **Semantic Distance**: Distractors must NOT be synonyms or near-synonyms of the correct answer
    - AVOID: correct="happy" with distractor="joyful" (too similar)
    - Each distractor should represent a distinctly different concept

Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice following example's style",
    "B": "second choice following example's style", 
    "C": "third choice following example's style",
    "D": "fourth choice following example's style"
  },
  "correct_answer": "A",
  "DOK": 1,
  "CCSS": "standard code",
  "template_adaptation": "brief explanation of how you adapted the example to fit your text",
  "rationale": "brief explanation of why this answer is correct",
  "quality_verification": {
    "homogeneity_check": "all choices are [category type]",
    "specificity_check": "all choices are at [detail level]",
    "length_check": "correct answer length is appropriate relative to distractors"
  }
}
```

Instructions: Generate exactly one DOK 1 multiple choice question that follows the example's template structure while adapting the content to assess the target standard using the provided text. Ensure ALL quality requirements are met.
```

---

## MCQ DOK 2

```
You are generating a DOK 2 multiple choice question for {grade_level} reading assessment using a provided example as a template.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 2 (Skills and Concepts)
Question Type: Multiple Choice

Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}

Existing Questions to Avoid Duplication:
{existing_questions}

Task: Use the example question as a template to create a new question for the provided text.

Template Analysis Instructions:
1. Question Structure: Identify the question pattern and cognitive demand from the example
2. Inference Type: Note what kind of reasoning or application the example requires
3. Answer Choice Logic: Observe how choices represent different levels of understanding
4. Cognitive Process: Ensure your question matches the same DOK 2 application level

DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Demonstrate understanding beyond simple recall

Adaptation Process:
1. Identify the cognitive process required by the example (inference, comparison, classification, etc.)
2. Find equivalent information or relationships in your provided text
3. Adapt the question structure to target the same cognitive process with your content
4. Create answer choices that reflect different levels of understanding
5. Ensure the correct choice requires the same type of reasoning as the example
6. Make distractors represent reasonable misconceptions or partial understanding

## Quality Requirements (CRITICAL - All Must Be Met)

### Question Quality:
1. **Template Fidelity**: Follow the example's cognitive demand and question structure
2. **Inference Required**: Cannot be answered by simple recall alone
3. **Text Dependency**: Must require reading and understanding the passage - cannot be answered with general knowledge
4. **Clear and Precise**: Unambiguous question with one correct answer
5. **Standard Alignment**: Question must directly assess the specific skill in the target standard
6. **Cognitive Match**: Should require the same type of thinking as the example

### Answer Choice Quality:
7. **Plausible Distractors**: Wrong answers should represent reasonable misconceptions
8. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
9. **Homogeneity**: All choices MUST belong to the same conceptual category
   - If asking about character motivation → all choices must be possible motivations
   - If asking about cause-effect → all choices must be possible causes or effects
   - If asking about inference → all choices must be possible inferences
   - Do NOT mix different concept types (e.g., character traits with plot events)
10. **Specificity Balance**: All choices MUST have similar levels of detail
    - All choices should be at the same level of abstraction
    - Do NOT mix general statements with highly specific details
    - Do NOT have one technical term among casual language
11. **Length Balance**: Choices should maintain similar character length
    - The correct answer must NOT be the longest option
    - The correct answer must NOT be significantly shorter than all distractors
12. **Semantic Distance**: Distractors must NOT be synonyms or near-synonyms of the correct answer
    - Each option should represent a distinctly different interpretation or conclusion
    - AVOID options that differ only in degree (e.g., "somewhat worried" vs "very worried")

Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice reflecting the example's reasoning patterns",
    "B": "second choice reflecting the example's reasoning patterns", 
    "C": "third choice reflecting the example's reasoning patterns",
    "D": "fourth choice reflecting the example's reasoning patterns"
  },
  "correct_answer": "B",
  "DOK": 2,
  "CCSS": "standard code",
  "template_adaptation": "explanation of how you adapted the example's cognitive process to your text",
  "cognitive_process": "what type of DOK 2 thinking this question requires (matching the example)",
  "rationale": "explanation of why this answer requires DOK 2 reasoning",
  "quality_verification": {
    "homogeneity_check": "all choices are [category type]",
    "specificity_check": "all choices are at [detail level]",
    "semantic_distance_check": "each option represents a distinct concept"
  }
}
```

Instructions: Generate exactly one DOK 2 multiple choice question that follows the example's cognitive template while adapting the content to require the same type of reasoning using the provided text. Ensure ALL quality requirements are met.
```

---

## MCQ DOK 3

```
You are generating a DOK 3 multiple choice question for {grade_level} reading assessment using a provided example as a template.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 3 (Strategic Thinking)
Question Type: Multiple Choice

Example Question (Same Standard, DOK, Difficulty):
Question: {example_question}
A) {example_choice_a}
B) {example_choice_b}
C) {example_choice_c}
D) {example_choice_d}
Correct Answer: {example_correct}

Existing Questions to Avoid Duplication:
{existing_questions}

Task: Use the example question as a template to create a new question for the provided text.

Template Analysis Instructions:
1. Strategic Thinking Pattern: Identify what type of analysis, evaluation, or synthesis the example requires
2. Question Complexity: Note the sophisticated reasoning process the example demands
3. Evidence Integration: Observe how the example requires connecting multiple text elements
4. Depth Level: Ensure your question matches the same DOK 3 strategic thinking level

DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw conclusions based on evidence
- Make complex inferences or connections
- Demonstrate deep understanding

Adaptation Process:
1. Identify the strategic thinking process required by the example (analysis of purpose, evaluation of evidence, synthesis of themes, etc.)
2. Find equivalent complex relationships or deep concepts in your provided text
3. Adapt the question structure to target the same strategic thinking process
4. Create answer choices that represent different levels of analytical sophistication
5. Ensure the correct choice requires the same depth of reasoning as the example
6. Make distractors represent sophisticated but incomplete analysis

## Quality Requirements (CRITICAL - All Must Be Met)

### Question Quality:
1. **Template Fidelity**: Follow the example's strategic thinking demand and analytical structure
2. **Strategic Thinking**: Must require analysis, evaluation, or synthesis matching the example
3. **Evidence-Based**: Answer should be supported by multiple text clues like the example
4. **Text Dependency**: Must require reading and deep understanding of the passage
5. **Standard Alignment**: Question must directly assess the specific skill in the target standard
6. **Complex Reasoning**: Goes beyond simple inference to sophisticated analysis
7. **Depth Match**: Should require the same level of strategic thinking as the example

### Answer Choice Quality:
8. **Plausible Distractors**: Should represent sophisticated misconceptions or partial analysis
9. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
10. **Homogeneity**: All choices MUST belong to the same conceptual category
    - If asking about author's purpose → all choices must be possible purposes
    - If asking about theme → all choices must be possible themes
    - If asking about analysis → all choices must be analytical statements
    - Do NOT mix analysis types (e.g., theme with plot summary)
11. **Specificity Balance**: All choices MUST have similar levels of analytical depth
    - All should be equally sophisticated statements
    - Do NOT mix surface-level observations with deep analysis
12. **Length Balance**: Choices should maintain similar character length
    - The correct answer must NOT be the longest option
    - The correct answer must NOT be significantly shorter than all distractors
13. **Semantic Distance**: Distractors must NOT be synonyms or slight variations of the correct answer
    - Each should represent a distinctly different analytical conclusion
    - AVOID options that could both be considered correct with slight interpretation differences

Output Format:
```json
{
  "question": "exact question text adapted from the example template",
  "choices": {
    "A": "first choice reflecting sophisticated analytical options",
    "B": "second choice reflecting sophisticated analytical options", 
    "C": "third choice reflecting sophisticated analytical options",
    "D": "fourth choice reflecting sophisticated analytical options"
  },
  "correct_answer": "C",
  "DOK": 3,
  "CCSS": "standard code",
  "template_adaptation": "explanation of how you adapted the example's strategic thinking process to your text",
  "strategic_thinking_type": "what type of DOK 3 analysis this requires (matching the example pattern)",
  "evidence_integration": "how this question requires connecting multiple text elements like the example",
  "rationale": "detailed explanation of why this answer requires strategic thinking",
  "quality_verification": {
    "homogeneity_check": "all choices are [analytical category type]",
    "specificity_check": "all choices are at [same analytical depth]",
    "semantic_distance_check": "each option represents a distinct analytical conclusion"
  }
}
```

Instructions: Generate exactly one DOK 3 multiple choice question that follows the example's strategic thinking template while adapting the content to require the same depth of analysis using the provided text. Ensure ALL quality requirements are met.
```

---

## SR DOK 1

```
You are generating a DOK 1 short response question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 1 (Recall and Reproduction)
Question Type: Short Response

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 1 Requirements:
- Test recall of basic facts, definitions, or details
- Require simple identification or listing
- Ask for information directly stated in the text
- No analysis or complex explanation required

Short Response Characteristics:
- Expected answer length: 1-2 sentences
- Should require specific text evidence
- Student must locate and extract information
- Minimal interpretation required

Quality Requirements:
1. Text Dependency: Must require reading passage to answer
2. Specific Evidence: Should prompt for particular details or examples
3. Grade Appropriate: Language and expectations suitable for {grade_level}
4. Clear Scoring: Answers should be objectively verifiable
5. Focused Response: Should have a clear, limited scope
6. Standard Alignment: Must directly assess the target standard's specific skill

Sample Rubric Expectations:
- 2 points: Complete, accurate answer with specific text evidence
- 1 point: Partially correct answer or missing some evidence
- 0 points: Incorrect or no evidence from text

Output Format:
```json
{
  "question": "exact question text including any specific instructions",
  "expected_response": "sample complete response showing what a full-credit answer would include",
  "key_details": ["detail 1", "detail 2", "detail 3"],
  "scoring_notes": "brief guidance on what constitutes a complete answer",
  "dok_justification": "explanation of why this is DOK 1"
}
```

Instructions: Generate exactly one DOK 1 short response question that requires students to recall and cite specific information from the text to assess the target standard.
```

---

## SR DOK 2

```
You are generating a DOK 2 short response question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 2 (Skills and Concepts)
Question Type: Short Response

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Explain simple relationships or processes

Short Response Characteristics:
- Expected answer length: 2-3 sentences
- Should require inference or application
- Student must explain their reasoning
- Connects multiple pieces of information

Cognitive Processes for DOK 2:
- Making basic inferences from text evidence
- Explaining simple cause-and-effect relationships
- Comparing or contrasting elements
- Organizing information logically
- Applying understanding to explain concepts

Quality Requirements:
1. Inference Required: Cannot be answered by simple recall alone
2. Text Evidence: Must cite specific examples or details
3. Explanation Expected: Student should explain their thinking
4. Clear Criteria: Scoring should be based on clear, achievable standards
5. Grade Appropriate: Expectations match {grade_level} capabilities
6. Standard Alignment: Must directly assess the target standard's specific skill

Sample Rubric Expectations:
- 2 points: Clear inference/application with appropriate text evidence and explanation
- 1 point: Partial inference or weak evidence/explanation
- 0 points: No clear inference or insufficient text evidence

Output Format:
```json
{
  "question": "exact question text including any specific instructions about evidence or explanation",
  "expected_response": "sample complete response showing inference/application with text evidence",
  "key_concepts": ["concept 1", "concept 2"],
  "required_evidence": ["type of evidence needed", "another type"],
  "scoring_notes": "guidance on what constitutes complete inference and adequate evidence",
  "dok_justification": "explanation of what skill/concept application this question requires"
}
```

Instructions: Generate exactly one DOK 2 short response question that requires students to make inferences or apply concepts while providing text evidence to assess the target standard.
```

---

## SR DOK 3

```
You are generating a DOK 3 short response question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 3 (Strategic Thinking)
Question Type: Short Response

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw complex conclusions based on evidence
- Make sophisticated connections across text
- Demonstrate deep understanding

Short Response Characteristics:
- Expected answer length: 3-4 sentences
- Should require analysis or evaluation
- Student must synthesize multiple text elements
- Demonstrates complex understanding

Cognitive Processes for DOK 3:
- Analyzing author's purpose or craft decisions
- Evaluating effectiveness of text elements
- Synthesizing information from multiple parts
- Drawing complex conclusions with evidence
- Making sophisticated text-to-text connections
- Recognizing implicit themes or messages

Quality Requirements:
1. Strategic Thinking: Must require analysis, evaluation, or synthesis
2. Multiple Text Elements: Should connect different parts of the passage
3. Complex Reasoning: Goes beyond simple inference to sophisticated analysis
4. Evidence Integration: Must synthesize multiple pieces of evidence
5. Grade-Appropriate Depth: Challenging but achievable for {grade_level}
6. Standard Alignment: Must directly assess the target standard's specific skill

Sample Rubric Expectations:
- 2 points: Clear analysis/evaluation with well-integrated evidence and sophisticated reasoning
- 1 point: Some analysis with adequate evidence but less sophisticated reasoning
- 0 points: Little analysis or insufficient evidence integration

Output Format:
```json
{
  "question": "exact question text with clear expectations for analysis/evaluation",
  "expected_response": "sample response demonstrating strategic thinking with integrated evidence",
  "analysis_focus": "what aspect should be analyzed/evaluated",
  "evidence_requirements": ["type 1", "type 2", "connections needed"],
  "scoring_notes": "guidance on recognizing strategic thinking and evidence integration",
  "dok_justification": "explanation of the strategic thinking process this question requires"
}
```

Instructions: Generate exactly one DOK 3 short response question that requires students to analyze, evaluate, or synthesize information with integrated text evidence to assess the target standard.
```

---

## SR DOK 4

```
You are generating a DOK 4 short response question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 4 (Extended Thinking)
Question Type: Short Response

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 4 Requirements:
- Require extended thinking over time
- Complex analysis across multiple sources or extended text
- Synthesize and apply knowledge in new situations
- Create original connections or solutions
- Demonstrate sophisticated reasoning

Short Response Characteristics:
- Expected answer length: 4-5 sentences
- Should require complex synthesis or creation
- Student must make original connections
- Demonstrates extended reasoning process

Cognitive Processes for DOK 4:
- Creating original applications or extensions
- Synthesizing across multiple sources or experiences
- Designing solutions or alternatives
- Making complex comparative analyses
- Developing original interpretations
- Applying understanding to new contexts

Quality Requirements:
1. Extended Thinking: Must require sustained reasoning beyond single concept
2. Original Application: Should ask for creation or extension of ideas
3. Complex Synthesis: Connects passage with broader knowledge or experiences
4. Sophisticated Reasoning: Demonstrates deep understanding and original thinking
5. Grade-Appropriate Challenge: Ambitious but achievable for advanced {grade_level} students
6. Standard Alignment: Must directly assess the target standard's specific skill

Sample Rubric Expectations:
- 2 points: Original, creative response with sophisticated reasoning and clear text connections
- 1 point: Some original thinking with adequate reasoning and text connections
- 0 points: Limited original thinking or weak connections to text

Output Format:
```json
{
  "question": "exact question text that prompts extended thinking and original application",
  "expected_response": "sample response showing extended reasoning and original connections",
  "thinking_process": "what extended cognitive process is required",
  "synthesis_elements": ["element 1", "element 2", "creative component"],
  "scoring_notes": "guidance on recognizing extended thinking and original applications",
  "dok_justification": "explanation of why this requires extended thinking and complex reasoning"
}
```

Instructions: Generate exactly one DOK 4 short response question that requires students to engage in extended thinking, synthesis, or original application while assessing the target standard.
```

---

## MP DOK 2

```
You are generating a DOK 2 multipart question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 2 (Skills and Concepts)
Question Type: Multipart

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 2 Requirements:
- Apply skills and concepts to make basic inferences
- Classify, organize, or compare information
- Make connections between ideas
- Demonstrate understanding through multiple steps

Multipart Structure:
- Part A: Foundation question (often recall or basic inference)
- Part B: Application question that builds on Part A
- Both parts should work together to assess the standard
- Combined difficulty should reach DOK 2 level

Standard-Specific Examples:
- RI.3.2: Part A: "What is the main topic of this passage?" Part B: "Which two details best support this main topic?"
- RI.3.8: Part A: "What is the first step in the process?" Part B: "How does this first step connect to the final result?"
- RL.3.3: Part A: "What problem does the character face?" Part B: "How do the character's actions help solve this problem?"

## Quality Requirements (CRITICAL - All Must Be Met)

### Question Quality:
1. **Connected Parts**: Part B should build meaningfully on Part A
2. **Progressive Difficulty**: Part A establishes foundation, Part B requires application
3. **Text Dependency**: Both parts must require passage comprehension - cannot be answered with general knowledge
4. **Clear Scoring**: Each part should have distinct, measurable expectations
5. **Cumulative Assessment**: Together they should fully assess the target standard
6. **Standard Alignment**: Both parts must directly assess the target standard's specific skill

### Answer Choice Quality (for both Part A and Part B):
7. **Plausible Distractors**: Wrong answers should be believable but clearly incorrect
8. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
9. **Homogeneity**: All choices MUST belong to the same conceptual category
   - Do NOT mix different concept types within one part
10. **Specificity Balance**: All choices MUST have similar levels of detail
    - All choices should be at the same level of abstraction
11. **Length Balance**: Choices should maintain similar character length
    - The correct answer must NOT be the longest option
    - The correct answer must NOT be significantly shorter than all distractors
12. **Semantic Distance**: Distractors must NOT be synonyms or near-synonyms of the correct answer

Output Format:
```json
{
  "part_a": {
    "question": "exact text for Part A",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "A",
    "DOK": 1,
    "CCSS": "standard code",
    "quality_verification": {
      "homogeneity_check": "all choices are [category]",
      "specificity_check": "all at [detail level]"
    }
  },
  "part_b": {
    "question": "exact text for Part B",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "B",
    "DOK": 2,
    "CCSS": "standard code",
    "quality_verification": {
      "homogeneity_check": "all choices are [category]",
      "specificity_check": "all at [detail level]"
    }
  },
  "connection_rationale": "explanation of how Part B builds on Part A",
  "dok_justification": "explanation of why the combined question reaches DOK 2",
  "standard_assessment": "how this multipart question assesses the target standard"
}
```

Instructions: Generate exactly one DOK 2 multipart question where Part A establishes a foundation and Part B requires application or reasoning that builds on Part A to assess the target standard. Ensure ALL quality requirements are met for both parts.
```

---

## MP DOK 3

```
You are generating a DOK 3 multipart question for {grade_level} reading assessment.

Text Section/Passage:
{text_content}

Target Standard: {standard_code} - {standard_description}

DOK Level: 3 (Strategic Thinking)
Question Type: Multipart

Existing Questions to Avoid Duplication:
{existing_questions}

DOK 3 Requirements:
- Require strategic thinking and reasoning
- Analyze, evaluate, or synthesize information
- Draw complex conclusions based on evidence
- Make sophisticated connections across text

Multipart Structure:
- Part A: Analysis or inference question
- Part B: Strategic thinking question that extends Part A
- Both parts should work together to demonstrate deep understanding
- Combined difficulty should reach DOK 3 level

Standard-Specific Examples:
- RI.3.6: Part A: "What is the author's main purpose in writing this passage?" Part B: "How do the author's word choices in the first and last paragraphs support this purpose?"
- RI.3.8: Part A: "What conclusion can be drawn about the importance of each step in the process?" Part B: "What piece of evidence from the passage best supports your answer to the previous question?"
- RL.3.3: Part A: "How do the character's feelings change throughout the story?" Part B: "Which quotation from the text best supports your answer to the previous question?"

## Quality Requirements (CRITICAL - All Must Be Met)

### Question Quality:
1. **Strategic Connection**: Part B should require sophisticated reasoning beyond Part A
2. **Deep Analysis**: Combined parts should demonstrate thorough understanding
3. **Evidence Integration**: Both parts should require synthesizing multiple text elements
4. **Complex Reasoning**: Part B should extend thinking in meaningful ways
5. **Standard Mastery**: Together they should comprehensively assess the target standard
6. **Text Dependency**: Both parts must require reading the passage - cannot be answered with general knowledge

### Answer Choice Quality (for both Part A and Part B):
7. **Plausible Distractors**: Wrong answers should be believable but clearly incorrect
8. **Grammatical Parallelism**: All choices MUST follow the same grammatical structure
9. **Homogeneity**: All choices MUST belong to the same conceptual category
   - If asking about theme → all choices must be possible themes
   - If asking about evidence → all choices must be evidence statements
   - Do NOT mix different concept types
10. **Specificity Balance**: All choices MUST have similar levels of analytical depth
    - All should be equally sophisticated statements
11. **Length Balance**: Choices should maintain similar character length
    - The correct answer must NOT be the longest option
    - The correct answer must NOT be significantly shorter than all distractors
12. **Semantic Distance**: Distractors must NOT be synonyms, near-synonyms, or slight variations of the correct answer
    - Each should represent a distinctly different analytical conclusion

Output Format:
```json
{
  "part_a": {
    "question": "exact text for Part A requiring analysis or complex inference",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "A",
    "DOK": 2,
    "CCSS": "standard code",
    "quality_verification": {
      "homogeneity_check": "all choices are [category]",
      "specificity_check": "all at [analytical depth]"
    }
  },
  "part_b": {
    "question": "exact text for Part B requiring strategic thinking that builds on Part A",
    "choices": {
      "A": "first choice",
      "B": "second choice", 
      "C": "third choice",
      "D": "fourth choice"
    },
    "correct_answer": "A",
    "DOK": 3,
    "CCSS": "standard code",
    "quality_verification": {
      "homogeneity_check": "all choices are [category]",
      "specificity_check": "all at [analytical depth]"
    }
  },
  "strategic_connection": "explanation of how Part B requires strategic thinking beyond Part A",
  "dok_justification": "explanation of the strategic thinking process required across both parts",
  "standard_assessment": "how this multipart question demonstrates comprehensive mastery of the target standard"
}
```

Instructions: Generate exactly one DOK 3 multipart question where Part A requires analysis and Part B requires strategic thinking that builds on and extends Part A to comprehensively assess the target standard. Ensure ALL quality requirements are met for both parts.
```

---

# Quality Control Prompts

These prompts are used for validating generated questions.

## Grammatical Parallel

```
You are evaluating whether answer choices have consistent grammatical structure.

Question: {question}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Task: Determine if all choices follow the same grammatical pattern.

Examples of GOOD parallelism:
All infinitive phrases: "to make", "to carry", "to take", "to hold"
All single words: "happy", "sad", "angry", "excited"
All noun phrases: "the main character", "the setting", "the conflict", "the theme"
All complete sentences: "He was tired.", "He was hungry.", "He was lost.", "He was scared."

Examples of BAD parallelism:
Mixed structures: "to make", "carrying", "he takes", "holds it"
Mixed lengths: "run", "walking quickly", "to jump over the fence", "swimming"

IMPORTANT: Your goal is to fail questions that are unfair due to the grammatical structure of their options. Minor variations are to be accepted as long as they do not provide an unfair advantage or disadvantage.

Instructions:
Evaluate ONLY grammatical consistency. Return exactly one number:
1 if all choices follow the same grammatical pattern
0 if choices have inconsistent grammatical structures

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Plausibility

```
You are evaluating whether incorrect answer choices are plausible distractors.

Passage: {passage}

Question: {question}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Correct Answer: {correct_answer}

Task: Evaluate if each INCORRECT choice is a believable wrong answer.

GOOD distractors:
Represent common misconceptions
Are logically related to the question
Could reasonably fool a student who partially understands

BAD distractors:
Are obviously wrong to any reasonable student
Are completely unrelated to the question topic
Are "throwaway" options with no educational value

Instructions:
Consider only the incorrect choices. Return exactly one number:
1 if all incorrect choices are plausible distractors
0 if any incorrect choice is obviously wrong or unrelated

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Homogeneity

```
You are evaluating whether all answer choices belong to the same conceptual category.

Question: {question}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Task: Determine if all choices address the same type of concept.

GOOD homogeneity examples:
Word meaning question → All choices are possible definitions
Character motivation question → All choices are possible motivations
Text structure question → All choices are structural elements
Main idea question → All choices are potential main ideas

BAD homogeneity examples:
Word meaning question → Mix of definitions and plot events
Character question → Mix of character traits and setting details
Main idea question → Mix of themes and specific facts

Instructions:
Return exactly one number:
1 if all choices belong to the same conceptual category
0 if choices span different conceptual categories

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Specificity Balance

```
You are evaluating whether answer choices have similar levels of detail and specificity.

Question: {question}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Task: Determine if choices are at similar specificity levels.

GOOD specificity balance:
All general: "happy", "sad", "angry", "worried"
All specific: "photosynthesis", "respiration", "transpiration", "germination"
All at same detail level: "ran quickly", "walked slowly", "jumped high", "crawled carefully"

BAD specificity balance:
Mixed levels: "sad" vs "experiencing deep melancholy" vs "blue"
One outlier: Three simple words + one complex phrase
Technical vs casual: "H2O" vs "water" vs "liquid" vs "beverage"

Instructions:
Return exactly one number:
1 if all choices are at similar levels of specificity/detail
0 if there are significant differences in specificity levels

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Too Close

> **NEW** - Added December 2024

```
You are evaluating whether any distractors are semantically too close to the correct answer.

Passage: {passage}
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Correct Answer: {correct_answer}
Grade Level: {grade}

Task: Determine if any distractor is TOO CLOSE to the correct answer.

A distractor is TOO CLOSE if:
1. **Synonymous or Near-Synonymous**: Uses different wording but conveys essentially the same meaning
   - Example: correct="elated" with distractor="thrilled" (too similar)
2. **Degree-Only Difference**: Differs only in degree/intensity when the passage doesn't clearly establish the distinction
   - Example: correct="somewhat worried" with distractor="very worried" (too similar)
3. **Equally Text-Supported**: Both correct answer and distractor are equally supported by passage evidence
4. **Double-Key Risk**: Two options could both be considered correct based on reasonable interpretation
5. **Grade-Inappropriate Distinction**: The distinction requires knowledge beyond the target grade level

GOOD semantic distance:
- Correct="to persuade" vs distractors="to inform", "to entertain", "to describe" (distinct purposes)
- Correct="brave" vs distractors="selfish", "lazy", "confused" (distinct traits)

BAD semantic distance (TOO CLOSE):
- Correct="happy" vs distractor="joyful" (synonyms)
- Correct="the story teaches kindness" vs distractor="the story shows being nice" (same meaning)
- Correct="worried" vs distractor="anxious" (near-synonyms)

Instructions:
Return exactly one number:
1 if all distractors are semantically distinct from the correct answer
0 if any distractor is too close to the correct answer

<quality_check>
<score>1</score>
<reasoning>Brief explanation identifying any too-close distractors or confirming all are distinct</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Standard Alignment

```
You are evaluating whether this question properly assesses the assigned learning standard.

Passage: {passage}

Question: {question}

Standard: {standard_code} - {standard_description}

DOK Level: {dok}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Common Standards (Examples):
RI.3.1: Ask and answer questions to demonstrate understanding, referring explicitly to text
RI.3.2: Determine the main idea; recount key details
RI.3.4: Determine meaning of words/phrases in text
RL.3.1: Ask and answer questions about key details
RL.3.3: Describe characters and explain how their actions contribute to story events

Task: Determine if this question directly assesses the assigned standard.

Instructions:
Compare what the question is testing against what the standard requires. The question must directly assess the standard's specific skill, not a tangentially related skill.

Return exactly one number:
1 if the question directly and appropriately assesses the assigned standard
0 if the question assesses a different skill or misaligns with the standard

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Clarity Precision

```
You are evaluating whether this question is clearly written and unambiguous.

Passage: {passage}

Question: {question}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Clarity Issues to Check:
Ambiguous pronouns (unclear "it", "this", "that", "they")
Double negatives
Overly complex sentence structure
Vague or imprecise language
Multiple possible interpretations
Unnecessary wordiness

Task: Determine if the question is clear and precise.

Instructions:
Evaluate whether a student would understand exactly what is being asked. The question should have one clear interpretation and be written at appropriate complexity for the grade level.

Return exactly one number:
1 if the question is clear, precise, and unambiguous
0 if the question has clarity issues that could confuse students

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Text Dependency

```
You are evaluating whether this question requires reading the passage to answer correctly.

Question: {question}

Passage: {passage}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Task: Determine if the question is truly text-dependent.

TEXT-DEPENDENT questions:
Cannot be answered without reading the specific passage
Require information that is unique to this text
Ask about passage-specific details, examples, or organization
Reference specific content that varies between texts

NOT TEXT-DEPENDENT questions:
Can be answered using general knowledge alone
Ask about universal concepts not specific to the passage
Could be answered correctly without reading the text
Test generic skills rather than passage comprehension

Examples:
TEXT-DEPENDENT: "According to the passage, what three steps are needed to plant the pineapple?"
NOT TEXT-DEPENDENT: "What does the word 'plant' mean?" (if asking for general definition)
TEXT-DEPENDENT: "What does the author compare the pineapple's size to?"
NOT TEXT-DEPENDENT: "Which of these is a type of fruit?" (general knowledge)

Instructions:
Determine whether a student must read this specific passage to answer the question correctly, or if they could answer it using general knowledge.

Return exactly one number:
1 if the question requires reading the passage to answer correctly
0 if the question could be answered without reading the passage

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Single Correct Answer

```
You are validating that this multiple choice question has exactly one defensibly correct answer.

Question: {question}

Passage: {passage}

Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}

Indicated Correct Answer: {correct_answer}

Task: Verify there is exactly one correct answer that can be defended based on the passage.

Red Flags:
Multiple answers could be argued as correct
Correct answer requires unsupported inferences
Question asks for opinions as if they were facts
Passage contradicts itself on the topic

Instructions:
Based on the passage, determine if exactly one answer is clearly correct and the others are clearly incorrect.

Return exactly one number:
1 if there is exactly one defensibly correct answer
0 if multiple answers could be correct or no answer is clearly correct

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Passage Reference

```
You are verifying that specific passage references in the question are accurate and exist.

Question: {question}

Passage: {passage}

Task: Verify that any specific references to passage elements are accurate.

Types of References to Check:
Paragraph numbers (e.g., "In paragraph 3...")
Line numbers (e.g., "Line 15 shows...")
Section titles (e.g., "The section titled 'Getting Started'...")
Specific quotes or phrases referenced
Page numbers or other structural elements

Verification Process:
1. Identify any specific structural references in the question
2. Check if those elements actually exist in the passage
3. Confirm the references are accurate and accessible

Examples of GOOD references:
"In paragraph 2..." when passage has 4 paragraphs
"The section titled 'Materials Needed'..." when that section exists
"According to the last paragraph..." when referring to final paragraph

Examples of BAD references:
"In paragraph 5..." when passage only has 3 paragraphs
"The section titled 'Conclusion'..." when no such section exists
"Line 20..." when passage only has 15 lines

Instructions:
Check if all specific passage references in the question are accurate and correspond to actual elements in the passage.

Return exactly one number:
1 if all passage references are accurate and exist; OR if the question does not contain passage references
0 if any passage reference is inaccurate or doesn't exist

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Difficulty Assessment

> **NEW** - Added December 2024

```
You are evaluating whether this question is appropriate for the target grade level.

Passage: {passage}
Question: {question}
Answer Choices:
A) {choice_A}
B) {choice_B}
C) {choice_C}
D) {choice_D}
Correct Answer: {correct_answer}
Target Grade: {grade}
DOK Level: {dok}

Task: Assess whether the question difficulty is appropriate for the target grade level.

Assessment Dimensions:

1. **Level of Inference Required**:
   - LOW: Answer is directly stated in text
   - MODERATE: Requires connecting 2-3 pieces of information
   - HIGH: Requires synthesis across multiple parts or abstract reasoning

2. **Distractor Difficulty**:
   - WEAK: Distractors are obviously wrong
   - PLAUSIBLE: Distractors could fool students with partial understanding
   - STRONG: Distractors require careful analysis to eliminate

3. **Vocabulary Complexity**:
   - Is the vocabulary appropriate for the grade level?
   - Are any terms too advanced or too simple?

4. **Cognitive Demand**:
   - Does the cognitive demand match the stated DOK level?
   - Is it appropriate for students at this grade?

Grade Level Expectations:
- Grades 3-5: Concrete concepts, explicit information, basic inferences
- Grades 6-8: Abstract concepts, implicit information, moderate inferences
- Grades 9-10: Complex analysis, synthesis, sophisticated reasoning

Instructions:
Return exactly one number:
1 if the question difficulty is appropriate for the target grade level
0 if the question is too easy or too hard for the target grade level

<quality_check>
<score>1</score>
<reasoning>Brief assessment of difficulty appropriateness with specific observations</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

## Skill Integration

```
You are evaluating whether this question set covers multiple reading competencies appropriately.

Question Set: {question_count} questions

Standards Represented: {standards_list}

Questions:
{questions_list}

Task: Determine if the question set spans multiple reading competencies.

Required Reading Competencies:
LITERAL COMPREHENSION: Directly stated information, key details, explicit facts
INFERENTIAL THINKING: Drawing conclusions, making connections, determining implied meanings
EVALUATIVE ANALYSIS: Analyzing author's purpose, evaluating evidence, making judgments

Evaluation Criteria:
Set should include questions from at least 2 of the 3 competency areas
No single competency should dominate (>70% of questions)
Questions should collectively assess a range of cognitive skills

Examples of Competency Types:
Literal: "According to the passage, where does the story take place?"
Inferential: "What can you conclude about the character's motivation?"
Evaluative: "Why did the author choose to start with this scene?"

Instructions:
Analyze the question set to determine if it appropriately spans multiple reading competencies and doesn't focus too narrowly on a single skill area.

Return exactly one number:
1 if the question set appropriately integrates multiple reading competencies
0 if the set focuses too narrowly on a single competency or lacks variety

<quality_check>
<score>1</score>
<reasoning>Brief explanation of why all choices do or do not meet the criteria</reasoning>
</quality_check>

Score: 1 if criteria are met, 0 if criteria are not met
```

---

# Question Bank Extender Prompt

This is the current prompt used by `question_bank_extender.py`:

```
You are generating additional reading comprehension questions for a Grade {grade} assessment.

## Article: {article_title}

## Passage(s):
{passages_text}

## Existing Questions (DO NOT duplicate these):

### Existing Question 1:
- Section: {section_id}
- Question: {question}
- A) {option_1}
- B) {option_2}
- C) {option_3}
- D) {option_4}
- Correct Answer: {correct_answer}
- DOK: {DOK}
- Difficulty: {difficulty}
- CCSS: {CCSS}

Feedback for each option:
- A) {option_1_explanation[:200]}...
- B) {option_2_explanation[:200]}...
- C) {option_3_explanation[:200]}...
- D) {option_4_explanation[:200]}...

[... more existing questions ...]

## Task:
Generate {num_siblings} NEW sibling question(s) for EACH existing question above.
- Total questions to generate: {total_questions}
- Each sibling must have the SAME DOK, difficulty, and CCSS as its original
- Each sibling must test the SAME passage/section as its original
- Questions must be DIFFERENT from the existing ones (different focus, angle, or details)
- Avoid duplicating any existing question's content

## Requirements for each generated question:

### Question Quality:
1. Text-dependent: Must require reading the passage to answer
2. Clear and precise: Unambiguous with one correct answer
3. Grade-appropriate: Vocabulary and concepts suitable for Grade {grade}
4. Grammatical parallelism: All choices follow same grammatical structure
5. Length balance: Choices should have similar length (correct answer should NOT be longest)

### Answer Choices:
- 4 choices (A, B, C, D)
- One clearly correct answer
- Three plausible but incorrect distractors
- All choices from same conceptual category

### Feedback/Explanations (REQUIRED for each choice):
For CORRECT answers, include:
- Why it's correct with text evidence
- Reading strategy reminder

For INCORRECT answers, include:
- Why a student might have chosen it
- Why it's wrong
- What the correct answer is
- Strategy tip for next time

## Output Format:
Generate exactly {total_questions} questions in the sibling_questions array.

Each question must follow this exact JSON structure:
```json
{
  "sibling_questions": [
    {
      "question": "The full question text here",
      "option_1": "First answer choice (A)",
      "option_2": "Second answer choice (B)",
      "option_3": "Third answer choice (C)",
      "option_4": "Fourth answer choice (D)",
      "correct_answer": "A",
      "option_1_explanation": "Detailed feedback for option A explaining why it is correct/incorrect",
      "option_2_explanation": "Detailed feedback for option B explaining why it is correct/incorrect",
      "option_3_explanation": "Detailed feedback for option C explaining why it is correct/incorrect",
      "option_4_explanation": "Detailed feedback for option D explaining why it is correct/incorrect"
    }
  ]
}
```

Generate siblings in order: first all siblings for Question 1, then all siblings for Question 2, etc.
```

---

# Comparison Summary

## Key Differences

| Feature | Bulk Generator / Question Generator | Question Bank Extender |
|---------|-------------------------------------|----------------------|
| **Purpose** | Generate NEW questions from scratch | Generate SIBLINGS of existing questions |
| **Grade Level** | ✅ Dynamic `{grade_level}` from standard | ✅ Uses `{grade}` parameter |
| **Example Source** | Separate `examples.csv` file | Uses existing questions as examples |
| **DOK Instructions** | ✅ Specific per DOK level (1/2/3 have different requirements) | ❌ Generic "same DOK as original" |
| **Template Analysis** | ✅ 4 detailed steps | ❌ Missing |
| **Adaptation Process** | ✅ 6 steps | ❌ Missing |
| **Standard Description** | ✅ Full description from `ccss.csv` | ❌ Just code |
| **Questions per call** | 1 | Multiple (5-20+) |
| **Output includes** | `template_adaptation`, `rationale`, `quality_verification` | Just question + explanations |
| **Feedback required** | ❌ Not in output | ✅ Required for all options |
| **Homogeneity Check** | ✅ In generation prompt + QC | ⚠️ Brief mention only |
| **Specificity Balance** | ✅ In generation prompt + QC | ❌ Not mentioned |
| **Semantic Distance** | ✅ In generation prompt + QC | ❌ Not mentioned |
| **Quality Verification** | ✅ Self-check in output | ❌ Not present |

## QC Prompts Summary

| QC Check | Status | Level |
|----------|--------|-------|
| `grammatical_parallel` | ✅ Available | Distractors |
| `plausibility` | ✅ Available | Distractors |
| `homogeneity` | ✅ Available | Distractors |
| `specificity_balance` | ✅ Available | Distractors |
| `too_close` | ✅ **NEW** | Distractors |
| `standard_alignment` | ✅ Available | Question |
| `clarity_precision` | ✅ Available | Question |
| `text_dependency` | ✅ Available | Question |
| `single_correct_answer` | ✅ Available | Question |
| `passage_reference` | ✅ Available | Question |
| `difficulty_assessment` | ✅ **NEW** | Question |
| `skill_integration` | ✅ Available | Question Set |

## Recommendations for Question Bank Extender

1. **Add DOK-specific instructions** - Different requirements for DOK 1, 2, 3
2. **Add Template Analysis section** - Guide Claude on how to analyze the existing question
3. **Add Adaptation Process section** - Step-by-step for creating siblings
4. **Consider single question per call** - More reliable than batching many questions
5. **Add CCSS standard descriptions** - Load from ccss.csv like bulk generator
6. **Add Homogeneity requirement** - Explicit instructions like MCQ prompts
7. **Add Specificity Balance requirement** - Match the MCQ prompt quality
8. **Add Semantic Distance requirement** - Prevent too-close distractors
9. **Add Quality Verification output** - Self-check mechanism

---

# Variable Reference

## Generation Prompt Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `{grade_level}` | Dynamic grade level string (e.g., "grade 3", "grades 9-10") | Extracted from `{standard_code}` |
| `{text_content}` | The passage text | Input CSV |
| `{standard_code}` | CCSS standard code (e.g., "RL.3.1") | Input CSV |
| `{standard_description}` | Full text description of the standard | `ck_gen - ccss.csv` |
| `{existing_questions}` | List of already-generated questions for the passage | Updated during generation |
| `{example_question}` | Example question text | `ck_gen - examples.csv` |
| `{example_choice_a/b/c/d}` | Example answer choices | `ck_gen - examples.csv` |
| `{example_correct}` | Correct answer for example | `ck_gen - examples.csv` |

## QC Prompt Variables

| Variable | Description |
|----------|-------------|
| `{passage}` | The passage text |
| `{question}` | The question being evaluated |
| `{choice_A/B/C/D}` | Answer choices |
| `{correct_answer}` | The indicated correct answer |
| `{standard_code}` | CCSS standard code |
| `{standard_description}` | Full standard description |
| `{dok}` | DOK level (1, 2, 3, or 4) |
| `{grade}` | Target grade level |

---

*Document generated from `ck_gen - prompts.json` - Last updated December 10, 2024*
