import { useQuery } from '@tanstack/react-query'
import { logScrollEvent, scrollDebugEnabled } from '../scrollDebug'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

const DIFF_KEY = 'diff'

const noBinaryFiles: BinaryFileInfo[] = []
const noTabSizes: Record<string, number> = {}
const noUntrackedFiles: string[] = []

let lastPatch: string | null = null

async function fetchDiff(options: DiffOptions): Promise<DiffData> {
  const res = await fetch(`/api/diff?staged=${options.staged}&untracked=${options.untracked}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as DiffData
  // A poll that comes back byte-identical costs nothing; one that does not remounts cards
  // and is the first thing to rule in or out when the page moved on its own.
  if (scrollDebugEnabled) {
    logScrollEvent('diff polled', {
      bytes: data.patch?.length ?? 0,
      changed: lastPatch != null && lastPatch !== data.patch,
    })
    lastPatch = data.patch ?? null
  }
  return data
}

// The code under review keeps moving while the review is open — a comment is written, the
// agent fixes it — so the diff is re-read on an interval rather than once at load. React
// Query's structural sharing hands back the previous data object when a poll finds nothing
// new, so a quiet repository costs no re-render.
export function useDiff(options: DiffOptions & { enabled?: boolean }) {
  const { staged, untracked, enabled = true } = options
  const { data, isPending, error } = useQuery({
    queryKey: [DIFF_KEY, staged, untracked],
    queryFn: () => fetchDiff({ staged, untracked }),
    refetchInterval: enabled ? 3000 : false,
    enabled,
  })

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? noBinaryFiles,
    tabSizeMap: data?.tabSizeMap ?? noTabSizes,
    untrackedFiles: data?.untrackedFiles ?? noUntrackedFiles,
    loading: isPending,
    // A poll that fails once a diff is on screen is not worth an error screen: the server
    // going away is how a finished review ends, and the page is a snapshot from then on.
    error: data != null ? null : error?.message ?? null,
  }
}
