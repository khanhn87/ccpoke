import type {
  AskUserQuestionEvent,
  NotificationEvent,
  PermissionRequestEvent,
} from "../agent/agent-handler.js";
import type { AgentRegistry } from "../agent/agent-registry.js";
import type { PaneRegistry } from "../tmux/pane-registry.js";
import type { PaneStateManager } from "../tmux/pane-state-manager.js";
import type { TmuxBridge } from "../tmux/tmux-bridge.js";
import type { GitChangeStatus } from "../utils/constants.js";

export interface ChannelDeps {
  paneRegistry?: PaneRegistry;
  paneStateManager?: PaneStateManager;
  tmuxBridge?: TmuxBridge;
  registry?: AgentRegistry;
}

export interface NotificationChannel {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  sendNotification(data: NotificationData, responseUrl?: string): Promise<void>;
  handleNotificationEvent(event: NotificationEvent): void;
  handleAskUserQuestionEvent(event: AskUserQuestionEvent): void;
  handlePermissionRequestEvent(event: PermissionRequestEvent): void;
}

export interface NotificationData {
  agent: string;
  agentDisplayName: string;
  projectName: string;
  responseSummary: string;
  gitChanges: GitChange[];
  model: string;
  paneId?: string;
  panePid?: string;
}

export interface GitChange {
  file: string;
  status: GitChangeStatus;
}
