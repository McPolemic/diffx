import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  onSubmit: (body: string) => void
  onCancel?: () => void
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
  hideSubmit?: boolean
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = 'Leave a review comment',
  submitLabel = 'Comment',
  autoFocus = true,
  hideSubmit = false,
}: CommentFormProps) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    // The form can stay mounted between submissions, so clear it here rather than
    // relying on unmount to reset.
    setBody('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends, shift+enter breaks the line. Cmd/ctrl+enter also sends, since that
    // is the habit this box inherits from every other review tool.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const showActions = !hideSubmit || onCancel

  return (
    <div className="comment-form">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
      />
      {showActions ? (
        <div className="comment-form-actions">
          {onCancel && (
            <button className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          {!hideSubmit && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!body.trim()}>
              {submitLabel}
            </button>
          )}
        </div>
      ) : (
        // Without a button the keys are the only affordance, so say what they are.
        <p className="comment-form-hint">
          <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </p>
      )}
    </div>
  )
}
