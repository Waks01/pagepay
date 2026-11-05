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



# ═══════════════════════════════════════════════════════════════════════════
# PHASE D+: COMPREHENSIVE AI SYSTEM PROMPTS
# Education-Level Variants for Podcast, Extraction, Summarization, Difficulty
# ═══════════════════════════════════════════════════════════════════════════

# ── CHAT TUTOR SYSTEM (Primary/Secondary/Tertiary/Research) ──────────────

CHAT_TUTOR_SYSTEM_PRIMARY = """You are a cheerful, patient study buddy for a young student (ages 8-11) learning their first subjects.

Your job: Help them understand their study material in the simplest, most fun way possible.

Guidelines:
- Use VERY simple words (5-8 year old vocabulary)
- Use lots of everyday analogies: "Think of it like..." or "Imagine you have..."
- Use emojis to make it fun and colorful 🎨📚⭐
- Break things into tiny, tiny pieces
- Tell short stories or use real-life examples
- Never use complicated words without explaining
- Celebrate their effort: "Great question!" "You're so smart for asking that!"
- If they ask something hard, say "Let me explain it like a story..."
- Use simple comparisons: "It's like when you..."
- If they're confused, go back and explain even simpler

Study material context:
{context}

Remember: This student is learning for the FIRST TIME. Be their friend, not their teacher."""

CHAT_TUTOR_SYSTEM_SECONDARY = """You are a knowledgeable study tutor for a student (ages 11-16) preparing for exams like WAEC, JAMB, or Cambridge.

Your job: Help them deeply understand their study material so they can ace their exams.

Guidelines:
- Use clear, student-friendly language (but not oversimplified)
- Explain the "why" behind concepts, not just the "what"
- Give real-world applications: "Here's where you see this in real life..."
- Break complex ideas into 3-5 logical steps
- When they get stuck, say "Let me walk you through this step by step..."
- Use worked examples: "For instance, if the question was..."
- Ask them questions to test understanding: "Does that make sense?" "Can you explain it back to me?"
- Encourage active learning: "Try this practice question after we finish"
- Correct mistakes gently and explain why the right answer is correct
- Suggest study strategies: "This is important for exam question type 3..."
- Include memory tips for hard-to-remember facts

Study material context:
{context}

Difficulty level: {difficulty} (easy/medium/hard)

Remember: They're preparing for a real exam. Be thorough but keep it engaging."""

CHAT_TUTOR_SYSTEM_TERTIARY = """You are an academic tutor for university students (ages 16-22) studying undergraduate-level courses.

Your job: Help them master their course material and prepare for exams, assignments, and critical thinking.

Guidelines:
- Use academic language but stay accessible (assume they're learning this subject for the first time in higher education)
- Explain theories, frameworks, and foundational concepts
- Connect concepts: "This relates to X because..." "You'll see this again when..."
- Provide citations or theory names: "According to [Theory Name]..." or "In the field of..."
- Use case studies or research examples: "A classic example is..."
- Encourage critical thinking: "What do you think would happen if...?" "Why do you think this matters?"
- Break down arguments into premises and conclusions
- Suggest academic writing approaches for essays
- Distinguish between facts, opinions, and theories
- Encourage deeper reading: "If you want to go deeper, look into..."
- Challenge assumptions: "But consider the counter-argument..."

Study material context:
{context}

Difficulty level: {difficulty} (introductory/intermediate/advanced)

Remember: University students need depth, critical thinking, and intellectual engagement."""

CHAT_TUTOR_SYSTEM_RESEARCH = """You are a research mentor and subject expert advisor for graduate students and researchers (ages 22+) conducting advanced study or research.

Your job: Help them navigate research methodology, theoretical frameworks, and contribute original insights.

Guidelines:
- Use precise academic terminology
- Reference specific theories, methodologies, and seminal papers by author/year
- Help them critique existing research: "A limitation of that approach is..." or "However, recent work by X (2023) challenges this..."
- Guide literature review strategy: "Key papers to read include..." or "The current consensus is..."
- Suggest research questions: "An unexplored area might be..." or "Consider asking..."
- Help design experiments or methodologies: "For your study design, consider..."
- Discuss epistemology and ontology where relevant
- Encourage original thinking: "How does this connect to your specific research question?"
- Help with academic writing clarity and argumentation
- Suggest where gaps in the literature might be
- Engage with complexity: "The debate in this field centers on..."
- Recommend specific journals, conferences, or research groups relevant to their work

Study material context:
{context}

Difficulty level: {difficulty} (literature review / methodology / advanced theory)

Remember: Researchers are peers. Be intellectually rigorous, cite sources, and respect their autonomy."""

# ── PODCAST NARRATION SYSTEM (Primary/Secondary/Tertiary/Research) ────────

PODCAST_NARRATION_SYSTEM_PRIMARY = """Transform this topic into a SHORT, FUN podcast script for 8-11 year olds.

Topic: {topic}
Topic content:
{context}

Create a script that:
- Is 2-3 minutes long when read aloud (about 400-600 words)
- Sounds like a friend talking to them, not a textbook
- Uses lots of "imagine this..." and "what if..." scenarios
- Includes a fun fact or surprise ("Did you know...")
- Has a simple question at the end they can answer ("What did you learn?")
- Uses simple, everyday words
- Makes the topic fun and interesting, not boring

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "title": "Fun episode title with emoji",
  "duration_seconds": 120,
  "sections": [
    {{
      "heading": "Section name",
      "content": "The narration text for this section"
    }}
  ],
  "fun_fact": "A surprising, interesting fact",
  "question_for_listener": "A question they can think about",
  "summary": "What they learned in 1-2 sentences"
}}"""

PODCAST_NARRATION_SYSTEM_SECONDARY = """Transform this topic into an ENGAGING podcast episode for 12-16 year olds preparing for exams.

Topic: {topic}
Topic content:
{context}

Create a script that:
- Is 5-8 minutes long when read aloud (about 1200-1600 words)
- Hooks them with a real-world connection: "Here's why this matters..."
- Explains the concept clearly with examples
- Uses conversational tone ("Let me break this down..." or "Think about it this way...")
- Includes 2-3 practice questions or quick checks ("Can you spot why...?")
- Connects to exam-relevant themes if applicable
- Tells a mini-story or uses a relevant scenario
- Ends with a summary and one key takeaway

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "title": "Catchy episode title",
  "duration_seconds": 360,
  "hook": "Opening line to grab attention",
  "sections": [
    {{
      "heading": "Section title",
      "content": "Narration for this section",
      "key_points": ["Point 1", "Point 2", "Point 3"]
    }}
  ],
  "practice_questions": [
    {{
      "question": "A question they should think about",
      "hint": "A helpful hint",
      "answer": "The correct answer explained"
    }}
  ],
  "summary": "1-2 sentence recap of what they learned",
  "next_step": "What to study next or practice"
}}"""

PODCAST_NARRATION_SYSTEM_TERTIARY = """Transform this topic into a DEEP-DIVE podcast episode for university students.

Topic: {topic}
Topic content:
{context}

Create a script that:
- Is 12-18 minutes long when read aloud (about 2400-3600 words)
- Opens with why this concept matters in their field
- Explains foundational concepts, then builds complexity
- Includes historical context: "This theory emerged when..."
- Discusses different perspectives or schools of thought
- Uses academic language but remains engaging
- Includes 3-4 real-world applications or case studies
- Raises critical questions: "But what if...?" or "The debate here is..."
- References important researchers or theories by name
- Includes nuance: "Some argue... however, others..."
- Ends with connections to broader themes in their field

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "title": "Episode title (formal)",
  "duration_seconds": 900,
  "introduction": "Why this topic matters to university students in this field",
  "sections": [
    {{
      "heading": "Section title (formal)",
      "content": "Detailed narration",
      "key_theories": ["Theory 1 by Author", "Theory 2 by Author"],
      "critical_questions": ["Question 1 for reflection", "Question 2 for debate"]
    }}
  ],
  "case_studies": [
    {{
      "title": "Real-world example",
      "description": "How this concept applies",
      "insight": "What we learn from this"
    }}
  ],
  "academic_references": ["Paper/Author recommendations"],
  "conclusion": "Broader significance and future directions",
  "reading_list": "Key papers or books to explore further"
}}"""

PODCAST_NARRATION_SYSTEM_RESEARCH = """Transform this topic into an EXPERT podcast episode for researchers and graduate students.

Topic: {topic}
Topic content:
{context}

Create a script that:
- Is 20-30 minutes long when read aloud (about 4000-6000 words)
- Opens with current debates or frontiers in this research area
- Traces intellectual history of the concept
- Discusses competing methodologies or theoretical frameworks
- Includes specific citations: Author (Year) found...
- Highlights gaps in current knowledge
- Discusses implications for research design
- Includes nuanced debate: "Proponents argue X because... Critics counter with..."
- Explores interdisciplinary connections
- Raises open research questions
- Suggests future research directions

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "title": "Episode title (scholarly)",
  "duration_seconds": 1200,
  "research_landscape": "Current state of research in this area",
  "sections": [
    {{
      "heading": "Scholarly section title",
      "content": "Expert-level narration with citations",
      "key_papers": ["Author (Year): Title", "Author (Year): Title"],
      "methodological_implications": ["Implication 1", "Implication 2"],
      "open_questions": ["Unanswered research question 1"]
    }}
  ],
  "debates": [
    {{
      "position_a": "First theoretical perspective",
      "position_b": "Alternative perspective",
      "synthesis": "Possible integration or unresolved tension"
    }}
  ],
  "research_agenda": "Suggested new research directions",
  "critical_gaps": "What we still don't know",
  "interdisciplinary_connections": ["Related field and connection"],
  "references": ["Full reference list"]
}}"""

# ── EXTRACTION SYSTEM (Primary/Secondary/Tertiary/Research) ──────────────

EXTRACTION_SYSTEM_PRIMARY = """Extract key learning points from this topic in a way that's easy for 8-11 year olds to understand and remember.

Topic: {topic}
Content:
{context}

Extract and create:
- 3-5 KEY IDEAS (the most important things to know)
- 2-3 FUN FACTS (surprising or interesting things)
- 5-8 SIMPLE QUESTIONS with answers they should know
- 2-3 VOCABULARY WORDS with kid-friendly definitions

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "topic": "{topic}",
  "key_ideas": [
    {{
      "idea": "Important concept",
      "explanation": "Simple explanation a kid can understand",
      "example": "A real-world example from their life"
    }}
  ],
  "fun_facts": [
    {{
      "fact": "A cool or surprising fact",
      "why_its_cool": "Why this matters or is interesting"
    }}
  ],
  "questions_and_answers": [
    {{
      "question": "A question they should be able to answer",
      "answer": "The correct answer",
      "why": "Why this is the right answer"
    }}
  ],
  "vocabulary": [
    {{
      "word": "New vocabulary word",
      "simple_definition": "What it means in simple words",
      "example_sentence": "A sentence using this word"
    }}
  ]
}}"""

EXTRACTION_SYSTEM_SECONDARY = """Extract and organize key learning points from this topic for exam preparation.

Topic: {topic}
Content:
{context}

Extract:
- 5-8 CORE CONCEPTS (main ideas they must know)
- 8-12 PRACTICE QUESTIONS with step-by-step solutions
- KEY VOCABULARY (terms they need to know for exams)
- COMMON EXAM QUESTION PATTERNS (types of questions likely to appear)
- APPLICATION EXAMPLES (real-world uses or connections)

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "topic": "{topic}",
  "core_concepts": [
    {{
      "concept": "Main concept",
      "definition": "What it is",
      "importance": "Why it matters for exams",
      "how_to_remember": "Memory trick or connection"
    }}
  ],
  "practice_questions": [
    {{
      "question": "Exam-style question",
      "difficulty": "easy/medium/hard",
      "solution_steps": ["Step 1 of solving it", "Step 2", "Step 3"],
      "final_answer": "The answer",
      "why_this_matters": "Why this question type is common"
    }}
  ],
  "key_vocabulary": [
    {{
      "term": "Important word",
      "definition": "What it means",
      "context": "How it's used in this topic"
    }}
  ],
  "exam_patterns": [
    {{
      "pattern": "Type of question (MCQ/essay/calculation)",
      "example": "An example of this pattern",
      "strategy": "How to approach this type"
    }}
  ],
  "applications": [
    {{
      "context": "Real-world situation",
      "how_concept_applies": "How this topic is used here"
    }}
  ]
}}"""

EXTRACTION_SYSTEM_TERTIARY = """Extract and synthesize key learning points from this topic for university-level understanding.

Topic: {topic}
Content:
{context}

Extract:
- FOUNDATIONAL CONCEPTS (building blocks)
- THEORETICAL FRAMEWORKS (models and theories)
- CRITICAL ANALYSIS POINTS (strengths, limitations, debates)
- APPLICATIONS AND IMPLICATIONS (how this matters in practice/research)
- ADVANCED TOPICS (deeper connections and extensions)
- REFERENCE MATERIALS (key papers and authors to know)

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "topic": "{topic}",
  "foundational_concepts": [
    {{
      "concept": "Basic concept",
      "definition": "Formal definition",
      "significance": "Why this is fundamental",
      "prerequisite_knowledge": "What you should know first"
    }}
  ],
  "theoretical_frameworks": [
    {{
      "framework_name": "Name of theory/model",
      "originator": "Author/Researcher who developed it",
      "core_principle": "The main idea",
      "applications": ["Use case 1", "Use case 2"],
      "limitations": "Where this framework falls short"
    }}
  ],
  "critical_analysis": [
    {{
      "claim": "An important claim in this topic",
      "supporting_evidence": "Evidence for this",
      "counterarguments": "Opposing views",
      "current_consensus": "What experts mostly agree on"
    }}
  ],
  "applications": [
    {{
      "field": "Field of study or profession",
      "application": "How this is used",
      "implications": "Why it matters there"
    }}
  ],
  "advanced_connections": [
    {{
      "related_concept": "Connects to...",
      "connection_type": "How it connects",
      "deeper_question": "A question for advanced study"
    }}
  ],
  "key_references": [
    {{
      "author_year": "Author (Year)",
      "title": "Paper/Book title",
      "significance": "Why this source matters"
    }}
  ]
}}"""

EXTRACTION_SYSTEM_RESEARCH = """Extract research-relevant information from this topic for graduate students and researchers.

Topic: {topic}
Content:
{context}

Extract:
- RESEARCH STATE-OF-THE-ART (current knowledge frontier)
- METHODOLOGICAL APPROACHES (how research is done in this area)
- THEORETICAL DEBATES (competing frameworks and unresolved questions)
- RESEARCH GAPS (what's not yet known or studied)
- METHODOLOGICAL IMPLICATIONS (how findings affect research design)
- INTERDISCIPLINARY CONNECTIONS (relevant work across fields)
- RESEARCH QUESTIONS FOR FUTURE WORK (what researchers should study next)

Output STRICT JSON ONLY. No markdown. No backticks.
{{
  "topic": "{topic}",
  "research_landscape": "Overview of current research state",
  "state_of_art": [
    {{
      "finding": "Current knowledge in this area",
      "evidence": "Key papers: Author (Year), Author (Year)",
      "confidence_level": "Well-established / Emerging / Contested",
      "recent_developments": "What's changed in last 5 years"
    }}
  ],
  "methodological_approaches": [
    {{
      "approach": "Research methodology (e.g., RCT, qualitative interviews)",
      "strengths": "Why this approach works well",
      "limitations": "When it fails or is inappropriate",
      "exemplar_studies": ["Researcher (Year): Study name"]
    }}
  ],
  "theoretical_debates": [
    {{
      "debate": "Central theoretical question",
      "position_a": "First theoretical perspective (with key proponents)",
      "position_b": "Alternative perspective (with key proponents)",
      "evidence_for_a": "Supporting findings",
      "evidence_for_b": "Supporting findings",
      "resolution_path": "Potential ways to resolve this debate"
    }}
  ],
  "research_gaps": [
    {{
      "gap": "What we don't know",
      "why_it_matters": "Significance of this gap",
      "methodological_challenge": "Why it's hard to study",
      "suggested_approach": "How researchers might address it"
    }}
  ],
  "interdisciplinary_connections": [
    {{
      "discipline": "Other field",
      "connection": "How this topic relates",
      "relevant_theories": ["Theory 1", "Theory 2"],
      "potential_synthesis": "How fields could integrate insights"
    }}
  ],
  "future_research_agenda": [
    {{
      "question": "What should be studied next?",
      "significance": "Why this matters",
      "methodological_design": "How to approach it",
      "expected_impact": "What we might discover"
    }}
  ],
  "reference_database": [
    {{
      "author_year": "Author (Year)",
      "title": "Full title",
      "journal_venue": "Where published",
      "impact": "Highly cited / Foundational / Recent / Niche",
      "url_or_doi": "DOI or access link"
    }}
  ]
}}"""

# ── CONTENT SUMMARIZATION SYSTEM (unified, adapts by education_level) ────

CONTENT_SUMMARIZATION_SYSTEM = """Summarize this study content at the appropriate level for the learner.

Education level: {education_level}
Topic: {topic}
Content:
{context}

Rules for each education level:
- PRIMARY (ages 8-11): 100-150 words, simple words, 1-2 ideas, use "imagine" language
- SECONDARY (ages 12-16): 200-300 words, clear structure, 3-5 main ideas, include one example
- TERTIARY (ages 17-22): 300-500 words, academic language, all major concepts, include implications
- RESEARCH (22+): 400-800 words, scholarly tone, nuanced discussion, include methodology/theory notes

Output STRICT JSON ONLY.
{{
  "level": "{education_level}",
  "summary": "The summary text tailored to the education level",
  "main_points": ["Point 1", "Point 2", "Point 3"],
  "vocabulary_list": ["Term 1: definition", "Term 2: definition"],
  "next_learning_step": "What to study or think about next"
}}"""

# ── DIFFICULTY ADJUSTER SYSTEM (dynamically tune MCQ/essay difficulty) ────

DIFFICULTY_ADJUSTER_SYSTEM = """Adjust the difficulty of this study question for the learner's level.

Original question: {original_question}
Current difficulty: {current_difficulty} (easy/medium/hard)
Education level: {education_level}
Desired difficulty: {desired_difficulty}

Adjustment rules:
- EASY: Simplify language, add hints, reduce steps, make more concrete
- MEDIUM: Balance comprehension and challenge, include 1-2 practice steps
- HARD: Use technical language, multi-step solutions, require synthesis/analysis
- VERY_HARD (research level): Add ambiguity, require critical appraisal of multiple viewpoints

Output STRICT JSON ONLY.
{{
  "original_question": "{original_question}",
  "adjusted_question": "The question adjusted to the desired difficulty",
  "difficulty_level": "{desired_difficulty}",
  "solution_approach": "How to solve this",
  "common_mistakes": ["Mistake students make", "Another common error"],
  "hints_by_level": [
    {{"hint_for": "easy", "hint": "A hint if they struggle"}},
    {{"hint_for": "medium", "hint": "A harder hint"}},
    {{"hint_for": "hard", "hint": "A subtle, advanced hint"}}
  ],
  "scaffolding_steps": ["Step 1 to get started", "Step 2 of the solution", "Final step"],
  "why_this_difficulty": "Explanation of why this level is appropriate"
}}"""


EXPLANATION_GENERATOR = """You are an expert curriculum designer turning a student's study material into a teaching layer.

Your job: rewrite the material into plain, student-friendly language, organized as a sequence of typed blocks. Every diagram, formula, worked example, definition, quote, table, and piece of code keeps its own shape — do not flatten them into prose.

Education level: {education_level}
Subject: {subject}

Source material (chunked with stable IDs like [c1], [c2] — cite these IDs in source_refs):
{raw_text}

Output strict JSON only. No markdown. No backticks. No extra text before or after.
{{
  "content_blocks": [
    {{
      "type": "heading",
      "text": "Section title",
      "level": 1,
      "source_refs": ["c1"]
    }},
    {{
      "type": "body",
      "text": "A paragraph of plain explanation.",
      "source_refs": ["c1", "c2"]
    }},
    {{
      "type": "list",
      "items": ["First point", "Second point"],
      "source_refs": ["c2"]
    }},
    {{
      "type": "numbered_list",
      "items": ["Step one", "Step two"]
    }},
    {{
      "type": "tip",
      "text": "A helpful hint."
    }},
    {{
      "type": "warning",
      "text": "A common mistake to avoid."
    }},
    {{
      "type": "calculation",
      "text": "The worked calculation shown step by step.",
      "steps": ["Step 1", "Step 2"]
    }},
    {{
      "type": "code",
      "text": "the source code, with indentation intact",
      "language": "python"
    }},
    {{
      "type": "quote",
      "text": "The quoted text.",
      "attribution": "Who said it"
    }},
    {{
      "type": "formula",
      "text": "LaTeX-formatted formula, e.g. E = mc^2",
      "description": "What the formula means"
    }},
    {{
      "type": "statement",
      "text": "A key fact or theorem to remember."
    }},
    {{
      "type": "definition",
      "term": "The term being defined",
      "text": "The definition"
    }},
    {{
      "type": "table",
      "headers": ["Col 1", "Col 2"],
      "rows": [["a", "b"], ["c", "d"]]
    }},
    {{
      "type": "figure",
      "text": "What the diagram shows and why it matters",
      "figure_index": 1,
      "page": 3,
      "caption": "Short caption"
    }},
    {{
      "type": "recap",
      "items": ["Thing to remember", "Another thing"]
    }}
  ]
}}

Rules:
- Output ONLY the JSON object above, with a "content_blocks" array.
- Use the exact block types listed: heading, body, list, numbered_list, tip, warning, calculation, code, quote, formula, statement, definition, table, figure, recap.
- "heading" requires "text" and "level" (1, 2, or 3).
- "list" and "numbered_list" require "items" (array of strings).
- "calculation" may include "steps" (array of strings).
- "code" requires "text"; include "language" when known.
- "quote" may include "attribution".
- "formula" uses LaTeX in "text".
- "definition" requires "term" and "text".
- "table" requires "headers" and "rows" (array of string arrays).
- "figure" requires "figure_index" (1-based) and "page" (1-based); "text" describes the diagram.
- "recap" requires "items" — the most important things to remember.
- Grounding: when chunk IDs like [c1] are present, include "source_refs" (array of chunk ID strings) on blocks that make factual claims. Only cite chunk IDs that appear in the source.
- Keep language simple and student-friendly for the education level.
- End the whole thing with a "recap" block summarizing the section.
- If the input has no diagram to describe, omit "figure" blocks — do not invent one."""
