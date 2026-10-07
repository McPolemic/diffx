import { memo, useMemo } from 'react'
import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { BinaryFileInfo } from '../hooks/useDiff'
import { fileKey } from '../hooks/useFullDiffs'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  softWrap: boolean
  viewedFiles: Set<string>
  collapsedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  onViewedChange: (filePath: string, viewed: boolean) => void
  onCollapsedChange: (filePath: string, collapsed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
  onResolveComment: (id: string) => void
  onUnresolveComment: (id: string) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

export const DiffViewer = memo(function DiffViewer({
  files,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  softWrap,
  viewedFiles,
  collapsedFiles,
  binaryFiles,
  onViewedChange,
  onCollapsedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
  onReplyComment,
  onResolveComment,
  onUnresolveComment,
}: DiffViewerProps) {
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const partsA = a.name.split('/')
      const partsB = b.name.split('/')
      const len = Math.min(partsA.length, partsB.length)
      for (let i = 0; i < len; i++) {
        const aIsDir = i < partsA.length - 1
        const bIsDir = i < partsB.length - 1
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        const cmp = partsA[i].localeCompare(partsB[i])
        if (cmp !== 0) return cmp
      }
      return partsA.length - partsB.length
    })
  }, [files])

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {sortedFiles.map((file, index) => {
        const filePath = file.name
        const binaryInfo = binaryFiles.get(filePath)
        if (binaryInfo) {
          return (
            <BinaryFileDiff
              key={`${filePath}-${index}`}
              filePath={filePath}
              info={binaryInfo}
              viewed={viewedFiles.has(filePath)}
              onViewedChange={onViewedChange}
            />
          )
        }
        return (
          <FileDiffCard
            // The @pierre/diffs <FileDiff> under the Virtualizer keeps the fileDiff it
            // was hydrated with and ignores later ones, so a card only picks up new
            // content by remounting. Key on the file's blob ids — so an edit made while
            // the review is open renders — and on isPartial, so a file upgraded from a
            // patch-only to a full diff gains its hunk-context expansion controls.
            key={`${fileKey(file)}-${index}-${file.isPartial ? 'p' : 'f'}`}
            id={`file-${filePath}`}
            fileDiff={file}
            filePath={filePath}
            annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
            diffStyle={diffStyle}
            tabSize={tabSizeMap[filePath] ?? defaultTabSize}
            softWrap={softWrap}
            viewed={viewedFiles.has(filePath)}
            collapsed={collapsedFiles.has(filePath)}
            onViewedChange={onViewedChange}
            onCollapsedChange={onCollapsedChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onReplyComment={onReplyComment}
            onResolveComment={onResolveComment}
            onUnresolveComment={onUnresolveComment}
          />
        )
      })}
    </div>
  )
})
