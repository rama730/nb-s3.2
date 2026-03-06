"use client";

import React, { useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { cn } from "@/lib/utils";

const LazyReactMarkdown = dynamic(
  () => import("react-markdown"),
  { ssr: false }
);

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

const markdownComponents = {
  h1: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="text-2xl font-bold mb-4 border-b border-zinc-200 dark:border-zinc-800 pb-2" {...props} />,
  h2: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="text-xl font-semibold mt-6 mb-3" {...props} />,
  h3: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="text-lg font-medium mt-4 mb-2" {...props} />,
  p: ({ ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-4 leading-relaxed" {...props} />,
  ul: ({ ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc list-inside mb-4 pl-4" {...props} />,
  ol: ({ ...props }: React.HTMLAttributes<HTMLOListElement>) => <ol className="list-decimal list-inside mb-4 pl-4" {...props} />,
  li: ({ ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className="mb-1" {...props} />,
  blockquote: ({ ...props }: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 py-1 my-4 italic text-zinc-600 dark:text-zinc-400" {...props} />,
  a: ({ ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a className="text-blue-600 dark:text-blue-400 hover:underline" {...props} />,
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match;
    if (isInline) {
      return <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200" {...props}>{children}</code>;
    }
    return (
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-md p-3 my-4 overflow-x-auto">
        <code className={cn("text-sm font-mono block", className)} {...props}>
          {children}
        </code>
      </div>
    );
  },
  table: ({ ...props }: React.TableHTMLAttributes<HTMLTableElement>) => <div className="overflow-x-auto my-4"><table className="w-full text-left border-collapse" {...props} /></div>,
  th: ({ ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className="border-b border-zinc-300 dark:border-zinc-700 font-semibold p-2" {...props} />,
  td: ({ ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className="border-b border-zinc-200 dark:border-zinc-800 p-2" {...props} />,
  hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => <hr className="my-6 border-zinc-200 dark:border-zinc-800" {...props} />,
  img: ({ src, alt = "", title }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const safeSrc = typeof src === "string" ? src : "";
    if (!safeSrc) return null;
    return (
      <Image
        src={safeSrc}
        alt={alt || ""}
        title={typeof title === "string" ? title : undefined}
        width={1200}
        height={800}
        unoptimized
        className="max-w-full h-auto rounded-md my-4"
        style={{ height: "auto" }}
      />
    );
  },
};

export default function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const remarkPlugins = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gfm = require("remark-gfm");
      return [gfm.default || gfm];
    } catch {
      return [];
    }
  }, []);

  return (
    <div className={cn("markdown-body overflow-auto h-full p-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100", className)}>
      <Suspense fallback={<div className="text-sm text-zinc-500">Loading preview...</div>}>
        <LazyReactMarkdown
          remarkPlugins={remarkPlugins}
          components={markdownComponents as unknown as Record<string, React.FC>}
        >
          {content}
        </LazyReactMarkdown>
      </Suspense>
    </div>
  );
}
