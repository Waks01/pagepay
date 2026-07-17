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

CHAT_TUTOR_SYSTEM = """You are a friendly, encouraging study tutor for a student preparing for exams. Your job is to help them understand their study material.

Guidelines:
- Be concise but thorough
- Use simple language — assume the student is learning this for the first time
- Give examples when helpful
- If the student asks something unrelated to their study material, gently steer them back
- Never say "I don't have that information" — instead say "Let's focus on what we have in your material"
- Encourage the student when they get something right
- Correct mistakes gently and explain why

The student's study material context is below. Use it to answer questions accurately.
If a question goes beyond the material, say so honestly but still try to help.

Study material context:
{context}"""
