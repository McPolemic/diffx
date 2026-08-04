import { useState, useMemo, useCallback, useEffect } from 'react'
import { Resizable } from 'react-resizable'
import { parsePatchFiles } from '@pierre/diffs'
import { Virtualizer, useVirtualizer } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { useFullDiffs, fileKey } from './hooks/useFullDiffs'
import { useReviewStatus } from './hooks/useReviewStatus'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'
import { SidebarStorage } from './sidebarStorage'

interface JumpTarget {
  commentId: string
  filePath: string
  side: ReviewComment['side']
  lineNumber: number
}

interface FileDiffInstance {
  top?: number
  getLinePosition(lineNumber: number, side: ReviewComment['side']): { top: number; height: number } | undefined
}

// The virtualizer keeps its per-file instances to itself and a rendered <FileDiff> has no
// public way to answer "where is line N". Reaching for the map is deliberate and guarded:
// without a position we still scroll to the file, just not to the line.
function findFileInstance(virtualizer: unknown, card: HTMLElement): FileDiffInstance | undefined {
  const observers = (virtualizer as { observers?: unknown } | null | undefined)?.observers
  if (!(observers instanceof Map)) return undefined
  for (const [container, instance] of observers as Map<HTMLElement, FileDiffInstance>) {
    if (card.contains(container)) return instance
  }
  return undefined
}

// Jumping to a comment cannot just scroll to its anchor: only lines near the viewport are
// built, so until we are close the anchor sits in the DOM at zero size. Aim using the
// line's computed position, then let the anchor make the landing exact once it renders.
// Re-aiming matters because the file may still have been collapsing as we started.
function CommentJumper({ target, onDone }: { target: JumpTarget | null; onDone: () => void }) {
  const virtualizer = useVirtualizer()

  useEffect(() => {
    if (target == null) return
    let cancelled = false

    const aim = () => {
      const scroller = document.querySelector<HTMLElement>('.main-scroll')
      const card = document.getElementById(`file-${target.filePath}`)
      if (scroller == null || card == null) return
      const instance = findFileInstance(virtualizer, card)
      const position = instance?.getLinePosition(target.lineNumber, target.side)
      if (instance?.top == null || position == null) {
        card.scrollIntoView({ block: 'start' })
        return
      }
      scroller.scrollTo({ top: instance.top + position.top - scroller.clientHeight / 3 })
    }

    const settle = (attemptsLeft: number) => {
      if (cancelled) return
      const anchor = document.getElementById(`comment-${target.commentId}`)
      if (anchor != null && anchor.getBoundingClientRect().height > 0) {
        anchor.scrollIntoView({ block: 'center' })
        onDone()
        return
      }
      if (attemptsLeft === 0) {
        onDone()
        return
      }
      if (attemptsLeft % 10 === 0) aim()
      requestAnimationFrame(() => settle(attemptsLeft - 1))
    }

    aim()
    settle(60)
    return () => {
      cancelled = true
    }
  }, [target, virtualizer, onDone])

  return null
}

function useWindowSize({ factor }: { factor: number }) {
  const compute = () => Math.round(window.innerWidth * factor)

  const [size, setSize] = useState(compute)

  useEffect(() => {
    const handleResize = () => setSize(compute())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [factor])

  return size
}

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, untrackedFiles, loading, error } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  })
  const { reviewDone, markDone } = useReviewStatus()
  const { comments, addComment, removeComment, replyToComment, resolveComment, unresolveComment } =
    useComments({ enabled: !reviewDone })
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null)
  const [sidebar, setSidebar] = useState(() => SidebarStorage.load())
  const maxSidebarWidth = Math.max(SidebarStorage.minSize, useWindowSize({ factor: 0.5 }))

  const handleResize = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width))
  }, [])

  const handleResizeStop = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width).save())
  }, [])

  const handleToggleCollapse = useCallback(() => {
    setSidebar((prev) => prev.withCollapsed(!prev.collapsed).save())
  }, [])

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const fullFiles = useFullDiffs(patch, files, { staged: settings.staged, untracked: settings.untracked })
  const displayFiles = useMemo(() => {
    if (fullFiles.size === 0) return files
    return files.map((f) => fullFiles.get(fileKey(f)) ?? f)
  }, [files, fullFiles])

  const { viewedFiles, setViewed, clearAllViewed } = useViewed(files)

  // Marking a file viewed collapses it, but collapsing is its own state: expanding a
  // viewed file to read a comment must not claim you have unreviewed it. An entry here
  // overrides the default for one file until its viewed state changes again.
  const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(() => new Map())

  const collapsedFiles = useMemo(() => {
    const collapsed = new Set<string>()
    for (const file of files) {
      if (collapseOverrides.get(file.name) ?? viewedFiles.has(file.name)) collapsed.add(file.name)
    }
    return collapsed
  }, [files, viewedFiles, collapseOverrides])

  const setCollapsed = useCallback((filePath: string, collapsed: boolean) => {
    setCollapseOverrides((prev) => new Map(prev).set(filePath, collapsed))
  }, [])

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const unresolvedCount = useMemo(
    () => comments.filter((c) => c.status !== 'resolved').length,
    [comments],
  )

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
    // Toggling viewed is a fresh statement about the file, so it takes back the default:
    // viewed collapses, unviewed expands.
    setCollapseOverrides((prev) => {
      if (!prev.has(filePath)) return prev
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })
  }, [setViewed])

  const handleCommentClick = useCallback((comment: ReviewComment) => {
    setActiveFile(comment.filePath)
    setCollapseOverrides((prev) => new Map(prev).set(comment.filePath, false))
    setJumpTarget({
      commentId: comment.id,
      filePath: comment.filePath,
      side: comment.side,
      lineNumber: comment.lineNumber,
    })
  }, [])

  const handleJumpDone = useCallback(() => setJumpTarget(null), [])

  const sidebarContent = (
    <div className="sidebar-content">
      <FileTree
        files={files}
        activeFile={activeFile}
        commentCounts={commentCounts}
        viewedFiles={viewedFiles}
        untrackedFiles={untrackedSet}
        onFileClick={handleFileClick}
        collapsed={sidebar.collapsed}
        onToggleCollapse={handleToggleCollapse}
      />
      {!sidebar.collapsed && <CommentTracker comments={comments} onCommentClick={handleCommentClick} />}
    </div>
  )

  if (!loaded || loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className={`app ${reviewDone ? 'review-closed' : ''}`}>
      <Toolbar
        repoName={repoName}
        branch={branch}
        fileCount={files.length}
        viewedCount={viewedFiles.size}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        unresolvedCount={unresolvedCount}
        reviewDone={reviewDone}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        softWrap={settings.softWrap}
        browser={settings.browser}
        customMode={customMode}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onSoftWrapChange={(softWrap) => updateSettings({ softWrap })}
        onBrowserChange={(browser) => updateSettings({ browser })}
        onClearViewed={clearAllViewed}
        onDone={async () => {
          await markDone()
        }}
      />
      {reviewDone && (
        <div className="review-closed-banner">
          Review handed off. The server has stopped, so this page is a snapshot now.
          Carry on in your terminal.
        </div>
      )}
      <div className="app-body">
        {sidebar.collapsed ? (
          <aside className="sidebar sidebar-collapsed" style={{ width: sidebar.visibleSize() }}>
            {sidebarContent}
          </aside>
        ) : (
          <Resizable
            width={sidebar.visibleSize(maxSidebarWidth)}
            height={0}
            axis="x"
            resizeHandles={['e']}
            minConstraints={[SidebarStorage.minSize, 0]}
            maxConstraints={[maxSidebarWidth, 0]}
            onResize={handleResize}
            onResizeStop={handleResizeStop}
            handle={<div className="sidebar-resize-handle" />}
          >
            <aside className="sidebar" style={{ width: sidebar.visibleSize(maxSidebarWidth) }}>
              {sidebarContent}
            </aside>
          </Resizable>
        )}
        <main className="main">
          <Virtualizer className="main-scroll" contentClassName="main-content">
            <CommentJumper target={jumpTarget} onDone={handleJumpDone} />
            <DiffViewer
              files={displayFiles}
              diffStyle={settings.diffStyle}
              tabSizeMap={tabSizeMap}
              defaultTabSize={settings.defaultTabSize}
              softWrap={settings.softWrap}
              viewedFiles={viewedFiles}
              collapsedFiles={collapsedFiles}
              binaryFiles={binaryFileMap}
              onViewedChange={handleViewedChange}
              onCollapsedChange={setCollapsed}
              fileAnnotationsMap={fileAnnotationsMap}
              onAddComment={addComment}
              onDeleteComment={removeComment}
              onReplyComment={replyToComment}
              onResolveComment={resolveComment}
              onUnresolveComment={unresolveComment}
            />
          </Virtualizer>
        </main>
      </div>
    </div>
  )
}
