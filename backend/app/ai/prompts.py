"""Prompt templates for the PagePay AI router.

All prompts are stored as constants here so they can be versioned,
audited, and tweaked without touching the router logic. Temperature
and max-token defaults are set per task type: factual/structured tasks
run cooler (0.3) for deterministic JSON, while chat runs warmer (0.7)
for natural conversation.
"""

VISION_OCR_PROMPT = """Transcribe this page of a study document.

Rules:
- Output the page's own words. Do not paraphrase, summarise, translate, correct or explain anything.
- Read in natural reading order. For a two-column layout, read the left column top to bottom, then the right column.
- Use markdown to show the structure: "#" for the page's main heading, "##" and "###" for subheadings, "-" for bullet lists, "1." for numbered lists. Keep the wording of every heading exactly as written.
- Keep paragraphs as paragraphs. Do not break a sentence across lines.
- For a table that is actually printed on this page, output it in exactly this form:
  [TABLE: column header 1 | column header 2]
  row value 1 | row value 2
  row value 3 | row value 4
- An equation standing on its own line, set apart from the prose, is a display formula. Put it on its own line between dollar signs, for example $ax^{2} + bx + c = 0$, and keep any equation number that sits beside it.
- Write inline mathematics between dollar signs too, for example $x^{2} + y^{2} = z^{2}$ and $a \neq 0$. Keep everything else plain prose.
- If any text is blurred, cut off or otherwise unreadable, write [ILLEGIBLE] in its place. Never guess at a character you cannot read.
- If the page ends in the middle of a sentence, transcribe only the words that are printed and stop there. Do not finish the sentence, and do not guess what comes next.
- Leave out page numbers, running headers and footers, and never read them as part of the body text. A page number in the margin is not the end of a sentence.
- Do not describe any picture, graph or diagram. A separate pass looks for those, and two passes describing the same picture differently is worse than one.
- Output only the transcription. No preamble, no closing remarks."""

FIGURE_DETECTION_PROMPT = """Look at this page of a document and report what is on it.

Answer in exactly this format, with nothing else:

PICTURE: YES or NO
DESCRIPTION: <one line per picture that shows information — what it is, what it shows, and every label and number on it. If PICTURE is NO, write NONE.>
HEADER: <the running header printed at the top of the page, or NONE>
FOOTER: <the running footer printed at the bottom of the page, or NONE>

Rules for the PICTURE line:
- Answer YES only if the page contains a picture that shows information: a graph, a diagram, a chart, a drawn table, a photograph, a circuit, a map, or a worked illustration.
- Answer NO when the only thing on the page that is not text is a logo, a crest, a seal, an emblem, a decorative border, a page number, a header or a footer.
- Answer NO when the page talks about a graph, a diagram or an example but does not actually show one.
- Answer NO when you are not certain a picture is there.

Rules for the DESCRIPTION line:
- Describe only what is actually printed on this page. A picture you invent is worse than no picture, because the student will be taught something that is not in their material.
- Read out the labels and the text that are printed on the picture, and describe its shape and its parts.
- Do not state a coordinate, a value, a point or a number that you cannot read clearly on the picture. Say "the vertex is marked but its value is not legible" rather than guessing. A wrong number in a description is taught to the student as fact.

The HEADER and FOOTER are the text repeated on every page of the document — a course title, a centre name, a page number. Copy them exactly. If the page has none, write NONE."""


FIGURE_DESCRIPTION_PROMPT = """You are explaining one figure taken from a student's own study material.

Look only at the image you are given. Write 2 to 4 sentences that a student could understand without ever seeing the picture:
- Say what kind of figure it is (diagram, graph, circuit, table, photograph, map, worked example).
- Say what it shows and how its parts relate to each other.
- Read out the labels, numbers and symbols that matter.
- Say what the student should take away from it.

Do not start with "The image shows" or "This figure". Write it as if you are speaking to the student. Do not use markdown, bullet points or headings."""

STUDY_EXPLANATION = """You are a warm, patient tutor turning a student's own study material into a clear lesson they can read or listen to.

The student uploaded this material themselves. Your job is to explain *their* material to them — the same facts, the same examples, the same diagrams — in plain language, so a beginner can follow it without guessing.

Material title: {material_title}
Explanation level: {education_level}
{level_guidance}

The student's material, extracted from their upload:
<<<MATERIAL
{raw_text}
MATERIAL>>>

Figures that appear on the pages:
{figure_text}

Output strict JSON only. No markdown fences. No text before or after.
{{
  "title": "short descriptive title",
  "blocks": [
    {{ "type": "heading", "text": "Section heading", "level": 2 }},
    {{ "type": "body", "text": "A paragraph of plain-language explanation." }},
    {{ "type": "list", "style": "bullet", "items": ["item 1", "item 2"] }},
    {{ "type": "numbered_list", "items": ["step 1", "step 2"] }},
    {{ "type": "tip", "label": "Remember", "text": "The one thing to hold on to." }},
    {{ "type": "warning", "label": "Careful", "text": "A common mistake to avoid." }},
    {{ "type": "calculation", "label": "Worked example", "steps": ["Step 1 and what it does", "Step 2", "The result"] }},
    {{ "type": "formula", "text": "E = mc²", "description": "What it means in words." }},
    {{ "type": "statement", "label": "Theorem", "text": "The claim itself." }},
    {{ "type": "definition", "term": "Photosynthesis", "text": "What the term means." }},
    {{ "type": "table", "headers": ["Column 1", "Column 2"], "rows": [["Value A", "Value B"]] }},
    {{ "type": "figure", "figure_index": 1, "text": "What the diagram shows, in words a student can follow." }},
    {{ "type": "recap", "items": ["The three to five things worth remembering."] }}
  ]
}}

Rules:
- The first block is a body block saying what this material is about and what the student will be able to do afterwards.
- Use heading blocks for sections, with level 2.
- Use body blocks for all actual explanation: definitions, reasoning, worked-through ideas.
- Explain an idea in plain language BEFORE you use its technical term, then give the term in brackets, for example: "the force that pulls things down (gravity)".
- Use an everyday analogy wherever one helps, and say it in plain words.
- For every worked example, calculation or diagram in the material, walk through it step by step in a calculation block, saying what each step does.
- For every figure listed above, add a figure block with that figure's figure_index and a text saying what it shows, in words a student can follow without seeing it. Never drop a figure.
- When the material states a theorem, a law, a rule or a principle as a formal claim, use a statement block with the label it uses ("Theorem", "Law", "Principle").
- When the material defines a term a beginner must know, use a definition block with the term and what it means.
- A formula block's "text" is LaTeX source: write "\\frac{{a}}{{b}}" for a fraction, "x^{{2}}" for a power, "\\sqrt{{x}}" for a root. Never wrap it in dollar signs. Its "description" says what it means in plain words.
- Inside a body block, wrap inline mathematics in dollar signs like "$x^{{2}} + y^{{2}} = z^{{2}}$". Keep everything else plain prose.
- Keep every fact, formula, date, name and example from the material. Do not add facts the material does not contain. If the material does not cover something, say so plainly.
- Use short sentences. Read each one aloud in your head: if you would run out of breath, split it.
- End with a recap block listing the three to five most important points.
- This must work for ANY document type: academic notes, business reports, personal notes, study guides, legal docs, etc.
- Aim for about {target_words} words of explanation in total."""

SOW_PARSER_CHUNK = """You are a document structure extractor. You are given ONE PART of a longer document. Parse only the part you are given.

Return strict JSON only. No markdown fences. No text before or after.
{{
  "title": "The title of the document, if this part shows it, otherwise a short descriptive title",
  "topics": [
    {{ "name": "Main topic", "subtopics": ["Subtopic"], "key_concepts": ["Key concept"] }}
  ],
  "content_blocks": [
    {{ "type": "heading", "text": "Section heading", "level": 1 }},
    {{ "type": "body", "text": "A paragraph of prose." }},
    {{ "type": "list", "style": "bullet", "items": ["item 1", "item 2"] }},
    {{ "type": "numbered_list", "items": ["step 1", "step 2"] }},
    {{ "type": "tip", "label": "Remember", "text": "The one thing to hold on to." }},
    {{ "type": "warning", "label": "Careful", "text": "A common mistake to avoid." }},
    {{ "type": "calculation", "label": "Worked example", "steps": ["Step 1 and what it does", "Step 2", "The result"] }},
    {{ "type": "code", "language": "python", "text": "print('hello')" }},
    {{ "type": "quote", "text": "A direct quote.", "attribution": "Who said it" }},
    {{ "type": "formula", "text": "\\\\frac{{a}}{{b}}", "description": "What the formula means in words." }},
    {{ "type": "statement", "label": "Theorem", "text": "The statement itself, in the source's own words." }},
    {{ "type": "definition", "term": "Photosynthesis", "text": "What the term means." }},
    {{ "type": "table", "headers": ["Column 1", "Column 2"], "rows": [["Value A", "Value B"]] }},
    {{ "type": "figure", "page": 1, "caption": "Short caption for the figure", "description": "What the figure shows, in plain words" }}
  ]
}}

Rules:
- Return BOTH topics AND content_blocks
- content_blocks must cover EVERYTHING in the part you were given, in reading order. Do not summarise, do not skip, do not merge paragraphs.
- Detect the document's natural structure: headings, subheadings, sections, subsections
- Heading levels: use 1 for main title/major sections, 2 for subsections, 3 for minor headings
- Use body blocks for all actual content: explanations, definitions, formulas, examples, narratives
- Convert real bullet lists into list blocks with style "bullet"
- Convert numbered/ordered lists into numbered_list blocks
- Use tip blocks for: "Remember", "Pro tip", "Note", "Hint", "Key point", "Important", "Don't forget"
- Use warning blocks for: "Caution", "Warning", "Common mistake", "Avoid", "Watch out", "Danger"
- Use calculation blocks for: worked examples, step-by-step math, problem-solving sequences
- Use code blocks for: code snippets, commands, terminal output, syntax examples
- Use quote blocks for: direct quotes, adages, proverbs, notable sayings, highlighted phrases
- Use statement blocks for: a theorem, lemma, proposition, corollary, law, principle or rule that the source states as a formal claim
- Use definition blocks for: a term the source defines, especially a key term a beginner must know
- Use formula blocks for: standalone mathematical formulas, equations, scientific notation
- Use table blocks for: any tabular data, comparisons, schedules, lists with columns
- Use figure blocks for: diagrams, graphs, circuits, charts, maps, photographs and worked illustrations. Place each figure block in reading order where the figure appears, and carry over the description that came with the figure word for word — do not rewrite it, do not add a detail to it, and do not drop one. The caption is the caption printed in the document, and the description is what another pass worked out by looking at the picture. A figure is never dropped, even if the text around it says little about it
- Remove page numbers, running headers/footers, copyright notices, bookmarks, URLs, timestamps, "Error!" text, and any OCR artifacts

Math and code — follow these exactly, the reader renders them:
- A formula block's "text" is LaTeX source, nothing else. Write "\\\\frac{{a}}{{b}}" for a fraction, "x^{{2}}" for a power, "\\\\sqrt{{x}}" for a root, "\\\\sum_{{i=1}}^{{n}}" for a sum. Never wrap it in dollar signs.
- A formula block's "description" is plain English saying what the formula means. It must be understandable without reading the formula.
- Inside a body block, wrap inline mathematics in dollar signs like "$x^{{2}} + y^{{2}} = z^{{2}}$". Keep everything else plain prose.
- A calculation block's steps are one step per entry. A step that contains mathematics carries it in dollar signs. Do not put two steps in one entry.
- A code block's "text" is the code exactly as it appears, with its indentation preserved. Use "language" for the language name ("python", "javascript", "sql", "bash"). Never wrap the code in markdown fences.

- This must work for ANY document type: academic notes, business reports, personal notes, study guides, legal docs, etc.
- Output only the JSON."""

SOW_PARSER = """You are a document structure extractor. Your job is to read any uploaded document text and return structured, clean study-ready notes.

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
  ],
  "content_blocks": [
    {{
      "type": "heading",
      "text": "Section heading",
      "level": 1
    }},
    {{
      "type": "body",
      "text": "Paragraph content..."
    }},
    {{
      "type": "list",
      "style": "bullet",
      "items": ["item 1", "item 2"]
    }},
    {{
      "type": "numbered_list",
      "items": ["step 1", "step 2"]
    }},
    {{
      "type": "tip",
      "label": "Remember",
      "text": "Helpful tip or important point to remember"
    }},
    {{
      "type": "warning",
      "label": "Caution",
      "text": "Warning or common mistake to avoid"
    }},
    {{
      "type": "calculation",
      "label": "Example",
      "steps": [
        "Step 1 description",
        "Step 2 with formula: Q = I × t",
        "Result"
      ]
    }},
    {{
      "type": "code",
      "language": "python",
      "text": "code snippet here"
    }},
    {{
      "type": "quote",
      "text": "Notable quote or adage",
      "attribution": "— Author Name"
    }},
    {{
      "type": "formula",
      "text": "\\\\frac{{a}}{{b}}",
      "description": "What the formula means in words"
    }},
    {{
      "type": "statement",
      "label": "Theorem",
      "text": "The statement itself, in the source's own words"
    }},
    {{
      "type": "definition",
      "term": "Photosynthesis",
      "text": "What the term means"
    }},
    {{
      "type": "table",
      "headers": ["Column 1", "Column 2"],
      "rows": [
        ["Value A", "Value B"],
        ["Value C", "Value D"]
      ]
    }},
    {{
      "type": "figure",
      "page": 1,
      "caption": "Short caption for the figure",
      "description": "What the figure shows, in plain words"
    }}
  ]
}}

Rules:
- Return BOTH topics AND content_blocks
- content_blocks must cover the FULL document content in reading order
- Detect the document's natural structure: headings, subheadings, sections, subsections
- Heading levels: use 1 for main title/major sections, 2 for subsections, 3 for minor headings
- Use body blocks for all actual content: explanations, definitions, formulas, examples, narratives
- Convert real bullet lists into list blocks with style "bullet"
- Convert numbered/ordered lists into numbered_list blocks
- Use tip blocks for: "Remember", "Pro tip", "Note", "Hint", "Key point", "Important", "Don't forget"
- Use warning blocks for: "Caution", "Warning", "Common mistake", "Avoid", "Watch out", "Danger"
- Use calculation blocks for: worked examples, step-by-step math, problem-solving sequences
- Use code blocks for: code snippets, commands, terminal output, syntax examples
- Use quote blocks for: direct quotes, adages, proverbs, notable sayings, highlighted phrases
- Use statement blocks for: a theorem, lemma, proposition, corollary, law, principle or rule that the source states as a formal claim
- Use definition blocks for: a term the source defines, especially a key term a beginner must know
- Use formula blocks for: standalone mathematical formulas, equations, scientific notation
- Use table blocks for: any tabular data, comparisons, schedules, lists with columns
- Use figure blocks for: diagrams, graphs, circuits, charts, maps, photographs and worked illustrations. Place each figure block in reading order where the figure appears, and carry over the description that came with the figure word for word — do not rewrite it, do not add a detail to it, and do not drop one. The caption is the caption printed in the document, and the description is what another pass worked out by looking at the picture. A figure is never dropped, even if the text around it says little about it
- Remove page numbers, running headers/footers, copyright notices, bookmarks, URLs, timestamps, "Error!" text, and any OCR artifacts
- Preserve key facts, formulas, dates, names, and important details in body text
- If the document has a table of contents, include only the content sections as content_blocks (not the TOC itself as headings)
- Keep the original meaning intact; do not summarize or shorten content
- topics should reflect the main subjects covered, 3-8 topics max
- This must work for ANY document type: academic notes, business reports, personal notes, study guides, legal docs, etc.

Math and code — follow these exactly, the reader renders them:
- A formula block's "text" is LaTeX source, nothing else. Write "\\\\frac{{a}}{{b}}" for a fraction, "x^{{2}}" for a power, "\\\\sqrt{{x}}" for a root, "\\\\sum_{{i=1}}^{{n}}" for a sum. Never wrap it in dollar signs.
- A formula block's "description" is plain English saying what the formula means. It must be understandable without reading the formula.
- Inside a body block, wrap inline mathematics in dollar signs like "$x^{{2}} + y^{{2}} = z^{{2}}$". Keep everything else plain prose.
- A calculation block's steps are one step per entry. A step that contains mathematics carries it in dollar signs. Do not put two steps in one entry.
- A code block's "text" is the code exactly as it appears, with its indentation preserved. Use "language" for the language name ("python", "javascript", "sql", "bash"). Never wrap the code in markdown fences.
"""

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
- Difficulty: medium
{teach_from_lesson}"""

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
- Difficulty: medium
{teach_from_lesson}"""

#: The rule every generator gets. The context it is handed holds the
#: lesson that was written from the student's own material — the same
#: explanation the student read, and the same one they will hear. The
#: generators must write from that lesson, not from a table of
#: contents and not from the model's own memory of the subject.
TEACH_FROM_LESSON = """- The context holds a lesson written from the student's own material, in plain language. That lesson is what the student was actually taught. Write from it — use its explanations, its definitions, its worked examples and its wording
- Where the context also carries the student's material verbatim, that text is the authority on what was uploaded. Use the lesson to explain, and the verbatim text to check the facts
- Never invent a fact, a number, a date or a name that is not in the context
- Write inline mathematics inside the text in dollar signs, for example "$x^{2} + y^{2} = z^{2}$", so it can be typeset. Leave everything else plain prose"""


def render_prompt(template: str, **values) -> str:
    """Fill a prompt template.

    Every generator prompt carries the `teach_from_lesson` rule. It is
    filled in by default, so a call site that forgets it renders a
    slightly weaker prompt rather than failing at runtime with a
    KeyError — and a caller that wants a different rule can still
    pass one.
    """
    values.setdefault("teach_from_lesson", TEACH_FROM_LESSON)
    return template.format(**values)


MCQ_ALL_TOPICS_GENERATOR = """Generate {count} multiple-choice questions distributed across the following topics.

Exam style guide:
{exam_style}

Study material:
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
- Difficulty: {difficulty}
- Distribute questions evenly across all topics
- Include a "topic" field in each question indicating which topic it covers
- Draw strictly on the study material above. Never invent facts it does not contain
- Where the material gives numbers, dates, or definitions, test those specifically
{teach_from_lesson}"""

# Per-board phrasing guidance. Nigerian exam boards differ in how they
# ask rather than what they ask, so this is a style guide, not a
# syllabus. Keys match app/exam_types.py.
EXAM_STYLE_GUIDES = {
    "jamb": (
        "WAEC/JAMB-style objective questions. Short, direct stems "
        "(typically one sentence). Emphasise fast factual recall, "
        "application of formulas, and definition-matching. Distractors "
        "must be plausible — common misconceptions, not jokes."
    ),
    "waec": (
        "WAEC-style objective questions. Slightly longer stems than "
        "JAMB, weighted toward conceptual understanding and theory. "
        "Prefer 'which of the following' framings over pure recall."
    ),
    "neco": (
        "NECO-style objective questions. Stay close to the literal "
        "wording and named terms used in the study material, since "
        "students are preparing to recognise exact phrasing."
    ),
    "nabteb": (
        "NABTEB-style objective questions. Bias toward technical and "
        "procedural knowledge — tools, steps, safety, and practical "
        "application over abstract theory."
    ),
    "custom": (
        "General objective questions. Balanced between factual recall "
        "and conceptual understanding."
    ),
}

DIFFICULTY_GUIDES = {
    "easy": (
        "Recall-level questions that test definitions, names, and "
        "directly stated facts. A student who read the material once "
        "should answer correctly."
    ),
    "medium": (
        "Mixed recall and application questions. Most should be "
        "answerable from the material, with a few requiring a small "
        "step of reasoning."
    ),
    "hard": (
        "Application and analysis questions. Require combining two "
        "facts from the material or reasoning one step past what is "
        "stated. Avoid pure recall."
    ),
}

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
- Cards should cover the most important concepts in the context
{teach_from_lesson}"""

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
- Cards should cover the most important concepts in the specific topic
{teach_from_lesson}"""

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
- Include a "topic" field in each card indicating which topic it covers
{teach_from_lesson}"""

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
- Questions should test analysis and application, not just recall
{teach_from_lesson}"""

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
- Questions should test analysis and application of the specific topic
{teach_from_lesson}"""

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
- Include a "topic" field in each question indicating which topic it covers
{teach_from_lesson}"""

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

The student's study material context is below. It has three parts:
- The outline, which shows the structure of the material.
- The lesson, which is the explanation written from the student's own material — the same plain-language explanation the student read in the app and will hear in the narration. This is what you teach from. Use its wording, its analogies and its worked examples, so that what you say and what they read are the same thing.
- The student's own material, verbatim, which is the authority on what was actually uploaded. Use it to check facts the lesson might have left out.

Study material context:
{context}

Output rules:
- Answer in plain prose with light markdown (bold for key terms, short bullet lists only when listing steps or items).
- Keep answers focused: 100-250 words unless the student explicitly asks for more depth.
- Base every claim on the material above. Do not invent facts, numbers, or dates it does not contain.
- Write inline mathematics in dollar signs, for example "$x^{{2}} + y^{{2}} = z^{{2}}$", so it can be typeset. Leave everything else plain prose.
- If the material does not cover the question, say so plainly in one sentence, then explain what the material does say that is closest.
- If the student asks for content unrelated to studying (or anything inappropriate), decline politely in one sentence and offer to return to their material."""

#: Locale code → language name for the chat tutor. The chat screen
#: sends the active i18n language; non-English gets a reply-language
#: line appended to CHAT_TUTOR_SYSTEM by the /study/chat endpoint.
LANGUAGE_NAMES = {
    "en": "English",
    "ha": "Hausa",
    "ig": "Igbo",
    "pcm": "Nigerian Pidgin",
    "yo": "Yoruba",
}

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
- The description should be detailed enough for a frontend renderer to recreate it
{teach_from_lesson}"""

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
- End with a key takeaway
{teach_from_lesson}"""

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

#: Per-level spoken guidance, mirroring CHAT_TUTOR_SYSTEM above so a
#: listener hears the same pedagogy the text tutor applies.
NARRATION_LEVEL_GUIDANCE = {
    "primary": (
        "Speak to a young student. Short sentences. Explain every idea "
        "with something from everyday life — \"Imagine you have five "
        "apples...\". Say the simple version first, then the formal term."
    ),
    "secondary": (
        "Speak to a secondary-school student. Detailed explanations with "
        "worked examples, step-by-step walkthroughs, and real-world uses."
    ),
    "tertiary": (
        "Speak to a university student. Academic depth, correct "
        "terminology, and enough context to see why the idea matters."
    ),
    "research": (
        "Speak to a researcher. Cover assumptions, trade-offs, and edge "
        "cases; name the technique and use precise terminology."
    ),
}

STUDY_NARRATION_SCRIPT = """You are a warm, patient tutor narrating a study lesson aloud to one student. The student is *listening*, not reading, so every sentence must make sense when spoken.

Material: {material_title}
Topic {topic_index} of {topic_total}: {topic_name}
Subtopics: {subtopics}
Part {episode_number} of {episode_count}

Explanation level: {education_level}
{level_guidance}

Source material for this topic:
{blocks_text}

Write the narration script now. Follow these rules exactly:
- Write only the words you will say. No headings, no bullet points, no markdown, no stage directions, no "here are the steps".
- Open by naming the topic and saying what the student will get from it. If this is not the first part, continue smoothly from where the previous part ended instead of reintroducing the topic.
- Explain an idea in plain language before you name its technical term, and use an everyday analogy where it helps.
- Work through examples and calculations step by step, saying each step aloud.
- NEVER read a formula symbol by symbol — say it in words, for example "Q equals current multiplied by time".
- Say tables as sentences: what the columns are, then what each row tells you.
- Signpost the moves: "Now, here's the important part...", "A common mistake is...", "Let's try an example."
- Do not read out page numbers, URLs, or source citations.
- Close by summarising the two or three things worth remembering.
- Stay faithful to the source material. Do not invent facts it does not contain. If it does not cover something, say so plainly.
- Aim for about {target_words} words."""
