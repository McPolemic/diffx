import { CheckCircle2 } from 'lucide-react'

interface ViewedProgressProps {
  viewed: number
  total: number
}

const SIZE = 14
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ViewedProgress({ viewed, total }: ViewedProgressProps) {
  if (total === 0) return null

  const fraction = Math.min(viewed / total, 1)

  return (
    <span className="viewed-progress" title={`${viewed} of ${total} files marked viewed`}>
      {viewed >= total ? (
        <CheckCircle2 className="viewed-progress-done" size={SIZE} />
      ) : (
        <svg className="viewed-progress-ring" width={SIZE} height={SIZE} aria-hidden="true">
          <circle
            className="viewed-progress-track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
          />
          <circle
            className="viewed-progress-bar"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
      )}
      <span>
        <span className="viewed-progress-count">
          {viewed} / {total}
        </span>{' '}
        viewed
      </span>
    </span>
  )
}
