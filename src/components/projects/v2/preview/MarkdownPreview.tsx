"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export default function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("markdown-body overflow-auto h-full p-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100", className)}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
            // Typography styling using Tailwind
            h1: ({node, ...props}) => <h1 className="text-2xl font-bold mb-4 border-b border-zinc-200 dark:border-zinc-800 pb-2" {...props} />,
            h2: ({node, ...props}) => <h2 className="text-xl font-semibold mt-6 mb-3" {...props} />,
            h3: ({node, ...props}) => <h3 className="text-lg font-medium mt-4 mb-2" {...props} />,
            p: ({node, ...props}) => <p className="mb-4 leading-relaxed" {...props} />,
            ul: ({node, ...props}) => <ul className="list-disc list-inside mb-4 pl-4" {...props} />,
            ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-4 pl-4" {...props} />,
            li: ({node, ...props}) => <li className="mb-1" {...props} />,
            blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 py-1 my-4 italic text-zinc-600 dark:text-zinc-400" {...props} />,
            a: ({node, ...props}) => <a className="text-blue-600 dark:text-blue-400 hover:underline" {...props} />,
            code: ({node, className, children, ...props}) => {
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
            table: ({node, ...props}) => <div className="overflow-x-auto my-4"><table className="w-full text-left border-collapse" {...props} /></div>,
            th: ({node, ...props}) => <th className="border-b border-zinc-300 dark:border-zinc-700 font-semibold p-2" {...props} />,
            td: ({node, ...props}) => <td className="border-b border-zinc-200 dark:border-zinc-800 p-2" {...props} />,
            hr: ({node, ...props}) => <hr className="my-6 border-zinc-200 dark:border-zinc-800" {...props} />,
            img: ({node, ...props}) => <img className="max-w-full h-auto rounded-md my-4" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
