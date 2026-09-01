import { ExternalLink } from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="article-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeHighlight,
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
        ]}
        components={{
          a({ href = "", title, children }) {
            const external = href.startsWith("http");
            if (title === "button") {
              return (
                <a className="button button-primary markdown-button" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                  {children} {external ? <ExternalLink aria-hidden="true" /> : null}
                </a>
              );
            }
            return (
              <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                {children}{external ? <ExternalLink aria-hidden="true" /> : null}
              </a>
            );
          },
          img({ src = "", alt = "" }) {
            if (typeof src !== "string" || !URL.canParse(src)) return null;
            return <Image src={src} alt={alt} width={1400} height={788} sizes="(max-width: 900px) 100vw, 820px" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
