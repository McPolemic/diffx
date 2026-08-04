import { useState, memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  softWrap: boolean
  viewed: boolean
  collapsed: boolean
  onViewedChange: (filePath: string, viewed: boolean) => void
  onCollapsedChange: (filePath: string, collapsed: boolean) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
  onResolveComment: (id: string) => void
  onUnresolveComment: (id: string) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  softWrap,
  viewed,
  collapsed,
  onViewedChange,
  onCollapsedChange,
  onAddComment,
  onDeleteComment,
  onReplyComment,
  onResolveComment,
  onUnresolveComment,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    // Full (non-partial) diffs carry the entire file, so any line — including
    // expanded context outside hunks — can be addressed directly.
    if (!fileDiff.isPartial) {
      return lines[lineNumber - 1] ?? ''
    }
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''}`} id={id}>
      <FileDiff<ReviewComment | { _pending: true }>
        fileDiff={fileDiff}
        options={{
          diffStyle,
          // Collapsing is the library's own: it keeps the header and drops the lines,
          // so one header serves both states and the Viewed checkbox stays put.
          collapsed,
          stickyHeader: true,
          expansionLineCount: 20,
          enableGutterUtility: true,
          theme: { dark: 'github-dark', light: 'github-light' },
          themeType: 'system',
          overflow: softWrap ? 'wrap' : 'scroll',
          unsafeCSS: `:host { --diffs-tab-size: ${tabSize}; }`,
        }}
        lineAnnotations={allAnnotations}
        renderHeaderPrefix={() => (
          <button
            className="collapse-toggle"
            title={collapsed ? 'Expand this file' : 'Collapse this file'}
            onClick={(e) => {
              e.stopPropagation()
              onCollapsedChange(filePath, !collapsed)
            }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        renderHeaderMetadata={() => (
          <label
            className={`viewed-label ${viewed ? 'viewed-checked' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onViewedChange(filePath, e.target.checked)}
            />
            Viewed
          </label>
        )}
        renderAnnotation={(annotation) => {
          if ('_pending' in annotation.metadata) {
            return (
              <CommentForm
                onSubmit={(body) => {
                  const lineContent = getLineContent(pending!.side, pending!.lineNumber)
                  onAddComment(filePath, pending!.side, pending!.lineNumber, lineContent, body)
                  setPending(null)
                }}
                onCancel={() => setPending(null)}
              />
            )
          }
          return (
            <CommentBubble
              comment={annotation.metadata as ReviewComment}
              onDelete={onDeleteComment}
              onReply={onReplyComment}
              onResolve={onResolveComment}
              onUnresolve={onUnresolveComment}
            />
          )
        }}
        renderGutterUtility={(getHoveredLine) => (
          <button
            className="gutter-add-btn"
            onClick={() => {
              const line = getHoveredLine()
              if (line) {
                setPending({ side: line.side, lineNumber: line.lineNumber })
              }
            }}
          >
            +
          </button>
        )}
      />
    </div>
  )
})
