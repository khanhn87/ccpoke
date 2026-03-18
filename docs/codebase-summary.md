# Codebase Summary

**ccpoke** is a TypeScript/Node.js notification bridge for AI coding agents. This document provides a high-level overview of the codebase structure, module responsibilities, and key architectural components.

- **Language:** TypeScript 5.7.3, targeting ES2022 with ESM modules
- **Runtime:** Node.js ≥20
- **Lines of Code:** ~7,897 LOC in src/ (56 TS files)
- **Architecture:** Multi-agent provider pattern with single-channel selection
- **Version:** 1.6.16

---

## Project Structure

```
ccpoke/
├── src/                        # Main application source (~7,897 LOC)
│   ├── index.ts               # Entry point, bot lifecycle orchestration (228 LOC)
│   ├── config-manager.ts      # Config persistence & schema migration (127 LOC)
│   ├── agent/                 # Multi-agent provider framework
│   ├── channel/               # Notification channels (Telegram, Discord, Slack — single active)
│   ├── server/                # Express API server
│   ├── tmux/                  # Terminal session management
│   ├── commands/              # CLI commands (setup, uninstall, update, help, project)
│   ├── i18n/                  # Internationalization (EN, VI, ZH)
│   └── utils/                 # Shared utilities
├── web/                        # Web dashboard (Astro-based)
├── dist/                       # Compiled JavaScript (generated)
├── docs/                       # Documentation
├── .husky/                     # Git hooks (pre-commit linting)
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── eslint.config.js           # ESLint + TypeScript config
└── .prettierrc                 # Code formatting rules
```

---

## Core Modules

### Agent Framework (`src/agent/`)

Implements the **Provider Pattern** for multi-agent support.

#### Key Files

| File | LOC | Responsibility |
|------|-----|-----------------|
| **types.ts** | 41 | Interface definitions: `AgentProvider`, `AgentEventResult`, `NotificationEvent` |
| **agent-registry.ts** | 30 | Registry pattern for discovering/loading agents |
| **agent-handler.ts** | 301 | Central hook event dispatcher (stop, session_start, notification, permission_request, ask_user_question hooks) |
| **chat-session-resolver.ts** | 5 | Bridges notifications to tmux session linking |

#### Agent Adapters

**Claude Code Adapter** (`claude-code/`)
- **claude-code-installer.ts** (443 LOC) — Manages hook scripts, `settings.json` configuration for 5+ hook types
- **claude-code-parser.ts** (163 LOC) — Parses NDJSON transcript files for event extraction
- **claude-code-provider.ts** (89 LOC) — Implements `AgentProvider` interface (settleDelayMs=500, submitKeys=["Enter"])

**Cursor Adapter** (`cursor/`)
- **cursor-installer.ts** (118 LOC) — Manages `hooks.json` configuration
- **cursor-parser.ts** (112 LOC) — Parses Cursor's transcript format with fallback resolution
- **cursor-provider.ts** (91 LOC) — Implements `AgentProvider` interface (settleDelayMs=0, submitKeys=["Enter"])
- **cursor-state-reader.ts** (69 LOC) — Reads SQLite DB for Cursor state

**Codex CLI Adapter** (`codex/`)
- **codex-installer.ts** (170 LOC) — TOML-based hook configuration for Codex
- **codex-parser.ts** (98 LOC) — Parses Codex notify events + rollout JSONL
- **codex-provider.ts** (98 LOC) — Implements `AgentProvider` interface (settleDelayMs=500, submitKeys=["Escape","Enter"])

**Gemini CLI Adapter** (`gemini-cli/`)
- **gemini-cli-installer.ts** — Manages hook configuration for Gemini CLI
- **gemini-cli-parser.ts** — Parses Gemini CLI transcript files for event extraction
- **gemini-cli-provider.ts** — Implements `AgentProvider` interface (settleDelayMs=0, submitKeys=["Enter"])
- **gemini-cli-settings.ts** — Gemini CLI settings and configuration

### Notification Channels (`src/channel/`)

Implements the **Adapter Pattern** for multi-channel support.

#### Telegram Callback Encoding (Pane-Centric)

Telegram inline button callbacks have a 64-byte limit. To preserve pane identity across Telegram interactions:

**buildTargetCallback(prefix: string, tmuxTarget: string, panePid: string):** `string`
- Encodes tmuxTarget + panePid into callback_data
- Format: `"{prefix}:{tmuxTarget}:{panePid}"` (e.g., `"chat:0:1:1234"`)
- Automatically truncates tmuxTarget if needed to fit 64-byte limit
- Preserves window:pane suffix (e.g., `:1.0`) to maintain unique identity

**parseTargetCallback(data: string, prefix: string):** `TargetCallback | null`
- Decodes callback_data back to `{ tmuxTarget, panePid }`
- Validates format and panePid is numeric
- Returns null if invalid format

**Example Flow:**
```typescript
// Encoding (when sending Chat button)
const panePid = queryPanePid("0:1") ?? "0";
const callback = buildTargetCallback("chat", "0:1", panePid);
// Result: "chat:0:1:1234" (max 64 bytes)

// Decoding (when user clicks button)
const parsed = parseTargetCallback(query.data, "chat");
if (parsed) {
  const { tmuxTarget, panePid } = parsed;
  const health = checkPaneHealth(tmuxTarget);
  // Safe to proceed if health.paneExists && health.agentRunning
}
```

#### Key Files

| File | LOC | Responsibility |
|------|-----|-----------------|
| **types.ts** | 25 | `NotificationChannel` interface, `NotificationData` (tmuxTarget, panePid fields) |
| **telegram/telegram-channel.ts** | 730 | Bot lifecycle, Telegram handlers, notification formatting, pane-centric session management |
| **telegram/telegram-sender.ts** | 97 | Message sending, pagination, Markdown escaping |
| **telegram/pending-reply-store.ts** | 56 | In-memory store for tracking pending replies (no TTL, evict at 200 entries, cleanup on reply/shutdown) |
| **telegram/session-list.ts** | 60 | `/sessions` command formatting with state emojis and Chat buttons (pane-centric with panePid callbacks) |
| **telegram/callback-parser.ts** | ~35 | `buildTargetCallback()`, `parseTargetCallback()` for encoding/decoding pane info in callbacks (max 64 bytes) |
| **telegram/prompt-handler.ts** | 163 | Forwards elicitation_dialog and idle_prompt events with force_reply (pane-centric callback encoding) |
| **telegram/permission-request-handler.ts** | 192 | Forward tool-use Allow/Deny decisions to Telegram inline keyboard (pane-centric) |
| **telegram/permission-tui-injector.ts** | - | Shared keystroke injection for permission dialogs (allow/deny + ExitPlanMode plan options) |
| **telegram/ask-question-handler.ts** | 377 | Forward AskUserQuestion to Telegram with multi-step inline keyboards (pane-centric) |
| **telegram/ask-question-keyboard-builder.ts** | - | Build dynamic inline keyboards for question responses |
| **telegram/ask-question-tui-injector.ts** | - | Inject keystroke answers into terminal UI |
| **telegram/project-list.ts** | - | Format /projects inline keyboard with project paths |
| **telegram/escape-markdown.ts** | - | MarkdownV2 escaping utilities |
| **slack/slack-channel.ts** | 47 | Slack WebClient lifecycle, initialize via auth.test(), sendNotification |
| **slack/slack-sender.ts** | 36 | Slack Web API wrapper; splits >50 Block Kit blocks into chunks |
| **slack/slack-block-builder.ts** | 70 | Builds `KnownBlock[]` from `NotificationData` (header, fields, summary, context, action button) |
| **discord/discord-channel.ts** | ~340 | Discord bot lifecycle, DM channel, interaction/message event routing (pane-centric) |
| **discord/discord-sender.ts** | ~40 | Sends embeds to Discord DM with error handling |
| **discord/discord-markdown.ts** | ~50 | NotificationData → Discord EmbedBuilder formatting |
| **discord/discord-permission-handler.ts** | ~180 | Allow/Deny button builder + interactionCreate handler |
| **discord/discord-ask-question-handler.ts** | ~330 | Single/multi-select buttons, "Other" free-text, 5-row cap |
| **discord/discord-prompt-handler.ts** | ~140 | Elicitation/idle prompt forwarding with DM reply capture |
| **discord/discord-session-command-handler.ts** | ~210 | /sessions, /projects slash commands + session list embed (pane-centric with panePid queries) |
| **discord/discord-agent-launcher.ts** | ~75 | Launch agent sessions from Discord project selection |

### Terminal Session Management (`src/tmux/`)

Implements the **Bridge Pattern** for tmux operations with **pane-centric design**.

#### Pane-Centric Architecture

**Core Interface (PaneMetadata):**
```typescript
interface PaneMetadata {
  tmuxTarget: string;          // Key: tmux target (e.g., "0:1", "0:2.1")
  project: string;             // Project name
  cwd: string;                 // Working directory
  label: string;               // Display label
  state: SessionState;         // idle | busy | blocked | unknown | launching
  model: string;               // LLM model
  agent: AgentName;            // Agent type
  lastActivity: Date;          // Last activity timestamp
}

// Backward compatibility alias
type TmuxSession = PaneMetadata;
```

**Session Key Change:**
- **SessionMap** keyed by `tmuxTarget` (not UUID-based sessionId)
- Benefits: Stable identity across restarts, no UUID generation, direct tmux target mapping

#### Pane Utilities

**queryPanePid(target: string):** `string | undefined`
- Queries current PID running in a specific pane
- Returns decimal string (e.g., "1234") or undefined if pane absent

**checkPaneHealth(target: string, tree?: ProcessTree):** `PaneHealth`
- Validates pane exists and agent process is active
- Returns: `{ paneExists: boolean, agentRunning: boolean, processName?: string }`
- Used by all callback handlers to prevent stale pane operations

**Example Usage:**
```typescript
const pid = queryPanePid("0:1");
const health = checkPaneHealth("0:1");
if (health.agentRunning) {
  // Safe to inject keys, update state
}
```

#### Key Files

| File | LOC | Responsibility |
|------|-----|-----------------|
| **tmux-bridge.ts** | 89 | Low-level tmux CLI wrapper (send-keys, capture-pane, create-window, kill-pane) |
| **tmux-scanner.ts** | 264 | Multi-agent pane detection, process tree search, session discovery, `queryPanePid()`, `checkPaneHealth()` utilities |
| **session-map.ts** | 160 | Pane-centric session registry (keyed by tmuxTarget), `PaneMetadata` interface, state tracking (idle/busy/blocked/unknown/launching), LRU eviction |
| **session-state.ts** | 114 | Message queue, keystroke injection, state machine, agent-specific submitKeys |
| **tmux-session-resolver.ts** | 67 | Implements `ChatSessionResolver` interface, links notifications to tmux targets via `resolveTmuxTarget()` |

### API Server (`src/server/`)

Express-based HTTP server for receiving webhooks.

| File | LOC | Responsibility |
|------|-----|-----------------|
| **api-server.ts** | 101 | Express setup, webhook routes (/hook/stop, /hook/notification), CORS, rate limiting |

### Configuration (`src/config-manager.ts`)

Handles config persistence and schema migrations.

| Responsibility |
|---|
| Read/write `~/.ccpoke/config.json` |
| Schema validation using TypeScript interfaces |
| Auto-migration when structure changes |
| Defaults for missing values |

### CLI Commands (`src/commands/`)

| Command | File | LOC | Purpose |
|---------|------|-----|---------|
| `setup` | setup.ts | 266 | Interactive configuration wizard |
| `update` | update.ts | 159 | Check for npm updates |
| `uninstall` | uninstall.ts | 51 | Remove hooks, config, state |
| `project` | project.ts | 175 | Manage project paths and launch settings |
| `help` | help.ts | 24 | Display help information |

### Internationalization (`src/i18n/`)

3 supported locales with parameter substitution.

| File | LOC | Purpose |
|------|-----|---------|
| **locales/en.ts** | - | English strings |
| **locales/vi.ts** | - | Vietnamese strings |
| **locales/zh.ts** | - | Chinese (Simplified) strings |
| **index.ts** | - | i18n loader and selection logic |

### Utilities (`src/utils/`)

| File | LOC | Purpose |
|------|-----|---------|
| **constants.ts** | - | Global constants (ports, defaults, limits) |
| **paths.ts** | - | File paths (~/.ccpoke, ~/.claude, ~/.cursor, codex paths) |
| **git-collector.ts** | - | Git diff extraction and formatting |
| **markdown.ts** | - | Markdown to Telegram MarkdownV2 conversion |
| **response-store.ts** | - | Stores responses by session ID (24h TTL, max 100) |
| **stats-format.ts** | - | Formats execution stats (duration, tokens) |
| **tunnel.ts** | - | Tunnel manager (retry logic, auto-restart on process exit) |
| **tunnel-types.ts** | - | `TunnelType`, `TunnelProvider` interface, retry constants |
| **tunnel-provider-factory.ts** | - | Factory for creating tunnel provider instances |
| **tunnel-providers/cloudflare-tunnel-provider.ts** | - | Cloudflare Tunnel implementation |
| **tunnel-providers/ngrok-tunnel-provider.ts** | - | ngrok Tunnel implementation (requires authtoken) |
| **tunnel-providers/custom-url-tunnel-provider.ts** | - | Custom HTTPS URL provider (passthrough) |
| **version-check.ts** | - | npm version checking |
| **install-detection.ts** | - | Detects installed agents (Claude Code, Cursor, Codex) |
| **shell-completion.ts** | - | zsh/bash tab completion generation |
| **path-prompt.ts** | - | Interactive path input with tab completion |
| **log.ts** | 64 | Pino v10 logger wrapper (async file + pretty console, rotates at 2MB) |

### Entry Point (`src/index.ts`)

**228 LOC** — Orchestrates the complete bot lifecycle:

1. Load configuration
2. Initialize logging
3. Register agents (including Codex)
4. Ensure hooks installed for all agents
5. Create Telegram bot
6. Start Express server
7. Start session scanner
8. Install shell completion
9. Ensure tunnel auto-restart
10. Handle graceful shutdown

---

## Architecture Patterns

### 1. Provider Pattern

**Purpose:** Abstract agent implementations behind a common interface.

```typescript
interface AgentProvider {
  name: string;
  displayName: string;
  settleDelayMs: number;
  submitKeys: string[];
  detect(): Promise<boolean>;
  installHook(config: HookConfig): Promise<void>;
  parseEvent(raw: unknown): AgentEventResult;
  synchronous(): boolean;
}
```

**Agent Support Matrix:**

| Agent | Display Name | settleDelayMs | submitKeys |
|---|---|---|---|
| claude-code | Claude Code | 500 | ["Enter"] |
| cursor | Cursor CLI | 0 | ["Enter"] |
| codex | Codex CLI | 500 | ["Escape", "Enter"] |
| gemini-cli | Gemini CLI | 0 | ["Enter"] |

**Benefits:**
- Easy to add new agents (implement interface)
- Core logic doesn't depend on specific agent
- Pluggable architecture

### 2. Adapter Pattern

**Purpose:** Abstract notification channels behind a common interface.

```typescript
interface NotificationChannel {
  initialize(config: Config): Promise<void>;
  shutdown(): Promise<void>;
  sendNotification(event: AgentEvent): Promise<void>;
}
```

**Benefits:**
- Easy to add new channels (Slack, Discord, etc.)
- Core logic channels-agnostic

### 3. Bridge Pattern

**Purpose:** Separate tmux CLI operations from high-level session logic.

- **tmux-bridge.ts** — Low-level CLI wrappers
- **tmux-scanner.ts** — Discovers and tracks panes
- **session-map.ts** — High-level session registry
- **session-state.ts** — State machine for messages

### 4. Observer Pattern

**Purpose:** Session changes trigger notifications and updates.

- SessionMap emits "session_started", "session_idle", "session_ended"
- TelegramChannel subscribes to session events
- Periodic scanner maintains live state

### 5. State Machine

**Purpose:** Pane lifecycle management.

```
idle → blocked → busy → idle
  └─────→ busy ────→ idle
launching → idle
  └─────→ unknown
```

- **idle** — No activity, ready to accept messages
- **busy** — Agent processing, queue messages
- **blocked** — Waiting for user input (elicitation or permission request hook)
- **launching** — Agent session starting up
- **unknown** — Unable to determine state

### 6. Store Pattern (Pane-Centric)

**Purpose:** Centralized state management with persistence.

- **ConfigManager** — Persistent config store
- **SessionMap** — Persistent pane-centric session registry (keyed by tmuxTarget)
- **ResponseStore** — Response by tmuxTarget
- **PendingReplyStore** — In-memory reply tracking

---

## Data Flow

### Notification Flow (Stop Hook, Pane-Centric)

```
1. Claude Code completes response
2. Stop hook trigger (~/.ccpoke/hooks/stop-notify.sh)
3. curl POST http://127.0.0.1:9377/hook/stop
   - Include: transcript path, secret
   - Validate: hook secret
4. AgentHandler parses event (handleStopEvent)
   - Load transcript (NDJSON)
   - Extract last response
   - Collect git changes
   - Resolve tmuxTarget via resolveTmuxTarget()
   - Query panePid via queryPanePid(tmuxTarget)
5. SessionResolver links to pane (by tmuxTarget)
6. Store response (ResponseStore, keyed by tmuxTarget)
7. TelegramChannel formats & sends
   - Markdown conversion
   - Pagination if needed
   - Add git diff summary
   - Encode callback: buildTargetCallback("chat", tmuxTarget, panePid)
```

### Elicitation Dialog Flow

```
1. Claude Code needs user input (confirmation prompt)
2. Notification hook: POST /hook/notification
   - notification_type: elicitation_dialog
   - message: the prompt
   - tmuxTarget: pane target (replaces session_id)
   - title: optional
3. AgentHandler.handleNotification():
   - Resolve tmuxTarget (pane-centric)
   - Query panePid via queryPanePid(tmuxTarget)
   - Update state → blocked
4. PromptHandler forwards to Telegram
   - Encode callback: buildTargetCallback("elicit", tmuxTarget, panePid)
   - force_reply + selective markup
   - User types response
5. Message reply detection
6. parseTargetCallback("elicit") → {tmuxTarget, panePid}
7. checkPaneHealth(tmuxTarget) validates pane is live
8. PromptHandler.injectElicitationResponse()
   - Send response via tmux send-keys
   - Update state → busy
```

### Two-Way Chat Flow (Pane-Centric)

```
1. User sends message in Telegram
2. TelegramChannel receives update
3. Parse callback via parseTargetCallback() → {tmuxTarget, panePid}
4. Check pane health via checkPaneHealth(tmuxTarget)
5. Resolve target pane (SessionResolver, by tmuxTarget)
6. Inject message via tmux send-keys
7. Poll JSONL transcript for response
8. Send response back to Telegram
```

### Session Lifecycle (Pane-Centric)

```
1. SessionStart hook triggers (provides tmuxTarget)
2. Register in SessionMap by tmuxTarget
3. Periodic 30s scanner sync
   - List live panes
   - Query panePid for each via queryPanePid()
   - Check health via checkPaneHealth()
   - Detect new panes and auto-register
   - Update last_activity
4. Stale sessions (30min idle) pruned
5. Persist to ~/.ccpoke/sessions.json
6. Bot restart loads from persistence
   - Validate tmuxTarget field present
   - Reconcile with live tmux state
   - Query current paneIds
```

---

## External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **express** | ^5 | HTTP server |
| **node-telegram-bot-api** | ^0.63 | Telegram Bot API client |
| **@slack/web-api** | ^7 | Slack Web API client (Block Kit messaging) |
| **better-sqlite3** | ^9 | SQLite driver (Cursor state) |
| **cloudflared** | Latest | Cloudflare tunnel binary |
| **@clack/prompts** | ^0.7 | CLI prompt library |
| **qrcode-terminal** | ^0.12 | QR code display |

Dev dependencies: TypeScript, ESLint, Prettier, tsup, tsx

---

## Configuration & Build

### TypeScript Config

- **Target:** ES2022
- **Module:** ESNext with `verbatimModuleSyntax`
- **Strict Mode:** Enabled
- **Lib:** ES2022

### ESLint Config

- **Flat Config** — Modern ESLint setup
- **Plugins:** typescript-eslint, import sorting
- **Rules:** Enforce const, no any, proper error handling

### Prettier Config

- **Print Width:** 100
- **Indent:** 2 spaces
- **Quotes:** Double
- **Trailing Commas:** ES5
- **Line Ending:** LF

### Build Process

```bash
pnpm build        # Compile TypeScript → dist/
pnpm dev          # Dev mode (tsx)
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier
pnpm start        # Run compiled bot
npx -y ccpoke     # Zero-install via npm
```

---

## File Size Guidelines

**Design Principle:** Keep files under 200 LOC for maintainability.

- **agent-handler.ts:** 80 LOC ✅
- **tmux-bridge.ts:** 89 LOC ✅
- **telegram-sender.ts:** 97 LOC ✅
- **api-server.ts:** 101 LOC ✅
- **session-map.ts:** 160 LOC ✅
- **claude-code-installer.ts:** 171 LOC ✅
- **index.ts:** 177 LOC ✅ (borderline, core orchestration)
- **telegram-channel.ts:** 239 LOC ⚠️ (largest, combines multiple responsibilities)

The largest file (telegram-channel.ts) could be split into:
- `telegram-handlers.ts` — Message handlers
- `telegram-formatter.ts` — Notification formatting
- `telegram-bot.ts` — Bot lifecycle

---

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **Files** | kebab-case | `agent-handler.ts`, `tmux-bridge.ts` |
| **Classes** | PascalCase | `TelegramChannel`, `SessionMap` |
| **Functions** | camelCase | `parseEvent()`, `sendNotification()` |
| **Constants** | UPPER_SNAKE_CASE | `DEFAULT_PORT`, `HOOK_SECRET_HEADER` |
| **Types/Interfaces** | PascalCase | `AgentProvider`, `NotificationChannel` |
| **Private members** | `_prefix` | `_config`, `_logger` |

---

## Error Handling

**Principles:**
- Try-catch for async operations
- Typed errors (not bare strings)
- Log context (operation, input, error details)
- Graceful degradation where possible
- Never crash the bot for single-operation failures

**Pattern:**
```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', { error, context: {...} });
  // Handle gracefully or rethrow
}
```

---

## Testing Strategy

Currently minimal test coverage. Recommended additions:

1. **Unit tests** — Agent parsers, formatters, utilities
2. **Integration tests** — Hook → notification flow
3. **E2E tests** — Full bot lifecycle with mock Telegram API

Run tests:
```bash
pnpm test
```

---

## Related Documentation

- **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, goals, features
- **[Code Standards](./code-standards.md)** — Implementation guidelines
- **[System Architecture](./system-architecture.md)** — Component interactions, data flows
- **[CLI Commands](./commands.md)** — Command reference
- **[Deployment Guide](./deployment-guide.md)** — Deployment and release instructions
