/* =====================================================================
   HAPAG KIOSK — application controller.

   Architecture:
   - Kiosk-style single-screen layout: sidebar categories, scrollable
     grid, bottom action bar with My Kitchen / Saved / History buttons.
   - State is managed through setState → rAF render, same pattern as v1.
   - Views: browse (default), kitchen, saved, history.
   ===================================================================== */

import {
  CATEGORIES,
  INGREDIENT_GROUPS,
  INGREDIENT_TO_GROUP,
  KIOSK_CATEGORIES,
  KIOSK_CAT_FILTER,
  PANTRY_STAPLES,
  SKILL_LEVELS,
  VIANDS,
} from "./data.js"

/* ------------------------------------------------------------------ utils */

const debounce = (fn, ms) => {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

/** Collect every [data-ref] descendant of a root into a plain lookup object. */
function refsOf(root) {
  const map = {}
  for (const el of root.querySelectorAll("[data-ref]")) map[el.dataset.ref] = el
  return map
}

const ui = refsOf(document)

const fmtTime = (min) =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ""}`.trim() : `${min} min`
const fmtDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/* Emoji map per category for card photo placeholders */
const CAT_EMOJI = {
  Chicken: "🍗",
  Pork: "🥩",
  Beef: "🥩",
  Seafood: "🦐",
  Vegetable: "🥬",
  Soup: "🍲",
  Stew: "🍛",
}

/* Photo gradient CSS var per category */
const CAT_PHOTO = {
  Chicken: "var(--photo-chicken)",
  Pork: "var(--photo-pork)",
  Beef: "var(--photo-beef)",
  Seafood: "var(--photo-seafood)",
  Vegetable: "var(--photo-vegetable)",
  Soup: "var(--photo-soup)",
  Stew: "var(--photo-stew)",
}

const photoFor = (viand) => CAT_PHOTO[viand.cats[0]] || "var(--photo-default)"
const emojiFor = (viand) => CAT_EMOJI[viand.cats[0]] || "🍽️"

/* ------------------------------------------------------------------ state */

const STORE_KEY = "hapag.v2"
const CUSTOM_VIANDS_KEY = "hapag.custom_viands"

const state = {
  view: "browse",       // browse | kitchen | saved | history
  query: "",
  kioskCategory: "ALL",
  sort: "best",
  selected: [],         // My Kitchen ingredients
  favorites: [],        // Saved recipe IDs
  history: [],
  progress: {},         // Cooking checklist progress
  openPicker: null,
  pickerFilter: {},
  activeId: null,       // Recipe sheet
  cookId: null,         // Cooking checklist
  ingredientOverrides: {}, // Recipe ingredient on-hand toggles per recipe ID
  webSearchQuery: "",   // Query for active web search fallback
  webSearchResults: [], // Dishes returned from web search fallback
  isWebSearching: false,// Boolean if web search is currently in-flight
}

/* Common pantry staples automatically considered on hand in every kitchen */
const PANTRY_STAPLES_LIST = [
  "salt", "asin",
  "pepper", "peppercorn", "paminta",
  "water", "tubig",
  "oil", "cooking oil", "mantika",
  "sugar", "asukal",
  "rice", "kanin",
]

function isPantryStaple(text) {
  const t = (text || "").toLowerCase()
  return PANTRY_STAPLES_LIST.some((s) => {
    const regex = new RegExp(`\\b${s}\\b`, "i")
    return regex.test(t)
  })
}

function resolveRecipeUrl(viand) {
  const searchTerm = (viand.name || viand.fname || "").trim()
  return `https://panlasangpinoy.com/?s=${encodeURIComponent(searchTerm)}`
}

function persistCustomViands(newViands = []) {
  try {
    const existing = JSON.parse(localStorage.getItem(CUSTOM_VIANDS_KEY) || "[]")
    const map = new Map(existing.map((v) => [v.id, v]))
    for (const v of newViands) {
      if (v && v.id) map.set(v.id, v)
    }
    const combined = Array.from(map.values()).slice(-60)
    localStorage.setItem(CUSTOM_VIANDS_KEY, JSON.stringify(combined))
  } catch {}
}

function hydrate() {
  try {
    // Restore any previously searched/saved custom web dishes
    const savedCustom = JSON.parse(localStorage.getItem(CUSTOM_VIANDS_KEY) || "[]")
    if (Array.isArray(savedCustom)) {
      for (const v of savedCustom) {
        if (v && v.id) {
          viandById.set(v.id, v)
        }
      }
    }

    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}")
    const known = new Set(Object.values(INGREDIENT_GROUPS).flat())
    if (Array.isArray(saved.selected)) state.selected = saved.selected.filter((i) => known.has(i))
    if (Array.isArray(saved.favorites))
      state.favorites = saved.favorites.filter((id) => viandById.has(id))
    if (Array.isArray(saved.history)) state.history = saved.history.slice(0, 40)
    if (saved.progress && typeof saved.progress === "object") state.progress = saved.progress
  } catch {
    /* Corrupt or unavailable storage is not an error worth surfacing. */
  }
}

const persist = debounce(() => {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        selected: state.selected,
        favorites: state.favorites,
        history: state.history,
        progress: state.progress,
      }),
    )
  } catch {
    /* Private-mode storage failure must not break the session. */
  }
}, 200)

let frame = null
function setState(patch) {
  Object.assign(state, patch)
  persist()
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = null
    render()
  })
}

/* --------------------------------------------------------------- selectors */

const viandById = new Map(VIANDS.map((v) => [v.id, v]))
const selectedSet = () => new Set(state.selected)

function matchOf(viand, sel = selectedSet()) {
  const have = viand.ing.filter((i) => sel.has(i) || isPantryStaple(i))
  const missing = viand.ing.filter((i) => !sel.has(i) && !isPantryStaple(i))
  const total = viand.ing.length || 1
  return { have, missing, pct: Math.round((have.length / total) * 100) }
}

function browseList() {
  const q = state.query.trim().toLowerCase()
  const catFilter = KIOSK_CAT_FILTER[state.kioskCategory] || (() => true)
  return VIANDS.filter((v) => {
    if (!catFilter(v)) return false
    if (!q) return true
    return `${v.name} ${v.fname} ${v.ing.join(" ")} ${v.cats.join(" ")}`.toLowerCase().includes(q)
  })
}

function matchList() {
  if (!state.selected.length) return []
  const sel = selectedSet()

  const selProteins = state.selected.filter((i) => INGREDIENT_TO_GROUP[i] === "Protein")

  const rows = VIANDS.map((v) => ({ viand: v, ...matchOf(v, sel) })).filter((r) => {
    // Must have at least 1 matching ingredient
    if (r.have.length === 0) return false

    // If proteins are selected, recipe should contain at least one of the selected proteins
    if (selProteins.length > 0 && !r.viand.ing.some((i) => selProteins.includes(i))) return false

    // Pantry and Aromatics are NOT mandatory filters; having them simply contributes to "On hand" status
    return true
  })

  if (state.sort === "az") return rows.sort((a, b) => a.viand.name.localeCompare(b.viand.name))
  if (state.sort === "quick") return rows.sort((a, b) => a.viand.minutes - b.viand.minutes)
  return rows.sort((a, b) => a.missing.length - b.missing.length || b.have.length - a.have.length)
}

const stepsOf = (id) => {
  const viand = viandById.get(id)
  const saved = state.progress[id]
  return Array.isArray(saved) && saved.length === viand.steps.length
    ? saved
    : viand.steps.map(() => false)
}

/* ---------------------------------------------------------------- actions */

function switchView(view) {
  if (view === state.view) return
  setState({ view })
}

function toggleIngredient(name) {
  const next = state.selected.includes(name)
    ? state.selected.filter((i) => i !== name)
    : [...state.selected, name]
  setState({ selected: next })
}

function toggleFavorite(id) {
  const next = state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [id, ...state.favorites]
  setState({ favorites: next })
}

function log(kind, id) {
  const viand = viandById.get(id)
  const entry = { kind, id, name: viand.name, fname: viand.fname, ts: Date.now() }
  const deduped = state.history.filter((h) => !(h.id === id && h.kind === kind && entry.ts - h.ts < 60_000))
  setState({ history: [entry, ...deduped].slice(0, 40) })
}

function setStep(id, index, value) {
  const steps = [...stepsOf(id)]
  steps[index] = value
  setState({ progress: { ...state.progress, [id]: steps } })
}

/* ------------------------------------------------------- reveal observer */

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add("is-visible")
      revealObserver.unobserve(entry.target)
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
)

/* ============================================================== SIDEBAR */

const sidebarScroll = ui.sidebarScroll

const sidebarButtons = KIOSK_CATEGORIES.map((cat) => {
  const btn = document.createElement("button")
  btn.className = "sidebar-btn"
  btn.type = "button"
  btn.textContent = cat.label
  btn.dataset.cat = cat.key
  btn.setAttribute("aria-pressed", "false")
  return btn
})
sidebarScroll.replaceChildren(...sidebarButtons)

/* ============================================================ DISH PHOTOS */

const EXACT_DISH_PHOTOS = {
  1: "./images/dishes/dish-1.jpg",   // Chicken Adobo
  2: "./images/dishes/dish-2.jpg",   // Pork Adobo
  3: "./images/dishes/dish-3.jpg",   // Sinigang na Baboy
  4: "./images/dishes/dish-4.jpg",   // Sinigang na Hipon
  5: "./images/dishes/dish-5.jpg",   // Kare-Kare
  6: "./images/dishes/dish-6.jpg",   // Beef Caldereta
  7: "./images/dishes/dish-7.jpg",   // Chicken Tinola
  8: "./images/dishes/dish-8.jpg",   // Bicol Express
  9: "./images/dishes/dish-9.jpg",   // Chicken Curry
  10: "./images/dishes/dish-10.jpg", // Beef Nilaga
  11: "./images/dishes/dish-11.jpg", // Pork Menudo
  12: "./images/dishes/dish-12.jpg", // Chicken Afritada
  13: "./images/dishes/dish-13.jpg", // Ginataang Gulay
  14: "./images/dishes/dish-14.jpg", // Laing
  15: "./images/dishes/dish-15.jpg", // Pinakbet
  16: "./images/dishes/dish-16.jpg", // Grilled Bangus
  17: "./images/dishes/dish-17.jpg", // Ginisang Monggo
  18: "./images/dishes/dish-18.jpg", // Crispy Pata
  19: "./images/dishes/dish-19.jpg", // Chopsuey
  20: "./images/dishes/dish-20.jpg", // Sinigang na Baka
}

// Authentic Filipino cooking style fallback photos for offline resilience
const FILIPINO_STYLE_FALLBACKS = {
  soup: "./images/dishes/dish-3.jpg",       // Authentic Sinigang tamarind broth
  tinola: "./images/dishes/dish-7.jpg",     // Authentic Tinola ginger broth
  nilaga: "./images/dishes/dish-10.jpg",    // Authentic Nilaga clear broth
  stew: "./images/dishes/dish-6.jpg",       // Authentic Caldereta tomato-liver stew
  gata: "./images/dishes/dish-13.jpg",      // Authentic Ginataan coconut milk stew
  adobo: "./images/dishes/dish-1.jpg",      // Authentic Adobo soy-vinegar braise
  vegetable: "./images/dishes/dish-15.jpg", // Authentic Pinakbet native vegetables
  seafood: "./images/dishes/dish-4.jpg",    // Authentic Sinigang na Hipon
  fish: "./images/dishes/dish-16.jpg",      // Authentic Inihaw na Bangus
  pork: "./images/dishes/dish-2.jpg",       // Authentic Pork Adobo / Liempo
  beef: "./images/dishes/dish-6.jpg",       // Authentic Beef Caldereta
  chicken: "./images/dishes/dish-1.jpg",    // Authentic Chicken Adobo
  default: "./images/dishes/dish-1.jpg",    // Authentic Chicken Adobo
}

function resolveDishImageUrl(viand) {
  if (!viand) return FILIPINO_STYLE_FALLBACKS.default

  // Tier 1: Exact dish ID (1-20 for core recipes)
  if (viand.id && EXACT_DISH_PHOTOS[viand.id]) {
    return EXACT_DISH_PHOTOS[viand.id]
  }

  // Tier 2: Valid dynamic web photo or cached URL
  if (viand.imageUrl && typeof viand.imageUrl === "string" && (viand.imageUrl.startsWith("./") || viand.imageUrl.startsWith("images/") || viand.imageUrl.startsWith("http"))) {
    return viand.imageUrl
  }

  // Tier 3: Cooking style & ingredients heuristic (offline fallback)
  const nameText = `${viand.name || ""} ${viand.fname || ""}`.toLowerCase()
  const fullText = `${nameText} ${(viand.cats || []).join(" ")} ${(viand.ing || []).join(" ")}`.toLowerCase()

  if (fullText.includes("gata") || fullText.includes("coconut") || fullText.includes("ginataan")) return FILIPINO_STYLE_FALLBACKS.gata
  if (fullText.includes("sinigang") || fullText.includes("sour") || fullText.includes("tamarind") || fullText.includes("sampalok")) return FILIPINO_STYLE_FALLBACKS.soup
  if (fullText.includes("tinola") || fullText.includes("sayote") || fullText.includes("malunggay")) return FILIPINO_STYLE_FALLBACKS.tinola
  if (fullText.includes("nilaga") || fullText.includes("bulalo")) return FILIPINO_STYLE_FALLBACKS.nilaga
  if (fullText.includes("adobo") || fullText.includes("adobong")) return FILIPINO_STYLE_FALLBACKS.adobo
  if (fullText.includes("caldereta") || fullText.includes("afritada") || fullText.includes("menudo") || fullText.includes("mechado") || fullText.includes("tomato")) return FILIPINO_STYLE_FALLBACKS.stew
  if (fullText.includes("pinakbet") || fullText.includes("gulay") || fullText.includes("vegetable") || fullText.includes("monggo") || fullText.includes("kangkong")) return FILIPINO_STYLE_FALLBACKS.vegetable
  if (fullText.includes("shrimp") || fullText.includes("hipon") || fullText.includes("squid") || fullText.includes("pusit") || fullText.includes("crab") || fullText.includes("seafood")) return FILIPINO_STYLE_FALLBACKS.seafood
  if (fullText.includes("fish") || fullText.includes("bangus") || fullText.includes("tilapia") || fullText.includes("isda")) return FILIPINO_STYLE_FALLBACKS.fish
  if (fullText.includes("pork") || fullText.includes("baboy") || fullText.includes("liempo")) return FILIPINO_STYLE_FALLBACKS.pork
  if (fullText.includes("beef") || fullText.includes("baka")) return FILIPINO_STYLE_FALLBACKS.beef
  if (fullText.includes("chicken") || fullText.includes("manok")) return FILIPINO_STYLE_FALLBACKS.chicken

  return FILIPINO_STYLE_FALLBACKS.default
}

/* ============================================================ CARD GRIDS */

function createGrid(container) {
  const cache = new Map()

  return function paint(rows) {
    const sel = selectedSet()
    const nodes = rows.map(({ viand, have, missing, pct }) => {
      let entry = cache.get(viand.id)
      if (!entry) {
        const node = ui.tplCard.content.firstElementChild.cloneNode(true)
        entry = { node, refs: refsOf(node) }
        node.dataset.id = String(viand.id)

        // Set name
        entry.refs.name.textContent = viand.name

        // Set metadata
        const diffLabel = viand.diff.toUpperCase()
        const timeLabel = (viand.minutes + " MIN").toUpperCase()
        entry.refs.meta.textContent = `${timeLabel} · ${diffLabel}`

        // Set photo photo / image
        const imgUrl = resolveDishImageUrl(viand)
        if (entry.refs.photoImg) {
          entry.refs.photoImg.src = imgUrl
          entry.refs.photoImg.alt = viand.name
          entry.refs.photoImg.onerror = () => {
            entry.refs.photoImg.src = "./images/dishes/dish-1.jpg"
          }
        }
        const photo = node.querySelector(".card-photo")
        photo.style.setProperty("--photo-img", `url("${imgUrl}")`)
        photo.dataset.emoji = ""

        cache.set(viand.id, entry)
        revealObserver.observe(node)
      } else {
        const imgUrl = resolveDishImageUrl(viand)
        if (entry.refs.photoImg && entry.refs.photoImg.src !== imgUrl && !entry.refs.photoImg.src.endsWith(imgUrl.replace(/^\.\//, ''))) {
          entry.refs.photoImg.src = imgUrl
          const photo = entry.node.querySelector(".card-photo")
          if (photo) photo.style.setProperty("--photo-img", `url("${imgUrl}")`)
        }
      }

      const { node, refs } = entry

      // Saved state
      const isSaved = state.favorites.includes(viand.id)
      node.dataset.saved = String(isSaved)

      // Pantry-ready tag
      if (state.selected.length > 0) {
        const match = matchOf(viand, sel)
        refs.pantryTag.hidden = match.missing.length > 0
      } else {
        refs.pantryTag.hidden = true
      }

      return node
    })

    container.replaceChildren(...nodes)
  }
}

const paintBrowse = createGrid(ui.browseGrid)
const paintMatches = createGrid(ui.matchGrid)
const paintSaved = createGrid(ui.savedGrid)
const paintAiCards = createGrid(ui.aiCardGrid)

/* ============================================================== PICKERS */

const pickers = Object.entries(INGREDIENT_GROUPS).map(([group, items]) => {
  const node = ui.tplPicker.content.firstElementChild.cloneNode(true)
  const refs = refsOf(node)
  const slug = group.toLowerCase()
  node.dataset.group = group
  node.style.setProperty("--group", `var(--g-${slug})`)
  node.style.setProperty("--group-light", `var(--g-${slug}-light)`)
  node.style.setProperty("--group-tint", `var(--g-${slug}-tint)`)
  refs.label.textContent = group
  refs.filter.id = `filter-${slug}`
  refs.filter.placeholder = `Search ${slug}…`
  refs.filterLabel.setAttribute("for", refs.filter.id)
  refs.filterLabel.textContent = `Search ${group} ingredients`

  const options = items.map((name) => {
    const li = ui.tplPickerItem.content.firstElementChild.cloneNode(true)
    const optRefs = refsOf(li)
    optRefs.name.textContent = name
    const btn = li.querySelector(".opt")
    btn.type = "button"
    btn.dataset.ing = name
    return { name, li, btn }
  })
  refs.list.replaceChildren(...options.map((o) => o.li))
  return { group, node, refs, options }
})
ui.pickerRow.replaceChildren(...pickers.map((p) => p.node))

/* ============================================================ HISTORY */

const historyCache = new Map()
const HISTORY_LABEL = { viewed: "Opened", cooked: "Cooked" }

function paintHistory() {
  const nodes = state.history.map((entry) => {
    const key = `${entry.ts}-${entry.kind}`
    let cached = historyCache.get(key)
    if (!cached) {
      const node = ui.tplHistory.content.firstElementChild.cloneNode(true)
      const refs = refsOf(node)
      node.dataset.key = key
      refs.kind.textContent = HISTORY_LABEL[entry.kind] || entry.kind
      refs.time.dateTime = new Date(entry.ts).toISOString()
      refs.time.textContent = fmtDate.format(entry.ts)
      refs.title.textContent = entry.name
      const em = document.createElement("em")
      em.textContent = ` ${entry.fname}`
      refs.title.append(em)
      cached = { node }
      historyCache.set(key, cached)
    }
    return cached.node
  })
  ui.historyList.replaceChildren(...nodes)
}

/* ======================================================== RECIPE SHEET */

function paintRecipeSheet() {
  const viand = viandById.get(state.activeId)
  if (!viand) return

  const imgUrl = resolveDishImageUrl(viand)
  if (ui.rPhotoImg) {
    ui.rPhotoImg.src = imgUrl
    ui.rPhotoImg.alt = viand.name
    ui.rPhotoImg.onerror = () => {
      ui.rPhotoImg.src = "./images/dishes/dish-1.jpg"
    }
  }
  ui.rPhoto.style.setProperty("--photo-img", `url("${imgUrl}")`)
  ui.recipeSheet.style.setProperty("--accent", "var(--amber)")

  ui.rKicker.textContent = viand.cats.join(" · ")
  ui.rName.textContent = viand.name
  ui.rFname.textContent = viand.fname
  ui.rDiff.textContent = viand.diff
  ui.rTime.textContent = fmtTime(viand.minutes)
  ui.rServes.textContent = `${viand.serves}`
  ui.rCat.textContent = viand.cats[0]
  ui.rDesc.textContent = viand.desc

  // Source attribution (Panlasang Pinoy)
  const sourceName = viand.source || "Panlasang Pinoy"
  const sourceUrl = resolveRecipeUrl(viand)
  if (ui.rSourceName) ui.rSourceName.textContent = sourceName
  if (ui.rSourceLink) {
    ui.rSourceLink.href = sourceUrl
    ui.rSourceLink.title = `View authentic recipe on ${sourceName}`
  }

  const { have, missing } = matchOf(viand)
  const matching = state.selected.length > 0

  const baseItems = Array.isArray(viand.ingredientsDetailed) && viand.ingredientsDetailed.length > 0
    ? viand.ingredientsDetailed
    : viand.ing

  const overrides = state.ingredientOverrides[viand.id] || {}
  const processedItems = baseItems.map((itemText, originalIndex) => {
    let isHave
    if (overrides[originalIndex] !== undefined) {
      isHave = overrides[originalIndex]
    } else {
      isHave = isPantryStaple(itemText) || (matching && viand.ing.some((name) => have.includes(name) && itemText.toLowerCase().includes(name.toLowerCase())))
    }
    return { itemText, originalIndex, isHave }
  })

  // Sort so "On hand" ingredients are ALWAYS on TOP
  processedItems.sort((a, b) => {
    if (a.isHave === b.isHave) return a.originalIndex - b.originalIndex
    return a.isHave ? -1 : 1
  })

  const haveCount = processedItems.filter((p) => p.isHave).length
  const totalCount = processedItems.length
  const calcPct = Math.round((haveCount / totalCount) * 100)

  ui.rMeter.hidden = haveCount === 0
  ui.rMeter.style.setProperty("--progress", `${calcPct}%`)
  ui.rIngNote.textContent = `${haveCount} of ${totalCount} on hand · tap tag to toggle`

  ui.rIngList.replaceChildren(
    ...processedItems.map(({ itemText, originalIndex, isHave }) => {
      const li = document.createElement("li")
      li.dataset.have = String(isHave)

      const spanText = document.createElement("span")
      spanText.className = "ing-name"
      spanText.textContent = itemText
      li.append(spanText)

      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "flag flag-btn"
      btn.dataset.toggleIng = String(originalIndex)
      btn.setAttribute("aria-label", `Mark ${itemText} as ${isHave ? "To buy" : "On hand"}`)
      btn.textContent = isHave ? "✓ On hand" : "+ To buy"
      li.append(btn)

      return li
    }),
  )

  const done = stepsOf(viand.id).filter(Boolean).length
  ui.rStepNote.textContent = done ? `${done}/${viand.steps.length} steps done` : `${viand.steps.length} steps`
  ui.rStepList.replaceChildren(
    ...viand.steps.map((text) => {
      const li = document.createElement("li")
      li.textContent = text
      return li
    }),
  )

  const saved = state.favorites.includes(viand.id)
  const favBtn = ui.recipeSheet.querySelector('[data-act="fav"]')
  favBtn.setAttribute("aria-pressed", String(saved))
  favBtn.querySelector(".sr-only").textContent = saved ? "Remove from saved" : "Save recipe"
  ui.recipeSheet.querySelector('[data-act="cook"]').textContent = done ? "Resume Cooking" : "Start Cooking"
  if (missing.length && matching) ui.rIngNote.dataset.missing = String(missing.length)
}

/* ======================================================== COOKING SHEET */

let cookRows = []

function buildCookSheet() {
  const viand = viandById.get(state.cookId)
  ui.cookSheet.style.setProperty("--accent", "var(--amber)")
  ui.cName.textContent = viand.name
  ui.cFname.textContent = viand.fname
  ui.cTotal.textContent = String(viand.steps.length)

  cookRows = viand.steps.map((text, index) => {
    const li = document.createElement("li")
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "step-btn"
    btn.setAttribute("role", "checkbox")
    btn.setAttribute("aria-checked", "false")
    btn.dataset.step = String(index)
    const box = document.createElement("span")
    box.className = "opt-box"
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
    use.setAttribute("href", "#i-check")
    svg.append(use)
    box.append(svg)
    const span = document.createElement("span")
    span.className = "step-text"
    span.textContent = text
    btn.append(box, span)
    li.append(btn)
    return { btn }
  })
  ui.cList.replaceChildren(...cookRows.map((r) => r.btn.parentElement))
}

function paintCookSheet() {
  const viand = viandById.get(state.cookId)
  if (!viand || !cookRows.length) return
  const steps = stepsOf(viand.id)
  steps.forEach((checked, i) => cookRows[i].btn.setAttribute("aria-checked", String(checked)))
  const done = steps.filter(Boolean).length
  ui.cDone.textContent = String(done)
  ui.cMeter.style.setProperty("--progress", `${Math.round((done / steps.length) * 100)}%`)
  ui.cMeter.style.setProperty("--accent", done === steps.length ? "var(--green)" : "var(--amber)")
  ui.cDoneMsg.hidden = done !== steps.length
  ui.cDoneMsg.textContent = `Every step is done — enjoy your ${viand.name}.`
  ui.cookSheet.querySelector('[data-act="reset-steps"]').disabled = done === 0
}

/* ================================================================ RENDER */

function render() {
  /* ---- Search Bar Visibility ---- */
  const mainHeader = document.querySelector(".main-header")
  if (mainHeader) {
    mainHeader.hidden = state.view !== "browse"
  }

  /* ---- Views ---- */
  const views = document.querySelectorAll(".content-view")
  for (const v of views) {
    v.hidden = v.dataset.view !== state.view
  }

  /* ---- Sidebar ---- */
  const showSidebar = state.view === "browse"
  document.getElementById("sidebar").style.display = showSidebar ? "" : "none"

  for (const btn of sidebarButtons) {
    btn.setAttribute("aria-pressed", String(btn.dataset.cat === state.kioskCategory))
  }

  /* ---- Bottom bar badges ---- */
  ui.kitchenBadge.hidden = state.selected.length === 0
  ui.kitchenBadge.textContent = String(state.selected.length)
  ui.savedBadge.hidden = state.favorites.length === 0
  ui.savedBadge.textContent = String(state.favorites.length)
  ui.historyBadge.hidden = state.history.length === 0
  ui.historyBadge.textContent = String(state.history.length)

  /* Bottom bar active states */
  const btnHome = document.getElementById("btn-home")
  if (btnHome) btnHome.dataset.active = String(state.view === "browse")
  document.getElementById("btn-kitchen").dataset.active = String(state.view === "kitchen")
  document.getElementById("btn-saved").dataset.active = String(state.view === "saved")
  document.getElementById("btn-history").dataset.active = String(state.view === "history")

  /* ---- Search clear ---- */
  document.querySelector('[data-act="clear-search"]').hidden = state.query.length === 0

  /* ---- Browse ---- */
  if (state.view === "browse") {
    const q = state.query.trim().toLowerCase()
    const browse = browseList()

    if (!q) {
      if (ui.browseSearchLoading) ui.browseSearchLoading.hidden = true
      ui.browseCount.textContent = String(browse.length)
      ui.browseCountWord.textContent = browse.length === 1 ? "recipe" : "recipes"
      paintBrowse(browse.map((v) => ({ viand: v, ...matchOf(v) })))
      ui.browseEmpty.hidden = browse.length > 0
      ui.browseEmptyText.textContent = `No recipes in this category.`
    } else if (browse.length > 0) {
      if (ui.browseSearchLoading) ui.browseSearchLoading.hidden = true
      ui.browseCount.textContent = String(browse.length)
      ui.browseCountWord.textContent = browse.length === 1 ? "recipe" : "recipes"
      paintBrowse(browse.map((v) => ({ viand: v, ...matchOf(v) })))
      ui.browseEmpty.hidden = true
    } else {
      // Fallback to web search results
      if (state.isWebSearching) {
        if (ui.browseSearchLoading) {
          ui.browseSearchLoading.hidden = false
          if (ui.browseSearchLoadingText) {
            ui.browseSearchLoadingText.textContent = `Searching web for authentic recipes matching "${state.query}"…`
          }
        }
        ui.browseCount.textContent = "…"
        ui.browseCountWord.textContent = "searching web"
        paintBrowse([])
        ui.browseEmpty.hidden = true
      } else {
        if (ui.browseSearchLoading) ui.browseSearchLoading.hidden = true
        const webDishes = state.webSearchResults || []
        if (webDishes.length > 0) {
          ui.browseCount.textContent = String(webDishes.length)
          ui.browseCountWord.textContent = webDishes.length === 1 ? "web recipe found" : "web recipes found"
          paintBrowse(webDishes.map((v) => ({ viand: v, ...matchOf(v) })))
          ui.browseEmpty.hidden = true
        } else {
          ui.browseCount.textContent = "0"
          ui.browseCountWord.textContent = "recipes"
          paintBrowse([])
          ui.browseEmpty.hidden = false
          ui.browseEmptyText.textContent = `No recipes found for "${state.query}". Try searching for sisig, bulalo, or dinuguan.`
        }
      }
    }
  }

  /* ---- My Kitchen ---- */
  if (state.view === "kitchen") {
    for (const picker of pickers) {
      const count = INGREDIENT_GROUPS[picker.group].filter((i) => state.selected.includes(i)).length
      const open = state.openPicker === picker.group
      picker.node.dataset.open = String(open)
      picker.node.dataset.filled = String(count > 0)
      picker.refs.panel.hidden = !open
      picker.node.querySelector(".picker-btn").setAttribute("aria-expanded", String(open))
      picker.refs.count.hidden = count === 0
      picker.refs.count.textContent = String(count)
      const filter = (state.pickerFilter[picker.group] || "").toLowerCase()
      let visible = 0
      for (const opt of picker.options) {
        const show = opt.name.toLowerCase().includes(filter)
        opt.li.hidden = !show
        if (show) visible += 1
        opt.btn.setAttribute("aria-checked", String(state.selected.includes(opt.name)))
      }
      picker.refs.none.hidden = visible > 0
    }

    ui.selectedRow.hidden = state.selected.length === 0
    ui.selectedList.replaceChildren(
      ...state.selected.map((name) => {
        const group = (INGREDIENT_TO_GROUP[name] || "Pantry").toLowerCase()
        const li = document.createElement("li")
        li.className = "pill"
        li.style.setProperty("--group", `var(--g-${group})`)
        li.style.setProperty("--group-light", `var(--g-${group}-light)`)
        li.style.setProperty("--group-tint", `var(--g-${group}-tint)`)
        li.append(document.createTextNode(name))
        const btn = document.createElement("button")
        btn.type = "button"
        btn.dataset.remove = name
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
        use.setAttribute("href", "#i-close")
        svg.append(use)
        const sr = document.createElement("span")
        sr.className = "sr-only"
        sr.textContent = `Remove ${name}`
        btn.append(svg, sr)
        li.append(btn)
        return li
      }),
    )

    const hasSelected = state.selected.length > 0
    if (ui.aiSearchRow) {
      ui.aiSearchRow.hidden = !hasSelected
      if (hasSelected && ui.aiSearchBtnText) {
        const count = state.selected.length
        ui.aiSearchBtnText.textContent = `Find recipe with ${count} ingredient${count === 1 ? "" : "s"} selected`
      }
    }

    const matches = matchList()
    ui.matchHead.hidden = matches.length === 0
    ui.kitchenHint.hidden = state.selected.length > 0
    ui.matchCount.textContent = String(matches.length)
    ui.matchIngCount.textContent = String(state.selected.length)
    for (const btn of ui.matchHead.querySelectorAll("[data-sort]"))
      btn.setAttribute("aria-pressed", String(btn.dataset.sort === state.sort))
    paintMatches(matches)
  }

  /* ---- Saved ---- */
  if (state.view === "saved") {
    const saved = state.favorites.map((id) => viandById.get(id)).filter(Boolean)
    paintSaved(saved.map((v) => ({ viand: v, ...matchOf(v) })))
    ui.savedEmpty.hidden = saved.length > 0
  }

  /* ---- History ---- */
  if (state.view === "history") {
    ui.historyBar.hidden = state.history.length === 0
    ui.historyEmpty.hidden = state.history.length > 0
    ui.historyCount.textContent = String(state.history.length)
    paintHistory()
  }

  /* ---- Sheets ---- */
  if (ui.recipeSheet.open) paintRecipeSheet()
  if (ui.cookSheet.open) paintCookSheet()
}

/* ================================================================ SERVICES (ELECTRON / WEB HYBRID) */

async function callAiService(payload) {
  if (window.electronAPI && window.electronAPI.callClaude) {
    return await window.electronAPI.callClaude(payload)
  }
  // Web / Vercel Serverless Function fallback
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return await res.json()
  } catch (err) {
    return { error: { message: err.message || "Network error calling AI service." } }
  }
}

async function fetchDishImageService(dish) {
  if (window.electronAPI && window.electronAPI.fetchDishImage) {
    return await window.electronAPI.fetchDishImage(dish)
  }
  // Web / Vercel Serverless Function fallback
  try {
    const res = await fetch("/api/fetch-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dish),
    })
    const data = await res.json()
    return (data && data.url) || null
  } catch (err) {
    return null
  }
}

/* ================================================================ SHEETS */

const aiTipsCache = new Map()

async function handleAiCall(promptType) {
  const viand = viandById.get(state.activeId)
  if (!viand) return

  const cacheKey = `${viand.id}:${promptType}`

  if (ui.aiResponse) ui.aiResponse.hidden = false
  if (ui.aiText) ui.aiText.textContent = ""

  if (aiTipsCache.has(cacheKey)) {
    if (ui.aiLoading) ui.aiLoading.hidden = true
    if (ui.aiText) ui.aiText.textContent = aiTipsCache.get(cacheKey)
    return
  }

  if (ui.aiLoading) ui.aiLoading.hidden = false

  let prompt = ""
  if (promptType === "ai-substitutions") {
    prompt = `You are an authentic Filipino Master Chef referencing Panlasang Pinoy culinary methods.
I am cooking traditional Filipino ${viand.name} (${viand.fname}) with ingredients: ${viand.ing.join(", ")}.
What are 3 smart ingredient substitutions I can use if I don't have all ingredients or want a healthier variation, according to Panlasang Pinoy standards?
Give concise, practical bullet points.`
  } else if (promptType === "ai-pairing") {
    prompt = `You are an authentic Filipino Master Chef referencing Panlasang Pinoy culinary methods.
What are the best traditional Filipino sides, dipping sauces (sawsawan), and rice pairings recommended by Panlasang Pinoy to serve with ${viand.name} (${viand.fname})?
Give concise, appetizing bullet points.`
  } else if (promptType === "ai-tips") {
    prompt = `You are an authentic Filipino Master Chef referencing Panlasang Pinoy culinary methods (Chef Vanjo Merano).
Give me 3 expert home-cooking secrets and tips from Panlasang Pinoy to make ${viand.name} (${viand.fname}) extra delicious.
Give concise, actionable bullet points.`
  }

  try {
    const res = await callAiService({ prompt, isJson: false })
    if (ui.aiLoading) ui.aiLoading.hidden = true
    if (res && res.error) {
      if (ui.aiText) ui.aiText.textContent = `AI Chef note: ${res.error.message || "Could not retrieve tips."}`
    } else if (res && res.candidates && res.candidates[0]?.content?.parts[0]?.text) {
      const text = res.candidates[0].content.parts[0].text
      if (ui.aiText) ui.aiText.textContent = text
      aiTipsCache.set(cacheKey, text)
    } else {
      if (ui.aiText)
        ui.aiText.textContent =
          "AI Chef note: Add your GOOGLE_API_KEY to your environment variables to enable live AI responses."
    }
  } catch (err) {
    if (ui.aiLoading) ui.aiLoading.hidden = true
    if (ui.aiText) ui.aiText.textContent = `Error: ${err.message || "Failed to reach AI Chef."}`
  }
}

// Fast session cache for instant recipe retrieval when ingredients are re-selected
const sessionRecipeCache = new Map()

async function handleAiIngredientSearch() {
  if (!state.selected.length) return

  const sortedKey = [...state.selected].sort().join(",")

  if (ui.aiKitchenResults) ui.aiKitchenResults.hidden = false
  if (ui.aiKitchenText) ui.aiKitchenText.hidden = true

  // Fast path: instant return from session cache if already searched
  if (sessionRecipeCache.has(sortedKey)) {
    const cached = sessionRecipeCache.get(sortedKey)
    if (ui.aiKitchenLoading) ui.aiKitchenLoading.hidden = true
    if (cached.length > 0 && ui.aiCardGrid) {
      cached.forEach((v) => viandById.set(v.id, v))
      paintAiCards(cached.map((v) => ({ viand: v, ...matchOf(v) })))
    }
    return
  }

  if (ui.aiKitchenLoading) ui.aiKitchenLoading.hidden = false
  if (ui.aiCardGrid) ui.aiCardGrid.replaceChildren()

  const existingDishNames = new Set(
    VIANDS.flatMap((v) => [
      v.name.toLowerCase().trim(),
      v.fname.toLowerCase().trim(),
    ])
  )

  const prompt = `You are a Filipino Master Chef referencing Panlasang Pinoy (panlasangpinoy.com).
Find 4 authentic Filipino ulam recipes from Panlasang Pinoy that use one or more of these ingredients: ${state.selected.join(", ")}.
AVOID these existing 20 dishes: ${VIANDS.map((v) => v.name).join(", ")}.

CRITICAL: Return ONLY a valid JSON array of 4 dish objects with these exact keys:
- "name": English dish name (e.g. "Pork Bistek")
- "fname": Tagalog / Filipino dish name (e.g. "Bistek Tagalog")
- "cats": Array of 1-2 category strings (e.g. ["Beef", "Stew"] or ["Soup"] or ["Vegetable"])
- "diff": Difficulty ("Beginner", "Intermediate", or "Advanced")
- "minutes": Total cooking time in minutes (number, e.g. 45)
- "serves": Number of servings (number, e.g. 4)
- "source": "Panlasang Pinoy"
- "recipeUrl": Direct URL on panlasangpinoy.com
- "desc": Short 1-2 sentence description
- "ing": Array of base ingredients (e.g. ["Beef", "Soy Sauce", "Calamansi", "Onion"])
- "ingredientsDetailed": Array of authentic ingredients with exact quantities from Panlasang Pinoy
- "steps": Array of 3-4 clear cooking instruction steps`

  try {
    let aiViands = []

    const res = await callAiService({ prompt, isJson: true })
    if (ui.aiKitchenLoading) ui.aiKitchenLoading.hidden = true

    if (res && res.candidates && res.candidates[0]?.content?.parts) {
      const parts = res.candidates[0].content.parts || []
      const rawText = parts.map((p) => p.text || "").filter(Boolean).join("\n")
      const cleaned = rawText.replace(/```json|```/gi, "").trim()

      try {
        const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
        const jsonStr = jsonMatch ? jsonMatch[0] : null

        if (jsonStr) {
          const parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed) && parsed.length > 0) {
            aiViands = parsed
              .filter((item) => {
                const n = (item.name || "").toLowerCase().trim()
                const fn = (item.fname || "").toLowerCase().trim()
                return !existingDishNames.has(n) && !existingDishNames.has(fn)
              })
              .map((item, idx) => {
                const v = {
                  id: 9000 + idx + (Date.now() % 1000),
                  name: item.name || "Filipino Ulam",
                  fname: item.fname || item.name || "Masarap na Ulam",
                  cats: Array.isArray(item.cats) ? item.cats : ["Stew"],
                  diff: item.diff || "Beginner",
                  minutes: Number(item.minutes) || 40,
                  serves: Number(item.serves) || 4,
                  source: item.source || "Panlasang Pinoy",
                  recipeUrl: item.recipeUrl || item.sourceUrl || "https://panlasangpinoy.com",
                  desc: item.desc || `Authentic Panlasang Pinoy recipe featuring ${state.selected.join(", ")}.`,
                  ing: Array.isArray(item.ing) ? item.ing : [...state.selected],
                  ingredientsDetailed: Array.isArray(item.ingredientsDetailed) ? item.ingredientsDetailed : (item.ing || [...state.selected]),
                  steps: Array.isArray(item.steps) ? item.steps : ["Prepare ingredients.", "Simmer until tender and serve hot over rice."],
                  imageUrl: item.imageUrl || null,
                }
                v.imageUrl = resolveDishImageUrl(v)
                viandById.set(v.id, v)
                return v
              })

            // Dynamically fetch exact authentic web photos for every searched dish in parallel
            await Promise.all(
              aiViands.map(async (v) => {
                try {
                  const dynamicPhoto = await fetchDishImageService({ name: v.name, fname: v.fname })
                  if (dynamicPhoto) {
                    v.imageUrl = dynamicPhoto
                  }
                } catch (e) {
                  console.warn("Dynamic image fetch note:", e)
                }
              })
            )

            // Cache result in session cache for instant future lookups
            if (aiViands.length > 0) {
              sessionRecipeCache.set(sortedKey, aiViands)
            }
          }
        }
      } catch (e) {
        console.warn("Could not parse AI JSON array:", e)
      }

      if (!aiViands.length && rawText) {
        // If Gemini returned conversational or unstructured text instead of JSON
        if (ui.aiKitchenText) {
          ui.aiKitchenText.hidden = false
          ui.aiKitchenText.textContent = rawText
        }
      }
    } else if (res && res.error) {
      if (ui.aiKitchenText) {
        ui.aiKitchenText.hidden = false
        ui.aiKitchenText.textContent = `AI Search Note: ${res.error.message || "Could not retrieve web recipes."}`
      }
    }

    // If no AI dishes were found (e.g. offline, quota, or demo mode), use curated fallbacks
    if (!aiViands.length) {
      if (ui.aiKitchenLoading) ui.aiKitchenLoading.hidden = true
      aiViands = [
        {

          id: 9101,
          name: `Ginisang Kalabasa at Sitaw sa Gata`,
          fname: `Ginataang Gulay sa Gata`,
          cats: ["Vegetable", "Stew"],
          diff: "Beginner",
          minutes: 25,
          serves: 4,
          source: "Panlasang Pinoy",
          recipeUrl: "https://panlasangpinoy.com/ginataang-kalabasa-at-sitaw-recipe/",
          desc: `Rich, savory vegetable stew featuring ${state.selected.join(" and ")} simmered in spiced coconut milk.`,
          ing: [...state.selected, "Coconut Milk (Gata)", "Garlic", "Onion", "Siling Haba (Long Chili)"],
          ingredientsDetailed: [
            "3 cups Kalabasa (Squash, cubed)",
            "1 bunch Sitaw (String Beans, cut into 2-inch lengths)",
            "2 cups Coconut Milk (Gata)",
            "4 cloves Garlic (minced)",
            "1 medium Onion (sliced)",
            "2 pcs Siling Haba (Long Chili)"
          ],
          steps: ["Sauté garlic and onion in hot oil.", "Add vegetables and coconut milk.", "Simmer 15 minutes until sauce reduces."],
          imageUrl: "./images/dishes/dish-13.jpg",
        },
        {
          id: 9102,
          name: `Adobong Kangkong sa Aligue`,
          fname: `Adobong Kangkong with Crab Fat`,
          cats: ["Vegetable"],
          diff: "Beginner",
          minutes: 20,
          serves: 4,
          source: "Panlasang Pinoy",
          recipeUrl: "https://panlasangpinoy.com/adobong-kangkong-recipe/",
          desc: `Tender water spinach sautéed in garlic, vinegar, and rich savory crab paste.`,
          ing: [...state.selected, "Garlic", "Soy Sauce", "Vinegar", "Shrimp Paste (Bagoong)"],
          ingredientsDetailed: [
            "2 bunches Kangkong (leaves and tender stalks)",
            "1 head Garlic (minced)",
            "3 tbsp Soy Sauce",
            "2 tbsp Vinegar",
            "2 tbsp Crab Paste or Bagoong"
          ],
          steps: ["Sear garlic until golden brown.", "Add greens and splash of vinegar and soy sauce.", "Toss quickly on high heat and serve."],
          imageUrl: "./images/dishes/dish-1.jpg",
        },
        {
          id: 9103,
          name: `Sinampalukang Manok Special`,
          fname: `Tamarind Chicken Soup`,
          cats: ["Soup", "Chicken"],
          diff: "Intermediate",
          minutes: 50,
          serves: 4,
          source: "Panlasang Pinoy",
          recipeUrl: "https://panlasangpinoy.com/sinampalukang-manok-recipe/",
          desc: `Tangy tamarind chicken soup prepared with tender leaves and fresh ${state.selected.join(", ")}.`,
          ing: [...state.selected, "Chicken", "Tamarind (Sampalok)", "Ginger", "Onion"],
          ingredientsDetailed: [
            "2 lbs Chicken (cut into serving pieces)",
            "1 pack Tamarind Soup Base Mix",
            "2 thumbs Ginger (julienned)",
            "1 medium Onion (quartered)",
            "4 cups Water"
          ],
          steps: ["Sear chicken with ginger and onions.", "Add tamarind broth and boil until tender.", "Garnish with fresh greens."],
          imageUrl: "./images/dishes/search-sinampalukan.jpg",
        },
        {
          id: 9104,
          name: `Chicken Afritada`,
          fname: `Afritadang Manok`,
          cats: ["Stew", "Chicken"],
          diff: "Beginner",
          minutes: 40,
          serves: 4,
          source: "Panlasang Pinoy",
          recipeUrl: "https://panlasangpinoy.com/chicken-afritada-recipe/",
          desc: `Classic Filipino tomato stew loaded with tender chicken, potatoes, and ${state.selected.join(", ")}.`,
          ing: [...state.selected, "Chicken", "Tomato Sauce", "Potato", "Carrots", "Bell Pepper"],
          ingredientsDetailed: [
            "2 lbs Chicken (cut into pieces)",
            "1 cup Tomato Sauce",
            "2 medium Potatoes (cubed)",
            "1 large Carrot (sliced)",
            "1 Bell Pepper (sliced)"
          ],
          steps: ["Brown chicken pieces in pan.", "Add tomato sauce, broth, and potatoes.", "Simmer until sauce thickens and vegetables are soft."],
          imageUrl: "./images/dishes/dish-12.jpg",
        },
        {
          id: 9105,
          name: `Pork Hamonado`,
          fname: `Hamonadong Baboy`,
          cats: ["Stew", "Pork"],
          diff: "Intermediate",
          minutes: 60,
          serves: 6,
          source: "Panlasang Pinoy",
          recipeUrl: "https://panlasangpinoy.com/pork-hamonado-recipe/",
          desc: `Sweet and savory pork shoulder braised in pineapple juice, soy sauce, and ${state.selected.join(" and ")}.`,
          ing: [...state.selected, "Pork Belly", "Soy Sauce", "Garlic", "Onion"],
          ingredientsDetailed: [
            "2 lbs Pork Belly (cut into cubes)",
            "1 cup Pineapple Juice",
            "1/3 cup Soy Sauce",
            "4 cloves Garlic (minced)",
            "1 medium Onion (chopped)"
          ],
          steps: ["Sear pork until brown.", "Add pineapple glaze and soy sauce mixture.", "Simmer on low heat until fork tender."],
          imageUrl: "./images/dishes/search-hamonado.jpg",
        }
      ]
      aiViands.forEach((v) => viandById.set(v.id, v))
    }

    if (aiViands.length > 0 && ui.aiCardGrid) {
      paintAiCards(aiViands.map((v) => ({ viand: v, ...matchOf(v) })))
    }
  } catch (err) {
    if (ui.aiKitchenLoading) ui.aiKitchenLoading.hidden = true
    if (ui.aiKitchenText) {
      ui.aiKitchenText.hidden = false
      ui.aiKitchenText.textContent = `Error: ${err.message || "Failed to search web recipes."}`
    }
  }
}

/* ====================================================== DISH WEB SEARCH FALLBACK */

const OFFLINE_FILIPINO_DISHES = [
  {
    id: 8501,
    name: "Pork Sisig",
    fname: "Sizzling Sisig",
    cats: ["Pork"],
    diff: "Intermediate",
    minutes: 50,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/pork-sisig-recipe/",
    desc: "Crispy, savory chopped pork belly and jowl tossed with chicken liver, calamansi, chili, and raw egg on a sizzling plate.",
    ing: ["Pork Belly", "Calamansi", "Onion", "Siling Haba (Long Chili)", "Soy Sauce", "Egg"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (or pork mask/jowl, boiled and diced)",
      "1/4 lb Chicken Liver (sautéed and chopped)",
      "1 large Red Onion (finely chopped)",
      "3 pcs Siling Haba (Long Green Chili, chopped)",
      "3 tbsp Calamansi Juice",
      "2 tbsp Soy Sauce",
      "1 pc Raw Egg (for topping)",
      "1 tbsp Butter or Margarine"
    ],
    steps: [
      "Boil pork belly in water with salt and pepper for 40 minutes until tender, then drain and let cool.",
      "Grill or pan-fry pork belly until skin is blistered and crunchy, then finely chop.",
      "Sauté chicken liver and minced onions in butter, then fold in chopped pork, calamansi juice, soy sauce, and chilies.",
      "Transfer to a smoking-hot sizzling plate, crack a fresh egg on top, and toss hot with extra calamansi."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8502,
    name: "Bistek Tagalog",
    fname: "Beef Steak Tagalog",
    cats: ["Beef", "Stew"],
    diff: "Beginner",
    minutes: 45,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/bistek-tagalog-recipe/",
    desc: "Tender beef slices marinated in soy sauce and calamansi juice, braised and topped with sweet caramelized onion rings.",
    ing: ["Beef", "Soy Sauce", "Calamansi", "Onion", "Garlic"],
    ingredientsDetailed: [
      "1 1/2 lbs Beef Sirloin (thinly sliced across the grain)",
      "1/3 cup Soy Sauce",
      "1/4 cup Calamansi Juice",
      "2 large Onions (sliced into rings)",
      "4 cloves Garlic (minced)",
      "1/2 cup Water",
      "1/4 tsp Ground Black Pepper"
    ],
    steps: [
      "Marinate thinly sliced beef in soy sauce, calamansi juice, garlic, and black pepper for 30 minutes.",
      "Pan-fry beef slices in hot oil for 1 to 2 minutes per side until lightly browned, then remove.",
      "Sauté onion rings in the same pan until tender-crisp; remove half for garnish.",
      "Pour marinade and water into the pan, simmer for 15 to 20 minutes until beef is tender, then top with reserved onion rings."
    ],
    imageUrl: "./images/dishes/dish-6.jpg",
  },
  {
    id: 8503,
    name: "Beef Bulalo",
    fname: "Nilagang Bulalo",
    cats: ["Beef", "Soup"],
    diff: "Intermediate",
    minutes: 120,
    serves: 6,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/bulalo-recipe/",
    desc: "A rich, hearty beef shank and marrow soup simmered with sweet corn, pechay, and cabbage until meltingly tender.",
    ing: ["Beef", "Corn", "Cabbage", "Onion", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "2.5 lbs Beef Shank (with center bone marrow)",
      "2 ears Sweet Corn (cut into 3 pieces each)",
      "1/2 head Cabbage (cut into wedges)",
      "1 bunch Pechay (Bok Choy, rinsed)",
      "1 large Onion (quartered)",
      "8 cups Water",
      "2 tbsp Fish Sauce (Patis)",
      "1 tsp Whole Peppercorn"
    ],
    steps: [
      "Place beef shanks in a large soup pot with 8 cups water and quartered onions; bring to a rolling boil and skim off all scum.",
      "Lower heat, cover, and simmer for 90 to 120 minutes until meat is fork-tender and marrow is soft.",
      "Add sweet corn pieces and whole peppercorns; simmer for 10 minutes.",
      "Season with fish sauce, add cabbage wedges and pechay, cook for 3 minutes, and serve piping hot."
    ],
    imageUrl: "./images/dishes/dish-10.jpg",
  },
  {
    id: 8504,
    name: "Pork Dinuguan",
    fname: "Dinuguan",
    cats: ["Pork", "Stew"],
    diff: "Intermediate",
    minutes: 50,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/dinuguan-recipe/",
    desc: "Savory pork stew simmered in rich seasoned pig's blood, vinegar, garlic, and long green chili peppers.",
    ing: ["Pork Belly", "Vinegar", "Garlic", "Onion", "Siling Haba (Long Chili)", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (cut into small bite-sized pieces)",
      "10 oz Pig's Blood (strained with 1 tbsp vinegar)",
      "1/2 cup Cane Vinegar",
      "5 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "3 pcs Siling Haba (Long Green Chili)",
      "1 1/2 cups Water",
      "2 tbsp Fish Sauce (Patis)"
    ],
    steps: [
      "Sauté minced garlic and onions in oil until fragrant.",
      "Add diced pork belly and sear until lightly browned and natural oils render.",
      "Pour in vinegar and bring to a boil without stirring for 3 minutes.",
      "Pour in water and simmer for 25 minutes until pork is tender.",
      "Slowly stir in strained pig's blood, add siling haba, and simmer on low heat for 10 minutes until thick and savory."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8505,
    name: "Chicken Arroz Caldo",
    fname: "Arroz Caldo",
    cats: ["Chicken", "Soup"],
    diff: "Beginner",
    minutes: 40,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/arroz-caldo-recipe/",
    desc: "Comforting Filipino chicken rice porridge infused with fresh ginger, toasted garlic, scallions, and hard-boiled egg.",
    ing: ["Chicken", "Ginger", "Garlic", "Onion", "Egg", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "1.5 lbs Chicken (bone-in, cut into small pieces)",
      "1 cup Glutinous Rice (Malagkit, rinsed)",
      "2 thumbs Ginger (julienned)",
      "6 cloves Garlic (minced, toasted until golden)",
      "1 medium Onion (chopped)",
      "6 cups Chicken Broth or Water",
      "2 tbsp Fish Sauce (Patis)",
      "2 pcs Hard-Boiled Eggs (halved)",
      "2 stalks Green Onion (chopped)"
    ],
    steps: [
      "In a pot, sauté ginger, garlic, and onion until aromatic.",
      "Add chicken pieces and fish sauce; cook for 5 minutes until chicken is lightly browned.",
      "Add glutinous rice and stir for 1 minute to coat with savory chicken oil.",
      "Pour in chicken broth, bring to a boil, then simmer on low heat for 25 to 30 minutes, stirring occasionally, until porridge is thick.",
      "Ladle into bowls and top with crispy fried garlic, scallions, boiled egg, and a squeeze of calamansi."
    ],
    imageUrl: "./images/dishes/dish-7.jpg",
  },
  {
    id: 8506,
    name: "Lechon Kawali",
    fname: "Crispy Lechon Kawali",
    cats: ["Pork"],
    diff: "Intermediate",
    minutes: 60,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/lechon-kawali-recipe/",
    desc: "Pork belly boiled with aromatics, air-dried, and deep-fried to golden bubbly crispy skin with juicy meat.",
    ing: ["Pork Belly", "Garlic", "Bay Leaf (Laurel)", "Soy Sauce", "Vinegar"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (slab)",
      "5 cloves Garlic (crushed)",
      "3 pcs Bay Leaves",
      "1 tbsp Salt",
      "1 tsp Whole Peppercorn",
      "Cooking Oil for deep frying"
    ],
    steps: [
      "Boil pork belly slab in water with garlic, bay leaves, salt, and peppercorns for 45 minutes until tender.",
      "Remove pork slab, pat completely dry, and refrigerate uncovered for 2+ hours to dry skin.",
      "Heat oil in deep pot to 350°F (175°C) and fry pork slab using splatter shield for 8 to 10 minutes until skin blisters and crunches.",
      "Rest 5 minutes, chop into bite-sized squares, and serve with spiced liver sarsa or spiced vinegar."
    ],
    imageUrl: "./images/dishes/dish-18.jpg",
  },
  {
    id: 8507,
    name: "Tortang Talong",
    fname: "Eggplant Omelet",
    cats: ["Vegetable"],
    diff: "Beginner",
    minutes: 20,
    serves: 2,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/tortang-talong-recipe/",
    desc: "Charred grilled eggplant flattened and pan-fried in beaten eggs until golden brown, silky, and tender.",
    ing: ["Eggplant", "Egg", "Garlic", "Onion"],
    ingredientsDetailed: [
      "2 large Chinese Eggplants (with stem attached)",
      "2 large Eggs (beaten)",
      "1/4 tsp Salt",
      "1/4 tsp Ground Black Pepper",
      "3 tbsp Cooking Oil"
    ],
    steps: [
      "Grill or broil eggplants directly over open flame until skin is completely charred and flesh is soft.",
      "Let cool, then carefully peel off charred skin while keeping the stem intact.",
      "Place peeled eggplant on a plate and flatten gently with a fork.",
      "Dip flattened eggplant in seasoned beaten eggs to coat thoroughly.",
      "Pan-fry in hot oil for 3 to 4 minutes per side until golden brown and crispy at the edges."
    ],
    imageUrl: "./images/dishes/dish-15.jpg",
  },
  {
    id: 8508,
    name: "Beef Mechado",
    fname: "Mechadong Baka",
    cats: ["Beef", "Stew"],
    diff: "Intermediate",
    minutes: 75,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/beef-mechado-recipe/",
    desc: "Tender beef braised in rich tomato sauce with soy sauce, calamansi, potatoes, carrots, and sweet bell peppers.",
    ing: ["Beef", "Tomato Sauce", "Soy Sauce", "Calamansi", "Potato", "Carrots", "Bell Pepper"],
    ingredientsDetailed: [
      "2 lbs Beef Chuck (cut into cubes)",
      "1 cup Tomato Sauce",
      "3 tbsp Soy Sauce",
      "2 tbsp Calamansi Juice",
      "2 medium Potatoes (cubed)",
      "1 large Carrot (sliced)",
      "1 Bell Pepper (sliced into strips)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "2 cups Beef Broth"
    ],
    steps: [
      "Marinate beef cubes in soy sauce and calamansi juice for 20 minutes.",
      "Sear marinated beef in hot oil until browned on all sides, then remove.",
      "Sauté garlic and onion in the pan, add tomato sauce, beef broth, and return seared beef.",
      "Simmer covered on low heat for 50 minutes until meat is fork-tender.",
      "Add potatoes, carrots, and bell peppers; cook for 12 minutes until sauce is rich and thick."
    ],
    imageUrl: "./images/dishes/dish-6.jpg",
  },
  {
    id: 8509,
    name: "Sinampalukang Manok",
    fname: "Tamarind Chicken Soup",
    cats: ["Chicken", "Soup"],
    diff: "Beginner",
    minutes: 45,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/sinampalukang-manok-recipe/",
    desc: "A sour and tangy chicken soup prepared with fresh tamarind leaves, ginger, onions, and long green chilies.",
    ing: ["Chicken", "Tamarind (Sampalok)", "Ginger", "Onion", "Siling Haba (Long Chili)", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "2 lbs Chicken (cut into serving pieces)",
      "1 pack Tamarind Soup Mix (or fresh tamarind broth and leaves)",
      "2 thumbs Ginger (julienned)",
      "1 medium Onion (quartered)",
      "3 pcs Siling Haba (Long Green Chili)",
      "2 tbsp Fish Sauce (Patis)",
      "5 cups Water"
    ],
    steps: [
      "Sauté ginger and onion in oil until aromatic.",
      "Add chicken pieces and fish sauce; sear for 5 minutes until chicken turns light golden.",
      "Pour in 5 cups water, bring to a boil, and skim off foam.",
      "Stir in tamarind soup mix and add siling haba; simmer for 25 minutes until chicken is tender.",
      "Turn off heat, cover for 2 minutes to steep aromatics, and serve hot over rice."
    ],
    imageUrl: "./images/dishes/dish-7.jpg",
  },
  {
    id: 8510,
    name: "Chicken Inasal",
    fname: "Inasal na Manok",
    cats: ["Chicken"],
    diff: "Beginner",
    minutes: 40,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/chicken-inasal-recipe/",
    desc: "Bacolod-style grilled chicken marinated in lemongrass, calamansi, ginger, and garlic, basted with rich annatto oil.",
    ing: ["Chicken", "Calamansi", "Garlic", "Ginger", "Vinegar", "Soy Sauce"],
    ingredientsDetailed: [
      "2 lbs Chicken Quarters (thighs and drumsticks)",
      "1/3 cup Calamansi Juice",
      "1/3 cup Cane Vinegar",
      "6 cloves Garlic (crushed)",
      "2 thumbs Ginger (grated)",
      "2 stalks Lemongrass (crushed and minced)",
      "3 tbsp Annatto Oil (for basting)"
    ],
    steps: [
      "Combine calamansi juice, vinegar, garlic, ginger, and lemongrass in a bowl; marinate chicken for at least 1 hour.",
      "Prepare hot charcoal grill for medium-high heat.",
      "Grill chicken for 10 to 12 minutes per side, turning occasionally.",
      "Baste generously with annatto oil during the last 5 minutes of grilling until glistening and charred.",
      "Serve with hot steamed garlic rice and spiced toyomansi with chicken oil."
    ],
    imageUrl: "./images/dishes/dish-1.jpg",
  },
  {
    id: 8511,
    name: "Paksiw na Bangus",
    fname: "Milkfish in Vinegar Stew",
    cats: ["Seafood", "Stew"],
    diff: "Beginner",
    minutes: 25,
    serves: 3,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/paksiw-na-bangus-recipe/",
    desc: "Fresh milkfish simmered in vinegar, garlic, ginger, bitter gourd, eggplant, and long green finger chilies.",
    ing: ["Bangus", "Vinegar", "Garlic", "Ginger", "Ampalaya (Bitter Gourd)", "Eggplant", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "1 large Bangus (cleaned, scaled, and sliced into steaks)",
      "1/2 cup Cane Vinegar",
      "1 thumb Ginger (sliced)",
      "4 cloves Garlic (crushed)",
      "1 medium Eggplant (sliced)",
      "1/2 medium Ampalaya (sliced)",
      "2 pcs Siling Haba",
      "1/2 cup Water",
      "1 tbsp Fish Sauce"
    ],
    steps: [
      "Arrange ginger and garlic at the bottom of a cooking pot.",
      "Layer sliced bangus steaks over aromatics and top with eggplant, ampalaya, and siling haba.",
      "Pour in vinegar and water; bring to a boil over medium heat without stirring for 3 minutes.",
      "Lower heat, cover, and simmer for 15 minutes until fish is cooked and vegetables are tender.",
      "Season with fish sauce to taste and serve with warm rice."
    ],
    imageUrl: "./images/dishes/dish-16.jpg",
  },
  {
    id: 8512,
    name: "Tokwa't Baboy",
    fname: "Tofu and Pork Belly",
    cats: ["Pork"],
    diff: "Beginner",
    minutes: 35,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/tokwat-baboy-recipe/",
    desc: "Crispy fried tofu and tender boiled pork belly tossed in a savory, tangy spiced soy-vinegar dressing with onions.",
    ing: ["Tofu", "Pork Belly", "Soy Sauce", "Vinegar", "Onion", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "1 lb Firm Tofu (cut into cubes)",
      "1/2 lb Pork Belly (boiled until tender)",
      "1/2 cup Cane Vinegar",
      "1/3 cup Soy Sauce",
      "1 large Red Onion (diced)",
      "2 pcs Siling Haba (chopped)",
      "1 tsp Sugar",
      "Oil for frying"
    ],
    steps: [
      "Boil pork belly with salt and peppercorns for 30 minutes until tender, then slice into bite-sized cubes.",
      "Deep-fry firm tofu cubes in hot oil until golden brown and crispy, then drain.",
      "In a bowl, mix vinegar, soy sauce, sugar, chopped onions, and chilies to make dressing.",
      "Combine crispy tofu and tender pork belly in a serving bowl, pour dressing over top, and toss gently."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8513,
    name: "Pork Bopis",
    fname: "Bopis",
    cats: ["Pork", "Stew"],
    diff: "Intermediate",
    minutes: 45,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/bopis-recipe/",
    desc: "Finely minced pork simmered with annatto, radish, carrots, bell peppers, garlic, and fiery chilies.",
    ing: ["Pork", "Carrots", "Radish", "Bell Pepper", "Garlic", "Onion", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "1.5 lbs Minced Pork Belly / Pork",
      "1/2 cup Radish (finely diced)",
      "1/2 cup Carrots (finely diced)",
      "1 Bell Pepper (finely diced)",
      "5 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "2 tbsp Annatto Water (Atsuete)",
      "3 tbsp Vinegar",
      "2 pcs Siling Labuyo or Haba (chopped)"
    ],
    steps: [
      "Sauté garlic and onion in oil until fragrant.",
      "Add minced pork and cook for 10 minutes until lightly browned and oils render.",
      "Pour in vinegar and bring to a simmer for 3 minutes without stirring.",
      "Add annatto water for color, diced radish, carrots, bell peppers, and chili.",
      "Simmer for 15 minutes until vegetables are tender and sauce is thick and savory."
    ],
    imageUrl: "./images/dishes/dish-11.jpg",
  },
  {
    id: 8514,
    name: "Ginataang Tilapia",
    fname: "Tilapia in Coconut Milk",
    cats: ["Seafood", "Stew"],
    diff: "Beginner",
    minutes: 30,
    serves: 3,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/ginataang-tilapia-recipe/",
    desc: "Fresh tilapia simmered in creamy spiced coconut milk with leafy kangkong or spinach, ginger, and green chilies.",
    ing: ["Tilapia", "Coconut Milk (Gata)", "Ginger", "Garlic", "Onion", "Kangkong", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "2 whole Tilapia (cleaned and scaled)",
      "2 cups Coconut Milk (Gata)",
      "2 thumbs Ginger (julienned)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (sliced)",
      "1 bunch Kangkong or Spinach",
      "2 pcs Siling Haba",
      "1 tbsp Fish Sauce (Patis)"
    ],
    steps: [
      "In a pan, bring coconut milk, ginger, garlic, and onion to a gentle simmer for 5 minutes.",
      "Carefully add tilapia fish and siling haba; simmer covered on medium-low for 15 minutes until fish is cooked through.",
      "Season with fish sauce to taste.",
      "Add kangkong leaves, cover for 2 minutes off heat to wilt, and serve with warm rice."
    ],
    imageUrl: "./images/dishes/dish-4.jpg",
  },
  {
    id: 8515,
    name: "Pork Hamonado",
    fname: "Hamonadong Baboy",
    cats: ["Pork", "Stew"],
    diff: "Intermediate",
    minutes: 60,
    serves: 5,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/pork-hamonado-recipe/",
    desc: "Succulent pork belly braised in sweet pineapple juice, soy sauce, garlic, and brown sugar until tender and caramelized.",
    ing: ["Pork Belly", "Soy Sauce", "Garlic", "Onion", "Bay Leaf (Laurel)"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (cut into 2-inch cubes)",
      "1 1/2 cups Pineapple Juice",
      "1/3 cup Soy Sauce",
      "2 tbsp Brown Sugar",
      "5 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "3 pcs Bay Leaves"
    ],
    steps: [
      "Sear pork belly cubes in hot pan until lightly browned on all sides.",
      "Sauté garlic and onion in the drippings, then return pork.",
      "Pour in pineapple juice, soy sauce, brown sugar, and bay leaves; bring to a boil.",
      "Lower heat, cover, and simmer for 45 minutes until pork is fork-tender.",
      "Uncover and simmer for 8 minutes until sauce reduces into a rich, shiny sweet-savory glaze."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8516,
    name: "Lumpiang Shanghai",
    fname: "Crispy Pork Spring Rolls",
    cats: ["Pork"],
    diff: "Beginner",
    minutes: 35,
    serves: 6,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/lumpiang-shanghai-recipe/",
    desc: "Crispy fried golden spring rolls packed with seasoned ground pork, carrots, garlic, and aromatics with sweet chili dip.",
    ing: ["Ground Pork", "Carrots", "Onion", "Garlic", "Egg", "Soy Sauce"],
    ingredientsDetailed: [
      "1 lb Ground Pork",
      "1 medium Carrot (finely minced)",
      "1 medium Onion (finely minced)",
      "4 cloves Garlic (minced)",
      "1 Raw Egg",
      "1 tbsp Soy Sauce",
      "20 pcs Lumpia / Spring Roll Wrappers",
      "Oil for frying"
    ],
    steps: [
      "In a bowl, mix ground pork, carrots, onion, garlic, egg, soy sauce, salt, and pepper until thoroughly combined.",
      "Place 1 tbsp filling on each wrapper, roll tightly, and seal edges with a dab of water.",
      "Cut rolled spring rolls into 2-inch pieces.",
      "Deep-fry in hot oil (350°F / 175°C) for 4 to 5 minutes until golden brown and crispy.",
      "Drain on paper towels and serve hot with sweet and sour sauce."
    ],
    imageUrl: "./images/dishes/dish-18.jpg",
  },
  {
    id: 8517,
    name: "Beef Pochero",
    fname: "Pocherong Baka",
    cats: ["Beef", "Stew"],
    diff: "Intermediate",
    minutes: 90,
    serves: 6,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/beef-pochero-recipe/",
    desc: "A savory-sweet beef stew with sweet plantains (saba), garbanzo beans, cabbage, pechay, and tomato sauce.",
    ing: ["Beef", "Tomato Sauce", "Cabbage", "Potato", "Onion", "Garlic"],
    ingredientsDetailed: [
      "2 lbs Beef Chuck or Shank (cubed)",
      "1 cup Tomato Sauce",
      "2 pcs Plantain Bananas (Saging na Saba, sliced)",
      "1 can Garbanzo Beans (Chickpeas, drained)",
      "2 medium Potatoes (cubed)",
      "1/2 head Cabbage (wedged)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "3 cups Beef Broth"
    ],
    steps: [
      "Boil beef in water with onions for 60 minutes until tender.",
      "In another pot, sauté garlic and onion, then pan-fry plantain slices until golden and set aside.",
      "Add seared beef, tomato sauce, and beef broth; simmer for 15 minutes.",
      "Add potatoes and garbanzo beans; cook for 10 minutes until potatoes are soft.",
      "Add fried plantains and cabbage; simmer for 3 minutes and serve hot."
    ],
    imageUrl: "./images/dishes/dish-6.jpg",
  },
  {
    id: 8518,
    name: "Beef Kansi",
    fname: "Kansi Soup",
    cats: ["Beef", "Soup"],
    diff: "Intermediate",
    minutes: 110,
    serves: 6,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/kansi-recipe/",
    desc: "Traditional Western Visayan sour beef shank soup with batwan fruit or tamarind, lemongrass, annatto, and green jackfruit.",
    ing: ["Beef", "Tamarind (Sampalok)", "Garlic", "Onion", "Siling Haba (Long Chili)", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "2.5 lbs Beef Shank (with bone marrow)",
      "1 pack Tamarind / Sinigang Mix (or Batwan fruit)",
      "2 stalks Lemongrass (crushed)",
      "1 tbsp Annatto Water (for orange hue)",
      "3 pcs Siling Haba",
      "1 large Onion (quartered)",
      "8 cups Water",
      "2 tbsp Fish Sauce"
    ],
    steps: [
      "In a large soup pot, boil beef shank with quartered onion and lemongrass in 8 cups water, skimming foam.",
      "Simmer covered on low heat for 80 to 90 minutes until shank meat is tender.",
      "Add annatto water, siling haba, and sour tamarind / batwan broth.",
      "Simmer for 10 minutes to allow the distinct sour-savory flavor to penetrate meat.",
      "Season with fish sauce and serve piping hot with steamed rice."
    ],
    imageUrl: "./images/dishes/dish-10.jpg",
  },
  {
    id: 8519,
    name: "Pork Binagoongan",
    fname: "Binagoongang Baboy",
    cats: ["Pork", "Stew"],
    diff: "Beginner",
    minutes: 45,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/pork-binagoongan-recipe/",
    desc: "Tender pork belly braised in savory sautéed shrimp paste with fresh tomatoes, garlic, and fried eggplant slices.",
    ing: ["Pork Belly", "Shrimp Paste (Bagoong)", "Tomato", "Garlic", "Onion", "Eggplant", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (cut into 1-inch cubes)",
      "3 tbsp Sautéed Shrimp Paste (Bagoong Alamang)",
      "3 medium Tomatoes (chopped)",
      "1 medium Eggplant (sliced and fried)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "2 pcs Siling Haba",
      "1 cup Water",
      "1 tbsp Vinegar"
    ],
    steps: [
      "Sear pork belly cubes in a pan until golden and natural oils render.",
      "Sauté garlic, onion, and chopped tomatoes in the drippings until soft.",
      "Stir in shrimp paste and splash of vinegar; cook for 1 minute.",
      "Pour in water, cover, and simmer for 25 minutes until pork is tender.",
      "Add sliced fried eggplant and siling haba, toss for 2 minutes, and serve hot."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8520,
    name: "Adobong Pusit",
    fname: "Squid Adobo with Ink",
    cats: ["Seafood", "Stew"],
    diff: "Beginner",
    minutes: 25,
    serves: 3,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/adobong-pusit-recipe/",
    desc: "Fresh whole squid simmered in its own dark savory ink with vinegar, soy sauce, garlic, onions, and tomatoes.",
    ing: ["Squid", "Soy Sauce", "Vinegar", "Garlic", "Onion", "Tomato", "Siling Haba (Long Chili)"],
    ingredientsDetailed: [
      "1.5 lbs Fresh Squid (cleaned, ink sacs kept intact)",
      "1/4 cup Soy Sauce",
      "1/3 cup Cane Vinegar",
      "5 cloves Garlic (crushed)",
      "1 medium Onion (chopped)",
      "2 medium Tomatoes (chopped)",
      "2 pcs Siling Haba"
    ],
    steps: [
      "Sauté garlic, onion, and tomatoes in a pan until soft and fragrant.",
      "Add cleaned squid and sear quickly over high heat for 1 to 2 minutes.",
      "Pour in soy sauce and vinegar with squid ink; bring to a boil without stirring for 2 minutes.",
      "Simmer on medium-high for 3 to 5 minutes until squid is tender (do not overcook).",
      "Garnish with sliced green chilies and serve with warm white rice."
    ],
    imageUrl: "./images/dishes/dish-4.jpg",
  },
  {
    id: 8521,
    name: "Pancit Canton",
    fname: "Filipino Stir-Fried Noodles",
    cats: ["Pork", "Seafood"],
    diff: "Beginner",
    minutes: 30,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/pancit-canton-recipe/",
    desc: "Savory stir-fried egg noodles with tender pork, shrimp, cabbage, carrots, snap peas, garlic, and oyster sauce.",
    ing: ["Pork", "Shrimp", "Cabbage", "Carrots", "Soy Sauce", "Oyster Sauce", "Garlic", "Onion"],
    ingredientsDetailed: [
      "8 oz Pancit Canton Noodles",
      "1/2 lb Pork Belly (sliced thin)",
      "1/4 lb Shrimp (peeled)",
      "2 cups Cabbage (shredded)",
      "1 medium Carrot (julienned)",
      "2 tbsp Oyster Sauce",
      "2 tbsp Soy Sauce",
      "4 cloves Garlic (minced)",
      "1 medium Onion (sliced)",
      "2 cups Chicken Broth"
    ],
    steps: [
      "Sear pork and shrimp in a wok until cooked, then set aside.",
      "Sauté garlic and onion in the wok, add carrots and cabbage, and toss for 2 minutes.",
      "Pour in chicken broth, soy sauce, and oyster sauce; bring to a boil.",
      "Add dry Canton noodles and submerge into broth, tossing until noodles absorb liquid and soften.",
      "Return pork and shrimp, toss for 1 minute, and serve with calamansi wedges."
    ],
    imageUrl: "./images/dishes/dish-19.jpg",
  },
  {
    id: 8522,
    name: "Inihaw na Liempo",
    fname: "Grilled Pork Belly",
    cats: ["Pork"],
    diff: "Beginner",
    minutes: 35,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/inihaw-na-liempo-recipe/",
    desc: "Thick pork belly slabs marinated in calamansi, soy sauce, and garlic, grilled over charcoal to smoky perfection.",
    ing: ["Pork Belly", "Soy Sauce", "Calamansi", "Garlic", "Black Pepper"],
    ingredientsDetailed: [
      "2 lbs Pork Belly (sliced into 1/2-inch slabs)",
      "1/3 cup Soy Sauce",
      "1/4 cup Calamansi Juice",
      "5 cloves Garlic (minced)",
      "1 tbsp Brown Sugar",
      "1/2 tsp Ground Black Pepper"
    ],
    steps: [
      "Marinate pork belly slabs in soy sauce, calamansi juice, garlic, sugar, and black pepper for at least 1 hour.",
      "Prepare charcoal grill for medium-high heat.",
      "Grill pork belly for 5 to 6 minutes per side until charred and cooked through.",
      "Baste with reserved marinade during grilling.",
      "Slice diagonally and serve hot with spiced vinegar dipping sauce."
    ],
    imageUrl: "./images/dishes/dish-2.jpg",
  },
  {
    id: 8523,
    name: "Pork Embutido",
    fname: "Filipino Style Meatloaf",
    cats: ["Pork"],
    diff: "Intermediate",
    minutes: 60,
    serves: 6,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/embutido-recipe/",
    desc: "Classic Filipino steamed and pan-fried pork meatloaf rolled with hard-boiled eggs, carrots, and sweet bell peppers.",
    ing: ["Ground Pork", "Carrots", "Bell Pepper", "Egg", "Garlic", "Onion"],
    ingredientsDetailed: [
      "2 lbs Ground Pork",
      "1 medium Carrot (finely minced)",
      "1 Bell Pepper (finely diced)",
      "2 pcs Hard-Boiled Eggs (quartered lengthwise)",
      "2 Raw Eggs (beaten)",
      "1/2 cup Breadcrumbs",
      "4 cloves Garlic (minced)",
      "1 medium Onion (minced)"
    ],
    steps: [
      "In a bowl, mix ground pork, carrots, bell pepper, raw eggs, breadcrumbs, garlic, and onion.",
      "Spread meat mixture on aluminum foil sheets, place hard-boiled egg slices in center, and roll tightly into logs.",
      "Steam rolled logs over boiling water for 50 to 60 minutes until cooked through.",
      "Let cool, slice into rounds, and optionally pan-fry edges for crispiness before serving."
    ],
    imageUrl: "./images/dishes/dish-11.jpg",
  },
  {
    id: 8524,
    name: "Ginisang Upo",
    fname: "Sautéed Bottle Gourd",
    cats: ["Vegetable", "Stew"],
    diff: "Beginner",
    minutes: 25,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/ginisang-upo-recipe/",
    desc: "Tender bottle gourd sautéed with garlic, onions, juicy tomatoes, and shrimp in a light savory broth.",
    ing: ["Shrimp", "Tomato", "Garlic", "Onion", "Fish Sauce (Patis)"],
    ingredientsDetailed: [
      "1 medium Upo (Bottle Gourd, peeled and sliced into thin wedges)",
      "1/2 lb Shrimp (peeled)",
      "2 medium Tomatoes (chopped)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (chopped)",
      "1 tbsp Fish Sauce (Patis)",
      "1/2 cup Water"
    ],
    steps: [
      "Sauté garlic, onion, and tomatoes in a pan until tomatoes soften into a paste.",
      "Add shrimp and cook for 1 minute until pink.",
      "Add sliced upo and pour in 1/2 cup water; season with fish sauce.",
      "Cover and simmer on medium heat for 6 to 8 minutes until upo is translucent and tender.",
      "Serve warm with steamed rice."
    ],
    imageUrl: "./images/dishes/dish-15.jpg",
  },
  {
    id: 8525,
    name: "Crispy Ukoy",
    fname: "Crispy Shrimp Fritters",
    cats: ["Seafood"],
    diff: "Beginner",
    minutes: 25,
    serves: 4,
    source: "Panlasang Pinoy",
    recipeUrl: "https://panlasangpinoy.com/crispy-ukoy-recipe/",
    desc: "Golden crispy fritters of fresh small shrimp and shredded squash fried to a crunch, served with spiced vinegar dip.",
    ing: ["Shrimp", "Kalabasa (Squash)", "Egg", "Garlic", "Vinegar"],
    ingredientsDetailed: [
      "1/2 lb Small Shrimp (heads on or off)",
      "2 cups Kalabasa (Squash, grated or julienned)",
      "1 Raw Egg",
      "1/2 cup Cornstarch",
      "1/2 cup Flour",
      "1/2 cup Cold Water",
      "Cooking Oil for deep frying"
    ],
    steps: [
      "In a bowl, whisk egg, cornstarch, flour, and cold water to form a smooth batter.",
      "Fold in grated squash and small shrimp.",
      "Ladle batter into hot oil in thin patties and fry for 3 to 4 minutes per side until golden and crispy.",
      "Drain on wire rack and serve immediately with spiced garlic vinegar."
    ],
    imageUrl: "./images/dishes/dish-16.jpg",
  }
]

function titleCase(str) {
  return (str || "").replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
}

function generateProceduralRecipe(query) {
  const cleanName = titleCase(query.trim())
  const lower = query.toLowerCase()

  let cats = ["Stew"]
  let diff = "Beginner"
  let minutes = 45
  let serves = 4
  let ing = ["Garlic", "Onion", "Soy Sauce", "Black Pepper"]
  let detailed = [
    `2 lbs Meat or Seafood for ${cleanName} (cleaned and cut into serving pieces)`,
    "4 cloves Garlic (minced)",
    "1 medium Onion (chopped)",
    "3 tbsp Soy Sauce or Fish Sauce",
    "1 cup Water or Broth",
    "1/4 tsp Ground Black Pepper"
  ]
  let steps = [
    `Prepare and clean the ingredients for authentic ${cleanName}.`,
    "Sauté garlic and onions in hot oil until aromatic and softened.",
    "Add the main ingredients and sear for 3 to 5 minutes to develop flavor.",
    "Pour in seasoning and broth; simmer on medium-low heat until fork-tender.",
    "Adjust seasoning to taste and serve steaming hot with white rice."
  ]

  if (lower.includes("soup") || lower.includes("sinigang") || lower.includes("tinola") || lower.includes("nilaga") || lower.includes("bulalo") || lower.includes("kansi") || lower.includes("sopas") || lower.includes("sabaw")) {
    cats = ["Soup"]
    ing = ["Ginger", "Onion", "Fish Sauce (Patis)", "Cabbage", "Garlic"]
    detailed = [
      `2 lbs Meat or Seafood for ${cleanName} (cut into portions)`,
      "2 thumbs Ginger (sliced)",
      "1 large Onion (quartered)",
      "1/2 head Cabbage or leafy greens",
      "6 cups Water or Broth",
      "2 tbsp Fish Sauce (Patis)"
    ]
    steps = [
      `In a soup pot, bring water to a boil with ginger and onions.`,
      `Add main ingredients and simmer gently on low heat until tender, skimming any foam.`,
      `Season with fish sauce to taste.`,
      `Add fresh leafy greens and cover for 2 minutes to steam.`,
      `Ladle piping hot broth and meat into bowls and serve with rice.`
    ]
  } else if (lower.includes("gata") || lower.includes("ginataan") || lower.includes("coconut")) {
    cats = ["Stew"]
    ing = ["Coconut Milk (Gata)", "Garlic", "Onion", "Ginger", "Siling Haba (Long Chili)"]
    detailed = [
      `2 lbs Main ingredients for ${cleanName}`,
      "2 cups Coconut Milk (Gata)",
      "1 cup Coconut Cream (Kakang Gata)",
      "4 cloves Garlic (minced)",
      "1 medium Onion (sliced)",
      "2 pcs Siling Haba (Long Green Chili)"
    ]
    steps = [
      `Sauté garlic, onion, and ginger in a pot until fragrant.`,
      `Pour in coconut milk and bring to a gentle simmer.`,
      `Add main ingredients and simmer on medium-low for 20 minutes until tender.`,
      `Pour in coconut cream and chilies; cook until coconut oil renders and sauce thickens.`,
      `Serve warm over steamed rice.`
    ]
  } else if (lower.includes("isda") || lower.includes("fish") || lower.includes("bangus") || lower.includes("tilapia") || lower.includes("hipon") || lower.includes("shrimp") || lower.includes("pusit") || lower.includes("squid") || lower.includes("seafood")) {
    cats = ["Seafood"]
    minutes = 25
    ing = ["Tomato", "Onion", "Garlic", "Calamansi", "Fish Sauce (Patis)"]
  } else if (lower.includes("pork") || lower.includes("baboy") || lower.includes("liempo") || lower.includes("lechon")) {
    cats = ["Pork"]
    ing = ["Pork Belly", "Garlic", "Onion", "Soy Sauce", "Vinegar"]
  } else if (lower.includes("beef") || lower.includes("baka")) {
    cats = ["Beef"]
    minutes = 60
    ing = ["Beef", "Garlic", "Onion", "Soy Sauce", "Tomato Sauce"]
  } else if (lower.includes("chicken") || lower.includes("manok")) {
    cats = ["Chicken"]
    ing = ["Chicken", "Garlic", "Onion", "Soy Sauce", "Ginger"]
  } else if (lower.includes("gulay") || lower.includes("vegetable") || lower.includes("kangkong") || lower.includes("talong") || lower.includes("sitaw")) {
    cats = ["Vegetable"]
    minutes = 25
    ing = ["Garlic", "Onion", "Tomato", "Shrimp Paste (Bagoong)"]
  }

  const generated = {
    id: 8600 + Math.floor(Math.random() * 900),
    name: cleanName,
    fname: cleanName,
    cats,
    diff,
    minutes,
    serves,
    source: "Panlasang Pinoy",
    recipeUrl: `https://panlasangpinoy.com/?s=${encodeURIComponent(cleanName)}`,
    desc: `Authentic Filipino home-style recipe for ${cleanName} referencing traditional Panlasang Pinoy culinary methods.`,
    ing,
    ingredientsDetailed: detailed,
    steps,
    imageUrl: null,
    isWebResult: true,
  }
  generated.imageUrl = resolveDishImageUrl(generated)
  return generated
}

function findOfflineFallbackDishes(query) {
  const q = query.toLowerCase().trim()
  const matches = OFFLINE_FILIPINO_DISHES.filter((d) => {
    return `${d.name} ${d.fname} ${d.cats.join(" ")} ${d.ing.join(" ")} ${d.desc}`.toLowerCase().includes(q)
  })

  if (matches.length > 0) {
    return matches.map((item) => {
      const v = { ...item }
      v.imageUrl = resolveDishImageUrl(v)
      return v
    })
  }

  return [generateProceduralRecipe(query)]
}

const searchFallbackCache = new Map()
let activeWebSearchId = 0

async function handleWebSearchFallback(query) {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return

  // Check fast session cache
  if (searchFallbackCache.has(normalized)) {
    const cached = searchFallbackCache.get(normalized)
    cached.forEach((v) => viandById.set(v.id, v))
    setState({
      webSearchQuery: query,
      webSearchResults: cached,
      isWebSearching: false,
    })
    return
  }

  const currentSearchId = ++activeWebSearchId
  setState({
    webSearchQuery: query,
    webSearchResults: [],
    isWebSearching: true,
  })

  const getFallbackDishes = () => {
    return findOfflineFallbackDishes(normalized)
  }

  const prompt = `You are a Filipino Master Chef referencing Panlasang Pinoy (panlasangpinoy.com).
The user is searching for Filipino dishes matching or related to: "${query}".
Find 1 to 4 authentic Filipino ulam recipes from Panlasang Pinoy matching or closely related to "${query}".
AVOID these existing 20 dishes unless specifically requested: ${VIANDS.map((v) => v.name).join(", ")}.

CRITICAL: Return ONLY a valid JSON array of dish objects with these exact keys:
- "name": English dish name (e.g. "Pork Sisig", "Bistek Tagalog", "Bulalo")
- "fname": Tagalog / Filipino dish name (e.g. "Sizzling Sisig", "Bistek Tagalog", "Nilagang Bulalo")
- "cats": Array of 1-2 category strings (e.g. ["Pork"], ["Beef", "Soup"], ["Chicken", "Stew"], ["Seafood"], ["Vegetable"])
- "diff": Difficulty ("Beginner", "Intermediate", or "Advanced")
- "minutes": Total cooking time in minutes (number, e.g. 45)
- "serves": Number of servings (number, e.g. 4)
- "source": "Panlasang Pinoy"
- "recipeUrl": Direct URL on panlasangpinoy.com (e.g. "https://panlasangpinoy.com/pork-sisig-recipe/")
- "desc": Short 1-2 sentence description
- "ing": Array of base ingredients (e.g. ["Pork Belly", "Onion", "Siling Haba (Long Chili)", "Calamansi", "Soy Sauce", "Egg"])
- "ingredientsDetailed": Array of authentic ingredients with exact quantities from Panlasang Pinoy
- "steps": Array of 3-5 clear cooking instruction steps`

  try {
    let dishes = []
    const res = await callAiService({ prompt, isJson: true })

    if (currentSearchId !== activeWebSearchId) return

    if (res && res.candidates && res.candidates[0]?.content?.parts) {
      const parts = res.candidates[0].content.parts || []
      const rawText = parts.map((p) => p.text || "").filter(Boolean).join("\n")
      const cleaned = rawText.replace(/```json|```/gi, "").trim()

      try {
        const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
        const jsonStr = jsonMatch ? jsonMatch[0] : null
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed) && parsed.length > 0) {
            dishes = parsed
              .filter((item) => {
                const n = (item.name || "").toLowerCase().trim()
                const fn = (item.fname || "").toLowerCase().trim()
                return n && fn
              })
              .map((item, idx) => {
                const v = {
                  id: 8000 + idx + (Date.now() % 1000),
                  name: item.name || titleCase(query),
                  fname: item.fname || item.name || titleCase(query),
                  cats: Array.isArray(item.cats) && item.cats.length > 0 ? item.cats : ["Stew"],
                  diff: item.diff || "Beginner",
                  minutes: Number(item.minutes) || 40,
                  serves: Number(item.serves) || 4,
                  source: item.source || "Panlasang Pinoy",
                  recipeUrl: item.recipeUrl || item.sourceUrl || resolveRecipeUrl(item),
                  desc: item.desc || `Authentic Panlasang Pinoy recipe for ${item.name || query}.`,
                  ing: Array.isArray(item.ing) && item.ing.length > 0 ? item.ing : ["Garlic", "Onion"],
                  ingredientsDetailed: Array.isArray(item.ingredientsDetailed) && item.ingredientsDetailed.length > 0
                    ? item.ingredientsDetailed
                    : (item.ing || ["Garlic", "Onion"]),
                  steps: Array.isArray(item.steps) && item.steps.length > 0
                    ? item.steps
                    : ["Prepare ingredients.", "Sauté aromatics.", "Simmer until tender.", "Serve hot with rice."],
                  imageUrl: item.imageUrl || null,
                  isWebResult: true,
                }
                v.imageUrl = resolveDishImageUrl(v)
                viandById.set(v.id, v)
                return v
              })

            // Dynamically fetch exact web photos in parallel
            await Promise.all(
              dishes.map(async (v) => {
                try {
                  const dynamicPhoto = await fetchDishImageService({ name: v.name, fname: v.fname })
                  if (dynamicPhoto) {
                    v.imageUrl = dynamicPhoto
                  }
                } catch (e) {}
              })
            )
          }
        }
      } catch (e) {
        console.warn("Could not parse AI JSON array for dish fallback:", e)
      }
    }

    if (!dishes.length) {
      dishes = getFallbackDishes()
      dishes.forEach((v) => viandById.set(v.id, v))
      await Promise.all(
        dishes.map(async (v) => {
          try {
            const dynamicPhoto = await fetchDishImageService({ name: v.name, fname: v.fname })
            if (dynamicPhoto) {
              v.imageUrl = dynamicPhoto
            }
          } catch (e) {}
        })
      )
    }

    if (currentSearchId !== activeWebSearchId) return

    if (dishes.length > 0) {
      searchFallbackCache.set(normalized, dishes)
      persistCustomViands(dishes)
    }

    setState({
      webSearchQuery: query,
      webSearchResults: dishes,
      isWebSearching: false,
    })
  } catch (err) {
    if (currentSearchId !== activeWebSearchId) return
    const fallback = getFallbackDishes()
    fallback.forEach((v) => viandById.set(v.id, v))
    if (fallback.length > 0) {
      searchFallbackCache.set(normalized, fallback)
      persistCustomViands(fallback)
    }
    setState({
      webSearchQuery: query,
      webSearchResults: fallback,
      isWebSearching: false,
    })
  }
}

function openRecipe(id) {
  state.activeId = id
  if (ui.aiResponse) ui.aiResponse.hidden = true
  if (ui.aiLoading) ui.aiLoading.hidden = true
  if (ui.aiText) ui.aiText.textContent = ""
  paintRecipeSheet()
  ui.recipeSheet.showModal()
  log("viewed", id)
}

function openCook(id) {
  state.cookId = id
  buildCookSheet()
  paintCookSheet()
  if (ui.recipeSheet.open) ui.recipeSheet.close()
  ui.cookSheet.showModal()
}

ui.recipeSheet.addEventListener("close", () => {
  state.activeId = null
})
ui.cookSheet.addEventListener("close", () => {
  state.cookId = null
  cookRows = []
})

/* Dialog backdrop & close button click handlers */
ui.recipeSheet.addEventListener("click", (event) => {
  const closeBtn = event.target.closest('[data-act="close-recipe"]')
  if (closeBtn || event.target === ui.recipeSheet) {
    ui.recipeSheet.close()
  }
})

ui.cookSheet.addEventListener("click", (event) => {
  const closeBtn = event.target.closest('[data-act="close-cook"]')
  if (closeBtn || event.target === ui.cookSheet) {
    ui.cookSheet.close()
  }
})

/* ========================================================== INTERACTIONS */

document.addEventListener("click", (event) => {
  const target = event.target

  /* Sidebar category buttons */
  const catBtn = target.closest(".sidebar-btn")
  if (catBtn) {
    const nextCat = catBtn.dataset.cat
    const q = state.query.trim().toLowerCase()
    if (q) {
      const catFilter = KIOSK_CAT_FILTER[nextCat] || (() => true)
      const localMatches = VIANDS.filter((v) => {
        if (!catFilter(v)) return false
        return `${v.name} ${v.fname} ${v.ing.join(" ")} ${v.cats.join(" ")}`.toLowerCase().includes(q)
      })
      if (localMatches.length === 0) {
        handleWebSearchFallback(state.query)
      }
    }
    return setState({ kioskCategory: nextCat })
  }

  /* Sort buttons */
  const sortBtn = target.closest("[data-sort]")
  if (sortBtn) return setState({ sort: sortBtn.dataset.sort })

  /* Card interactions */
  const card = target.closest(".card")
  if (card) {
    if (target.closest('[data-act="save-card"]')) {
      event.stopPropagation()
      return toggleFavorite(Number(card.dataset.id))
    }
    return openRecipe(Number(card.dataset.id))
  }

  /* Recipe sheet ingredient on-hand / to-buy toggle */
  const toggleBtn = target.closest("[data-toggle-ing]")
  if (toggleBtn) {
    const originalIndex = Number(toggleBtn.dataset.toggleIng)
    const id = state.activeId
    if (id) {
      if (!state.ingredientOverrides[id]) state.ingredientOverrides[id] = {}
      const viand = viandById.get(id)
      if (viand) {
        const baseItems = Array.isArray(viand.ingredientsDetailed) && viand.ingredientsDetailed.length > 0
          ? viand.ingredientsDetailed
          : viand.ing
        const itemText = baseItems[originalIndex] || ""
        const matching = state.selected.length > 0
        const { have } = matchOf(viand)
        const currentHave = state.ingredientOverrides[id][originalIndex] !== undefined
          ? state.ingredientOverrides[id][originalIndex]
          : (isPantryStaple(itemText) || (matching && viand.ing.some((name) => have.includes(name) && itemText.toLowerCase().includes(name.toLowerCase()))))

        state.ingredientOverrides[id][originalIndex] = !currentHave
        paintRecipeSheet()
      }
    }
    return
  }

  /* Ingredient options */
  const opt = target.closest("[data-ing]")
  if (opt) return toggleIngredient(opt.dataset.ing)

  /* Selected pill remove */
  const remove = target.closest("[data-remove]")
  if (remove) return toggleIngredient(remove.dataset.remove)

  /* Picker toggle */
  const pickerBtn = target.closest('[data-act="toggle-picker"]')
  if (pickerBtn) {
    const group = pickerBtn.closest(".picker").dataset.group
    return setState({ openPicker: state.openPicker === group ? null : group })
  }

  /* Named actions */
  const act = target.closest("[data-act]")?.dataset.act
  switch (act) {
    case "ai-search-ingredients":
      return handleAiIngredientSearch()
    case "ai-substitutions":
    case "ai-pairing":
    case "ai-tips":
      return handleAiCall(act)
    case "clear-search":
      document.getElementById("kioskSearch").value = ""
      return setState({ query: "", webSearchQuery: "", webSearchResults: [], isWebSearching: false })
    case "reset-filters":
      document.getElementById("kioskSearch").value = ""
      return setState({ query: "", kioskCategory: "ALL", webSearchQuery: "", webSearchResults: [], isWebSearching: false })
    case "clear-ingredients":
      return setState({ selected: [] })
    case "clear-history":
      historyCache.clear()
      return setState({ history: [] })
    case "del-history": {
      const key = target.closest(".hist").dataset.key
      historyCache.delete(key)
      return setState({ history: state.history.filter((h) => `${h.ts}-${h.kind}` !== key) })
    }
    case "open-home":
    case "back-browse":
      return switchView("browse")
    case "open-kitchen":
      return switchView(state.view === "kitchen" ? "browse" : "kitchen")
    case "open-saved":
      return switchView(state.view === "saved" ? "browse" : "saved")
    case "open-history":
      return switchView(state.view === "history" ? "browse" : "history")
    case "fav":
      return toggleFavorite(state.activeId)
    case "close-recipe":
      return ui.recipeSheet.close()
    case "close-cook":
      return ui.cookSheet.close()
    case "cook":
      return openCook(state.activeId)
    case "reset-steps":
      return setState({
        progress: { ...state.progress, [state.cookId]: stepsOf(state.cookId).map(() => false) },
      })
    case "log-cooked": {
      const id = state.cookId
      setState({ progress: { ...state.progress, [id]: stepsOf(id).map(() => true) } })
      log("cooked", id)
      return ui.cookSheet.close()
    }
  }

  // Clicking anywhere outside an open picker dismisses it.
  if (state.openPicker && !target.closest(".picker")) setState({ openPicker: null })
})

/* Checklist steps */
ui.cList.addEventListener("click", (event) => {
  const btn = event.target.closest(".step-btn")
  if (!btn) return
  setStep(state.cookId, Number(btn.dataset.step), btn.getAttribute("aria-checked") !== "true")
})

/* Search */
const searchInput = document.getElementById("kioskSearch")
const applyQuery = debounce((value) => {
  const trimmed = value.trim()
  const q = trimmed.toLowerCase()
  const catFilter = KIOSK_CAT_FILTER[state.kioskCategory] || (() => true)
  const localMatches = VIANDS.filter((v) => {
    if (!catFilter(v)) return false
    if (!q) return true
    return `${v.name} ${v.fname} ${v.ing.join(" ")} ${v.cats.join(" ")}`.toLowerCase().includes(q)
  })

  if (!trimmed) {
    setState({ query: "", webSearchQuery: "", webSearchResults: [], isWebSearching: false })
  } else if (localMatches.length > 0) {
    setState({ query: trimmed, webSearchQuery: "", webSearchResults: [], isWebSearching: false })
  } else {
    // No local matches -> trigger web search fallback!
    setState({ query: trimmed })
    handleWebSearchFallback(trimmed)
  }
}, 180)
searchInput.addEventListener("input", (event) => applyQuery(event.target.value))
searchInput.closest("form").addEventListener("submit", (event) => event.preventDefault())

/* Picker search filters */
for (const picker of pickers) {
  picker.refs.filter.addEventListener(
    "input",
    debounce((event) => {
      setState({ pickerFilter: { ...state.pickerFilter, [picker.group]: event.target.value } })
    }, 120),
  )
}

/* Keyboard shortcuts */
document.addEventListener("keydown", (event) => {
  const activeTag = document.activeElement ? document.activeElement.tagName : ""
  const isInput = activeTag === "INPUT" || activeTag === "TEXTAREA"

  if (event.key === "/" && !isInput) {
    event.preventDefault()
    searchInput.focus()
    return
  }

  if (event.key === "Escape" && state.openPicker && !ui.recipeSheet.open && !ui.cookSheet.open) {
    setState({ openPicker: null })
  }
})

/* ================================================================== INIT */

hydrate()
render()