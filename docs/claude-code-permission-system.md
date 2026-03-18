# Claude Code Permission System Reference

> Research date: 2026-03-13 | Claude Code v2.1.74 | Source: official docs + TUI observation
> Update this doc when Claude Code updates TUI behavior or hook schemas.

## Overview

Claude Code has two distinct mechanisms for user interaction during agentic execution:

1. **Permission Requests** — Tool execution approval (PermissionRequest hook event)
2. **AskUserQuestion** — Multi-question surveys/elicitations (PreToolUse hook event for AskUserQuestion tool)

Both fire as hook events. ccpoke intercepts both and forwards them to Telegram/Discord.

---

## Hook Events

### PermissionRequest

Fires when Claude Code needs permission to execute a tool. Matcher filters on `tool_name`.

**Input fields (stdin JSON):**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Session identifier |
| `transcript_path` | string | Path to conversation JSONL |
| `cwd` | string | Current working directory |
| `permission_mode` | string | `"default"`, `"plan"`, `"acceptEdits"`, `"dontAsk"`, `"bypassPermissions"` |
| `hook_event_name` | string | Always `"PermissionRequest"` |
| `tool_name` | string | Tool requesting permission |
| `tool_input` | object | Tool-specific parameters |
| `agent_id` | string? | Present in subagent context |
| `agent_type` | string? | Present in subagent/`--agent` context |

**Decision control (stdout JSON):**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "permissionDecision": "allow" | "deny",
    "permissionDecisionReason": "optional explanation"
  }
}
```

Only two values: `allow` or `deny`. Exit code 0 = process JSON. Exit code 2 = deny (stderr shown).

### PreToolUse (for AskUserQuestion)

Fires before `AskUserQuestion` tool executes.

**Input fields (stdin JSON):**

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | string | `"AskUserQuestion"` |
| `tool_input.questions` | array | Array of question objects |
| `tool_input.questions[].question` | string | Question text |
| `tool_input.questions[].header` | string | Short label (max 12 chars) |
| `tool_input.questions[].options` | array | 2-4 options with label + description |
| `tool_input.questions[].multiSelect` | boolean | Single or multi-select |

---

## Tool Names That Trigger PermissionRequest

| Tool | `tool_input` key fields | Summary source |
|------|------------------------|----------------|
| `Bash` | `command`, `description` | command (120 chars) |
| `Edit` | `file_path`, `old_string`, `new_string` | file_path |
| `Write` | `file_path`, `content` | file_path |
| `Read` | `file_path` | file_path |
| `Glob` | `pattern`, `path` | pattern or path |
| `Grep` | `pattern`, `path` | pattern |
| `Agent` | `description`, `prompt` | description (80 chars) |
| `WebFetch` | `url` | url |
| `WebSearch` | `query` | query |
| `ExitPlanMode` | `allowedPrompts` | tool name |
| `EnterPlanMode` | (empty) | tool name |
| `NotebookEdit` | `notebook_path`, `new_source` | notebook_path |
| `mcp__*` | varies | tool name |

---

## TUI Permission Dialog Types

Claude Code's terminal UI renders different permission dialogs depending on the tool.

### Type 1: Simple Allow/Deny

Used for most tools (Bash, Edit, Write, Read, Glob, Grep, Agent, WebFetch, WebSearch, mcp__*, EnterPlanMode, NotebookEdit).

```
Allow Bash: npm test?
  (y)es  (n)o
```

- Navigation: `y` to allow, `n` to deny
- TUI injection: send `y` or `n` + `Enter`

**ccpoke source:** `src/channel/permission-tui-injector.ts` L26-38

```typescript
export class PermissionTuiInjector {
  async inject(tmuxTarget: string, result: PermissionInjectionResult): Promise<void> {
    const ready = await this.tmuxBridge.waitForTuiReady(tmuxTarget, 5000);
    if (!ready) throw new Error("TUI not ready");
    if (result.action === "plan-option") {
      await this.injectOptionSelect(tmuxTarget, result.optionIndex ?? 0);
    } else {
      this.tmuxBridge.sendKeys(tmuxTarget, result.action === "allow" ? "y" : "n", ["Enter"]);
    }
  }
}
```

**Telegram keyboard (standard tools):** `src/channel/telegram/permission-request-handler.ts` L98-108

```typescript
inline_keyboard: [
  [
    { text: `✅ Allow`, callback_data: `perm:a:${pendingId}` },
    { text: `❌ Deny`, callback_data: `perm:d:${pendingId}` },
  ],
]
```

**Telegram keyboard (ExitPlanMode):** `src/channel/telegram/permission-request-handler.ts` L74-95

```typescript
inline_keyboard: [
  [{ text: `🔄 Clear context & bypass`, callback_data: `perm:e0:${pendingId}` }],
  [{ text: `⚡ Bypass permissions`, callback_data: `perm:e1:${pendingId}` }],
  [{ text: `✋ Manually approve`, callback_data: `perm:e2:${pendingId}` }],
]
```

- Callback format: `perm:e0:`, `perm:e1:`, `perm:e2:` for plan options 1-3
- Standard tools: `perm:a:` (allow), `perm:d:` (deny)

### Type 2: Tabbed Permission Dialog (ExitPlanMode)

Used for `ExitPlanMode`. Claude Code shows a numbered option list, NOT a y/n prompt.

```
Claude has written up a plan and is ready to execute. Would you like to proceed?

❯ 1. Yes, clear context (29% used) and bypass permissions
  2. Yes, and bypass permissions
  3. Yes, manually approve edits
  4. Type here to tell Claude what to change
```

**ExitPlanMode options (observed v2.1.74):**

| # | Option | Behavior |
|---|--------|----------|
| 1 | "Yes, clear context (X% used) and bypass permissions" | Approve plan, clear context, switch to bypass mode |
| 2 | "Yes, and bypass permissions" | Approve plan, keep context, switch to bypass mode |
| 3 | "Yes, manually approve edits" | Approve plan, keep normal permission mode (acceptEdits) |
| 4 | "Type here to tell Claude what to change" | Reject/revise plan with text input |

- Navigation: `Up`/`Down` arrows to move cursor, `Enter` to confirm
- Option 1 is default selected (cursor on it)
- Option 4 opens a text input field after selection

**ccpoke implementation:** Sends Down arrows to navigate to selected option, then Enter to confirm. Maps Telegram buttons (perm:e0:/e1:/e2:) to options 1-3 via `PermissionTuiInjector`.

**Files:** `src/channel/permission-tui-injector.ts` — TUI keystroke injection (shared for all permission types)

### Type 3: AskUserQuestion (Single-Select)

Used when Claude calls `AskUserQuestion` with `multiSelect: false`.

```
┌──────────────────────────────────────┐
│  Which library should we use?        │
│                                      │
│  ❯ React (Recommended)               │
│    Vue                               │
│    Svelte                            │
│    Other                             │
└──────────────────────────────────────┘
```

- Navigation: `Down`/`Up` arrows, `Enter` to select
- Cursor starts at option 0 (first)

**ccpoke source:** `src/channel/telegram/ask-question-tui-injector.ts` L16-30

```typescript
async injectSingleSelect(target, _q, answer, agent): Promise<void> {
  if (answer.indices.length > 0) {
    const targetIdx = answer.indices[0]!;
    for (let i = 0; i < targetIdx; i++) {
      await this.delayedKey(target, "Down");  // Move to target option
    }
    await this.delayedKey(target, "Enter");   // Select
  }
}
```

**Telegram keyboard:** `src/channel/telegram/ask-question-handler.ts` L151-153

```typescript
const keyboard = q.multiSelect
  ? buildMultiSelectKeyboard(pq.pendingId, qIdx, q, new Set())
  : buildSingleSelectKeyboard(pq.pendingId, qIdx, q);
```

Callback format: `aq:{pendingId}:{qIdx}:{optIdx}` (e.g., `aq:5:0:1`)

### Type 4: AskUserQuestion (Multi-Select)

Used when Claude calls `AskUserQuestion` with `multiSelect: true`.

```
┌──────────────────────────────────────┐
│  Select features                     │
│                                      │
│  ☐ Testing                           │
│  ☐ Linting                           │
│  ☐ Debugging                         │
│                                      │
│  [Confirm]                           │
└──────────────────────────────────────┘
```

- Navigation: `Down`/`Up` to move, `Space` to toggle checkbox, move to Confirm + `Enter`
- OpenCode agent uses `Enter` to toggle and `Right` to confirm

**ccpoke source:** `src/channel/telegram/ask-question-tui-injector.ts` L32-67

```typescript
async injectMultiSelect(target, q, answer, agent): Promise<void> {
  const isOpenCode = agent === AgentName.OpenCode;
  const toggleKey = isOpenCode ? "Enter" : "Space";
  // ...navigate Down to each option, toggle with Space/Enter...
  if (isOpenCode) {
    await this.delayedKey(target, "Right");   // OpenCode: Right to Confirm
  } else {
    // Claude Code: navigate Down past all options to Confirm button
    await this.delayedKey(target, "Enter");
  }
}
```

Callback format: `am:{pendingId}:{qIdx}:{optIdx}` for toggle, `am:{pendingId}:{qIdx}:c` for confirm

---

## Injection Shared Infrastructure

### TmuxBridge

**File:** `src/tmux/tmux-bridge.ts`

| Method | Line | Description |
|--------|------|-------------|
| `sendKeys(target, text, submitKeys)` | L49-68 | Send literal text + special keys (used for `y`/`n` + Enter) |
| `sendSpecialKey(target, key)` | L83-93 | Send single special key: Down/Up/Space/Enter/Right/Left/Escape |
| `capturePane(target, lines)` | L95-103 | Read current pane content (for TUI readiness check) |
| `waitForTuiReady(target, timeoutMs)` | L105-130 | Poll pane for TUI indicators, 150ms interval |

**TUI readiness indicators** (L106):

```typescript
const TUI_INDICATORS = [/❯/, /\[ \]/, /\( \)/, /\(●\)/, /\[✓\]/, />/];
```

### Timing Constants

| Constant | Value | File:Line | Purpose |
|----------|-------|-----------|---------|
| `KEY_DELAY_MS` | 80ms | `ask-question-tui-injector.ts` L10 | Delay between arrow keys |
| `SPACE_SETTLE_MS` | 100ms | `ask-question-tui-injector.ts` L11 | Wait after Space toggle |
| `busyWaitMs` | 100ms | `tmux-bridge.ts` L60 | Wait after text before submit keys |
| `POLL_INTERVAL` | 150ms | `tmux-bridge.ts` L107 | TUI readiness poll interval |
| TUI timeout | 5000ms | `tmux-bridge.ts` L105 | Max wait for TUI ready |
| Advance delay | 500ms | `ask-question-handler.ts` L318 | Wait before next question |
| `EXPIRE_MS` | 600000ms | both handlers L20/L27 | 10 min pending request expiry |
| `MAX_PENDING` | 50 | both handlers L21/L28 | Max concurrent pending requests |

---

## Data Flow & Source Map

### Permission Request Flow

```
Hook fires (PermissionRequest event)
  ↓
hooks/claude-code-permission-request.sh
  - Extract: session_id, tool_name
  - Filter: skip AskUserQuestion (tool_name check)
  - Inject: tmux_target from detected tmux pane
  - POST /hook/permission-request with X-CCPoke-Secret
  ↓
src/server/api-server.ts → POST /hook/permission-request
  - Validate X-CCPoke-Secret header
  ↓
src/agent/agent-handler.ts L157-181 → handlePermissionRequest()
  - parsePermissionRequestEvent() [L296-319]
  - Validate tmuxTarget regex [L10-14]
  - Resolve sessionId via chatResolver
  - Emit to onPermissionRequest callback
  ↓
src/channel/telegram/permission-request-handler.ts
  - forwardPermission() [L36-78] → Store pending, send Telegram message
  - handleCallback() [L80-132] → Parse perm:a/d:id, inject response
  - injectResponse() [L141-145] → ⚠️ ONLY sends y/n + Enter
  ↓
src/tmux/tmux-bridge.ts
  - sendKeys() [L49-68] → tmux send-keys -t {target} -l "y" + Enter
```

### AskUserQuestion Flow

```
Hook fires (PreToolUse event, tool_name=AskUserQuestion)
  ↓
hooks/claude-code-pretooluse.sh
  - Extract: session_id, tool_name, questions
  - Filter: only AskUserQuestion
  - POST /hook/ask-user-question with X-CCPoke-Secret
  ↓
src/agent/agent-handler.ts L129-155 → handleAskUserQuestion()
  - parseAskUserQuestionEvent() [L225-270]
  ↓
src/channel/telegram/ask-question-handler.ts
  - forwardQuestion() [L47-80] → Store pending, send first question
  - sendQuestion() [L140-163] → Format with options, build keyboard
  - handleSingleSelectCallback() [L165-202] → Parse aq:id:q:opt
  - handleMultiSelectCallback() [L204-250] → Parse am:id:q:opt/c
  - injectAnswer() [L284-310] → Delegate to TUI injector
  - advanceToNext() [L312-333] → Next question or submit
  ↓
src/channel/telegram/ask-question-tui-injector.ts
  - injectSingleSelect() [L16-30] → Down arrows + Enter
  - injectMultiSelect() [L32-67] → Down + Space/Enter toggle + Confirm
  ↓
src/tmux/tmux-bridge.ts
  - sendSpecialKey() [L83-93] → tmux send-keys -t {target} Down/Enter/Space
```

---

## Permission Modes

| Mode | Value | Description |
|------|-------|-------------|
| Default | `"default"` | Normal permission prompts for each tool |
| Plan | `"plan"` | Requires plan approval before edits (ExitPlanMode) |
| Accept Edits | `"acceptEdits"` | Auto-approve file edits, prompt for Bash/dangerous |
| Don't Ask | `"dontAsk"` | Auto-approve most tools |
| Bypass | `"bypassPermissions"` | No permission prompts at all |

Toggle in TUI: `Shift+Tab` or `Alt+M`.

**ccpoke source:** `src/agent/agent-handler.ts` L315 — parsed but currently unused in handlers.

---

## Current ccpoke Gap Analysis

| Tool | TUI type | Telegram now | Injection now | Correct injection |
|------|----------|-------------|---------------|-------------------|
| Bash, Edit, Write, etc. | Simple y/n | ✅ Allow / ❌ Deny | `y`/`n` + Enter | ✅ Correct |
| ExitPlanMode | Numbered list (3 options) | ✅ e0/e1/e2 buttons | Down arrows + Enter | ✅ Correct |
| AskUserQuestion single | Option list | Numbered buttons | Down + Enter | ✅ Correct |
| AskUserQuestion multi | Checkbox list | Toggle + Confirm | Space + Down + Enter | ✅ Correct |

---

## References

- [Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks) — Official hook events, input/output schemas
- [Interactive Mode](https://docs.anthropic.com/en/docs/claude-code/interactive-mode) — Keyboard shortcuts, dialog navigation
- [CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference) — `--permission-prompt-tool` flag for SDK
