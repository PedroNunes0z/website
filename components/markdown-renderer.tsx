import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { CopyCodeBlock } from "@/components/copy-content";
import { getYouTubeEmbedUrl } from "@/lib/youtube";

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
            const youtubeUrl = title === "youtube" ? getYouTubeEmbedUrl(href) : null;
            if (youtubeUrl) return <span className="article-video"><iframe src={youtubeUrl} title="Vídeo do YouTube" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></span>;
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
          pre({ children }) {
            const code = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
            const languageClass = code && isValidElement<{ className?: string }>(code)
              ? code.props.className?.split(/\s+/).find((name) => name.startsWith("language-"))
              : undefined;
            const language = languageClass?.slice("language-".length);
            return <CopyCodeBlock language={language}>{children}</CopyCodeBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
