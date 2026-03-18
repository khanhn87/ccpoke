export function summarizeTool(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return typeof input.command === "string" ? truncate(input.command, 120) : toolName;
    case "Edit":
    case "Write":
    case "Read":
    case "Glob":
    case "Grep":
      return typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : typeof input.pattern === "string"
            ? input.pattern
            : toolName;
    case "Agent":
      return typeof input.description === "string" ? truncate(input.description, 80) : toolName;
    case "ExitPlanMode": {
      const prompts = input.allowedPrompts;
      if (Array.isArray(prompts) && prompts.length > 0) {
        return prompts
          .map((p) => {
            const obj = p as Record<string, string>;
            return `${obj.tool}: ${obj.prompt}`;
          })
          .join(", ");
      }
      return "Plan approval";
    }
    default:
      return toolName;
  }
}

export function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 3) + "...";
}
