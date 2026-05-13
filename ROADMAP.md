# TrustClaw Agent Architecture Roadmap

## Agent Anatomy Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AGENT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  PERCEPTION  │───▶│   PLANNING   │───▶│    EXECUTION LOOP    │  │
│  │              │    │              │    │                      │  │
│  │ - Text       │    │ - Goal       │    │ - Step limits        │  │
│  │ - Structured │    │   decomp     │    │ - Context pruning    │  │
│  │ - Multimedia │    │ - Strategy   │    │ - Error recovery     │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                   │                       │               │
│         ▼                   ▼                       ▼               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                          BRAIN (LLM)                         │  │
│  │                                                              │  │
│  │  OpenRouter → Claude | GPT | Gemini | Llama | Mistral | etc  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│         │                                           │               │
│         ▼                                           ▼               │
│  ┌──────────────┐                          ┌──────────────────┐    │
│  │    TOOLS     │                          │      MEMORY      │    │
│  │              │                          │                  │    │
│  │ - Read       │                          │ - Short-term     │    │
│  │ - Write      │                          │ - Long-term      │    │
│  │ - Communicate│                          │ - Episodic       │    │
│  │ - Compute    │                          │ - Semantic       │    │
│  └──────────────┘                          └──────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Current State

| Component | Status | Implementation |
|-----------|--------|----------------|
| Perception | Partial | Web chat, Telegram, Cron triggers |
| Planning | Implicit | System prompt guidance only |
| Brain | Limited | Claude only (hardcoded Anthropic) |
| Tools | Good | Composio SDK (500+ integrations) |
| Memory | Good | pgvector + compaction summaries |
| Execution Loop | Good | 100 step limit, context pruning |
| Multi-Agent | None | Single agent per user (`@unique` constraint) |
| UI | Overly Complex | Needs simplification |

---

## Roadmap

### Phase 1: Foundation Refactoring
> Goal: Enable multi-agent support and simplify the system

- [ ] **Multi-Agent Support**
  - [ ] Remove `@unique` constraint on `userId` in `ComposioClawInstance`
  - [ ] Add agent selection/creation UI
  - [ ] Agent-specific context isolation (already scoped by instanceId)

- [ ] **UI Simplification**
  - [ ] Strip unnecessary UI components
  - [ ] Focus on core agent interaction
  - [ ] Minimal, functional interface

---

### Phase 2: Brain Flexibility
> Goal: Use any LLM via OpenRouter

- [ ] **OpenRouter Integration**
  - [ ] Replace Anthropic SDK with OpenRouter
  - [ ] Model selection per agent
  - [ ] Support for: Claude, GPT-4/5, Gemini, Llama, Mistral, etc.
  - [ ] Cost tracking per model

- [ ] **Agent Configuration**
  - [ ] `model` field in `ComposioClawInstance`
  - [ ] Model-specific parameter tuning (temperature, max_tokens, etc.)

---

### Phase 3: Expanded Perception
> Goal: Meet users where they are

- [ ] **Slack Integration**
  - [ ] Slack bot setup
  - [ ] Channel/DM message handling
  - [ ] Thread context preservation

- [ ] **Email Integration**
  - [ ] Inbound email parsing (webhook or polling)
  - [ ] Reply threading
  - [ ] Attachment handling

- [ ] **Phone/SMS Integration**
  - [ ] Twilio or similar provider
  - [ ] Voice transcription (Whisper)
  - [ ] SMS two-way messaging

---

### Phase 4: Enhanced Tools
> Goal: Give agents compute capabilities

- [ ] **Computer Use**
  - [ ] Sandboxed code execution environment
  - [ ] Browser automation (Playwright/Puppeteer)
  - [ ] File system access (scoped)
  - [ ] Screenshot/visual feedback loop

- [ ] **Tool Categories**
  - [ ] READ: Memory search, web browse, file read, API fetch
  - [ ] WRITE: Memory save, file write, database operations
  - [ ] COMMUNICATE: Email, Slack, SMS, webhooks
  - [ ] COMPUTE: Code execution, data processing, browser automation

---

### Phase 5: Pluggable Memory
> Goal: Swap memory backends based on use case

- [ ] **Memory Provider Interface**
  ```typescript
  interface MemoryProvider {
    save(content: string, metadata: object): Promise<string>
    search(query: string, limit: number): Promise<Memory[]>
    delete(id: string): Promise<void>
  }
  ```

- [ ] **Supported Providers**
  - [ ] Built-in (pgvector) - current implementation
  - [ ] [SuperMemory](https://supermemory.ai) - AI-native memory
  - [ ] [Memo](https://memo.ai) - knowledge management
  - [ ] [Mem0](https://mem0.ai) - memory layer for AI
  - [ ] Custom provider support

- [ ] **Memory Configuration**
  - [ ] Per-agent memory provider selection
  - [ ] Memory type configuration (short/long/episodic/semantic)
  - [ ] Retention policies

---

### Phase 6: Advanced Planning
> Goal: Explicit planning and reasoning

- [ ] **Planning Module**
  - [ ] Task decomposition
  - [ ] Strategy selection
  - [ ] Progress tracking
  - [ ] Replanning on failure

- [ ] **Reasoning Transparency**
  - [ ] Thought traces
  - [ ] Decision logging
  - [ ] Confidence scoring

---

## Technical Debt

- [ ] Remove Composio branding/naming from core types
- [ ] Standardize error handling across tools
- [ ] Add comprehensive logging/observability
- [ ] Write tests for core agent loop
- [ ] Document API endpoints

---

## Notes

### Perception Input Sources
| Source | Priority | Complexity | Notes |
|--------|----------|------------|-------|
| Web Chat | Current | Low | Already implemented |
| Telegram | Current | Low | Already implemented |
| Slack | High | Medium | Many enterprise users |
| Email | High | Medium | Universal, async |
| Phone/SMS | Medium | High | Requires Twilio setup |

### Memory Provider Comparison
| Provider | Strengths | Considerations |
|----------|-----------|----------------|
| pgvector | Self-hosted, integrated | Manual embedding management |
| SuperMemory | AI-native, automatic | External dependency |
| Memo | Rich knowledge graph | Pricing at scale |
| Mem0 | Purpose-built for AI | Newer, less battle-tested |

---

*Last updated: 2025-05-13*
