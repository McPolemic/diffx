import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface MarkdownProps {
  children: string
}

interface CodeElementProps {
  className?: string
  children?: React.ReactNode
}

// react-markdown builds React elements rather than an HTML string, so comment bodies
// cannot inject markup no matter what they contain.
export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Overriding `pre` rather than `code` keeps inline code inline: react-markdown
          // v10 dropped the `inline` prop, and a fence with no language is otherwise
          // indistinguishable from inline code at the `code` component.
          pre: ({ children }) => {
            const child = children as ReactElement<CodeElementProps> | undefined
            const className = child?.props?.className ?? ''
            const lang = /language-(\w+)/.exec(className)?.[1]
            const code = String(child?.props?.children ?? '').replace(/\n$/, '')
            return <CodeBlock code={code} lang={lang} />
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
