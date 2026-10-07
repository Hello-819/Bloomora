import type { ReactNode } from 'react';

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}

export function MarkdownView({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  const lines = body.split(/\r?\n/);
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ul>,
    );
    listItems = [];
  };

  const flushCode = () => {
    blocks.push(<pre key={`code-${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>);
    codeLines = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCode) flushCode();
      else flushList();
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!trimmed) {
      flushList();
      return;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }
    flushList();
    if (trimmed.startsWith('### ')) blocks.push(<h4 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(4))}</h4>);
    else if (trimmed.startsWith('## ')) blocks.push(<h3 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(3))}</h3>);
    else if (trimmed.startsWith('# ')) blocks.push(<h2 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(2))}</h2>);
    else if (trimmed.startsWith('> ')) blocks.push(<blockquote key={blocks.length}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
    else blocks.push(<p key={blocks.length}>{renderInlineMarkdown(trimmed)}</p>);
  });
  if (inCode) flushCode();
  flushList();
  return <div className="markdownBody">{blocks.length ? blocks : <p className="muted">No note body yet.</p>}</div>;
}
