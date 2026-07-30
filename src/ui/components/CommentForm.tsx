import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  onSubmit: (body: string) => void
  onCancel?: () => void
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = 'Leave a review comment...',
  submitLabel = 'Comment',
  autoFocus = true,
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

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
      <div className="comment-form-actions">
        {onCancel && (
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!body.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
