
import React from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const html = marked.parse(content);
  return (
    <div
      className="markdown-content prose-invert w-full overflow-x-auto break-words text-[11.5px]"
      style={{
        lineHeight: '1.6',
        letterSpacing: '0.01em',
        color: '#cbd5e1'
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownRenderer;
