import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export interface MarkdownContentProps {
  content: string;
  onLinkClick?: (href: string) => boolean;
}

export function MarkdownContent({ content, onLinkClick }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href, onClick, ...props }: ComponentProps<"a">) => (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              onClick?.(event);
              if (event.defaultPrevented || !href || !onLinkClick) {
                return;
              }

              if (onLinkClick(href)) {
                event.preventDefault();
              }
            }}
          />
        ),
        code: ({ className, children, ...props }: ComponentProps<"code">) => {
          const text = extractText(children).trim();
          const formattedDate = className ? null : formatMarkdownDateToken(text);

          if (formattedDate) {
            return <DateBadge>{formattedDate}</DateBadge>;
          }

          return (
            <code {...props} className={className}>
              {children}
            </code>
          );
        },
      }}
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeRaw, rehypeKatex]}
    >
      {content}
    </ReactMarkdown>
  );
}

function DateBadge({ children }: { children: string }) {
  return (
    <span className="not-prose inline-flex whitespace-nowrap rounded border border-primary/15 bg-surface-elevated px-1.5 py-0.5 align-baseline text-[0.78em] font-extrabold leading-none text-primary">
      {children}
    </span>
  );
}

function formatMarkdownDateToken(value: string) {
  const singleDateMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/u);
  if (singleDateMatch?.[1]) {
    return formatReadableDate(singleDateMatch[1]);
  }

  const dateRangeMatch = value.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/u);
  if (dateRangeMatch?.[1] && dateRangeMatch[2]) {
    return `${formatReadableDate(dateRangeMatch[1])} to ${formatReadableDate(dateRangeMatch[2])}`;
  }

  return null;
}

function formatReadableDate(value: string) {
  const [year = "1970", month = "1", day = "1"] = value.split("-");
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function extractText(value: ReactNode): string {
  if (Array.isArray(value)) {
    return value.map((child) => extractText(child)).join("");
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "";
}
