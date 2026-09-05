// ===========================================================================
// Local behaviour customisations for obsidian.arda.internal.
// Paired with quartz/styles/custom.scss. Loaded as a beforeDOMLoaded resource
// so the scrollIntoView patch below is installed before the explorer runs.
// ===========================================================================

// Must match $compact / $roomy in custom.scss (Quartz's desktop breakpoint).
const COMPACT = "(max-width: 1200px)"

const SIDEBAR_KEY = "qz-sidebar-collapsed"
const SECTIONS_KEY = "qz-open-sections"

// ---------------------------------------------------------------------------
// 1. Keep the explorer's "scroll to active note" inside the explorer
// ---------------------------------------------------------------------------
// explorer.inline.ts does `activeElement.scrollIntoView({ behavior: "smooth" })`
// when restoring the tree. scrollIntoView scrolls *every* scrollable ancestor,
// including the document, so simply opening a note scrolled the article out of
// view. Measured on this vault before the fix: the page landed at scrollY 228
// with no user input, and expanding folders drove it to 1467.
//
// Constrain the scroll to the explorer's own list. Everything else keeps the
// native behaviour, so in-page anchors and the TOC are untouched.
type ScrollTarget = Element & { closest(sel: string): Element | null }

if (!(window as unknown as Record<string, unknown>).__qzScrollPatched) {
  ;(window as unknown as Record<string, unknown>).__qzScrollPatched = true

  const native = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (
    this: ScrollTarget,
    arg?: boolean | ScrollIntoViewOptions,
  ): void {
    const list = this.closest(".explorer-ul") as HTMLElement | null
    if (list && list.scrollHeight > list.clientHeight) {
      const behavior =
        typeof arg === "object" && arg !== null && arg.behavior ? arg.behavior : "auto"
      const listBox = list.getBoundingClientRect()
      const selfBox = this.getBoundingClientRect()
      // centre the active item in the list without touching the document
      const delta = selfBox.top - listBox.top - (listBox.height - selfBox.height) / 2
      list.scrollTo({ top: list.scrollTop + delta, behavior })
      return
    }
    return native.call(this, arg as ScrollIntoViewOptions)
  }
}

// ---------------------------------------------------------------------------
// Observers are re-created per navigation; keep handles so SPA navs don't leak.
// ---------------------------------------------------------------------------
let observers: MutationObserver[] = []

function releaseObservers() {
  for (const o of observers) o.disconnect()
  observers = []
}

function readSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]")
    return new Set(Array.isArray(raw) ? (raw as string[]) : [])
  } catch {
    return new Set()
  }
}

// ---------------------------------------------------------------------------
// 2. Scrim behind the explorer drawer (compact range)
// ---------------------------------------------------------------------------
function wireDrawer() {
  const explorer = document.querySelector<HTMLElement>(".explorer")
  if (!explorer) return

  let scrim = document.querySelector<HTMLElement>(".qz-scrim")
  if (!scrim) {
    scrim = document.createElement("div")
    scrim.className = "qz-scrim"
    scrim.setAttribute("aria-hidden", "true")
    document.body.appendChild(scrim)
  }

  const hamburger = () => explorer.querySelector<HTMLElement>("button.mobile-explorer")

  const sync = () => {
    const open =
      !explorer.classList.contains("collapsed") && window.matchMedia(COMPACT).matches
    scrim!.classList.toggle("qz-visible", open)
  }

  // Close by clicking the plugin's own toggle rather than editing classes
  // directly, so its internal state (lock-scroll, mobile-no-scroll) stays right.
  scrim.onclick = () => hamburger()?.click()

  document.onkeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return
    if (explorer.classList.contains("collapsed")) return
    if (!window.matchMedia(COMPACT).matches) return
    hamburger()?.click()
  }

  const mo = new MutationObserver(sync)
  mo.observe(explorer, { attributes: true, attributeFilter: ["class"] })
  observers.push(mo)

  window.matchMedia(COMPACT).onchange = sync
  sync()
}

// ---------------------------------------------------------------------------
// 3. Collapsible left sidebar (desktop only)
// ---------------------------------------------------------------------------
// The compact range already has the explorer's hamburger, so this button is
// hidden below 1200px — exactly one visible control at any width.
const TOGGLE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`

function wireSidebarToggle() {
  const page = document.querySelector<HTMLElement>(".page")
  const sidebar = document.querySelector<HTMLElement>(".sidebar.left")
  if (!page || !sidebar) return

  if (localStorage.getItem(SIDEBAR_KEY) === "1") {
    page.classList.add("qz-sidebar-collapsed")
  }

  let btn = sidebar.querySelector<HTMLButtonElement>(".qz-sidebar-toggle")
  if (!btn) {
    btn = document.createElement("button")
    btn.type = "button"
    btn.className = "qz-sidebar-toggle"
    btn.innerHTML = TOGGLE_ICON
    sidebar.insertBefore(btn, sidebar.firstChild)
  }

  const describe = () => {
    const collapsed = page.classList.contains("qz-sidebar-collapsed")
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar"
    btn!.setAttribute("aria-label", label)
    btn!.setAttribute("aria-expanded", String(!collapsed))
    btn!.title = label
  }

  btn.onclick = () => {
    const collapsed = page.classList.toggle("qz-sidebar-collapsed")
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0")
    describe()
    // the graph reads offsetWidth once at draw time and has no ResizeObserver,
    // so it needs an explicit nudge after the column width changes
    document.dispatchEvent(new CustomEvent("render"))
  }

  describe()
}

// ---------------------------------------------------------------------------
// 4. Collapsible graph / backlinks (compact range)
// ---------------------------------------------------------------------------
// These used to occupy a fixed ~286px-tall row above the footer on every page.
function wireRightSidebar() {
  const right = document.querySelector<HTMLElement>(".sidebar.right")
  if (!right) return

  const compact = window.matchMedia(COMPACT).matches
  const open = readSet(SECTIONS_KEY)

  for (const name of ["graph", "backlinks"]) {
    const section = right.querySelector<HTMLElement>(`.${name}`)
    const heading = section?.querySelector<HTMLElement>("h3")
    if (!section || !heading) continue

    if (!compact) {
      // restore the untouched desktop presentation
      section.classList.remove("qz-collapsible", "qz-open")
      heading.removeAttribute("role")
      heading.removeAttribute("tabindex")
      heading.removeAttribute("aria-expanded")
      heading.onclick = null
      heading.onkeydown = null
      continue
    }

    section.classList.add("qz-collapsible")
    section.classList.toggle("qz-open", open.has(name))
    heading.setAttribute("role", "button")
    heading.setAttribute("tabindex", "0")
    heading.setAttribute("aria-expanded", String(open.has(name)))

    const toggle = () => {
      const isOpen = section.classList.toggle("qz-open")
      const next = readSet(SECTIONS_KEY)
      if (isOpen) next.add(name)
      else next.delete(name)
      localStorage.setItem(SECTIONS_KEY, JSON.stringify([...next]))
      heading.setAttribute("aria-expanded", String(isOpen))
      // graph canvas is sized from offsetWidth, which is 0 while display:none
      if (isOpen && name === "graph") {
        document.dispatchEvent(new CustomEvent("render"))
      }
    }

    heading.onclick = toggle
    heading.onkeydown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      toggle()
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring. Quartz dispatches `nav` on first load as well as on SPA navigation,
// and `prenav` before tearing the page down.
// ---------------------------------------------------------------------------
document.addEventListener("prenav", releaseObservers)

document.addEventListener("nav", () => {
  releaseObservers()
  wireDrawer()
  wireSidebarToggle()
  wireRightSidebar()
})

// Re-evaluate the breakpoint-dependent wiring on rotate / resize.
window.addEventListener("resize", () => {
  wireRightSidebar()
})
