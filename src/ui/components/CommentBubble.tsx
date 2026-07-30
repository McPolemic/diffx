import { useState, useEffect } from 'react'
import {
  UserCircle,
  CheckCircle2,
  Bot,
  RotateCcw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo } from '../utils'
import { CommentForm } from './CommentForm'
import { Markdown } from './Markdown'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply: (id: string, body: string) => void
  onResolve: (id: string) => void
  onUnresolve: (id: string) => void
}

export function CommentBubble({
  comment,
  onDelete,
  onReply,
  onResolve,
  onUnresolve,
}: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const isResolved = comment.status === 'resolved'
  const [expanded, setExpanded] = useState(!isResolved)

  // Settling a thread collapses it, and reopening one brings it straight back.
  useEffect(() => {
    setExpanded(!isResolved)
  }, [isResolved])

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const lineLabel = `${comment.side === 'additions' ? 'R' : 'L'}${comment.lineNumber}`

  return (
    <div
      className={`comment-bubble ${isResolved ? 'comment-resolved' : ''} ${
        isResolved && !expanded ? 'comment-collapsed' : ''
      }`}
      id={`comment-${comment.id}`}
    >
      {isResolved && (
        <div className="comment-collapse-header">
          <button
            className="comment-collapse-toggle"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse thread' : 'Expand thread'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>
              Comment on line <strong>{lineLabel}</strong>
            </span>
          </button>
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
          {!expanded && (
            <button
              className="comment-bubble-undo"
              onClick={() => onUnresolve(comment.id)}
              title="Unresolve comment"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      )}

      {expanded && (
        <>
          <div className="comment-bubble-header">
            <UserCircle size={18} className="comment-bubble-avatar" />
            <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
            {!isResolved && (
              <>
                {/* Offered even before a reply lands: a thread can become moot before
                    it is ever answered. */}
                <button
                  className="comment-bubble-resolve"
                  onClick={() => onResolve(comment.id)}
                  title="Mark this thread resolved"
                >
                  <CheckCircle2 size={14} />
                  Mark resolved
                </button>
                <button
                  className="comment-bubble-delete"
                  onClick={() => onDelete(comment.id)}
                  title="Delete comment"
                >
                  &times;
                </button>
              </>
            )}
          </div>

          <div className="comment-bubble-body">
            <Markdown>{comment.body}</Markdown>
          </div>

          {comment.replies?.length > 0 && (
            <div className="comment-replies">
              {comment.replies.map((reply) => (
                <div key={reply.id} className="comment-reply">
                  <div className="comment-reply-header">
                    {reply.author === 'reviewer' ? (
                      <UserCircle size={16} className="comment-reply-avatar" />
                    ) : (
                      <Bot size={16} className="comment-reply-avatar" />
                    )}
                    <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
                  </div>
                  <div className="comment-reply-body">
                    <Markdown>{reply.body}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Always open rather than behind a Reply button, and present on resolved
              threads too: following up on a finished fix ("undo this") is the main
              reason to reply. */}
          <CommentForm
            onSubmit={(body) => onReply(comment.id, body)}
            placeholder="Reply"
            autoFocus={false}
            hideSubmit
          />

          {isResolved && (
            <div className="comment-resolved-footer">
              <button className="btn btn-sm" onClick={() => onUnresolve(comment.id)}>
                Unresolve comment
              </button>
              <span className="comment-resolved-note">Marked as resolved</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
