// PagePay · Study preview
// Editorial / Linear direction. Real interactions on exam flow, chat
// streaming, and unlock modal. Mock data shapes match backend schemas
// (MaterialSummary / MaterialDetail / AssetInfo / QuizCompleteResponse).

// ---------- icon helper (no external icon lib) ----------
const I = (path, opts = {}) => {
  const stroke = opts.stroke || "currentColor";
  const sw = opts.sw || 1.6;
  const size = opts.size || 20;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
};

const icons = {
  back:        '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  upload:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  doc:         '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/>',
  camera:      '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  gallery:     '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  chat:        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell:        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  plus:        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search:      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  chevR:       '<polyline points="9 18 15 12 9 6"/>',
  chevL:       '<polyline points="15 18 9 12 15 6"/>',
  chevDown:    '<polyline points="6 9 12 15 18 9"/>',
  more:        '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  check:       '<polyline points="20 6 9 17 4 12"/>',
  close:       '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  lock:        '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  play:        '<polygon points="5 3 19 12 5 21 5 3"/>',
  refresh:     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  award:       '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  flash:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  zap:         '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  list:        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  card:        '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  bulb:        '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.4 1 1 1 1.6V18h6v-1.7c0-.6.4-1.2 1-1.6A7 7 0 0 0 12 2z"/>',
  send:        '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  flip:        '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  bookmark:    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  hourglass:   '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.6-1.42L12 12l-4.4 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .6 1.42L12 12l4.4-4.41A2 2 0 0 0 17 6.17V2"/>',
};

// ---------- mock data (shaped to backend schemas) ----------
const materials = [
  {
    id: 1,
    title: "JAMB · Chemistry 2025 SOW",
    exam_type: "jamb",
    asset_types: ["mcq", "flashcard", "essay"],
    mastery: 0.72,
    due_today: 8,
    topics: 12,
    created_at: "2025-08-04",
    accent: "mint",
  },
  {
    id: 2,
    title: "WAEC · Further Mathematics",
    exam_type: "waec",
    asset_types: ["mcq", "example"],
    mastery: 0.34,
    due_today: 18,
    topics: 14,
    created_at: "2025-08-07",
    accent: "signal",
  },
  {
    id: 3,
    title: "NECO · English Language",
    exam_type: "neco",
    asset_types: ["essay", "mcq"],
    mastery: 0.55,
    due_today: 5,
    topics: 9,
    created_at: "2025-08-09",
    accent: "ink",
  },
];

const examQuestions = [
  {
    q: "Which of the following best describes an exothermic reaction?",
    options: [
      "A reaction that absorbs heat from the surroundings",
      "A reaction that releases heat to the surroundings",
      "A reaction where temperature remains constant",
      "A reaction that requires a catalyst",
    ],
    correct: 1,
    explain: "Exothermic reactions release energy as heat (ΔH < 0). Combustion is a classic example.",
  },
  {
    q: "The pH of a neutral aqueous solution at 25 °C is closest to:",
    options: ["0", "7", "10", "14"],
    correct: 1,
    explain: "At 25 °C, pure water has [H⁺] = 10⁻⁷ M, giving pH 7.",
  },
  {
    q: "An element has atomic number 17. It belongs to which group?",
    options: ["Group 1 — alkali metals", "Group 2 — alkaline earths", "Group 17 — halogens", "Group 18 — noble gases"],
    correct: 2,
    explain: "Z = 17 is chlorine (Cl), which sits in Group 17 with the other halogens.",
  },
  {
    q: "Which of these is an empirical formula?",
    options: ["C₄H₁₀", "C₂H₅", "CH₃COOH", "C₆H₁₂O₆"],
    correct: 1,
    explain: "C₂H₅ cannot be reduced further — it is the empirical formula of the C₄H₁₀ butane molecule.",
  },
];

const srsCards = [
  { id: "srs-1", front: "Avogadro's number", back: "6.022 × 10²³ particles per mole", box: 4, topic: "Stoichiometry" },
  { id: "srs-2", front: "Define electronegativity", back: "The tendency of an atom to attract bonding electrons.", box: 2, topic: "Bonding" },
  { id: "srs-3", front: "Le Chatelier's principle", back: "If a system at equilibrium is disturbed, it shifts to oppose the change.", box: 5, topic: "Equilibrium" },
  { id: "srs-4", front: "pH of 0.01 M HCl", back: "pH ≈ 2 — strong acid, fully dissociates.", box: 1, topic: "Acids & Bases" },
  { id: "srs-5", front: "Hybridization of carbon in ethyne", back: "sp — triple bond, linear geometry, 180°.", box: 3, topic: "Bonding" },
];

const chatScript = [
  { role: "user", text: "Explain Le Chatelier's principle with a real-world example." },
  { role: "ai", text: "Le Chatelier's principle states that when a system at equilibrium is disturbed, it shifts to oppose the change and re-establish balance.\n\nThink of a saturated carbonated drink. When you open the bottle, pressure drops suddenly. The dissolved CO₂ was in equilibrium with CO₂ gas above the liquid. To oppose the pressure drop, CO₂ rushes out of solution — that's why you hear the fizz.\n\nIn chemistry, the same idea applies to concentration, temperature, and pressure changes." },
  { role: "user", text: "What if I increase the temperature of an exothermic reaction at equilibrium?" },
  { role: "ai", text: "For an exothermic reaction, heat is a product. Raising temperature adds heat — by Le Chatelier, the equilibrium shifts backward (toward reactants) to consume the added heat.\n\nA practical example: the Haber process (N₂ + 3H₂ ⇌ 2NH₃, exothermic). Industrial plants use moderately high temperatures despite lower yield, because the reaction would be too slow at low temperatures. There's a trade-off between rate and equilibrium position." },
];

// ---------- screen renderers ----------
const screens = {
  "study-list": () => `
    <section class="screen">
      <header class="hdr">
        <div>
          <h1 class="hdr__title">Study</h1>
          <p class="hdr__sub">${materials.length} materials · 31 cards due today</p>
        </div>
        <div class="hdr__right">
          <button class="icon-btn" aria-label="Search">${I(icons.search)}</button>
          <button class="icon-btn" aria-label="Notifications">${I(icons.bell)}<span class="dot"></span></button>
        </div>
      </header>

      <div class="upload">
        <div class="upload__lead">
          <span class="upload__icon">${I(icons.upload, { stroke: "#fff", sw: 2 })}</span>
          <div style="flex:1">
            <h2 class="upload__title">Upload your syllabus</h2>
            <p class="upload__hint">Drop a photo, PDF, or paste text. We'll parse the topics, generate quizzes, and unlock spaced-repetition cards.</p>
          </div>
        </div>
        <div class="upload__chips">
          <button class="chip chip--clickable chip--mint">${I(icons.flash, { size: 12 })} 15 topics parsed</button>
          <button class="chip chip--clickable">${I(icons.card, { size: 12 })} MCQ + flashcards</button>
        </div>
        <textarea class="field__input" placeholder="Paste your scheme of work or syllabus text…" rows="3" style="background: var(--card); border: 1px solid var(--border); padding: 12px 14px; border-radius: var(--radius-sm);"></textarea>
        <div class="upload__modes">
          <button class="mode-btn">${I(icons.doc, { size: 20 })}<span>PDF / Doc</span></button>
          <button class="mode-btn">${I(icons.gallery, { size: 20 })}<span>Image</span></button>
          <button class="mode-btn">${I(icons.camera, { size: 20 })}<span>Camera</span></button>
        </div>
      </div>

      <div class="section">
        <h3 class="section__title">Your materials</h3>
        <span class="section__meta">${materials.length} active</span>
      </div>

      <div class="stack">
        ${materials.map((m) => `
          <a class="row" data-go="study-detail">
            <span class="row__icon ${m.accent === "signal" ? "row__icon--signal" : m.accent === "ink" ? "row__icon--ink" : ""}">${I(m.accent === "signal" ? icons.bulb : m.accent === "ink" ? icons.list : icons.card)}</span>
            <div class="row__main">
              <p class="row__title">${m.title}</p>
              <p class="row__sub">${m.topics} topics · ${m.asset_types.map(a => a.toUpperCase()).join(" · ")}</p>
              <div class="bar" style="margin-top:8px"><div class="bar__fill" style="width:${m.mastery * 100}%"></div></div>
            </div>
            <div style="text-align:right">
              <span class="chip chip--mint">${m.due_today} due</span>
            </div>
          </a>
        `).join("")}
      </div>

      <div class="section">
        <h3 class="section__title">Quick actions</h3>
      </div>
      <div class="gen-grid">
        <a class="gen" data-go="exam-setup">
          <span class="gen__icon">${I(icons.hourglass)}</span>
          <span class="gen__label">Exam Mode</span>
          <span class="gen__count">20 questions</span>
        </a>
        <a class="gen" data-go="srs">
          <span class="gen__icon">${I(icons.flip)}</span>
          <span class="gen__label">Review due</span>
          <span class="gen__count">${srsCards.length} cards</span>
        </a>
        <a class="gen" data-go="chat">
          <span class="gen__icon">${I(icons.chat)}</span>
          <span class="gen__label">Ask AI</span>
          <span class="gen__count">Material-scoped</span>
        </a>
      </div>
    </section>
  `,

  "study-detail": () => {
    const m = materials[0];
    const topics = [
      { name: "Stoichiometry & the mole", sub: "6 subtopics · 14 concepts", progress: 1.0, status: "mastered" },
      { name: "Atomic structure", sub: "5 subtopics · 11 concepts", progress: 0.85, status: "mastered" },
      { name: "Chemical bonding", sub: "7 subtopics · 18 concepts", progress: 0.62, status: "reviewing" },
      { name: "Acids, bases & salts", sub: "6 subtopics · 16 concepts", progress: 0.40, status: "reviewing" },
      { name: "Electrochemistry", sub: "4 subtopics · 9 concepts", progress: 0.10, status: "not_started" },
      { name: "Rates of reaction", sub: "5 subtopics · 12 concepts", progress: 0, status: "not_started" },
    ];
    const assetTypes = [
      { key: "mcq",        label: "MCQs",         icon: icons.list,   count: 20 },
      { key: "flashcard",  label: "Flashcards",   icon: icons.flip,   count: 30 },
      { key: "essay",      label: "Essays",       icon: icons.bulb,   count: 6  },
      { key: "diagram",    label: "Diagrams",     icon: icons.card,   count: 4  },
      { key: "video",      label: "Video",        icon: icons.play,   count: 1, locked: true },
      { key: "example",    label: "Examples",     icon: icons.zap,    count: 5  },
    ];
    return `
      <section class="screen">
        <header class="hdr">
          <button class="hdr__back" data-go="study-list" aria-label="Back">${I(icons.back)}</button>
          <div class="hdr__right">
            <button class="icon-btn" aria-label="Bookmark">${I(icons.bookmark)}</button>
            <button class="icon-btn" aria-label="More">${I(icons.more)}</button>
          </div>
        </header>

        <div class="detail-hero">
          <p class="detail-hero__eyebrow">Material · ${m.exam_type.toUpperCase()}</p>
          <h1 class="detail-hero__title">${m.title.replace("JAMB · ", "")}</h1>
          <p style="margin:0; font-size:13px; color:rgba(255,255,255,0.7); position:relative;">12 topics parsed · last generated 2h ago</p>
          <div class="detail-hero__meta">
            <span class="chip">${m.topics} topics</span>
            <span class="chip">${m.asset_types.length} asset types</span>
            <span class="chip">${m.due_today} due today</span>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:14px;">
          <button class="btn btn--mint btn--full" data-go="chat">${I(icons.chat, { size: 16 })} Chat with this material</button>
          <button class="btn btn--ghost btn--sm" aria-label="Continue reading">${I(icons.bookmark, { size: 16 })}</button>
        </div>

        <div class="section">
          <h3 class="section__title">Topics covered</h3>
          <span class="section__meta">${topics.filter(t => t.status === "mastered").length} of ${topics.length} mastered</span>
        </div>

        <div class="topics">
          ${topics.map((t, i) => `
            <div class="topic">
              <span class="topic__num">${String(i + 1).padStart(2, "0")}</span>
              <div class="topic__main">
                <p class="topic__name">${t.name}</p>
                <p class="topic__sub">${t.sub}</p>
              </div>
              <div class="topic__bar">
                <div class="bar"><div class="bar__fill" style="width:${t.progress * 100}%; background: ${t.status === 'mastered' ? 'var(--mint)' : t.status === 'reviewing' ? 'var(--gold)' : 'var(--ink-faint)'}"></div></div>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="section" style="margin-top:24px;">
          <h3 class="section__title">Generate assets</h3>
          <div class="segmented" style="margin-top:6px;">
            <button class="segmented__btn is-active">All topics</button>
            <button class="segmented__btn">One topic</button>
          </div>
        </div>

        <div class="gen-grid">
          ${assetTypes.map((a) => `
            <button class="gen ${a.locked ? "gen--locked" : ""}" ${a.locked ? `data-go="unlock"` : ""}>
              <span class="gen__icon">${I(a.icon)}</span>
              <span class="gen__label">${a.label}</span>
              <span class="gen__count">${a.count} ${a.locked ? "· 200 pts" : "items"}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  },

  "exam-setup": () => {
    const types = [
      { code: "JAMB",   meta: "60 min · 20 Qs", tag: "Most popular" },
      { code: "WAEC",   meta: "90 min · 50 Qs", tag: null },
      { code: "NECO",   meta: "90 min · 50 Qs", tag: null },
      { code: "NABTEB", meta: "90 min · 50 Qs", tag: null },
      { code: "Custom", meta: "30 min · 10 Qs", tag: "Quick drill" },
    ];
    return `
      <section class="screen">
        <header class="hdr">
          <button class="hdr__back" data-go="study-list" aria-label="Back">${I(icons.back)}</button>
          <div class="hdr__right">
            <button class="icon-btn" aria-label="Settings">${I(icons.more)}</button>
          </div>
        </header>

        <p class="eyebrow">Exam mode</p>
        <h1 class="hdr__title" style="margin:0 0 4px;">Timed mock exam</h1>
        <p class="hdr__sub">Pick an exam type and material. Bonus points awarded on completion.</p>

        <div class="section">
          <h3 class="section__title">Exam type</h3>
          <span class="section__meta">5 options</span>
        </div>

        <div class="exam-types">
          ${types.map((t, i) => `
            <button class="exam-type ${i === 0 ? "is-active" : ""}">
              ${t.tag ? `<span class="exam-type__badge">${t.tag}</span>` : ""}
              <p class="exam-type__name">${t.code}</p>
              <p class="exam-type__meta">${t.meta}</p>
            </button>
          `).join("")}
        </div>

        <div class="section">
          <h3 class="section__title">Material</h3>
          <span class="section__meta">3 available</span>
        </div>

        <div class="stack">
          ${materials.map((m, i) => `
            <button class="row" style="text-align:left;">
              <span class="row__icon ${m.accent === "signal" ? "row__icon--signal" : m.accent === "ink" ? "row__icon--ink" : ""}">${I(m.accent === "signal" ? icons.bulb : m.accent === "ink" ? icons.list : icons.card)}</span>
              <div class="row__main">
                <p class="row__title">${m.title}</p>
                <p class="row__sub">${m.topics} topics · ${Math.round(m.mastery * 100)}% mastery</p>
              </div>
              ${i === 0 ? `<span class="chip chip--mint">Selected</span>` : `<span class="chip">Pick</span>`}
            </button>
          `).join("")}
        </div>

        <div class="divider"></div>

        <div style="background: var(--mint-faint); border-radius: var(--radius-md); padding: 14px; display:flex; gap:12px; align-items:center;">
          <span style="color: var(--mint)">${I(icons.award, { size: 22 })}</span>
          <div>
            <p style="margin:0; font-weight:600; font-size:13.5px;">+50 pts bonus on completion</p>
            <p style="margin:2px 0 0; font-size:12px; color:var(--ink-muted);">Scored 60% and above. Credited to your wallet.</p>
          </div>
        </div>

        <div style="margin-top: 18px;">
          <button class="btn btn--primary btn--full btn--lg" data-go="exam-active">Start exam</button>
        </div>
      </section>
    `;
  },

  "exam-active": () => {
    const q = examQuestions[0];
    const total = examQuestions.length;
    return `
      <div class="exam-banner">
        <div class="exam-banner__left">
          ${I(icons.close, { size: 16, stroke: "rgba(255,255,255,0.7)" })}
          Exit exam
        </div>
        <div class="exam-banner__timer">59:47</div>
      </div>

      <section class="screen" style="padding-top:8px;">
        <div class="exam-progress">
          <span class="exam-progress__count">01 / ${String(total).padStart(2, "0")}</span>
          <div class="bar" style="flex:1"><div class="bar__fill" style="width:${(1/total)*100}%; background: rgba(255,255,255,0.4)"></div></div>
          <span>Question 1 of ${total}</span>
        </div>

        <div class="exam-question">
          <p class="exam-question__num">Question 01</p>
          <h2 class="exam-question__text">${q.q}</h2>
          <div class="options" id="examOptions">
            ${q.options.map((opt, i) => `
              <button class="option" data-i="${i}">
                <span class="option__letter">${String.fromCharCode(65 + i)}</span>
                <span>${opt}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="exam-footer">
          <button class="btn btn--ghost">${I(icons.chevL, { size: 16 })} Previous</button>
          <button class="btn btn--primary">Next ${I(icons.chevR, { size: 16 })}</button>
        </div>
      </section>
    `;
  },

  "exam-result": () => {
    return `
      <section class="screen">
        <header class="hdr">
          <button class="hdr__back" data-go="study-list">${I(icons.back)}</button>
          <div class="hdr__right">
            <button class="icon-btn">${I(icons.more)}</button>
          </div>
        </header>

        <div style="text-align:center; margin-bottom:8px;">
          <p class="eyebrow" style="text-align:center;">Exam complete</p>
          <h1 class="hdr__title" style="margin:6px 0 4px;">Solid run.</h1>
          <p class="hdr__sub" style="margin:0 auto; max-width:280px;">You finished with 4 minutes to spare. The two you missed were both on bonding — flagged for review.</p>
        </div>

        <div class="score-ring" style="--p:78%">
          <div class="score-ring__inner">
            <p class="score-ring__num">78%</p>
            <p class="score-ring__label">16 / 20 correct</p>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <p class="stat__num stat__num--mint">16</p>
            <p class="stat__label">Correct</p>
          </div>
          <div class="stat">
            <p class="stat__num stat__num--signal">4</p>
            <p class="stat__label">Wrong</p>
          </div>
          <div class="stat">
            <p class="stat__num">20</p>
            <p class="stat__label">Total</p>
          </div>
        </div>

        <div class="card" style="margin-top:18px;">
          <p class="card__label">Bonus awarded</p>
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <p style="margin:0; font-family:var(--font-serif); font-size:32px; font-weight:600; letter-spacing:-0.02em;">+50 pts</p>
              <p style="margin:4px 0 0; font-size:12.5px; color:var(--ink-muted);">Added to your wallet · balance now 1,247 pts</p>
            </div>
            <span style="color: var(--mint)">${I(icons.award, { size: 36, sw: 1.5 })}</span>
          </div>
        </div>

        <div class="section">
          <h3 class="section__title">Topics to review</h3>
          <span class="section__meta">2 flagged</span>
        </div>

        <div class="stack">
          <a class="row" data-go="chat">
            <span class="row__icon row__icon--signal">${I(icons.bulb)}</span>
            <div class="row__main">
              <p class="row__title">Chemical bonding</p>
              <p class="row__sub">2 missed questions · Q7, Q14</p>
            </div>
            <span class="chip chip--signal">${I(icons.chat, { size: 11 })} Ask AI</span>
          </a>
          <a class="row" data-go="chat">
            <span class="row__icon row__icon--signal">${I(icons.bulb)}</span>
            <div class="row__main">
              <p class="row__title">Acids, bases & salts</p>
              <p class="row__sub">2 missed questions · Q12, Q19</p>
            </div>
            <span class="chip chip--signal">${I(icons.chat, { size: 11 })} Ask AI</span>
          </a>
        </div>

        <div style="margin-top: 22px; display:flex; gap:10px;">
          <button class="btn btn--ghost btn--full" data-go="exam-setup">Retake</button>
          <button class="btn btn--primary btn--full">Back to Study</button>
        </div>
      </section>
    `;
  },

  "srs": () => `
    <section class="screen">
      <header class="hdr">
        <div>
          <h1 class="hdr__title">Spaced repetition</h1>
          <p class="hdr__sub">${srsCards.length} cards due today · Leitner system</p>
        </div>
        <div class="hdr__right">
          <button class="icon-btn" aria-label="Stats">${I(icons.award)}</button>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat">
          <p class="stat__num stat__num--mint">${srsCards.length}</p>
          <p class="stat__label">Due today</p>
        </div>
        <div class="stat">
          <p class="stat__num">42</p>
          <p class="stat__label">Mastered</p>
        </div>
        <div class="stat">
          <p class="stat__num stat__num--signal">14</p>
          <p class="stat__label">Learning</p>
        </div>
      </div>

      <div class="section" style="margin-top:22px;">
        <h3 class="section__title">Due for review</h3>
        <span class="section__meta">${srsCards.length} cards</span>
      </div>

      <div class="stack" id="srsList">
        ${srsCards.map((c) => {
          const boxClass = c.box >= 4 ? "box-badge--mint" : c.box <= 1 ? "box-badge--signal" : "";
          return `
            <div class="row" data-flip="${c.id}">
              <span class="row__icon row__icon--gold">${I(icons.flip)}</span>
              <div class="row__main">
                <p class="row__title">${c.front}</p>
                <p class="row__sub">${c.topic}</p>
                <p class="row__meta">Last reviewed 3d ago</p>
              </div>
              <span class="box-badge ${boxClass}">Box ${c.box}</span>
            </div>
          `;
        }).join("")}
      </div>

      <div style="margin-top:24px; text-align:center;">
        <p style="font-size:13px; color:var(--ink-muted); margin:0 0 12px;">Difficulty after revealing:</p>
        <div style="display:flex; gap:8px; justify-content:center;">
          <button class="btn btn--ghost btn--sm">Again</button>
          <button class="btn btn--ghost btn--sm">Hard</button>
          <button class="btn btn--ghost btn--sm">Good</button>
          <button class="btn btn--mint btn--sm">Easy</button>
        </div>
      </div>
    </section>
  `,

  "chat": () => `
    <header class="hdr">
      <button class="hdr__back" data-go="study-detail">${I(icons.back)}</button>
      <div>
        <h1 class="hdr__title" style="font-size:18px;">JAMB · Chemistry</h1>
        <p class="hdr__sub" style="font-size:11.5px;">Material-scoped AI · Groq Llama 3.3</p>
      </div>
      <button class="icon-btn">${I(icons.more)}</button>
    </header>

    <div class="chat-stream" id="chatStream">
      <div class="bubble bubble--ai">
        <p class="bubble__role">AI · Chemistry tutor</p>
        I've loaded your material. Ask me anything about stoichiometry, bonding, acids & bases, electrochemistry, or rates of reaction.
      </div>
    </div>

    <div class="composer">
      <div class="composer__row">
        <textarea id="chatInput" placeholder="Ask anything about this material…" rows="1"></textarea>
        <button class="composer__send" id="chatSend">${I(icons.send, { stroke: "currentColor", sw: 2 })}</button>
      </div>
    </div>
  `,

  "unlock": () => `
    <section class="screen">
      <header class="hdr">
        <div>
          <h1 class="hdr__title" style="font-size:18px;">Generate asset</h1>
          <p class="hdr__sub">Choose how to unlock</p>
        </div>
      </header>

      <div class="card">
        <p class="card__label">Asset preview</p>
        <p class="card__title">Video explainer · Chemical bonding</p>
        <p class="card__body">A 4-minute narrated walkthrough of ionic, covalent, and metallic bonding with annotated diagrams. Generated by the AI tutor on demand.</p>
        <div style="display:flex; gap:8px; margin-top:14px;">
          <span class="chip chip--gold">${I(icons.play, { size: 11 })} 4 min</span>
          <span class="chip">Scene-driven</span>
        </div>
      </div>

      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" id="unlockModal">
          <div class="modal__handle"></div>
          <button class="modal__close" id="modalClose">${I(icons.close, { size: 16 })}</button>
          <span class="modal__icon">${I(icons.lock, { sw: 1.8 })}</span>
          <h2 class="modal__title">Unlock this asset?</h2>
          <p class="modal__sub">Choose how you'd like to access this premium study content.</p>
          <div class="unlock-options">
            <button class="unlock-choice">
              <span class="unlock-choice__label">Pay with points</span>
              <span class="unlock-choice__price">200</span>
              <span class="unlock-choice__sub">Instant access</span>
            </button>
            <button class="unlock-choice unlock-choice--primary">
              <span class="unlock-choice__label">Watch a short ad</span>
              <span class="unlock-choice__price">Free</span>
              <span class="unlock-choice__sub">~30 seconds</span>
            </button>
          </div>
          <button class="btn btn--ghost btn--full" style="margin-top:6px;">Continue browsing</button>
        </div>
      </div>
    </section>
  `,

  "progress": () => {
    const total = materials[0];
    const mastered = 4;
    const reviewing = 6;
    const not = 2;
    return `
      <section class="screen">
        <header class="hdr">
          <button class="hdr__back" data-go="study-detail">${I(icons.back)}</button>
          <div class="hdr__right">
            <button class="icon-btn">${I(icons.award)}</button>
          </div>
        </header>

        <p class="eyebrow">${total.exam_type.toUpperCase()} · Chemistry</p>
        <h1 class="hdr__title" style="margin:0 0 16px;">Mastery</h1>

        <div class="mastery-card">
          <p class="mastery-card__num">67<span style="font-size:24px; opacity:0.6;">%</span></p>
          <p class="mastery-card__label">Overall mastery</p>
          <span class="chip">${mastered + reviewing + not} topics tracked</span>
          <div class="legend">
            <span><span class="legend__dot legend__dot--mastered"></span>${mastered} mastered</span>
            <span><span class="legend__dot legend__dot--reviewing"></span>${reviewing} reviewing</span>
            <span><span class="legend__dot legend__dot--not"></span>${not} not started</span>
          </div>
        </div>

        <div class="section" style="margin-top:24px;">
          <h3 class="section__title">By topic</h3>
          <span class="section__meta">${mastered + reviewing + not} of 12</span>
        </div>

        <div class="topics">
          ${[
            { name: "Stoichiometry", progress: 1.0, status: "mastered" },
            { name: "Atomic structure", progress: 1.0, status: "mastered" },
            { name: "States of matter", progress: 0.95, status: "mastered" },
            { name: "Chemical bonding", progress: 0.78, status: "mastered" },
            { name: "Acids, bases & salts", progress: 0.62, status: "reviewing" },
            { name: "Electrochemistry", progress: 0.55, status: "reviewing" },
            { name: "Rates of reaction", progress: 0.42, status: "reviewing" },
            { name: "Equilibrium", progress: 0.30, status: "reviewing" },
            { name: "Hydrocarbons", progress: 0, status: "not_started" },
          ].map((t, i) => `
            <div class="topic">
              <span class="topic__num">${String(i + 1).padStart(2, "0")}</span>
              <div class="topic__main">
                <p class="topic__name">${t.name}</p>
                <p class="topic__sub">${t.status === "mastered" ? "Mastered" : t.status === "reviewing" ? "Reviewing" : "Not started"}</p>
              </div>
              <div class="topic__bar">
                <div class="bar"><div class="bar__fill" style="width:${t.progress * 100}%; background: ${t.status === 'mastered' ? 'var(--mint)' : t.status === 'reviewing' ? 'var(--gold)' : 'var(--ink-faint)'}"></div></div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  },
};

// ---------- navigation ----------
let currentScreen = "study-list";

function render(name) {
  currentScreen = name;
  const root = document.getElementById("screen-root");
  root.innerHTML = screens[name]();
  attachInScreenHandlers();
  // sidebar highlight
  document.querySelectorAll(".sidebar__link").forEach((l) => {
    l.classList.toggle("is-active", l.dataset.screen === name);
  });
  history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0 });
}

function attachInScreenHandlers() {
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      render(el.dataset.go);
    });
  });

  // exam option select
  document.querySelectorAll("#examOptions .option").forEach((opt) => {
    opt.addEventListener("click", () => {
      document.querySelectorAll("#examOptions .option").forEach((o) => o.classList.remove("option--selected"));
      opt.classList.add("option--selected");
    });
  });

  // unlock modal close
  const modal = document.getElementById("modalBackdrop");
  if (modal) {
    document.getElementById("modalClose").addEventListener("click", () => render("study-detail"));
    modal.addEventListener("click", (e) => { if (e.target === modal) render("study-detail"); });
  }

  // chat composer
  const send = document.getElementById("chatSend");
  const input = document.getElementById("chatInput");
  if (send && input) {
    const fire = () => {
      const text = input.value.trim();
      if (!text) return;
      appendBubble("user", text);
      input.value = "";
      appendBubble("ai-stream", "");
      streamInto(chatScript[Math.floor(Math.random() * chatScript.length)].text);
    };
    send.addEventListener("click", fire);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fire(); }
    });
  }
}

function appendBubble(role, text) {
  const stream = document.getElementById("chatStream");
  if (!stream) return;
  const div = document.createElement("div");
  div.className = role === "user" ? "bubble bubble--user" : role === "ai-stream" ? "bubble bubble--ai" : "bubble bubble--ai";
  if (role === "ai-stream") div.dataset.streaming = "true";
  if (role !== "ai-stream") {
    div.innerHTML = role === "user" ? text : `<p class="bubble__role">AI · Chemistry tutor</p>${escape(text)}`;
  } else {
    div.innerHTML = `<p class="bubble__role">AI · Chemistry tutor</p><span class="streaming-text"></span><span class="streaming"><span></span><span></span><span></span></span>`;
  }
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
  return div;
}

function streamInto(fullText) {
  const stream = document.getElementById("chatStream");
  if (!stream) return;
  const last = stream.querySelector("[data-streaming]");
  if (!last) return;
  const target = last.querySelector(".streaming-text");
  const dots = last.querySelector(".streaming");
  dots.remove();
  let i = 0;
  const tick = () => {
    target.textContent = fullText.slice(0, i);
    stream.scrollTop = stream.scrollHeight;
    i += 2;
    if (i <= fullText.length) {
      setTimeout(tick, 14);
    } else {
      target.innerHTML = escape(fullText).replace(/\n\n/g, "</p><p style='margin:8px 0 0'>").replace(/^/, "<p style='margin:0'>").replace(/$/, "</p>");
      delete last.dataset.streaming;
    }
  };
  tick();
}

function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- scheme toggle ----------
function setScheme(scheme) {
  document.documentElement.dataset.scheme = scheme;
  document.querySelectorAll(".scheme-toggle__btn").forEach((b) => {
    const active = b.dataset.scheme === scheme;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-checked", active ? "true" : "false");
  });
  try { localStorage.setItem("pagepay-scheme", scheme); } catch {}
}

document.querySelectorAll(".scheme-toggle__btn").forEach((b) => {
  b.addEventListener("click", () => setScheme(b.dataset.scheme));
});

// hash routing
function goFromHash() {
  const h = (location.hash || "#study-list").replace("#", "");
  if (screens[h]) render(h);
}
window.addEventListener("hashchange", goFromHash);

// sidebar clicks
document.querySelectorAll(".sidebar__link").forEach((l) => {
  l.addEventListener("click", (e) => {
    e.preventDefault();
    render(l.dataset.screen);
  });
});

// init
const saved = (() => { try { return localStorage.getItem("pagepay-scheme"); } catch { return null; } })();
if (saved && ["light","dark","sepia"].includes(saved)) setScheme(saved);
goFromHash();
