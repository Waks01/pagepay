# PagePay: Project Agents & Commands

This repository uses the Kilo agent system to coordinate multi-phase product development.

---

## How It Works

### Commands
Defined in `.kilo/command/*.md`. Each command is a phase with step-by-step implementation tasks.
- Run a command: describe what you want to build using the command's language
- Commands are **non-negotiable specifications** — follow them unless you find a bug, then fix the command first

### Agents
Defined in `.kilo/agent/*.md`. Each agent is a role with responsibilities, tech stack, and rules.
- **backend.md** — FastAPI, MySQL, Docker, AI router, ad SSV, payments
- **frontend.md** — Expo SDK 55+, Expo Router, React Native New Architecture
- **ai.md** — Multi-provider LLM routing, failover, prompt engineering
- **devops.md** — Docker, EAS Build, CI/CD, deployment

### Steering/Memory
`.kilo/steering.md` contains product vision, brand identity, non-negotiable principles, and hard constraints. Read before every implementation decision.

---

## Quick Reference

| File | Purpose |
|------|---------|
| `kilo.json` | Project config: name, stack, phases, agents |
| `AGENTS.md` | This file — how the agent system works |
| `.kilo/steering.md` | Product steering + memory |
| `.kilo/agent/*.md` | Role definitions (backend, frontend, AI, DevOps) |
| `.kilo/command/*.md` | Phase implementation specs |
| `roadmap.md` | Full roadmap, Mermaid diagrams, API specs, DB schema |

---

## Rule of Engagement

1. **Read before you build:** Always read `steering.md` and the relevant agent file before writing code.
2. **Phase by phase:** Complete one phase end-to-end (backend + frontend + deploy) before starting the next.
3. **Ship every phase:** Each phase is a live product update. Don't hide work until "Phase 6 complete."
4. **Dual ad networks:** AdMob + AppLovin MAX always run together. Primary/fallback per placement.
5. **Docker backend:** All backend services run in Docker containers. No bare-metal Python processes.
6. **Expo dev-client only:** From Phase 2 onward, use `expo-dev-client` builds. Expo Go cannot load AdMob/AppLovin adapters.
7. **Free AI only until revenue:** Use free tier AI providers until you have proven ad revenue. Then upgrade to paid for reliability.

---

## Example Usage

"You" (the developer) can tell Claude/Kilo:
- "Run phase1-core"
- "Build the backend according to the backend agent spec"
- "Review my frontend against the frontend agent rules"
- "What needs to happen before we ship Phase 1?"

The AI will refer to these files to give accurate, context-aware answers.

---

## File Hierarchy

```
pagepay/
├── kilo.json
├── AGENTS.md
├── roadmap.md
├── .kilo/
│   ├── steering.md
│   ├── agent/
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   ├── ai.md
│   │   └── devops.md
│   └── command/
│       ├── phase1-core.md
│       ├── phase2-ads.md
│       ├── phase3-study.md
│       ├── phase4-payments.md
│       ├── phase5-community.md
│       └── phase6-scale.md
├── backend/          (code starts here)
│   ├── app/
│   ├── Dockerfile
│   └── docker-compose.yml
└── frontend/         (code starts here)
    └── app/
```

---

## Maintenance
- Update `roadmap.md` when architecture changes
- Update agent files when tech stack evolves (e.g., new Expo SDK, new AI provider)
- Update `steering.md` when product strategy shifts
- Keep phase commands in sync with roadmap — they should mirror each other
