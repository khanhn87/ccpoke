interface PendingReply {
  chatId: number;
  messageId: number;
  paneId: string;
  panePid: string;
  project: string;
}

export type OnCleanupCallback = (chatId: number, messageId: number) => void;

const MAX_ENTRIES = 200;
const TTL_MS = 600_000;

export class PendingReplyStore {
  private pending = new Map<string, PendingReply>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private onCleanup: OnCleanupCallback | null = null;

  setOnCleanup(cb: OnCleanupCallback): void {
    this.onCleanup = cb;
  }

  set(chatId: number, messageId: number, paneId: string, panePid: string, project: string): void {
    const key = PendingReplyStore.key(chatId, messageId);
    this.clearTimer(key);
    this.pending.set(key, { chatId, messageId, paneId, panePid, project });
    this.evictOldest();

    this.timers.set(
      key,
      setTimeout(() => {
        const entry = this.pending.get(key);
        if (!entry) return;
        this.pending.delete(key);
        this.timers.delete(key);
        this.onCleanup?.(entry.chatId, entry.messageId);
      }, TTL_MS)
    );
  }

  get(chatId: number, messageId: number): PendingReply | undefined {
    return this.pending.get(PendingReplyStore.key(chatId, messageId));
  }

  delete(chatId: number, messageId: number): void {
    const key = PendingReplyStore.key(chatId, messageId);
    this.clearTimer(key);
    this.pending.delete(key);
  }

  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    if (this.onCleanup) {
      for (const entry of this.pending.values()) {
        this.onCleanup(entry.chatId, entry.messageId);
      }
    }
    this.pending.clear();
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private evictOldest(): void {
    if (this.pending.size <= MAX_ENTRIES) return;
    const oldest = this.pending.keys().next().value;
    if (!oldest) return;
    const entry = this.pending.get(oldest);
    this.clearTimer(oldest);
    this.pending.delete(oldest);
    if (entry) this.onCleanup?.(entry.chatId, entry.messageId);
  }

  private static key(chatId: number, messageId: number): string {
    return `${chatId}:${messageId}`;
  }
}
