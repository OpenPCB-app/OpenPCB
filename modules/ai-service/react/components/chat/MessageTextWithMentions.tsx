import { Fragment, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Streamdown } from "streamdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { MentionBadge } from "./MentionBadge";
import { parseMentions } from "@/lib/mention-utils";
import type { MentionReference } from "@shared/types";

interface MessageTextWithMentionsProps {
  text: string;
  isStreaming?: boolean;
  markdownComponents?: Components;
  onMentionClick?: (mention: MentionReference) => void;
  deletedEntityIds?: Set<string>;
}

export function MessageTextWithMentions({
  text,
  isStreaming = false,
  markdownComponents,
  onMentionClick,
  deletedEntityIds = new Set(),
}: MessageTextWithMentionsProps) {
  const { segments } = useMemo(() => {
    const mentions = parseMentions(text);
    if (mentions.length === 0) {
      return { segments: [{ type: "text" as const, content: text }] };
    }

    const segs: Array<
      | { type: "text"; content: string }
      | { type: "mention"; mention: MentionReference }
    > = [];
    let lastIndex = 0;

    for (const mention of mentions) {
      if (mention.position > lastIndex) {
        segs.push({
          type: "text",
          content: text.slice(lastIndex, mention.position),
        });
      }
      segs.push({ type: "mention", mention });
      lastIndex = mention.position + mention.raw.length;
    }

    if (lastIndex < text.length) {
      segs.push({ type: "text", content: text.slice(lastIndex) });
    }

    return { segments: segs };
  }, [text]);

  const renderMarkdown = (content: string, key: string): ReactNode => {
    if (isStreaming) {
      return (
        <Streamdown
          key={key}
          isAnimating
          parseIncompleteMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          shikiTheme={["one-light", "one-dark-pro"]}
        >
          {content}
        </Streamdown>
      );
    }

    return (
      <ReactMarkdown
        key={key}
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    );
  };

  if (segments.length === 1 && segments[0]?.type === "text") {
    return <>{renderMarkdown(segments[0].content, "single")}</>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          if (!segment.content.trim()) {
            return <Fragment key={`text-${index}`}>{segment.content}</Fragment>;
          }
          return (
            <Fragment key={`text-${index}`}>
              {renderMarkdown(segment.content, `md-${index}`)}
            </Fragment>
          );
        }

        const isDeleted = deletedEntityIds.has(segment.mention.entityId);
        return (
          <MentionBadge
            key={`mention-${index}`}
            mention={segment.mention}
            isDeleted={isDeleted}
            onClick={
              onMentionClick && !isDeleted
                ? () => onMentionClick(segment.mention)
                : undefined
            }
          />
        );
      })}
    </>
  );
}
