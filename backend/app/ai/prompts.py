"""Prompt templates for the PagePay AI router.

All prompts are stored as constants here so they can be versioned,
audited, and tweaked without touching the router logic. Temperature
and max-token defaults are set per task type: factual/structured tasks
run cooler (0.3) for deterministic JSON, while chat runs warmer (0.7)
for natural conversation.
"""

SOW_PARSER = """You are an academic curriculum parser. Your job is to read a scheme of work or syllabus and return a structured outline.

Input raw text:
{raw_text}

Output strict JSON only. No markdown. No backticks. No extra text before or after.
{{
  "title": "short descriptive title",
  "topics": [
    {{
      "name": "Topic name",
      "subtopics": ["Sub A", "Sub B"],
      "key_concepts": ["concept1", "concept2"]
    }}
  ]
}}

Rules:
- 3-8 topics max
- 2-5 subtopics per topic
- 1-4 key concepts per subtopic
- Keep labels short and student-friendly
- If the input is very short, return fewer topics"""

MCQ_GENERATOR = """Generate {count} multiple-choice questions from the following study context.

Context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Why this answer is correct"
    }}
  ]
}}

Rules:
- Exactly {count} questions
- Each question has exactly 4 options
- correct_index is 0-3 matching the correct option
- Explanations are 1-2 sentences, student-friendly
- Questions should test understanding, not just memorization
- Difficulty: medium"""

MCQ_TOPIC_GENERATOR = """Generate {count} multiple-choice questions focused on the following specific topic.

Topic: {topic}

Topic context (only use information from this topic):
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Why this answer is correct"
    }}
  ]
}}

Rules:
- Exactly {count} questions
- Each question has exactly 4 options
- correct_index is 0-3 matching the correct option
- Explanations are 1-2 sentences, student-friendly
- Questions should test understanding of the specific topic, not general knowledge
- Difficulty: medium"""

MCQ_ALL_TOPICS_GENERATOR = """Generate {count} multiple-choice questions distributed across the following topics.

Topics and context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Why this answer is correct",
      "topic": "The topic this question belongs to"
    }}
  ]
}}

Rules:
- Exactly {count} questions total
- Each question has exactly 4 options
- correct_index is 0-3 matching the correct option
- Explanations are 1-2 sentences, student-friendly
- Questions should test understanding, not just memorization
- Difficulty: medium
- Distribute questions evenly across all topics
- Include a "topic" field in each question indicating which topic it covers"""

FLASHCARD_GENERATOR = """Generate {count} flashcards from the following study context.

Context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "cards": [
    {{
      "front": "Term or question",
      "back": "Definition or answer"
    }}
  ]
}}

Rules:
- Exactly {count} cards
- Front side: term, concept name, or question (max 120 chars)
- Back side: clear definition or answer (max 300 chars)
- Cards should cover the most important concepts in the context"""

FLASHCARD_TOPIC_GENERATOR = """Generate {count} flashcards focused on the following specific topic.

Topic: {topic}

Topic context (only use information from this topic):
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "cards": [
    {{
      "front": "Term or question",
      "back": "Definition or answer"
    }}
  ]
}}

Rules:
- Exactly {count} cards
- Front side: term, concept name, or question (max 120 chars)
- Back side: clear definition or answer (max 300 chars)
- Cards should cover the most important concepts in the specific topic"""

FLASHCARD_ALL_TOPICS_GENERATOR = """Generate {count} flashcards distributed across the following topics.

Topics and context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "cards": [
    {{
      "front": "Term or question",
      "back": "Definition or answer",
      "topic": "The topic this card belongs to"
    }}
  ]
}}

Rules:
- Exactly {count} cards total
- Front side: term, concept name, or question (max 120 chars)
- Back side: clear definition or answer (max 300 chars)
- Distribute cards evenly across all topics
- Include a "topic" field in each card indicating which topic it covers"""

ESSAY_GENERATOR = """Generate {count} essay questions from the following study context.

Context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "id": 1,
      "prompt": "Essay question text here",
      "outline": ["Point 1", "Point 2", "Point 3"]
    }}
  ]
}}

Rules:
- Exactly {count} questions
- Each question should require a 200-400 word answer
- Provide a 3-5 point outline for each question
- Questions should test analysis and application, not just recall"""

ESSAY_TOPIC_GENERATOR = """Generate {count} essay questions focused on the following specific topic.

Topic: {topic}

Topic context (only use information from this topic):
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "id": 1,
      "prompt": "Essay question text here",
      "outline": ["Point 1", "Point 2", "Point 3"]
    }}
  ]
}}

Rules:
- Exactly {count} questions
- Each question should require a 200-400 word answer
- Provide a 3-5 point outline for each question
- Questions should test analysis and application of the specific topic"""

ESSAY_ALL_TOPICS_GENERATOR = """Generate {count} essay questions distributed across the following topics.

Topics and context:
{context}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "questions": [
    {{
      "id": 1,
      "prompt": "Essay question text here",
      "outline": ["Point 1", "Point 2", "Point 3"],
      "topic": "The topic this question belongs to"
    }}
  ]
}}

Rules:
- Exactly {count} questions total
- Each question should require a 200-400 word answer
- Provide a 3-5 point outline for each question
- Distribute questions evenly across all topics
- Include a "topic" field in each question indicating which topic it covers"""

CHAT_TUTOR_SYSTEM = """You are a friendly, encouraging study tutor for a student preparing for exams. Your job is to help them understand their study material.

Education Level: {education_level}
Difficulty: {difficulty}

Guidelines:
- Be concise but thorough
- Use simple language — assume the student is learning this for the first time
- Give examples when helpful
- If the student asks something unrelated to their study material, gently steer them back
- Never say "I don't have that information" — instead say "Let's focus on what we have in your material"
- Encourage the student when they get something right
- Correct mistakes gently and explain why
- Adjust your explanation depth based on the education level:
  - primary: Simple language, analogies to everyday life, short sentences, emoji visuals, "Imagine you have 5 apples..."
  - secondary: Detailed explanations with examples, step-by-step walkthroughs, real-world applications
  - tertiary: Academic depth, citations, theoretical frameworks, critical analysis prompts
  - research: Literature review guidance, methodology suggestions, paper structure templates

The student's study material context is below. Use it to answer questions accurately.
If a question goes beyond the material, say so honestly but still try to help.

Study material context:
{context}"""

DIAGRAM_GENERATOR = """Create a detailed diagram description for the following topic.

Topic: {topic}
Context: {context}
Education Level: {education_level}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "title": "Diagram title",
  "description": "Detailed description of what the diagram shows",
  "elements": [
    {{
      "id": "A",
      "label": "Element label",
      "description": "What this element represents",
      "position": "top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right"
    }}
  ],
  "connections": [
    {{
      "from": "A",
      "to": "B",
      "label": "What the connection represents"
    }}
  ],
  "svg_hint": "Brief description of how this could be rendered as an SVG"
}}

Rules:
- Create a clear, educational diagram
- Use at most 6 elements
- Include connections between elements
- Make it appropriate for the education level
- The description should be detailed enough for a frontend renderer to recreate it"""

VIDEO_SCRIPT_GENERATOR = """Create a 30-second video script for the following topic.

Topic: {topic}
Context: {context}
Education Level: {education_level}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "title": "Video title",
  "duration_seconds": 30,
  "scenes": [
    {{
      "time": "0:00-0:05",
      "visual": "Description of what's shown on screen",
      "narration": "What the narrator says",
      "text_overlay": "Text to display on screen"
    }}
  ],
  "summary": "One-line summary of what the video teaches"
}}

Rules:
- Exactly 30 seconds total
- Create 3-5 scenes of 5-10 seconds each
- Make it engaging and educational
- Use simple language appropriate for the education level
- Include visual descriptions that could be animated
- The narration should be clear and easy to follow
- End with a key takeaway"""

EXAMPLE_GENERATOR = """Generate a worked example for the following topic.

Topic: {topic}
Context: {context}
Education Level: {education_level}
Subject hints: {subject_hints}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "title": "Example title",
  "problem": "The problem statement",
  "steps": [
    {{
      "step": 1,
      "instruction": "What to do in this step",
      "hint": "A helpful hint for this step",
      "answer": "The expected result after completing this step",
      "explanation": "Why this step works"
    }}
  ],
  "final_answer": "The final answer to the problem",
  "try_yourself": {{
    "problem": "A similar problem for the student to try",
    "hints": ["Hint 1", "Hint 2", "Hint 3"],
    "solution_steps": ["Step 1 description", "Step 2 description", "Step 3 description"],
    "final_answer": "The correct final answer"
  }}
}}

Rules:
- Create a realistic, practical problem
- Break it into 3-5 clear steps
- Each step should build on the previous one
- The "try_yourself" problem should be similar but with different values
- Include progressive hints for the try-yourself problem
- Adapt complexity to the education level:
  - primary: Simple arithmetic, word problems with everyday contexts
  - secondary: Algebra, geometry, basic physics/chemistry calculations
  - tertiary: Calculus, statistics, complex equations, code algorithms
  - research: Advanced mathematics, proof derivation, complex algorithm design
- For code subjects: include actual code snippets with syntax
- For math/physics: use LaTeX notation for formulas where helpful
- Keep explanations clear and educational"""
