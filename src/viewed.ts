import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'diffx-viewed.json'
const FORMAT_VERSION = 1

export type ViewedMap = Record<string, string>

interface ViewedState {
  version: number
  targets: Record<string, ViewedMap>
}

// --absolute-git-dir points at .git for a normal clone and at
// .git/worktrees/<name> for a linked worktree, so each worktree keeps its own
// viewed state without any extra keying.
function getGitDir(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim()
  } catch {
    return null
  }
}

function readState(path: string): ViewedState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ViewedState
    if (parsed?.version === FORMAT_VERSION && parsed.targets != null && typeof parsed.targets === 'object') {
      return parsed
    }
  } catch {
    // Missing, unreadable or written by an older format: nothing is viewed yet.
  }
  return { version: FORMAT_VERSION, targets: {} }
}

/**
 * Viewed state, stored as file path to the blob oid that was viewed. Marking a file
 * viewed is a statement about a version, not about a path: when the content changes
 * the oid changes with it and the client stops counting the file as viewed.
 *
 * Persisted under .git so it survives a restart, is never committed, stays separate
 * per worktree, and goes away with the clone. Entries are kept per diff target,
 * because "viewed" against `master...HEAD` says nothing about the working tree.
 */
export class ViewedStore {
  private readonly path: string | null
  private readonly target: string
  private readonly entries: ViewedMap
  private warned = false

  constructor(target: string) {
    const gitDir = getGitDir()
    this.path = gitDir ? join(gitDir, FILE_NAME) : null
    this.target = target
    this.entries = this.path ? (readState(this.path).targets[target] ?? {}) : {}
  }

  all(): ViewedMap {
    return { ...this.entries }
  }

  set(filePath: string, contentHash: string) {
    this.entries[filePath] = contentHash
    this.persist()
  }

  clear(filePath: string) {
    delete this.entries[filePath]
    this.persist()
  }

  clearAll() {
    for (const filePath of Object.keys(this.entries)) delete this.entries[filePath]
    this.persist()
  }

  // Re-read before writing so another diffx reviewing a different target in the same
  // repository keeps the entries it wrote while this one was running.
  private persist() {
    if (this.path == null) return
    try {
      const state = readState(this.path)
      state.targets[this.target] = this.entries
      writeFileSync(this.path, JSON.stringify(state, null, 2))
    } catch (error) {
      // Losing viewed state is not worth failing a request over, but silently
      // dropping every write would be baffling, so say it once.
      if (!this.warned) {
        this.warned = true
        console.error(`diffx: could not persist viewed state to ${this.path}: ${String(error)}`)
      }
    }
  }
}
