import React from "react";

/** Inline markdown: [label](url) links and **bold**. No raw HTML ever reaches the DOM. */
function renderInline(text: string, keyBase: string) {
  const nodes: React.ReactNode[] = [];
  // Split out links first, then bold within the remaining text.
  const linkParts = text.split(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g);
  for (let i = 0; i < linkParts.length; i += 3) {
    const plain = linkParts[i];
    if (plain) {
      const boldParts = plain.split(/\*\*([^*]+)\*\*/g);
      boldParts.forEach((part, j) => {
        if (!part) return;
        if (j % 2 === 1) {
          nodes.push(<strong key={`${keyBase}-b${i}-${j}`}>{part}</strong>);
          return;
        }
        const italicParts = part.split(/\*([^*]+)\*/g);
        italicParts.forEach((seg, k) => {
          if (!seg) return;
          nodes.push(k % 2 === 1 ? <em key={`${keyBase}-i${i}-${j}-${k}`}>{seg}</em> : seg);
        });
      });
    }
    if (i + 2 < linkParts.length) {
      nodes.push(
        <a
          key={`${keyBase}-a${i}`}
          href={linkParts[i + 2]}
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}
        >
          {linkParts[i + 1]}
        </a>,
      );
    }
  }
  return nodes;
}

/** Assistant replies arrive as markdown; render bullets, links and bold instead of raw symbols. */
export function renderRich(text: string) {
  return text.split("\n").map((line, i) => {
    const bullet = line.match(/^\s*[*-]\s+(.*)$/);
    const content = renderInline(bullet ? bullet[1] : line, `l${i}`);
    return (
      <span key={i} style={{ display: "block", paddingLeft: bullet ? 14 : 0 }}>
        {bullet && <span style={{ marginRight: 8 }}>&bull;</span>}
        {content}
      </span>
    );
  });
}
