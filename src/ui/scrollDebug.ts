// Scroll instrumentation for the one question worth asking when the page jumps: who moved
// it. Every writer of scrollTop announces itself here — the scroll pin, the virtualizer's
// own anchor correction, a jump to a comment — so a movement with nobody's name on it is
// itself the answer (the browser clamped the scroll because the content shrank).
//
// On by default while the scroll jump is being chased: an instrumented build nobody
// remembers to switch on catches nothing, and the server picks a fresh port every run, so a
// ?debug= param does not survive a restart. Turn it off with ?debug=none, or by setting
// localStorage 'diffx:debug-scroll' to 'off', which does survive one. When it is off every
// call here returns immediately.

interface ScrollEvent {
  at: number
  name: string
  detail?: Record<string, unknown>
}

const RING_SIZE = 400
// Below this a movement is a rounding artifact of sub-pixel layout, not a jump.
const JUMP_THRESHOLD_PX = 16
// A scroll this soon after a wheel, key, or drag is the reviewer's own, including the tail
// of momentum scrolling on a trackpad.
const USER_SCROLL_GRACE_MS = 700
// Wheel deltas are remembered for this long so a movement can be checked against the input
// that supposedly caused it.
const WHEEL_WINDOW_MS = 400
// How far past the wheel's own travel a movement has to go before it stops being the
// reviewer's scroll and starts being a shove. Trackpads report deltas that the browser then
// scales, so this is deliberately generous.
const WHEEL_OVERSHOOT_FACTOR = 4

function readFlag(): boolean {
  try {
    const requested = new URLSearchParams(window.location.search).get('debug')
    if (requested != null) return requested.split(',').includes('scroll')
    return window.localStorage.getItem('diffx:debug-scroll') !== 'off'
  } catch {
    return true
  }
}

export const scrollDebugEnabled = typeof window !== 'undefined' && readFlag()

const events: ScrollEvent[] = []
let started = false
let lastInput: { at: number; kind: string } = { at: 0, kind: 'none' }
let lastAnchor: Record<string, unknown> | null = null
const wheelDeltas: { at: number; delta: number }[] = []

function stamp(): number {
  return Math.round(performance.now())
}

// Set for the duration of a scroll written by code that owns up to it. Anything that moves
// the scroller while this is null moved it anonymously, which is the case worth a stack.
let writer: string | null = null

// Every programmatic scroll since the last frame was checked, named or not. A jump with this
// empty was made by the browser itself: scroll anchoring, a focus scroll, or native input.
const writesThisFrame: string[] = []

function asWriter<T>(name: string, write: () => T): T {
  const previous = writer
  writer = name
  try {
    return write()
  } finally {
    writer = previous
  }
}

// Native scrolling does not go through the scrollTop setter or scrollTo, so wrapping them
// catches every programmatic move and nothing the reviewer does by hand.
function instrumentScroller(element: HTMLElement) {
  if (!scrollDebugEnabled) return
  const marked = element as HTMLElement & { __diffxInstrumented?: boolean }
  if (marked.__diffxInstrumented === true) return
  marked.__diffxInstrumented = true

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  if (descriptor?.get == null || descriptor.set == null) return
  const { get, set } = descriptor

  const note = (how: string, to: number) => {
    const from = Math.round(get.call(element))
    if (Math.abs(to - from) < 1) return
    writesThisFrame.push(`${writer ?? 'an unnamed caller'} (${how} ${from} → ${Math.round(to)})`)
    if (writer != null) {
      logScrollEvent(`scroll written by ${writer}`, { how, from, to: Math.round(to) })
      return
    }
    logScrollEvent('scroll written by an unnamed caller', {
      how,
      from,
      to: Math.round(to),
      // An Error, not its .stack string: DevTools source-maps and links the frames of a
      // real Error object, and a string of minified frames names nobody.
      where: new Error('scroll written from here'),
    })
  }

  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get() {
      return get.call(element)
    },
    set(value: number) {
      note('scrollTop =', value)
      set.call(element, value)
    },
  })

  const scrollTo = element.scrollTo.bind(element)
  element.scrollTo = function patched(...args: unknown[]) {
    const top = typeof args[0] === 'object' && args[0] != null ? (args[0] as ScrollToOptions).top : args[1]
    if (typeof top === 'number') note('scrollTo', top)
    return scrollTo(...(args as Parameters<typeof scrollTo>))
  } as typeof element.scrollTo

  const scrollBy = element.scrollBy.bind(element)
  element.scrollBy = function patched(...args: unknown[]) {
    const by = typeof args[0] === 'object' && args[0] != null ? (args[0] as ScrollToOptions).top : args[1]
    if (typeof by === 'number') note('scrollBy', get.call(element) + by)
    return scrollBy(...(args as Parameters<typeof scrollBy>))
  } as typeof element.scrollBy
}

export { asWriter }

export function logScrollEvent(name: string, detail?: Record<string, unknown>) {
  if (!scrollDebugEnabled) return
  events.push({ at: stamp(), name, detail })
  if (events.length > RING_SIZE) events.shift()
  // console.log rather than console.debug: debug messages are hidden unless the console's
  // verbose level is on, and a log nobody sees is not instrumentation.
  console.log(`[diffx:scroll +${stamp()}ms] ${name}`, detail ?? '')
}

function recentEvents(sinceMs: number): ScrollEvent[] {
  const cutoff = stamp() - sinceMs
  return events.filter((event) => event.at >= cutoff)
}

// How far the wheel asked the page to travel in the recent past, signed. A movement that
// goes the other way, or much further, was not the reviewer's doing however recently they
// touched the trackpad.
function recentWheelTravel(): number {
  const cutoff = stamp() - WHEEL_WINDOW_MS
  let total = 0
  for (const entry of wheelDeltas) if (entry.at >= cutoff) total += entry.delta
  return total
}

function describeElement(element: Element | null | undefined): string {
  if (element == null) return '(none)'
  const own = element.id !== '' ? `#${element.id}` : element.tagName.toLowerCase()
  // closest() stops at a shadow boundary, so climb out through the hosts by hand: the
  // interesting part of a line deep inside a card is which card it belongs to.
  let node: Node | null = element
  while (node != null) {
    if (node instanceof Element) {
      const card = node.closest('.file-diff-card')
      if (card != null) return `${own} in ${card.id}`
    }
    const root = (node as Element).getRootNode?.()
    node = root instanceof ShadowRoot ? root.host : null
  }
  return own
}

// The two ways the browser scrolls a container without anyone touching scrollTop or
// scrollTo: an element asks to be brought into view, or an element takes focus and the
// browser brings it into view for free. Both honour scroll-margin, which is what makes a
// landing at exactly .file-diff-card's 16px scroll-margin-top worth chasing.
function instrumentNativeScrolls() {
  const scrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function patched(this: Element, ...args: unknown[]) {
    writesThisFrame.push(`scrollIntoView on ${describeElement(this)}`)
    logScrollEvent('scrollIntoView called', {
      on: describeElement(this),
      by: writer ?? 'an unnamed caller',
      args: JSON.stringify(args[0] ?? null),
      where: new Error('scrollIntoView called from here'),
    })
    return scrollIntoView.apply(this, args as Parameters<typeof scrollIntoView>)
  } as typeof scrollIntoView

  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function patched(this: HTMLElement, ...args: unknown[]) {
    writesThisFrame.push(`focus() on ${describeElement(this)}`)
    logScrollEvent('focus() called', {
      on: describeElement(this),
      by: writer ?? 'an unnamed caller',
      where: new Error('focus() called from here'),
    })
    return focus.apply(this, args as Parameters<typeof focus>)
  } as typeof focus

  // Focus can also land without focus() being called — a click, or the browser moving it
  // when the focused node is removed. Either way the browser may scroll to it.
  document.addEventListener(
    'focusin',
    (event) => logScrollEvent('focus moved', { to: describeElement(event.target as Element) }),
    true,
  )
}

// The virtualizer publishes its instance on window during setup. Wrapping its three scroll
// methods is what makes its corrections visible: getScrollAnchor is the choice of what to
// hold still, scrollFix decides whether it can still find that thing, and applyScrollFix is
// the one that actually moves the page.
function instrumentVirtualizer(): boolean {
  const instance = (window as unknown as { __INSTANCE?: Record<string, unknown> }).__INSTANCE
  if (instance == null || instance.__diffxInstrumented === true) return instance != null

  try {
    const applyScrollFix = instance.applyScrollFix as (offset: number) => void
    instance.applyScrollFix = function patched(this: Record<string, unknown>, offset: number) {
      const root = this.root as HTMLElement | undefined
      const before = root?.scrollTop ?? 0
      const result = asWriter('the virtualizer', () => applyScrollFix.call(this, offset))
      logScrollEvent('virtualizer correction', {
        offset: Math.round(offset),
        scrollTop: `${Math.round(before)} → ${Math.round(root?.scrollTop ?? 0)}`,
        anchor: lastAnchor,
      })
      return result
    }

    // scrollFix re-finds the anchored line in the file's shadow root *after* the render. If
    // virtualization unmounted that line, it silently falls back to holding the file's top
    // or bottom edge instead — which is a different promise, because lines above the
    // viewport inside that same file have just swapped between real and estimated heights.
    // That fallback is the prime suspect for a jump, so it gets called out by name.
    const scrollFix = instance.scrollFix as (anchor: unknown) => void
    instance.scrollFix = function patched(this: Record<string, unknown>, anchor: unknown) {
      const typed = anchor as
        | { fileElement?: HTMLElement; lineIndex?: string; lineOffset?: number; fileTypeOffset?: string }
        | undefined
      if (typed != null) {
        const wanted = typed.lineIndex
        const found =
          wanted == null
            ? null
            : typed.fileElement?.shadowRoot?.querySelector(`[data-line][data-line-index="${wanted}"]`) ?? null
        if (wanted != null && found == null) {
          logScrollEvent('anchor line lost, holding the file edge instead', {
            file: describeElement(typed.fileElement),
            lineIndex: wanted,
            edge: typed.fileTypeOffset,
          })
        } else if (wanted == null) {
          logScrollEvent('no line anchor, holding the file edge', {
            file: describeElement(typed.fileElement),
            edge: typed.fileTypeOffset,
          })
        }
      }
      return scrollFix.call(this, anchor)
    }

    const getScrollAnchor = instance.getScrollAnchor as (height: number) => unknown
    instance.getScrollAnchor = function patched(this: Record<string, unknown>, height: number) {
      const anchor = getScrollAnchor.call(this, height) as
        | { fileElement?: HTMLElement; fileOffset?: number; fileTypeOffset?: string; lineIndex?: string; lineOffset?: number }
        | undefined
      const root = this.root as HTMLElement | undefined
      lastAnchor = anchor == null
        ? null
        : {
            file: describeElement(anchor.fileElement),
            attached: anchor.fileElement?.isConnected ?? false,
            edge: anchor.fileTypeOffset,
            fileOffset: anchor.fileOffset == null ? null : Math.round(anchor.fileOffset),
            lineIndex: anchor.lineIndex ?? null,
            lineOffset: anchor.lineOffset == null ? null : Math.round(anchor.lineOffset),
          }
      // getScrollAnchor only considers a file's lines when fileTop < the height it is handed,
      // and it is handed the cached field rather than a fresh measurement. A stale or zero
      // height therefore rules out every line anchor and forces file-edge anchoring.
      const real = root?.clientHeight ?? 0
      if (height <= 0 || Math.abs(height - real) > 1) {
        logScrollEvent('anchor computed with a stale viewport height', {
          usedHeight: Math.round(height),
          actualHeight: Math.round(real),
          gotLineAnchor: anchor?.lineIndex != null,
        })
      }
      return anchor
    }

    instrumentFileInstances(instance)
    instance.__diffxInstrumented = true
    logScrollEvent('virtualizer instrumented')
    return true
  } catch (error) {
    console.warn('[diffx:scroll] could not instrument the virtualizer', error)
    return true
  }
}

// The once-per-frame poller can only see what survived to the end of a frame, so a height
// that collapses and comes back inside one frame is invisible to it — and that is exactly
// what a clamp needs: content briefly too short to hold the scroll position, the browser
// pinning scrollTop to the new maximum, then the content returning. A scroll listener reads
// the height at the moment the browser moved it, which settles whether that is what happens.
function watchForClamping(scroller: HTMLElement) {
  let previousTop = scroller.scrollTop

  scroller.addEventListener(
    'scroll',
    () => {
      const top = scroller.scrollTop
      const scrollHeight = scroller.scrollHeight
      const clientHeight = scroller.clientHeight
      const maxScroll = Math.max(0, scrollHeight - clientHeight)
      if (Math.abs(top - previousTop) >= JUMP_THRESHOLD_PX) {
        logScrollEvent('scroll event', {
          scrollTop: `${Math.round(previousTop)} → ${Math.round(top)}`,
          scrollHeight,
          maxScroll,
          // The tell: the page is sitting at a maximum that has just shrunk under it.
          pinnedToAShrunkMaximum: top >= maxScroll - 1 && top < previousTop,
          focus: describeElement(document.activeElement),
        })
      }
      previousTop = top
    },
    { passive: true, capture: true },
  )

  const content = scroller.firstElementChild
  if (content instanceof HTMLElement) {
    new ResizeObserver((entries) => {
      for (const entry of entries) {
        logScrollEvent('content resized', {
          height: Math.round(entry.contentRect.height),
          scrollTop: Math.round(scroller.scrollTop),
        })
      }
    }).observe(content)
  }
}

// Each file the virtualizer knows about is a CodeView, whose reset() empties the rendered
// lines, clears the spacer height and removes the container's explicit height — a file
// collapsing to nothing in one step. If a reset lands next to a jump, that is the answer, so
// the prototype is wrapped once and every file is covered.
function instrumentFileInstances(virtualizer: Record<string, unknown>) {
  const observers = virtualizer.observers as Map<unknown, Record<string, unknown>> | undefined
  const first = observers == null ? undefined : [...observers.values()][0]
  if (first == null) return

  // The CodeView may be the instance itself or hang off it, so check both before giving up.
  const candidates = [first, ...Object.values(first).filter((value): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && typeof (value as Record<string, unknown>).reset === 'function')]

  for (const candidate of candidates) {
    const prototype = Object.getPrototypeOf(candidate) as Record<string, unknown> & { __diffxInstrumented?: boolean }
    if (prototype == null || prototype.__diffxInstrumented === true) continue
    if (typeof prototype.reset !== 'function') continue

    const reset = prototype.reset as () => void
    prototype.reset = function patched(this: Record<string, unknown>) {
      logScrollEvent('CodeView reset — the file collapses to nothing here', {
        file: describeElement(this.root as Element | undefined),
        where: new Error('reset() called from here'),
      })
      return reset.call(this)
    }
    prototype.__diffxInstrumented = true
    logScrollEvent('file instances instrumented', { methods: Object.getOwnPropertyNames(prototype).length })
  }
}

interface ReaderSample {
  element: Element
  label: string
  top: number
}

// The line under the middle of the viewport, found by descending through each shadow root,
// since every diff line lives inside a card's. Following it from frame to frame shows what
// the reviewer saw, which the scroll position alone cannot: anchoring moves scrollTop *and*
// the content by the same amount, so the page jumps in the numbers and holds still on screen.
function sampleReader(scroller: HTMLElement): ReaderSample | null {
  const box = scroller.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  let element = document.elementFromPoint(x, y)
  while (element?.shadowRoot != null) {
    const inner = element.shadowRoot.elementFromPoint(x, y)
    if (inner == null || inner === element) break
    element = inner
  }
  if (element == null) return null
  const line = element.closest('[data-line]') ?? element
  const index = line.getAttribute('data-line-index')
  return {
    element: line,
    label: `${describeElement(line)}${index == null ? '' : ` line-index ${index}`}`,
    top: line.getBoundingClientRect().top,
  }
}

function describeReader(before: ReaderSample | null, after: ReaderSample | null, moved: number): string {
  if (before == null || after == null) return 'could not find a line under the viewport'
  if (before.element !== after.element) {
    if (!before.element.isConnected) return `the line being read (${before.label}) was removed from the page; now ${after.label}`
    const shifted = Math.round(before.element.getBoundingClientRect().top - before.top)
    return `on screen ${shifted}px (a plain scroll would be ${-moved}px); ${before.label} → now centred: ${after.label}`
  }
  const shifted = Math.round(after.top - before.top)
  return `on screen ${shifted}px (a plain scroll would be ${-moved}px): ${after.label}` +
    (Math.abs(shifted) < 2 ? ' — held still, so the content moved under scrollTop (anchoring-style correction)' : '')
}

function report(
  scroller: HTMLElement,
  from: number,
  to: number,
  heightBefore: number,
  heightAfter: number,
  why: string,
  reader: string,
  writes: string[],
) {
  const sinceInput = stamp() - lastInput.at
  const wheel = recentWheelTravel()
  // Into the ring as well as the console, so a copied log carries the verdicts and not just
  // the events around them.
  events.push({
    at: stamp(),
    name: `UNEXPLAINED JUMP ${from} → ${to} — ${why}`,
    detail: {
      scrollHeight: `${heightBefore} → ${heightAfter}`,
      clientHeight: scroller.clientHeight,
      lastInput: `${lastInput.kind} ${sinceInput}ms ago`,
      wheelTravel: Math.round(wheel),
      writers: writes.length === 0 ? 'NONE (the browser moved it on its own)' : writes,
      reader,
      overflowAnchor: getComputedStyle(scroller).overflowAnchor || '(unsupported)',
      anchor: lastAnchor,
    },
  })
  if (events.length > RING_SIZE) events.shift()
  console.group(
    `%c[diffx:scroll] unexplained jump ${from} → ${to} (${to - from > 0 ? '+' : ''}${to - from}px) — ${why}`,
    'color:#c33;font-weight:bold',
  )
  console.log('scrollHeight', heightBefore, '→', heightAfter, `(clientHeight ${scroller.clientHeight})`)
  console.log(
    'clamped by shrinking content:',
    to === Math.max(0, heightAfter - scroller.clientHeight) && heightAfter < heightBefore,
  )
  console.log('last input', lastInput.kind, `${sinceInput}ms ago`, `wheel travel in the last ${WHEEL_WINDOW_MS}ms: ${Math.round(wheel)}px`)
  console.log('focus is on', describeElement(document.activeElement))
  console.log(
    'code that wrote the scroll this frame:',
    writes.length === 0 ? 'NONE (the browser moved it on its own)' : writes.join('; '),
  )
  console.log('the line being read moved', reader)
  console.log('overflow-anchor on the scroller:', getComputedStyle(scroller).overflowAnchor || '(unsupported)')
  // Strings rather than expandable objects, so a screenshot or a copy of the console carries
  // everything without having to click anything open first.
  console.log('virtualizer anchor at the time', JSON.stringify(lastAnchor))
  console.log(
    'last 3s:\n' +
      recentEvents(3000)
        .map((event) => `  -${stamp() - event.at}ms ${event.name} ${describeDetail(event.detail, false)}`)
        .join('\n'),
  )
  console.groupEnd()
}

// Errors are kept in details so DevTools can link their frames, but they serialize to {}.
// Copied text keeps the top of the stack instead, which is enough to name the caller.
function describeDetail(detail: Record<string, unknown> | undefined, withStacks: boolean): string {
  if (detail == null) return ''
  return JSON.stringify(detail, (_key, value: unknown) => {
    if (!(value instanceof Error)) return value
    return withStacks ? value.stack?.split('\n').slice(0, 4).join(' | ') : undefined
  })
}

// The whole ring as plain text, headed with what the browser is, since whether it does scroll
// anchoring at all is the first thing to know about any jump in it.
export function scrollLogText(): string {
  const scroller = document.querySelector<HTMLElement>('.main-scroll')
  const header = [
    `diffx scroll log, ${new Date().toISOString()}, now +${stamp()}ms`,
    `browser: ${navigator.userAgent}`,
    `scroll anchoring supported: ${CSS.supports('overflow-anchor', 'auto')}`,
    `overflow-anchor on the scroller: ${scroller == null ? '(no scroller)' : getComputedStyle(scroller).overflowAnchor || '(unsupported)'}`,
    `page: ${window.location.pathname}${window.location.search}`,
    '',
  ]
  return [...header, ...events.map((event) => `+${event.at}ms ${event.name} ${describeDetail(event.detail, true)}`)].join('\n')
}

// A jump that only happens when the page is otherwise still is the easy case. The one being
// chased here happens *while* the reviewer is scrolling, so "they touched the trackpad
// recently" cannot be the test — it is true by definition. Compare the movement against what
// the wheel actually asked for instead: backwards, or several times further, is not theirs.
function classifyMovement(from: number, to: number): string | null {
  const moved = to - from
  if (Math.abs(moved) < JUMP_THRESHOLD_PX) return null

  const sinceInput = stamp() - lastInput.at
  if (sinceInput > USER_SCROLL_GRACE_MS) return 'nothing was touching the page'

  const wheel = recentWheelTravel()
  // A drag of the scrollbar or a keypress reports no distance, so there is nothing to check
  // the movement against; only the wheel can be held to account.
  if (wheel === 0) return lastInput.kind === 'wheel' ? 'the wheel had gone quiet' : null
  if (Math.sign(moved) !== Math.sign(wheel)) return `moved against the wheel (wheel asked for ${Math.round(wheel)}px)`
  if (Math.abs(moved) > Math.abs(wheel) * WHEEL_OVERSHOOT_FACTOR + JUMP_THRESHOLD_PX) {
    return `overshot the wheel (wheel asked for ${Math.round(wheel)}px)`
  }
  return null
}

export function startScrollDebug() {
  if (!scrollDebugEnabled || started) return
  started = true

  console.log(
    '%c[diffx] scroll debugging is on.%c Reproduce the jump, then use %cCopy scroll debug log%c in the settings menu to paste it back.',
    'color:#39c;font-weight:bold',
    'color:inherit',
    'font-family:monospace',
    'color:inherit',
  )
  ;(window as unknown as { __diffxScrollLog: () => ScrollEvent[] }).__diffxScrollLog = () => {
    console.table(events.map((event) => ({ at: event.at, event: event.name, detail: JSON.stringify(event.detail ?? {}) })))
    return events
  }

  instrumentNativeScrolls()

  const noteInput = (kind: string) => (event: Event) => {
    lastInput = { at: stamp(), kind }
    if (kind === 'wheel') {
      wheelDeltas.push({ at: stamp(), delta: (event as WheelEvent).deltaY })
      const cutoff = stamp() - WHEEL_WINDOW_MS
      while (wheelDeltas.length > 0 && wheelDeltas[0].at < cutoff) wheelDeltas.shift()
    }
  }
  for (const kind of ['wheel', 'keydown', 'mousedown', 'touchstart', 'touchmove'] as const) {
    window.addEventListener(kind, noteInput(kind), { passive: true, capture: true })
  }

  let scroller: HTMLElement | null = null
  let previousTop = 0
  let previousHeight = 0
  let instrumented = false
  let previousReader: ReaderSample | null = null

  const tick = () => {
    if (!instrumented) instrumented = instrumentVirtualizer()

    const found = document.querySelector<HTMLElement>('.main-scroll')
    if (found == null) {
      requestAnimationFrame(tick)
      return
    }
    if (found !== scroller) {
      scroller = found
      previousTop = found.scrollTop
      previousHeight = found.scrollHeight
      instrumentScroller(found)
      watchForClamping(found)
      // ?anchor=auto turns browser scroll anchoring back on, to A/B it against the fix.
      const anchorOverride = new URLSearchParams(window.location.search).get('anchor')
      if (anchorOverride != null) found.style.overflowAnchor = anchorOverride
      logScrollEvent('watching scroller', {
        scrollTop: previousTop,
        scrollHeight: previousHeight,
        overflowAnchor: getComputedStyle(found).overflowAnchor || '(unsupported)',
        anchoringSupported: CSS.supports('overflow-anchor', 'auto'),
        browser: navigator.userAgent,
      })
    }

    const top = scroller.scrollTop
    const height = scroller.scrollHeight
    // The content growing or shrinking under a fixed scrollTop is what moves the reader,
    // so it is worth seeing even on the frames where nothing scrolled.
    if (height !== previousHeight) {
      logScrollEvent('content height changed', {
        scrollHeight: `${previousHeight} → ${height}`,
        by: height - previousHeight,
        scrollTop: Math.round(top),
      })
    }
    const reader = sampleReader(scroller)
    const why = classifyMovement(previousTop, top)
    if (why != null) {
      report(scroller, previousTop, top, previousHeight, height, why, describeReader(previousReader, reader, top - previousTop), [...writesThisFrame])
    } else if (Math.abs(top - previousTop) >= JUMP_THRESHOLD_PX) {
      logScrollEvent('scrolled by hand', { from: previousTop, to: top, input: lastInput.kind })
    }
    previousTop = top
    previousHeight = height
    previousReader = reader
    writesThisFrame.length = 0
    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}
