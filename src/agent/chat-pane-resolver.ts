export interface ChatPaneResolver {
  resolvePaneId(
    agentSessionId: string,
    projectName: string,
    cwd?: string,
    paneId?: string
  ): string | undefined;

  resolveOrRegister(
    agentSessionId: string,
    projectName: string,
    cwd: string | undefined,
    paneId: string
  ): string;

  onStopHook(paneId: string, model?: string): void;
}
