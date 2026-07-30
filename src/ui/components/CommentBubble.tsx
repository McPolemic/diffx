import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, RotateCcw } from 'lucide-react'
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

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved ? (
          <>
            <span className="comment-bubble-resolved">
              <CheckCircle2 size={14} />
              Resolved
            </span>
            <button
              className="comment-bubble-resolve"
              onClick={() => onUnresolve(comment.id)}
              title="Reopen this thread"
            >
              <RotateCcw size={14} />
              Mark unresolved
            </button>
          </>
        ) : (
          // Offered even before a reply lands: a thread can become moot before it
          // is ever answered.
          <button
            className="comment-bubble-resolve"
            onClick={() => onResolve(comment.id)}
            title="Mark this thread resolved"
          >
            <CheckCircle2 size={14} />
            Mark resolved
          </button>
        )}
        {!isResolved && (
          <button
            className="comment-bubble-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            &times;
          </button>
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
      {/* Always open rather than behind a Reply button, and present on resolved threads
          too: following up on a finished fix ("undo this") is the main reason to reply. */}
      <CommentForm
        onSubmit={(body) => onReply(comment.id, body)}
        placeholder="Reply"
        submitLabel="Reply"
        autoFocus={false}
      />
    </div>
  )
}
