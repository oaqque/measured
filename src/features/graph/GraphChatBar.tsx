import { LoaderCircle, Send, Square } from "lucide-react";
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
    <div className="pointer-events-auto absolute inset-x-4 bottom-4 z-20 md:inset-x-auto md:left-1/2 md:w-[min(46rem,calc(100%-4rem))] md:-translate-x-1/2">
      <div className="overflow-hidden rounded-[1.4rem] border border-foreground/10 bg-background/94 shadow-2xl shadow-primary/15 backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span
              className={cn(
                "size-2.5 rounded-full",
                connected ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            {backendLabel}
          </div>
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
        </div>

        {transcript ? (
          <div className="max-h-36 overflow-y-auto border-b border-foreground/10 px-4 py-3 text-sm leading-6 text-foreground">
            <p>{transcript}</p>
          </div>
        ) : null}

        <form className="flex items-center gap-2 p-3" onSubmit={handleSubmit}>
          <Input
            aria-label="Graph chat prompt"
            className="h-12 rounded-[0.95rem]"
            disabled={inputDisabled || busy}
            placeholder={connected ? "Link sessions, focus a cluster, or suggest structure..." : "Start the local graph backend to use Codex chat"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            className="h-12 rounded-[0.95rem] px-4"
            disabled={inputDisabled || busy || value.trim().length === 0}
            type="submit"
            variant="default"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
          {pendingOps.length > 0 ? (
            <Button className="h-12 rounded-[0.95rem] px-4" type="button" variant="secondary" onClick={onApplyPendingOps}>
              Apply changes
            </Button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
