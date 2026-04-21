import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GraphSearchSuggestion } from "@/features/graph/search";

const MAX_VISIBLE_SUGGESTIONS = 10;

export function GraphSearch({
  query,
  suggestions,
  onQueryChange,
  onSelectSuggestion,
}: {
  query: string;
  suggestions: GraphSearchSuggestion[];
  onQueryChange: (query: string) => void;
  onSelectSuggestion: (nodeId: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const visibleSuggestions = suggestions.slice(0, MAX_VISIBLE_SUGGESTIONS);
  const expanded = focused || trimmedQuery.length > 0;
  const open = focused && trimmedQuery.length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      setFocused(true);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!focused) {
      return;
    }

    inputRef.current?.focus();
  }, [focused]);

  const handleSuggestionSelect = (nodeId: string) => {
    onSelectSuggestion(nodeId);
    setFocused(false);
  };

  return (
    <div
      className={cn("pointer-events-auto relative min-w-0", expanded ? "flex-1" : "shrink-0")}
      ref={containerRef}
      onBlurCapture={(event) => {
        if (containerRef.current?.contains(event.relatedTarget as Node | null)) {
          return;
        }

        setFocused(false);
      }}
      onFocusCapture={() => setFocused(true)}
    >
      {expanded ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            aria-label="Search graph"
            autoComplete="off"
            className="h-11 rounded-[0.95rem] border border-foreground/10 bg-background/92 pl-9 pr-10 shadow-lg shadow-primary/10 backdrop-blur"
            placeholder="Search graph"
            role="searchbox"
            spellCheck={false}
            type="text"
            value={query}
            onChange={(event) => {
              setActiveIndex(0);
              onQueryChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (trimmedQuery) {
                  setActiveIndex(0);
                  onQueryChange("");
                } else {
                  setFocused(false);
                }
                return;
              }

              if (!open) {
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(visibleSuggestions.length - 1, 0)));
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }

              if (event.key === "Enter") {
                const suggestion = visibleSuggestions[activeIndex];
                if (!suggestion) {
                  return;
                }

                event.preventDefault();
                handleSuggestionSelect(suggestion.nodeId);
              }
            }}
          />
          {trimmedQuery ? (
            <button
              aria-label="Clear graph search"
              className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setActiveIndex(0);
                onQueryChange("");
                inputRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          aria-label="Open graph search"
          className="inline-flex size-11 items-center justify-center rounded-[0.95rem] border border-foreground/10 bg-background/92 text-muted-foreground shadow-lg shadow-primary/10 backdrop-blur transition-colors hover:text-foreground"
          type="button"
          onClick={() => setFocused(true)}
        >
          <Search className="size-4" />
        </button>
      )}

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden rounded-[1rem] border border-foreground/10 bg-background/96 shadow-xl shadow-primary/10 backdrop-blur">
          {visibleSuggestions.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {visibleSuggestions.map((suggestion, index) => (
                <li key={`${suggestion.matchKind}:${suggestion.nodeId}`}>
                  <button
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-[0.8rem] px-3 py-2 text-left transition-colors",
                      index === activeIndex ? "bg-surface-elevated" : "hover:bg-surface-elevated/80",
                    )}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => handleSuggestionSelect(suggestion.nodeId)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{suggestion.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{suggestion.description}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                        suggestion.matchKind === "direct"
                          ? "bg-primary/12 text-primary"
                          : "bg-surface-elevated text-muted-foreground",
                      )}
                    >
                      {suggestion.matchKind === "direct" ? "Match" : "Connected"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">No matching nodes.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
