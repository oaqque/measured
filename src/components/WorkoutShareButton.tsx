import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function WorkoutShareButton({
  align = "end",
  className,
  compact = false,
  side = "bottom",
  slug,
  title,
}: {
  align?: "center" | "end" | "start";
  className?: string;
  compact?: boolean;
  side?: "bottom" | "left" | "right" | "top";
  slug: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const sharePath = `/notes/${encodeURIComponent(slug)}`;
  const shareUrl =
    typeof window === "undefined" ? sharePath : new URL(sharePath, window.location.origin).toString();

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopied(false);
    }, 1400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copied]);

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`Share ${title}`}
          className={cn(
            "rounded-[0.35rem] p-0",
            compact ? "size-7 bg-background/92 hover:bg-background" : "size-9",
            className,
          )}
          type="button"
          variant="secondary"
        >
          <Share2 className={compact ? "size-3.5" : "size-4"} />
          <span className="sr-only">Share {title}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-[min(24rem,calc(100vw-2rem))]" side={side}>
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Share post</p>
            <p className="text-xs text-muted-foreground">Direct link to this note.</p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shareUrl}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button
              aria-label={copied ? "Link copied" : "Copy link"}
              className="size-11 shrink-0 rounded-[0.35rem] p-0"
              type="button"
              variant="secondary"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="sr-only">{copied ? "Link copied" : "Copy link"}</span>
            </Button>
          </div>

          <a
            className="inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={sharePath}
          >
            Open post
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
