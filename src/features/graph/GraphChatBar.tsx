import { ChevronLeft, ChevronRight, LoaderCircle, MessageSquareText, Send, Square } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GraphOp } from "@/lib/graph/schema";
import { cn } from "@/lib/utils";

export function GraphChatBar({
  assistantText,
  backendLabel,
  busy,
  connected,
  inputDisabled,
  pendingOps,
  streamingText,
  onApplyPendingOps,
  onInterrupt,
  onSendMessage,
}: {
  assistantText: string | null;
  backendLabel: string;
  busy: boolean;
  connected: boolean;
  inputDisabled: boolean;
  pendingOps: GraphOp[];
  streamingText: string;
  onApplyPendingOps: () => void;
  onInterrupt: () => void;
  onSendMessage: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(Boolean(busy || pendingOps.length > 0 || streamingText || assistantText));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || inputDisabled || busy) {
      return;
    }

    onSendMessage(trimmed);
    setValue("");
  };

  const transcript = streamingText || assistantText;

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 top-4 z-20 flex items-start justify-end">
      {expanded ? (
        <div className="pointer-events-auto flex h-full w-[min(22rem,calc(100vw-2rem))] max-w-full flex-col overflow-hidden rounded-[1.45rem] border border-foreground/10 bg-background/94 shadow-2xl shadow-primary/15 backdrop-blur md:w-[22rem]">
          <div className="flex items-start justify-between gap-3 border-b border-foreground/10 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    connected ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <span className="truncate">Graph Chat</span>
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

          {transcript ? (
            <div className="min-h-0 flex-1 overflow-y-auto border-b border-foreground/10 px-4 py-4 text-sm leading-6 text-foreground">
              <p>{transcript}</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center border-b border-foreground/10 px-5 py-6 text-center text-sm leading-6 text-muted-foreground">
              {connected ? "Ask Codex to focus notes, suggest links, or reshape the graph view." : "Start the local graph backend to use Codex chat."}
            </div>
          )}

          {pendingOps.length > 0 ? (
            <div className="border-b border-foreground/10 px-3 py-3">
              <Button className="h-11 w-full rounded-[0.95rem] px-4" type="button" variant="secondary" onClick={onApplyPendingOps}>
                Apply {pendingOps.length} change{pendingOps.length === 1 ? "" : "s"}
              </Button>
            </div>
          ) : null}

          <form className="flex flex-col gap-2 p-3" onSubmit={handleSubmit}>
            <Input
              aria-label="Graph chat prompt"
              className="h-12 rounded-[0.95rem]"
              disabled={inputDisabled || busy}
              placeholder={connected ? "Link sessions, focus a cluster, or suggest structure..." : "Graph backend unavailable"}
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
            aria-label={
              pendingOps.length > 0
                ? `Open graph chat, ${pendingOps.length} pending change${pendingOps.length === 1 ? "" : "s"}`
                : busy
                  ? "Open graph chat, thinking"
                  : "Open graph chat"
            }
            className="mb-2 flex min-h-14 items-center gap-2 rounded-[1.1rem] px-4 py-3 shadow-xl shadow-primary/15"
            type="button"
            variant="default"
            onClick={() => setExpanded(true)}
          >
            {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <MessageSquareText className="size-4 shrink-0" />}
            {pendingOps.length > 0 ? <Square className="size-3.5 shrink-0" /> : null}
            <ChevronLeft className="size-4 shrink-0" />
          </Button>
        </div>
      )}
    </div>
  );
}
