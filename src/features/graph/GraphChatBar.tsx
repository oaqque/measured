import { ChevronLeft, ChevronRight, LoaderCircle, MessageSquareText, Send, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GraphChatEntry } from "@/features/graph/chat-items";
import { cn } from "@/lib/utils";

export function GraphChatBar({
  backendLabel,
  busy,
  connected,
  entries,
  inputDisabled,
  onInterrupt,
  onSendMessage,
}: {
  backendLabel: string;
  busy: boolean;
  connected: boolean;
  entries: GraphChatEntry[];
  inputDisabled: boolean;
  onInterrupt: () => void;
  onSendMessage: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(Boolean(busy || entries.length > 0));
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollTop = scroller.scrollHeight;
  }, [busy, entries]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || inputDisabled || busy) {
      return;
    }

    onSendMessage(trimmed);
    setValue("");
  };

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 top-4 z-20 flex items-start justify-end">
      {expanded ? (
        <div className="pointer-events-auto flex h-full w-[min(26rem,calc(100vw-2rem))] max-w-full flex-col overflow-hidden rounded-[1.45rem] border border-foreground/10 bg-background/94 shadow-2xl shadow-primary/15 backdrop-blur md:w-[26rem]">
          <div className="flex items-start justify-between gap-3 border-b border-foreground/10 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    connected ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <span className="truncate">Codex Chat</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{backendLabel}</p>
            </div>

            <div className="flex items-center gap-2">
              {busy ? (
                <button
                  className="inline-flex items-center gap-2 rounded-[0.75rem] bg-surface-panel-alt px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-panel"
                  type="button"
                  onClick={onInterrupt}
                >
                  <Square className="size-3.5" />
                  Interrupt
                </button>
              ) : null}

              <Button
                aria-label="Collapse graph chat"
                className="h-10 rounded-[0.85rem] px-3"
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => setExpanded(false)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {entries.length > 0 ? (
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto border-b border-foreground/10 px-3 py-3">
              <div className="flex flex-col gap-3">
                {entries.map((entry) => (
                  <ChatEntryCard key={entry.id} entry={entry} />
                ))}
                {busy ? (
                  <div className="rounded-[1rem] border border-dashed border-foreground/10 bg-surface-panel/50 px-3 py-2 text-xs text-muted-foreground">
                    Codex is working...
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center border-b border-foreground/10 px-5 py-6 text-center text-sm leading-6 text-muted-foreground">
              {connected ? "Ask Codex anything about this repository." : "Start the local Codex backend to use chat."}
            </div>
          )}

          <form className="flex flex-col gap-2 p-3" onSubmit={handleSubmit}>
            <Input
              aria-label="Graph chat prompt"
              className="h-12 rounded-[0.95rem]"
              disabled={inputDisabled || busy}
              placeholder={connected ? "Ask Codex..." : "Codex backend unavailable"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <Button
              className="h-11 rounded-[0.95rem] px-4"
              disabled={inputDisabled || busy || value.trim().length === 0}
              type="submit"
              variant="default"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          </form>
        </div>
      ) : (
        <div className="pointer-events-auto flex h-full items-end">
          <Button
            aria-label={busy ? "Open graph chat, thinking" : "Open graph chat"}
            className="mb-2 flex min-h-14 items-center gap-2 rounded-[1.1rem] px-4 py-3 shadow-xl shadow-primary/15"
            type="button"
            variant="default"
            onClick={() => setExpanded(true)}
          >
            {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <MessageSquareText className="size-4 shrink-0" />}
            <ChevronLeft className="size-4 shrink-0" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ChatEntryCard({ entry }: { entry: GraphChatEntry }) {
  const isUser = entry.kind === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-[1rem] border px-3 py-2 shadow-sm",
          isUser
            ? "border-primary/20 bg-primary text-primary-foreground"
            : entry.kind === "tool"
              ? "border-foreground/10 bg-surface-panel"
              : entry.kind === "system"
                ? "border-dashed border-foreground/10 bg-surface-panel/60"
                : "border-foreground/10 bg-background/80",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={cn("text-xs font-semibold uppercase tracking-[0.12em]", isUser ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {entry.title}
          </p>
          {entry.status ? (
            <span className={cn("text-[10px] uppercase tracking-[0.12em]", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
              {entry.status.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>

        {entry.body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.body}</p> : null}

        {entry.details.length > 0 ? (
          <p className={cn("mt-2 whitespace-pre-wrap text-xs", isUser ? "text-primary-foreground/75" : "text-muted-foreground")}>
            {entry.details.join(" · ")}
          </p>
        ) : null}

        {entry.output ? (
          <pre
            className={cn(
              "mt-2 overflow-x-auto rounded-[0.85rem] px-3 py-2 text-xs leading-5",
              isUser ? "bg-primary-foreground/15 text-primary-foreground" : "bg-foreground/5 text-foreground",
            )}
          >
            {entry.output}
          </pre>
        ) : null}

        {entry.raw ? (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Raw</summary>
            <pre className="mt-2 overflow-x-auto rounded-[0.85rem] bg-foreground/5 px-3 py-2 text-[11px] leading-5 text-foreground">
              {entry.raw}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
