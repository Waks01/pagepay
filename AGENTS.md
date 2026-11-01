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
- **backend.md** — FastAPI, PostgreSQL, Docker, AI router, ad SSV, payments
- **frontend.md** — Expo SDK 57+, Expo Router, React Native New Architecture
- **ai.md** — Cloudflare Workers AI routing (standard/premium tiers), metering, cost logging
- **devops.md** — Docker, EAS Build, CI/CD, Render deployment, Neon

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
| `PRICING_AND_UNIT_ECONOMICS.md` | Current pricing, quotas, payouts, unit economics |
| `admob.md` | Ad integration reference + rollout checklist |

---

## Rule of Engagement

1. **Read before you build:** Always read `steering.md` and the relevant agent file before writing code.
2. **Phase by phase:** Complete one phase end-to-end (backend + frontend + deploy) before starting the next.
3. **Ship every phase:** Each phase is a live product update. Don't hide work until "Phase 6 complete."
4. **AdMob only, for now:** AdMob is the one live ad network and the one with a working SSV endpoint. AppLovin's config fields are inert — do not write code against them. The dual-network plan in `roadmap.md` is not implemented.
5. **Docker backend:** All backend services run in Docker containers. No bare-metal Python processes.
6. **Expo dev-client only:** From Phase 2 onward, use `expo-dev-client` builds. Expo Go cannot load the AdMob adapter.
7. **Paid AI, metered:** Cloudflare Workers AI is already paid. The cost control is model routing (standard vs premium), the chat quota, and per-user cost logging — see `PRICING_AND_UNIT_ECONOMICS.md`. Any new AI call site is a new bill: say what it costs, who pays for it, and which quota bounds it.

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
├── PRICING_AND_UNIT_ECONOMICS.md   (current pricing + unit economics)
├── admob.md                          (ad integration reference)
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
│       ├── phase6-scale.md
│       ├── phase7-tasks.md
│       └── phase8-bills.md
├── backend/          (code starts here)
│   ├── app/
│   ├── alembic/versions/
│   ├── Dockerfile
│   └── docker-compose.yml
└── page/             (code starts here)
    ├── src/app/      (Expo Router routes)
    ├── src/features/
    ├── src/shared/
    └── components/
```

---

## Maintenance
- Update `roadmap.md` when architecture changes
- Update agent files when tech stack evolves (e.g., new Expo SDK, new AI provider)
- Update `steering.md` when product strategy shifts
- Update `PRICING_AND_UNIT_ECONOMICS.md` when pricing, quotas or payouts change
- Keep phase commands in sync with roadmap — they should mirror each other
- **When the code changes, the docs change with it.** A doc that describes a
  provider, database, price or endpoint the code no longer has is worse
  than no doc — it sends the next agent down the wrong path.
