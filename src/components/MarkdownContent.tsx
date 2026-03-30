import type { ComponentProps } from "react";
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
      }}
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeRaw, rehypeKatex]}
    >
      {content}
    </ReactMarkdown>
  );
}
