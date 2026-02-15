import { useMemo, useState, useCallback, useRef } from 'react'
import { usePersistedState } from '@/lib/usePersistedState'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Ruler, Scissors, AlertTriangle, ChevronDown, Copy, Check, Plus, Trash2, Pencil, MapPin, Download } from 'lucide-react'

// ── Types ──────────────────────────────────────────────

type DiagnosticGuide = 'dimensions' | 'margins' | 'gaps' | 'beading' | 'ratio' | 'handle' | 'overlay' | null

const keyToGuide: Record<string, DiagnosticGuide> = {
  doorWidth: 'dimensions', doorHeight: 'dimensions',
  topMargin: 'margins', bottomMargin: 'margins', leftMargin: 'margins', rightMargin: 'margins',
  horizontalGap: 'gaps', verticalGap: 'gaps',
  beadingWidth: 'beading', mdfPanelWidth: 'beading',
  topPanelRatio: 'ratio',
  handleSide: 'handle', handleHeight: 'handle', handleIndent: 'handle', handleSpread: 'handle',
}

interface DoorConfig {
  doorWidth: number
  doorHeight: number
  topMargin: number
  bottomMargin: number
  leftMargin: number
  rightMargin: number
  horizontalGap: number
  verticalGap: number
  beadingWidth: number
  mdfPanelWidth: number
  topPanelRatio: number
  handleSide: 'left' | 'right'
  handleHeight: number
  handleIndent: number
  handleSpread: number  // total reach from door edge inward
}

interface UnitPosition {
  label: string            // e.g. "Top-Left"
  beadingLeftX: number     // left long-point X from left edge
  beadingRightX: number    // right long-point X from left edge
  beadingY: number         // top beading Y from top edge (top outer edge)
  pinX: number             // center pin X from left edge
  pinY: number             // center pin Y from top edge (vertical center of beading)
}

interface CutResult {
  panelWidth: number
  topPanelHeight: number
  bottomPanelHeight: number
  topHorizontalBeading: number
  topVerticalBeading: number
  bottomHorizontalBeading: number
  bottomVerticalBeading: number
  topHorizontalBeadingShort: number
  topVerticalBeadingShort: number
  bottomHorizontalBeadingShort: number
  bottomVerticalBeadingShort: number
  panelBeadingGap: number
  unitPositions: UnitPosition[]
  handleWarnings: string[]
  isValid: boolean
  errors: string[]
}

interface SavedDoor {
  id: string
  name: string
  config: DoorConfig
}

// ── Defaults (standard UK interior door) ───────────────

const defaultConfig: DoorConfig = {
  doorWidth: 762,
  doorHeight: 1981,
  topMargin: 100,
  bottomMargin: 100,
  leftMargin: 80,
  rightMargin: 80,
  horizontalGap: 80,
  verticalGap: 80,
  beadingWidth: 20,
  mdfPanelWidth: 215,
  topPanelRatio: 40,
  handleSide: 'left' as const,
  handleHeight: 1000,
  handleIndent: 55,
  handleSpread: 140
}

function createDoor(name: string): SavedDoor {
  return { id: crypto.randomUUID(), name, config: { ...defaultConfig } }
}

const initialDoors: SavedDoor[] = [createDoor('Door 1')]

// ── Calculation ────────────────────────────────────────

function calculateCuts(c: DoorConfig): CutResult {
  const errors: string[] = []
  const handleWarnings: string[] = []

  // Available space inside margins
  const availableWidth = c.doorWidth - c.leftMargin - c.rightMargin - c.horizontalGap
  const availableHeight = c.doorHeight - c.topMargin - c.bottomMargin - c.verticalGap

  // Each panel "unit" = beading + gap + panel + gap + beading
  const panelUnitWidth = availableWidth / 2
  const panelWidth = c.mdfPanelWidth

  // The gap between the MDF panel edge and the beading inner edge
  const panelBeadingGap = (panelUnitWidth - 2 * c.beadingWidth - panelWidth) / 2

  const topUnitHeight = availableHeight * (c.topPanelRatio / 100)
  const bottomUnitHeight = availableHeight * ((100 - c.topPanelRatio) / 100)
  const topPanelHeight = topUnitHeight - 2 * c.beadingWidth - 2 * panelBeadingGap
  const bottomPanelHeight = bottomUnitHeight - 2 * c.beadingWidth - 2 * panelBeadingGap

  // Long-point for 45° mitred beading
  const topHBeading = panelUnitWidth
  const topVBeading = topUnitHeight
  const botHBeading = panelUnitWidth
  const botVBeading = bottomUnitHeight

  if (panelWidth <= 0)
    errors.push('MDF panel width must be greater than 0.')
  if (panelBeadingGap < 0)
    errors.push('MDF panel is too wide for the available space — reduce panel width or increase door width/margins.')
  if (topPanelHeight <= 0)
    errors.push('Top panel height is negative — adjust margins, gaps or ratio.')
  if (bottomPanelHeight <= 0)
    errors.push('Bottom panel height is negative — adjust margins, gaps or ratio.')

  // Handle vs beading collision check
  const handleMargin = c.handleSide === 'left' ? c.leftMargin : c.rightMargin
  if (c.handleSpread > handleMargin) {
    // Handle hardware extends past the margin — check if it vertically overlaps any beading unit
    const handleTop = c.handleHeight - 80   // backplate half-height (160/2)
    const handleBottom = c.handleHeight + 80

    // Top beading unit vertical range
    const topUnitTop = c.topMargin
    const topUnitBottom = c.topMargin + topUnitHeight
    // Bottom beading unit vertical range
    const bottomUnitTop = c.topMargin + topUnitHeight + c.verticalGap
    const bottomUnitBottom = bottomUnitTop + bottomUnitHeight

    const overlapsTop = handleBottom > topUnitTop && handleTop < topUnitBottom
    const overlapsBottom = handleBottom > bottomUnitTop && handleTop < bottomUnitBottom

    const overlap = c.handleSpread - handleMargin
    if (overlapsTop || overlapsBottom) {
      handleWarnings.push(
        `Handle hardware extends ${overlap.toFixed(1)} mm past the ${c.handleSide} margin into the beading zone. Increase the ${c.handleSide} margin to at least ${c.handleSpread} mm or reduce handle spread.`
      )
    }
  }

  // ── Unit positions (absolute from door edges) ──
  const colXs = [c.leftMargin, c.leftMargin + panelUnitWidth + c.horizontalGap]
  const rowYs = [c.topMargin, c.topMargin + topUnitHeight + c.verticalGap]
  const unitHs = [topUnitHeight, bottomUnitHeight]
  const labels = ['Top-Left', 'Top-Right', 'Bottom-Left', 'Bottom-Right']

  const unitPositions: UnitPosition[] = []
  for (let ri = 0; ri < 2; ri++) {
    for (let ci = 0; ci < 2; ci++) {
      const lx = colXs[ci]  // left edge of unit (= left long-point of top beading)
      const rx = colXs[ci] + panelUnitWidth  // right edge (= right long-point)
      const ty = rowYs[ri]  // top edge of unit (= top of top beading)
      unitPositions.push({
        label: labels[ri * 2 + ci],
        beadingLeftX: Math.round(lx * 10) / 10,
        beadingRightX: Math.round(rx * 10) / 10,
        beadingY: Math.round(ty * 10) / 10,
        pinX: Math.round((lx + panelUnitWidth / 2) * 10) / 10,
        pinY: Math.round((ty + c.beadingWidth / 2) * 10) / 10,
      })
    }
  }

  const r = (v: number) => Math.round(v * 10) / 10

  return {
    panelWidth: r(panelWidth),
    topPanelHeight: r(topPanelHeight),
    bottomPanelHeight: r(bottomPanelHeight),
    topHorizontalBeading: r(topHBeading),
    topVerticalBeading: r(topVBeading),
    bottomHorizontalBeading: r(botHBeading),
    bottomVerticalBeading: r(botVBeading),
    topHorizontalBeadingShort: r(topHBeading - 2 * c.beadingWidth),
    topVerticalBeadingShort: r(topVBeading - 2 * c.beadingWidth),
    bottomHorizontalBeadingShort: r(botHBeading - 2 * c.beadingWidth),
    bottomVerticalBeadingShort: r(botVBeading - 2 * c.beadingWidth),
    panelBeadingGap: r(panelBeadingGap),
    unitPositions,
    handleWarnings,
    isValid: errors.length === 0,
    errors
  }
}

// ── NumberInput ────────────────────────────────────────

function SliderInput({
  label,
  value,
  onChange,
  suffix = 'mm',
  min = 0,
  max = 500,
  step = 1
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="relative w-24">
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="pr-8 h-7 text-xs text-right font-mono"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary h-1.5 cursor-pointer"
        tabIndex={-1}
      />
    </div>
  )
}

// ── CutRow ─────────────────────────────────────────────

function SummaryBadge({ label, value }: { label?: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] leading-tight">
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className="font-semibold text-foreground/80 font-mono">{value}</span>
    </span>
  )
}

function CollapsibleCard({
  title,
  description,
  summary,
  headerRight,
  defaultOpen = true,
  children
}: {
  title: string
  description?: string
  summary?: React.ReactNode
  headerRight?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cardRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const allCards = document.querySelectorAll('[data-collapsible-card]')
    const cards = Array.from(allCards)
    const idx = cards.indexOf(cardRef.current!)

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (idx > 0) {
        setOpen(false)
        const prevBtn = cards[idx - 1].querySelector('button[data-card-toggle]') as HTMLElement | null
        if (prevBtn) {
          prevBtn.dataset.keyboardFocus = '1'
          prevBtn.focus()
        }
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (idx < cards.length - 1) {
        setOpen(false)
        const nextBtn = cards[idx + 1].querySelector('button[data-card-toggle]') as HTMLElement | null
        if (nextBtn) {
          nextBtn.dataset.keyboardFocus = '1'
          nextBtn.focus()
        }
      }
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (open) {
        setOpen(false)
      }
      return
    }

    if (!open && (e.key === 'Enter' || e.key === 'Tab')) {
      if (e.key === 'Tab' && e.shiftKey) return
      e.preventDefault()
      setOpen(true)
      // Focus first input inside the card after it opens
      setTimeout(() => {
        const input = contentRef.current?.querySelector(tabbableSelector) as HTMLElement | null
        input?.focus()
      }, 50)
    }

    // Shift+Tab on header when open → collapse, focus last element of previous card or its header
    if (open && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      setOpen(false)
      setTimeout(() => {
        if (idx > 0) {
          const prevBtn = cards[idx - 1].querySelector('button[data-card-toggle]') as HTMLElement | null
          if (prevBtn) {
            prevBtn.dataset.keyboardFocus = '1'
            prevBtn.focus()
          }
        }
      }, 50)
    }

    // Forward Tab on header when open → focus first input
    if (open && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const input = contentRef.current?.querySelector(tabbableSelector) as HTMLElement | null
      input?.focus()
    }
  }

  const tabbableSelector = 'input[type="number"], select, input:not([type="range"]), [data-card-tabbable]'

  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !open) return
    const inputs = contentRef.current?.querySelectorAll(tabbableSelector) as NodeListOf<HTMLElement> | undefined
    if (!inputs || inputs.length === 0) return

    if (!e.shiftKey) {
      // Forward tab on last element → collapse and move to next card
      const lastInput = inputs[inputs.length - 1]
      if (document.activeElement === lastInput) {
        e.preventDefault()
        setOpen(false)
        setTimeout(() => {
          const allCards = document.querySelectorAll('[data-collapsible-card]')
          const cards = Array.from(allCards)
          const idx = cards.indexOf(cardRef.current!)
          if (idx >= 0 && idx < cards.length - 1) {
            const nextBtn = cards[idx + 1].querySelector('button[data-card-toggle]') as HTMLElement | null
            if (nextBtn) {
              nextBtn.dataset.keyboardFocus = '1'
              nextBtn.focus()
            }
          }
        }, 50)
      }
    } else {
      // Shift+Tab on first element → collapse and move to previous card
      const firstInput = inputs[0]
      if (document.activeElement === firstInput) {
        e.preventDefault()
        setOpen(false)
        setTimeout(() => {
          const allCards = document.querySelectorAll('[data-collapsible-card]')
          const cards = Array.from(allCards)
          const idx = cards.indexOf(cardRef.current!)
          if (idx > 0) {
            const prevBtn = cards[idx - 1].querySelector('button[data-card-toggle]') as HTMLElement | null
            if (prevBtn) {
              prevBtn.dataset.keyboardFocus = '1'
              prevBtn.focus()
            }
          }
        }, 50)
      }
    }
  }

  return (
    <Card ref={cardRef} data-collapsible-card>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (buttonRef.current?.dataset.keyboardFocus === '1') {
            delete buttonRef.current.dataset.keyboardFocus
            setOpen(true)
          }
        }}
        tabIndex={0}
        data-card-toggle
        className="w-full text-left"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">{title}</CardTitle>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  open ? '' : '-rotate-90'
                }`}
              />
            </div>
            {headerRight && <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>}
          </div>
          {description && open && (
            <CardDescription className="text-xs">{description}</CardDescription>
          )}
          {!open && summary && (
            <div className="flex flex-wrap gap-1 mt-1.5">{summary}</div>
          )}
        </CardHeader>
      </button>
      <div
        ref={contentRef}
        onKeyDown={handleContentKeyDown}
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <CardContent className="flex flex-col gap-2 pt-0">{children}</CardContent>
      </div>
    </Card>
  )
}

function CutRow({
  label,
  longPoint,
  shortPoint,
  qty
}: {
  label: string
  longPoint: number
  shortPoint: number
  qty: number
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted-foreground">×{qty}</span>
        <span className="font-mono font-medium w-20 text-right">{longPoint} mm</span>
        <span className="font-mono text-xs text-muted-foreground w-24 text-right">
          ({shortPoint} short)
        </span>
      </div>
    </div>
  )
}

// ── SVG Preview ────────────────────────────────────────

function DoorPreview({ config, cuts, guide, onToggleOverlay }: { config: DoorConfig; cuts: CutResult; guide: DiagnosticGuide; onToggleOverlay: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (!cuts.isValid) return null

  const c = config
  const padding = 30
  const vbW = c.doorWidth + padding * 2
  const vbH = c.doorHeight + padding * 2

  const availableWidth = c.doorWidth - c.leftMargin - c.rightMargin - c.horizontalGap
  const unitW = availableWidth / 2

  const availableHeight = c.doorHeight - c.topMargin - c.bottomMargin - c.verticalGap
  const topUnitH = availableHeight * (c.topPanelRatio / 100)
  const botUnitH = availableHeight * ((100 - c.topPanelRatio) / 100)

  const cols = [c.leftMargin, c.leftMargin + unitW + c.horizontalGap]
  const rows = [c.topMargin, c.topMargin + topUnitH + c.verticalGap]
  const unitHeights = [topUnitH, botUnitH]

  // Zoom: smaller viewBox = zoomed in
  const vw = vbW / zoom
  const vh = vbH / zoom
  // Center the zoom, then apply pan offset
  const vx = (vbW - vw) / 2 + pan.x
  const vy = (vbH - vh) / 2 + pan.y

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.min(Math.max(z * delta, 0.5), 8))
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    // Convert pixel drag to viewBox units
    const scaleX = vw / rect.width
    const scaleY = vh / rect.height
    const dx = (e.clientX - dragging.current.startX) * scaleX
    const dy = (e.clientY - dragging.current.startY) * scaleY
    setPan({ x: dragging.current.panX - dx, y: dragging.current.panY - dy })
  }

  const handleMouseUp = () => {
    dragging.current = null
  }

  const handleDoubleClick = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const isZoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0

  const [pngState, setPngState] = useState<'idle' | 'copying' | 'copied'>('idle')

  const copyAsPng = useCallback(async () => {
    if (!svgRef.current || pngState === 'copying') return
    setPngState('copying')
    try {
      const svgEl = svgRef.current
      // Clone SVG and reset viewBox to show full diagram with extra margin for labels
      const clone = svgEl.cloneNode(true) as SVGSVGElement
      const extraMargin = 60 // extra space for overlay labels that extend beyond padding
      const fullVbX = -extraMargin
      const fullVbY = -extraMargin
      const fullVbW = vbW + extraMargin * 2
      const fullVbH = vbH + extraMargin * 2
      clone.setAttribute('viewBox', `${fullVbX} ${fullVbY} ${fullVbW} ${fullVbH}`)
      clone.setAttribute('width', String(fullVbW))
      clone.setAttribute('height', String(fullVbH))
      clone.removeAttribute('class')
      clone.removeAttribute('style')

      const serializer = new XMLSerializer()
      const svgStr = serializer.serializeToString(clone)
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)

      const img = new Image()
      const scale = 8 // 8× for crisp text at any zoom
      const width = fullVbW * scale
      const height = fullVbH * scale

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Image load failed'))
        img.src = url
      })

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      // Dark background matching the app
      ctx.fillStyle = '#09090b'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setPngState('copied')
        setTimeout(() => setPngState('idle'), 1500)
      } else {
        setPngState('idle')
      }
    } catch (err) {
      console.error('Copy PNG failed:', err)
      setPngState('idle')
    }
  }, [vbW, vbH, pngState])

  return (
    <div className="relative h-full">
      <svg
        ref={svgRef}
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        className="w-full h-full"
        style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
      {/* Door body */}
      <rect
        x={padding}
        y={padding}
        width={c.doorWidth}
        height={c.doorHeight}
        rx={4}
        fill="oklch(0.205 0 0)"
        stroke="oklch(0.4 0 0)"
        strokeWidth={2}
      />

      {/* Panels */}
      {cols.map((colX, ci) =>
        rows.map((rowY, ri) => {
          const uh = unitHeights[ri]
          const bx = padding + colX
          const by = padding + rowY

          return (
            <g key={`${ci}-${ri}`}>
              {/* Beading frame (outer rectangle of the unit) */}
              <rect
                x={bx}
                y={by}
                width={unitW}
                height={uh}
                rx={2}
                fill="oklch(0.35 0.05 50)"
                stroke="oklch(0.5 0.07 50)"
                strokeWidth={1.5}
              />
              {/* Gap between beading and panel */}
              <rect
                x={bx + c.beadingWidth}
                y={by + c.beadingWidth}
                width={unitW - 2 * c.beadingWidth}
                height={uh - 2 * c.beadingWidth}
                rx={1}
                fill="oklch(0.205 0 0)"
              />
              {/* MDF Panel */}
              <rect
                x={bx + c.beadingWidth + cuts.panelBeadingGap}
                y={by + c.beadingWidth + cuts.panelBeadingGap}
                width={cuts.panelWidth}
                height={ri === 0 ? cuts.topPanelHeight : cuts.bottomPanelHeight}
                rx={1}
                fill="oklch(0.3 0.02 90)"
                stroke="oklch(0.45 0.03 90)"
                strokeWidth={1}
              />

            </g>
          )
        })
      )}

      {/* Door handle */}
      {(() => {
        const handleX = c.handleSide === 'left'
          ? padding + c.handleIndent
          : padding + c.doorWidth - c.handleIndent
        const handleY = padding + c.handleHeight
        const handleLen = 120
        const handleW = 10
        const backplateW = 30
        const backplateH = 160

        return (
          <g>
            {/* Backplate */}
            <rect
              x={handleX - backplateW / 2}
              y={handleY - backplateH / 2}
              width={backplateW}
              height={backplateH}
              rx={backplateW / 2}
              fill="oklch(0.45 0 0)"
              stroke="oklch(0.55 0 0)"
              strokeWidth={1}
            />
            {/* Keyhole */}
            <circle
              cx={handleX}
              cy={handleY + backplateH * 0.28}
              r={5}
              fill="oklch(0.25 0 0)"
            />
            {/* Handle lever */}
            <rect
              x={c.handleSide === 'right' ? handleX - handleLen : handleX}
              y={handleY - handleW / 2}
              width={handleLen}
              height={handleW}
              rx={handleW / 2}
              fill="oklch(0.55 0 0)"
              stroke="oklch(0.65 0 0)"
              strokeWidth={1}
            />
            {/* Handle rose */}
            <circle
              cx={handleX}
              cy={handleY}
              r={handleW}
              fill="oklch(0.5 0 0)"
              stroke="oklch(0.6 0 0)"
              strokeWidth={1}
            />
          </g>
        )
      })()}

      {/* ── Diagnostic guide overlays ── */}
      {(() => {
        const guideColor = 'oklch(0.75 0.2 200)'
        const guideStroke = { stroke: guideColor, strokeWidth: 2.5, strokeDasharray: '10 5' }
        const guideTextStyle = { fill: guideColor, fontSize: 22, fontFamily: 'monospace' as const }
        const dX = padding  // door left
        const dY = padding  // door top
        const dW = c.doorWidth
        const dH = c.doorHeight

        if (guide === 'margins') {
          return (
            <g opacity={0.9}>
              {/* Top margin */}
              <line x1={dX} y1={dY + c.topMargin} x2={dX + dW} y2={dY + c.topMargin} {...guideStroke} />
              <text x={dX + dW + 8} y={dY + c.topMargin / 2} dominantBaseline="central" {...guideTextStyle}>{c.topMargin}</text>
              {/* Bottom margin */}
              <line x1={dX} y1={dY + dH - c.bottomMargin} x2={dX + dW} y2={dY + dH - c.bottomMargin} {...guideStroke} />
              <text x={dX + dW + 8} y={dY + dH - c.bottomMargin / 2} dominantBaseline="central" {...guideTextStyle}>{c.bottomMargin}</text>
              {/* Left margin */}
              <line x1={dX + c.leftMargin} y1={dY} x2={dX + c.leftMargin} y2={dY + dH} {...guideStroke} />
              <text x={dX + c.leftMargin / 2} y={dY + dH + 14} textAnchor="middle" {...guideTextStyle}>{c.leftMargin}</text>
              {/* Right margin */}
              <line x1={dX + dW - c.rightMargin} y1={dY} x2={dX + dW - c.rightMargin} y2={dY + dH} {...guideStroke} />
              <text x={dX + dW - c.rightMargin / 2} y={dY + dH + 14} textAnchor="middle" {...guideTextStyle}>{c.rightMargin}</text>
            </g>
          )
        }

        if (guide === 'gaps') {
          const gapLeft = dX + c.leftMargin + unitW
          const gapTop = dY + c.topMargin + topUnitH
          return (
            <g opacity={0.9}>
              {/* Horizontal gap zone */}
              <rect x={gapLeft} y={dY} width={c.horizontalGap} height={dH} fill={guideColor} opacity={0.12} />
              <line x1={gapLeft} y1={dY} x2={gapLeft} y2={dY + dH} {...guideStroke} />
              <line x1={gapLeft + c.horizontalGap} y1={dY} x2={gapLeft + c.horizontalGap} y2={dY + dH} {...guideStroke} />
              <text x={gapLeft + c.horizontalGap / 2} y={dY + dH + 14} textAnchor="middle" {...guideTextStyle}>H {c.horizontalGap}</text>
              {/* Vertical gap zone */}
              <rect x={dX} y={gapTop} width={dW} height={c.verticalGap} fill={guideColor} opacity={0.12} />
              <line x1={dX} y1={gapTop} x2={dX + dW} y2={gapTop} {...guideStroke} />
              <line x1={dX} y1={gapTop + c.verticalGap} x2={dX + dW} y2={gapTop + c.verticalGap} {...guideStroke} />
              <text x={dX + dW + 8} y={gapTop + c.verticalGap / 2} dominantBaseline="central" {...guideTextStyle}>V {c.verticalGap}</text>
            </g>
          )
        }

        if (guide === 'beading') {
          // Highlight the beading frames on each unit
          return (
            <g opacity={0.9}>
              {cols.map((colX, ci) =>
                rows.map((rowY, ri) => {
                  const bx = dX + colX
                  const by = dY + rowY
                  const uh = unitHeights[ri]
                  return (
                    <g key={`b-${ci}-${ri}`}>
                      {/* Outer beading edge */}
                      <rect x={bx} y={by} width={unitW} height={uh} fill="none" stroke={guideColor} strokeWidth={1.5} />
                      {/* Inner beading edge */}
                      <rect x={bx + c.beadingWidth} y={by + c.beadingWidth} width={unitW - 2 * c.beadingWidth} height={uh - 2 * c.beadingWidth} fill="none" stroke={guideColor} strokeWidth={1} strokeDasharray="4 2" />
                      {/* Beading width label */}
                      <text x={bx + c.beadingWidth / 2} y={by - 4} textAnchor="middle" {...guideTextStyle}>{c.beadingWidth}</text>
                      {/* Panel width label */}
                      <text x={bx + unitW / 2} y={by + uh + 14} textAnchor="middle" {...guideTextStyle}>panel {cuts.panelWidth}</text>
                    </g>
                  )
                })
              )}
            </g>
          )
        }

        if (guide === 'ratio') {
          const splitY = dY + c.topMargin + topUnitH + c.verticalGap / 2
          return (
            <g opacity={0.9}>
              <line x1={dX} y1={splitY} x2={dX + dW} y2={splitY} {...guideStroke} />
              <text x={dX + dW + 8} y={dY + c.topMargin + topUnitH / 2} dominantBaseline="central" {...guideTextStyle}>{c.topPanelRatio}%</text>
              <text x={dX + dW + 8} y={dY + c.topMargin + topUnitH + c.verticalGap + botUnitH / 2} dominantBaseline="central" {...guideTextStyle}>{100 - c.topPanelRatio}%</text>
            </g>
          )
        }

        if (guide === 'handle') {
          const hx = c.handleSide === 'left' ? dX : dX + dW
          const spreadEnd = c.handleSide === 'left' ? dX + c.handleSpread : dX + dW - c.handleSpread
          const handleY = dY + c.handleHeight
          const margin = c.handleSide === 'left' ? c.leftMargin : c.rightMargin
          const marginLine = c.handleSide === 'left' ? dX + margin : dX + dW - margin
          const warn = c.handleSpread > margin
          const warnColor = 'oklch(0.75 0.2 60)'
          return (
            <g opacity={0.9}>
              {/* Handle spread zone */}
              <rect
                x={Math.min(hx, spreadEnd)}
                y={handleY - 90}
                width={c.handleSpread}
                height={180}
                fill={warn ? warnColor : guideColor}
                opacity={0.12}
                rx={3}
              />
              {/* Spread line */}
              <line x1={spreadEnd} y1={handleY - 90} x2={spreadEnd} y2={handleY + 90} stroke={warn ? warnColor : guideColor} strokeWidth={1.5} strokeDasharray="6 3" />
              {/* Margin line for reference */}
              <line x1={marginLine} y1={dY} x2={marginLine} y2={dY + dH} stroke={guideColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              {/* Spread label */}
              <text
                x={(hx + spreadEnd) / 2}
                y={handleY - 96}
                textAnchor="middle"
                fill={warn ? warnColor : guideColor}
                fontSize={22}
                fontFamily="monospace"
              >
                spread {c.handleSpread}
              </text>
              {/* Handle height line */}
              <line x1={hx} y1={dY} x2={hx} y2={handleY} stroke={guideColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              <text x={hx + (c.handleSide === 'left' ? -4 : 4)} y={dY + c.handleHeight / 2} textAnchor={c.handleSide === 'left' ? 'end' : 'start'} dominantBaseline="central" {...guideTextStyle}>{c.handleHeight}</text>
            </g>
          )
        }

        if (guide === 'overlay') {
          // ── Fitting pins ──
          const pinColor = 'oklch(0.75 0.18 150)'
          const pinStroke = { stroke: pinColor, strokeWidth: 1.5, strokeDasharray: '6 3' }
          const pinTextStyle = { fill: pinColor, fontSize: 20, fontFamily: 'monospace' as const }

          // ── Summary dimensions ──
          const dimColor = 'oklch(0.7 0.15 250)'   // blue — margins & dimensions
          const gapColor = 'oklch(0.7 0.2 330)'    // pink — gaps
          const beadColor = 'oklch(0.75 0.18 80)'  // amber — beading & panels
          const handleColor = 'oklch(0.7 0.15 150)' // teal — handle
          const txtBase = { fontSize: 18, fontFamily: 'monospace' as const }
          const dashPattern = '4 2'

          // Shared positions
          const innerLeft = dX + c.leftMargin
          const innerRight = dX + dW - c.rightMargin
          const innerTop = dY + c.topMargin
          const innerBottom = dY + dH - c.bottomMargin
          const gapLeft = innerLeft + unitW
          const gapTop = innerTop + topUnitH
          const splitY = gapTop + c.verticalGap / 2

          // Handle
          const hx = c.handleSide === 'left' ? dX + c.handleIndent : dX + dW - c.handleIndent
          const hy = dY + c.handleHeight

          return (
            <g opacity={0.85}>
              {/* ── Fitting pin crosshairs ── */}
              {cuts.unitPositions.map((up) => {
                const px = dX + up.pinX
                const py = dY + up.pinY
                const blx = dX + up.beadingLeftX
                const brx = dX + up.beadingRightX
                const by = dY + up.beadingY
                const bw = c.beadingWidth
                return (
                  <g key={up.label}>
                    {/* Top beading strip highlight */}
                    <rect x={blx} y={by} width={brx - blx} height={bw} fill={pinColor} opacity={0.15} rx={1} />
                    {/* Pin crosshair */}
                    <line x1={px - 8} y1={py} x2={px + 8} y2={py} stroke={pinColor} strokeWidth={1.5} />
                    <line x1={px} y1={py - 8} x2={px} y2={py + 8} stroke={pinColor} strokeWidth={1.5} />
                    <circle cx={px} cy={py} r={3} fill={pinColor} opacity={0.8} />
                    {/* Coordinate labels */}
                    <text x={px} y={by - 6} textAnchor="middle" {...pinTextStyle}>
                      pin ({up.pinX}, {up.pinY})
                    </text>
                    {/* Horizontal guide lines from door edges */}
                    <line x1={dX} y1={py} x2={blx} y2={py} {...pinStroke} opacity={0.4} />
                    {/* Vertical guide line from top edge */}
                    <line x1={px} y1={dY} x2={px} y2={by} {...pinStroke} opacity={0.4} />
                  </g>
                )
              })}

              {/* ── Margin dimension arrows ── */}
              {/* Top margin */}
              <line x1={dX + dW / 2} y1={dY} x2={dX + dW / 2} y2={innerTop} stroke={dimColor} strokeWidth={1} strokeDasharray={dashPattern} />
              <line x1={dX + dW / 2 - 8} y1={dY} x2={dX + dW / 2 + 8} y2={dY} stroke={dimColor} strokeWidth={1} />
              <line x1={dX + dW / 2 - 8} y1={innerTop} x2={dX + dW / 2 + 8} y2={innerTop} stroke={dimColor} strokeWidth={1} />
              <text x={dX + dW / 2 + 14} y={dY + c.topMargin / 2} textAnchor="start" dominantBaseline="central" fill={dimColor} {...txtBase}>{c.topMargin}</text>
              {/* Bottom margin */}
              <line x1={dX + dW / 2} y1={innerBottom} x2={dX + dW / 2} y2={dY + dH} stroke={dimColor} strokeWidth={1} strokeDasharray={dashPattern} />
              <line x1={dX + dW / 2 - 8} y1={innerBottom} x2={dX + dW / 2 + 8} y2={innerBottom} stroke={dimColor} strokeWidth={1} />
              <line x1={dX + dW / 2 - 8} y1={dY + dH} x2={dX + dW / 2 + 8} y2={dY + dH} stroke={dimColor} strokeWidth={1} />
              <text x={dX + dW / 2 + 14} y={dY + dH - c.bottomMargin / 2} textAnchor="start" dominantBaseline="central" fill={dimColor} {...txtBase}>{c.bottomMargin}</text>
              {/* Left margin */}
              {(() => {
                const alignY = innerTop + topUnitH / 3
                return (
                  <g>
                    <line x1={dX} y1={alignY} x2={innerLeft} y2={alignY} stroke={dimColor} strokeWidth={1} strokeDasharray={dashPattern} />
                    <line x1={dX} y1={alignY - 8} x2={dX} y2={alignY + 8} stroke={dimColor} strokeWidth={1} />
                    <line x1={innerLeft} y1={alignY - 8} x2={innerLeft} y2={alignY + 8} stroke={dimColor} strokeWidth={1} />
                    <text x={dX + c.leftMargin / 2} y={alignY - 16} textAnchor="middle" fill={dimColor} {...txtBase}>{c.leftMargin}</text>
                  </g>
                )
              })()}
              {/* Right margin */}
              {(() => {
                const alignY = innerTop + topUnitH / 3
                return (
                  <g>
                    <line x1={innerRight} y1={alignY} x2={dX + dW} y2={alignY} stroke={dimColor} strokeWidth={1} strokeDasharray={dashPattern} />
                    <line x1={innerRight} y1={alignY - 8} x2={innerRight} y2={alignY + 8} stroke={dimColor} strokeWidth={1} />
                    <line x1={dX + dW} y1={alignY - 8} x2={dX + dW} y2={alignY + 8} stroke={dimColor} strokeWidth={1} />
                    <text x={dX + dW - c.rightMargin / 2} y={alignY - 16} textAnchor="middle" fill={dimColor} {...txtBase}>{c.rightMargin}</text>
                  </g>
                )
              })()}

              {/* Margin boundary lines (faint) */}
              <line x1={dX} y1={innerTop} x2={dX + dW} y2={innerTop} stroke={dimColor} strokeWidth={0.5} strokeDasharray="2 4" opacity={0.4} />
              <line x1={dX} y1={innerBottom} x2={dX + dW} y2={innerBottom} stroke={dimColor} strokeWidth={0.5} strokeDasharray="2 4" opacity={0.4} />
              <line x1={innerLeft} y1={dY} x2={innerLeft} y2={dY + dH} stroke={dimColor} strokeWidth={0.5} strokeDasharray="2 4" opacity={0.4} />
              <line x1={innerRight} y1={dY} x2={innerRight} y2={dY + dH} stroke={dimColor} strokeWidth={0.5} strokeDasharray="2 4" opacity={0.4} />

              {/* ── Gap annotations ── */}
              {/* Horizontal gap */}
              <rect x={gapLeft} y={innerTop} width={c.horizontalGap} height={innerBottom - innerTop} fill={gapColor} opacity={0.08} />
              <line x1={gapLeft} y1={splitY} x2={gapLeft + c.horizontalGap} y2={splitY} stroke={gapColor} strokeWidth={1.5} />
              <line x1={gapLeft} y1={splitY - 8} x2={gapLeft} y2={splitY + 8} stroke={gapColor} strokeWidth={1.5} />
              <line x1={gapLeft + c.horizontalGap} y1={splitY - 8} x2={gapLeft + c.horizontalGap} y2={splitY + 8} stroke={gapColor} strokeWidth={1.5} />
              <text x={gapLeft + c.horizontalGap / 4} y={innerTop + (innerBottom - innerTop) / 2} textAnchor="middle" dominantBaseline="central" fill={gapColor} {...txtBase} transform={`rotate(-90, ${gapLeft + c.horizontalGap / 2}, ${innerTop + (innerBottom - innerTop) / 2})`}>vert gap {c.verticalGap}</text>
              {/* Vertical gap */}
              <rect x={innerLeft} y={gapTop} width={innerRight - innerLeft} height={c.verticalGap} fill={gapColor} opacity={0.08} />
              <line x1={dX + dW / 2} y1={gapTop} x2={dX + dW / 2} y2={gapTop + c.verticalGap} stroke={gapColor} strokeWidth={1.5} />
              <line x1={dX + dW / 2 - 8} y1={gapTop} x2={dX + dW / 2 + 8} y2={gapTop} stroke={gapColor} strokeWidth={1.5} />
              <line x1={dX + dW / 2 - 8} y1={gapTop + c.verticalGap} x2={dX + dW / 2 + 8} y2={gapTop + c.verticalGap} stroke={gapColor} strokeWidth={1.5} />
              <text x={gapLeft - c.horizontalGap / 4} y={gapTop + c.verticalGap / 2} textAnchor="end" dominantBaseline="central" fill={gapColor} {...txtBase}>horz gap {c.horizontalGap}</text>

              {/* ── Ratio split ── */}
              <line x1={innerLeft} y1={splitY} x2={innerRight} y2={splitY} stroke={gapColor} strokeWidth={0.5} strokeDasharray="6 3" opacity={0.5} />
              <text x={dX + dW + 8} y={innerTop + topUnitH / 2} dominantBaseline="central" fill={gapColor} {...txtBase}>{c.topPanelRatio}%</text>
              <text x={dX + dW + 8} y={innerTop + topUnitH + c.verticalGap + botUnitH / 2} dominantBaseline="central" fill={gapColor} {...txtBase}>{100 - c.topPanelRatio}%</text>

              {/* ── Beading & panel labels per unit ── */}
              {cols.map((colX, ci) =>
                rows.map((rowY, ri) => {
                  const bx = dX + colX
                  const by = dY + rowY
                  const uh = unitHeights[ri]
                  const panelH = ri === 0 ? cuts.topPanelHeight : cuts.bottomPanelHeight
                  return (
                    <g key={`s-${ci}-${ri}`}>
                      {/* Beading outer edge highlight */}
                      <rect x={bx} y={by} width={unitW} height={uh} fill="none" stroke={beadColor} strokeWidth={1} opacity={0.5} />
                      {/* Beading width indicator at 1/3 down left side */}
                      {(() => {
                        const tickY = by + uh / 3
                        const tickX = bx + c.beadingWidth / 2
                        return (
                          <g>
                            <line x1={bx} y1={tickY} x2={bx + c.beadingWidth} y2={tickY} stroke={beadColor} strokeWidth={1.5} />
                            <line x1={bx} y1={tickY - 4} x2={bx} y2={tickY + 4} stroke={beadColor} strokeWidth={1.5} />
                            <line x1={bx + c.beadingWidth} y1={tickY - 4} x2={bx + c.beadingWidth} y2={tickY + 4} stroke={beadColor} strokeWidth={1.5} />
                            <text x={tickX} y={tickY + 16} textAnchor="middle" fill={beadColor} {...txtBase} fontSize={14}>{c.beadingWidth}</text>
                          </g>
                        )
                      })()}
                      {/* Panel size label */}
                      <text x={bx + unitW / 2} y={by + uh / 2 - 12} textAnchor="middle" dominantBaseline="central" fill={beadColor} {...txtBase} fontSize={16} opacity={0.8}>
                        {cuts.panelWidth}×{panelH}
                      </text>
                      {/* Panel-beading gap label */}
                      {cuts.panelBeadingGap > 0 && (
                        <text x={bx + unitW / 2} y={by + uh / 2 + 12} textAnchor="middle" dominantBaseline="central" fill={beadColor} {...txtBase} fontSize={14} opacity={0.6}>
                          gap {cuts.panelBeadingGap}
                        </text>
                      )}
                    </g>
                  )
                })
              )}

              {/* ── Unit width dimension line (below top-left unit) ── */}
              {(() => {
                const ux = dX + cols[0]
                const uy = dY + rows[0] + unitHeights[0] + 8
                return (
                  <g>
                    <line x1={ux} y1={uy} x2={ux + unitW} y2={uy} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux} y1={uy - 6} x2={ux} y2={uy + 6} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux + unitW} y1={uy - 6} x2={ux + unitW} y2={uy + 6} stroke={beadColor} strokeWidth={1.5} />
                    <text x={ux + unitW / 2} y={uy + 22} textAnchor="middle" fill={beadColor} {...txtBase}>unit {unitW.toFixed(1)}</text>
                  </g>
                )
              })()}

              {/* ── Unit height dimension lines (to the left of top-left unit) ── */}
              {(() => {
                const ux = dX + cols[0] - 8
                const topY1 = dY + rows[0]
                const topY2 = topY1 + unitHeights[0]
                const botY1 = dY + rows[1]
                const botY2 = botY1 + unitHeights[1]
                const labelX = ux - 22
                return (
                  <g>
                    {/* Top unit height */}
                    <line x1={ux} y1={topY1} x2={ux} y2={topY2} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux - 6} y1={topY1} x2={ux + 6} y2={topY1} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux - 6} y1={topY2} x2={ux + 6} y2={topY2} stroke={beadColor} strokeWidth={1.5} />
                    <text x={labelX} y={topY1 + unitHeights[0] / 2} textAnchor="middle" dominantBaseline="central" fill={beadColor} {...txtBase}
                      transform={`rotate(-90, ${labelX}, ${topY1 + unitHeights[0] / 2})`}>
                      unit {topUnitH.toFixed(1)}
                    </text>
                    {/* Bottom unit height */}
                    <line x1={ux} y1={botY1} x2={ux} y2={botY2} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux - 6} y1={botY1} x2={ux + 6} y2={botY1} stroke={beadColor} strokeWidth={1.5} />
                    <line x1={ux - 6} y1={botY2} x2={ux + 6} y2={botY2} stroke={beadColor} strokeWidth={1.5} />
                    <text x={labelX} y={botY1 + unitHeights[1] / 2} textAnchor="middle" dominantBaseline="central" fill={beadColor} {...txtBase}
                      transform={`rotate(-90, ${labelX}, ${botY1 + unitHeights[1] / 2})`}>
                      unit {botUnitH.toFixed(1)}
                    </text>
                  </g>
                )
              })()}

              {/* ── Handle position ── */}
              <line x1={hx} y1={dY} x2={hx} y2={hy} stroke={handleColor} strokeWidth={0.8} strokeDasharray={dashPattern} opacity={0.6} />
              <line x1={c.handleSide === 'left' ? dX : dX + dW} y1={hy} x2={hx} y2={hy} stroke={handleColor} strokeWidth={1.2} strokeDasharray={dashPattern} opacity={0.6} />
              <text x={hx + (c.handleSide === 'left' ? -8 : 8)} y={hy - 22} textAnchor={c.handleSide === 'left' ? 'end' : 'start'} fill={handleColor} {...txtBase}>
                ↕ {c.handleHeight}
              </text>
              <text x={hx + (c.handleSide === 'left' ? -8 : 8)} y={hy - 8} textAnchor={c.handleSide === 'left' ? 'end' : 'start'} fill={handleColor} {...txtBase}>
                ↔ {c.handleIndent}
              </text>

              {/* ── Door dimensions (outside edges) ── */}
              <text x={dX + dW / 2} y={dY - 20} textAnchor="middle" fill={dimColor} {...txtBase} fontSize={24} fontWeight={600}>
                {c.doorWidth} × {c.doorHeight} mm
              </text>
            </g>
          )
        }

        return null
      })()}
    </svg>
      <div className="absolute top-2 right-2 flex gap-1">
        {isZoomed && (
          <button
            onClick={handleDoubleClick}
            tabIndex={-1}
            className="px-2 py-1 rounded text-[10px] font-medium bg-secondary/80 text-secondary-foreground hover:bg-secondary border border-border backdrop-blur-sm"
          >
            Reset ({Math.round(zoom * 100)}%)
          </button>
        )}
        <button
          onClick={onToggleOverlay}
          tabIndex={-1}
          className={`px-2 py-1 rounded text-[10px] font-medium border backdrop-blur-sm transition-colors ${
            guide === 'overlay'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-secondary/80 text-secondary-foreground hover:bg-secondary border-border'
          }`}
        >
          {guide === 'overlay' ? 'Hide overlay' : 'Show overlay'}
        </button>
        <button
          onClick={copyAsPng}
          tabIndex={-1}
          className={`p-1.5 rounded border backdrop-blur-sm transition-all duration-300 ${
            pngState === 'copied'
              ? 'bg-green-900/80 text-green-300 border-green-700'
              : pngState === 'copying'
                ? 'bg-secondary/80 text-secondary-foreground border-border'
                : 'bg-secondary/80 text-secondary-foreground hover:bg-secondary border-border'
          }`}
          title="Copy as PNG"
        >
          {pngState === 'copied' ? (
            <Check className="h-3.5 w-3.5" />
          ) : pngState === 'copying' ? (
            <Download className="h-3.5 w-3.5 animate-bounce" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

// ── Text formatting for sharing ───────────────────────

function formatTimestamp(): string {
  const d = new Date()
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatSummaryText(name: string, c: DoorConfig, cuts: CutResult): string {
  const lines: string[] = [
    `🚪 Summary — ${name}`,
    `📅 ${formatTimestamp()}`,
    ``,
    `Door: ${c.doorWidth} × ${c.doorHeight} mm`,
    `Margins: T${c.topMargin} B${c.bottomMargin} L${c.leftMargin} R${c.rightMargin} mm`,
    `Gaps: H${c.horizontalGap} V${c.verticalGap} mm`,
    `Beading width: ${c.beadingWidth} mm`,
    `Panel–beading gap: ${cuts.panelBeadingGap} mm`,
    `Handle: ${c.handleSide}, ${c.handleHeight} mm from top, ${c.handleSpread} mm spread from edge`,
    ``,
    `📐 MDF Panels`,
    `  Top panels (×2): ${cuts.panelWidth} × ${cuts.topPanelHeight} mm`,
    `  Bottom panels (×2): ${cuts.panelWidth} × ${cuts.bottomPanelHeight} mm`,
    ``,
    `✂️ Beading (45° mitres, long-point → short-point)`,
    `  Top horizontal (×4): ${cuts.topHorizontalBeading} → ${cuts.topHorizontalBeadingShort} mm`,
    `  Top vertical (×4): ${cuts.topVerticalBeading} → ${cuts.topVerticalBeadingShort} mm`,
    `  Bottom horizontal (×4): ${cuts.bottomHorizontalBeading} → ${cuts.bottomHorizontalBeadingShort} mm`,
    `  Bottom vertical (×4): ${cuts.bottomVerticalBeading} → ${cuts.bottomVerticalBeadingShort} mm`,
    ``,
    `📦 Totals`,
    `  MDF panels: 4 pieces`,
    `  Beading: 16 pieces`,
    `  Total beading: ${(
      cuts.topHorizontalBeading * 4 +
      cuts.topVerticalBeading * 4 +
      cuts.bottomHorizontalBeading * 4 +
      cuts.bottomVerticalBeading * 4
    ).toFixed(0)} mm`,
    ``,
    `📌 Fitting Guide (pin positions from door edges)`,
    ...cuts.unitPositions.map(up =>
      `  ${up.label}: top beading at Y=${up.pinY} mm, pin at (${up.pinX}, ${up.pinY}) mm`
    ),
  ]
  return lines.join('\n')
}

function formatCompactText(name: string, c: DoorConfig, cuts: CutResult): string {
  return [
    `${name} (${formatTimestamp()})`,
    `${c.doorWidth}×${c.doorHeight}`,
    `MDF: ${cuts.panelWidth}×${cuts.topPanelHeight} (×2), ${cuts.panelWidth}×${cuts.bottomPanelHeight} (×2)`,
    `Beading LP→SP: TH ${cuts.topHorizontalBeading}→${cuts.topHorizontalBeadingShort} (×4), TV ${cuts.topVerticalBeading}→${cuts.topVerticalBeadingShort} (×4), BH ${cuts.bottomHorizontalBeading}→${cuts.bottomHorizontalBeadingShort} (×4), BV ${cuts.bottomVerticalBeading}→${cuts.bottomVerticalBeadingShort} (×4)`,
    `Gap: ${cuts.panelBeadingGap}mm`,
  ].join('\n')
}

function formatAllDoorsSummary(doors: SavedDoor[]): string {
  const ts = formatTimestamp()
  const sections = doors.map((door) => {
    const cuts = calculateCuts(door.config)
    if (!cuts.isValid) return `🚪 ${door.name} — invalid configuration`
    return formatSummaryText(door.name, door.config, cuts)
  })
  return [
    `📋 All Doors Summary (${doors.length} door${doors.length > 1 ? 's' : ''})`,
    `📅 ${ts}`,
    '',
    sections.join('\n\n' + '─'.repeat(40) + '\n\n'),
  ].join('\n')
}

function CopyButton({ text, label, fullWidth }: { text: string; label: string; fullWidth?: boolean }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={copy}
      tabIndex={0}
      data-card-tabbable
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
        fullWidth ? 'w-full mt-1' : ''
      } ${
        copied
          ? 'bg-green-500/15 text-green-400 border border-green-500/30'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border'
      }`}
    >
      {copied ? (
        <><Check className="h-3 w-3" /> Copied!</>
      ) : (
        <><Copy className="h-3 w-3" /> {label}</>
      )}
    </button>
  )
}

// ── Main Component ─────────────────────────────────────

export function DoorCalculator() {
  const [doors, setDoors] = usePersistedState<SavedDoor[]>('door-calculator-doors', initialDoors)
  const [activeDoorId, setActiveDoorId] = usePersistedState<string>('door-calculator-active', initialDoors[0].id)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editNameValue, setEditNameValue] = useState('')
  const [activeGuide, setActiveGuide] = useState<DiagnosticGuide>(null)
  const [previewOpen, setPreviewOpen] = usePersistedState<boolean>('door-calculator-preview-open', true)

  const activeDoor = doors.find((d) => d.id === activeDoorId) ?? doors[0]
  const config = activeDoor.config
  const cuts = useMemo(() => calculateCuts(config), [config])

  const update = <K extends keyof DoorConfig>(key: K, value: DoorConfig[K]) => {
    setDoors((prev) =>
      prev.map((d) => (d.id === activeDoor.id ? { ...d, config: { ...d.config, [key]: value } } : d))
    )
    setActiveGuide(keyToGuide[key] ?? null)
  }

  const addDoor = () => {
    const newDoor: SavedDoor = {
      id: crypto.randomUUID(),
      name: `Door ${doors.length + 1}`,
      config: { ...activeDoor.config }
    }
    setDoors((prev) => [...prev, newDoor])
    setActiveDoorId(newDoor.id)
  }

  const deleteDoor = (id: string) => {
    if (doors.length <= 1) return
    setDoors((prev) => {
      const next = prev.filter((d) => d.id !== id)
      if (activeDoorId === id) setActiveDoorId(next[0].id)
      return next
    })
  }

  const startRename = (door: SavedDoor) => {
    setEditingName(door.id)
    setEditNameValue(door.name)
  }

  const commitRename = () => {
    if (editingName && editNameValue.trim()) {
      setDoors((prev) =>
        prev.map((d) => (d.id === editingName ? { ...d, name: editNameValue.trim() } : d))
      )
    }
    setEditingName(null)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 h-full">
      {/* ── Left column: Inputs ─────────────────── */}
      <div className="w-full lg:w-[340px] shrink-0 flex flex-col gap-4 overflow-y-auto pr-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Door Decoration Calculator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calculate MDF panel sizes and mitred beading cuts for a 4-panel door design.
          </p>
        </div>

        {/* Door selector */}
        <CollapsibleCard
          title="Doors"
          summary={<><SummaryBadge value={activeDoor.name} /><SummaryBadge label="Total" value={`${doors.length}`} /></>}
        >
            {doors.map((door) => (
              <div
                key={door.id}
                className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                  door.id === activeDoor.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted/50 text-muted-foreground'
                }`}
                onClick={() => setActiveDoorId(door.id)}
              >
                {editingName === door.id ? (
                  <input
                    autoFocus
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingName(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm py-0"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate">{door.name}</span>
                )}
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {door.config.doorWidth}×{door.config.doorHeight}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(door) }}
                    tabIndex={-1}
                    className="p-0.5 rounded hover:bg-muted"
                    title="Rename"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                  {doors.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteDoor(door.id) }}
                      tabIndex={-1}
                      className="p-0.5 rounded hover:bg-destructive/20"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              onClick={addDoor}
              tabIndex={0}
              data-card-tabbable
              className="inline-flex items-center justify-center gap-1 w-full mt-1 px-2 py-1.5 rounded-md text-xs font-medium border border-dashed border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" /> Add door
            </button>
            {doors.length > 1 && (
              <CopyButton text={formatAllDoorsSummary(doors)} label={`Copy full summary (${doors.length} doors)`} fullWidth />
            )}
        </CollapsibleCard>

        <CollapsibleCard title="Door Dimensions" summary={<><SummaryBadge label="W" value={`${config.doorWidth}`} /><SummaryBadge label="H" value={`${config.doorHeight}`} /></>}>
            <SliderInput label="Width" value={config.doorWidth} onChange={(v) => update('doorWidth', v)} min={300} max={1200} />
            <SliderInput label="Height" value={config.doorHeight} onChange={(v) => update('doorHeight', v)} min={500} max={2500} />
        </CollapsibleCard>

        <CollapsibleCard title="Door Handle" summary={<><SummaryBadge label="Side" value={config.handleSide === 'left' ? 'Left' : 'Right'} /><SummaryBadge label="Height" value={`${config.handleHeight}`} /><SummaryBadge label="Spread" value={`${config.handleSpread}`} /></>}>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Side</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => update('handleSide', 'left')}
                  tabIndex={-1}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    config.handleSide === 'left'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  Left
                </button>
                <button
                  onClick={() => update('handleSide', 'right')}
                  tabIndex={-1}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    config.handleSide === 'right'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  Right
                </button>
              </div>
            </div>
            <SliderInput label="Height from top" value={config.handleHeight} onChange={(v) => update('handleHeight', v)} min={200} max={1800} />
            <SliderInput label="Indent from edge" value={config.handleIndent} onChange={(v) => update('handleIndent', v)} min={20} max={150} />
            <SliderInput label="Spread from edge" value={config.handleSpread} onChange={(v) => update('handleSpread', v)} min={30} max={250} />
            {cuts.handleWarnings.length > 0 && (
              <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 mt-1">
                {cuts.handleWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
        </CollapsibleCard>

        <CollapsibleCard title="Margins (door edge → beading)" defaultOpen={false} summary={<><SummaryBadge label="T" value={`${config.topMargin}`} /><SummaryBadge label="B" value={`${config.bottomMargin}`} /><SummaryBadge label="L" value={`${config.leftMargin}`} /><SummaryBadge label="R" value={`${config.rightMargin}`} /></>}>
            <SliderInput label="Top" value={config.topMargin} onChange={(v) => update('topMargin', v)} min={10} max={300} />
            <SliderInput label="Bottom" value={config.bottomMargin} onChange={(v) => update('bottomMargin', v)} min={10} max={300} />
            <SliderInput label="Left" value={config.leftMargin} onChange={(v) => update('leftMargin', v)} min={10} max={300} />
            <SliderInput label="Right" value={config.rightMargin} onChange={(v) => update('rightMargin', v)} min={10} max={300} />
        </CollapsibleCard>

        <CollapsibleCard title="Gaps Between Panels" defaultOpen={false} summary={<><SummaryBadge label="Horiz" value={`${config.horizontalGap}`} /><SummaryBadge label="Vert" value={`${config.verticalGap}`} /></>}>
            <SliderInput label="Horizontal gap" value={config.horizontalGap} onChange={(v) => update('horizontalGap', v)} min={10} max={300} />
            <SliderInput label="Vertical gap" value={config.verticalGap} onChange={(v) => update('verticalGap', v)} min={10} max={300} />
        </CollapsibleCard>

        <CollapsibleCard title="Beading & Panel" summary={<><SummaryBadge label="Beading" value={`${config.beadingWidth}`} /><SummaryBadge label="Panel" value={`${config.mdfPanelWidth}`} /></>}>
            <SliderInput label="Beading width" value={config.beadingWidth} onChange={(v) => update('beadingWidth', v)} min={5} max={50} />
            <SliderInput label="MDF panel width" value={config.mdfPanelWidth} onChange={(v) => update('mdfPanelWidth', v)} min={50} max={500} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Panel Height Ratio"
          description={`Top panels get ${config.topPanelRatio}% of available height, bottom panels get ${100 - config.topPanelRatio}%.`}
          summary={<><SummaryBadge label="Top" value={`${config.topPanelRatio}%`} /><SummaryBadge label="Bottom" value={`${100 - config.topPanelRatio}%`} /></>}
        >
            <SliderInput
              label={`Top ${config.topPanelRatio}% / Bottom ${100 - config.topPanelRatio}%`}
              value={config.topPanelRatio}
              onChange={(v) => update('topPanelRatio', v)}
              suffix="%"
              min={15}
              max={85}
            />
        </CollapsibleCard>

      </div>

      {/* ── Right column: Preview & Cut List ──── */}
      <div className="flex-1 min-w-0 flex flex-col gap-0 overflow-hidden">
        {/* Validation errors */}
        {!cuts.isValid && (
          <Card className="border-destructive mb-2 shrink-0">
            <CardContent className="pt-4">
              {cuts.errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-destructive-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Preview (collapsible) */}
        <Card className={`shrink-0 flex flex-col ${ previewOpen ? 'flex-1 min-h-0' : '' }`}>
          <button
            onClick={() => setPreviewOpen((o) => !o)}
            tabIndex={-1}
            className="w-full text-left"
          >
            <CardHeader className="pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Preview — {activeDoor.name}</CardTitle>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                    previewOpen ? '' : '-rotate-90'
                  }`}
                />
              </div>
            </CardHeader>
          </button>
          {previewOpen && (
            <CardContent className="flex-1 min-h-0 pb-3">
              <DoorPreview config={config} cuts={cuts} guide={activeGuide} onToggleOverlay={() => setActiveGuide(activeGuide === 'overlay' ? null : 'overlay')} />
            </CardContent>
          )}
        </Card>

        {/* Details (scrollable, expands when preview collapsed) */}
        <div className={`overflow-y-auto flex flex-col gap-4 pt-4 pr-3 ${ previewOpen ? 'shrink-0 max-h-[45%]' : 'flex-1 min-h-0' }`}>

        {/* Cut list */}
        {cuts.isValid && (
          <CollapsibleCard
            title="Cut List"
            description="Beading lengths are long-point (outside edge) for 45° mitred corners. Short-point in parentheses."
            summary={<>
              <SummaryBadge label={`${cuts.panelWidth}×${cuts.topPanelHeight} top`} />
              <SummaryBadge label={`${cuts.panelWidth}×${cuts.bottomPanelHeight} bot`} />
              <SummaryBadge label="16 beading pcs" />
            </>}
          >
              {/* MDF Panels */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                MDF Panels
              </h4>
              <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm">
                <span className="text-muted-foreground">Top panels</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">×2</span>
                  <span className="font-mono font-medium">
                    {cuts.panelWidth} × {cuts.topPanelHeight} mm
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm">
                <span className="text-muted-foreground">Bottom panels</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">×2</span>
                  <span className="font-mono font-medium">
                    {cuts.panelWidth} × {cuts.bottomPanelHeight} mm
                  </span>
                </div>
              </div>

              <Separator className="my-2" />

              {/* Top panel beading */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Beading — Top Panels (45° mitre each end)
              </h4>
              <CutRow
                label="Horizontal (top & bottom)"
                longPoint={cuts.topHorizontalBeading}
                shortPoint={cuts.topHorizontalBeadingShort}
                qty={4}
              />
              <CutRow
                label="Vertical (left & right)"
                longPoint={cuts.topVerticalBeading}
                shortPoint={cuts.topVerticalBeadingShort}
                qty={4}
              />

              <Separator className="my-2" />

              {/* Bottom panel beading */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Beading — Bottom Panels (45° mitre each end)
              </h4>
              <CutRow
                label="Horizontal (top & bottom)"
                longPoint={cuts.bottomHorizontalBeading}
                shortPoint={cuts.bottomHorizontalBeadingShort}
                qty={4}
              />
              <CutRow
                label="Vertical (left & right)"
                longPoint={cuts.bottomVerticalBeading}
                shortPoint={cuts.bottomVerticalBeadingShort}
                qty={4}
              />

              <Separator className="my-2" />

              {/* Totals */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Totals
              </h4>
              <div className="flex items-center justify-between py-1.5 px-2 rounded text-sm bg-muted/30">
                <span className="text-muted-foreground">MDF panels</span>
                <span className="font-mono font-medium">4 pieces</span>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 rounded text-sm bg-muted/30">
                <span className="text-muted-foreground">Beading pieces</span>
                <span className="font-mono font-medium">16 pieces</span>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 rounded text-sm bg-muted/30">
                <span className="text-muted-foreground">Total beading length</span>
                <span className="font-mono font-medium">
                  {(
                    cuts.topHorizontalBeading * 4 +
                    cuts.topVerticalBeading * 4 +
                    cuts.bottomHorizontalBeading * 4 +
                    cuts.bottomVerticalBeading * 4
                  ).toFixed(0)}{' '}
                  mm
                </span>
              </div>
            </CollapsibleCard>
        )}

        {/* Fitting Guide */}
        {cuts.isValid && (
          <CollapsibleCard
            title="Fitting Guide"
            description="Pin the top beading piece first, then square the remaining sides from it. Positions measured from the top-left corner of the door."
            summary={<>
              {cuts.unitPositions.map((up) => (
                <SummaryBadge key={up.label} label={`${up.label}: (${up.pinX},${up.pinY})`} />
              ))}
            </>}
          >
              {cuts.unitPositions.map((up) => (
                <div key={up.label} className="rounded-md bg-muted/30 px-3 py-2">
                  <h4 className="text-xs font-semibold text-foreground mb-1.5">{up.label}</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="text-muted-foreground">Top beading Y</div>
                    <div className="font-mono text-right">{up.beadingY} mm from top</div>
                    <div className="text-muted-foreground">Top beading X span</div>
                    <div className="font-mono text-right">{up.beadingLeftX} → {up.beadingRightX} mm</div>
                    <div className="text-muted-foreground">Center pin</div>
                    <div className="font-mono text-right font-medium">({up.pinX}, {up.pinY}) mm</div>
                  </div>
                </div>
              ))}
            </CollapsibleCard>
        )}

        {/* Summary & Share */}
        {cuts.isValid && (
          <CollapsibleCard
            title="Summary"
            description="Complete measurements for this door."
            summary={<>
              <SummaryBadge label={`${config.doorWidth}×${config.doorHeight}`} />
              <SummaryBadge label={`4 MDF + 16 beading`} />
            </>}
          >
              {/* Door setup */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">Door size</div>
                <div className="font-mono text-right">{config.doorWidth} × {config.doorHeight} mm</div>
                <div className="text-muted-foreground">Margins (T/B/L/R)</div>
                <div className="font-mono text-right">{config.topMargin} / {config.bottomMargin} / {config.leftMargin} / {config.rightMargin} mm</div>
                <div className="text-muted-foreground">Gaps (H/V)</div>
                <div className="font-mono text-right">{config.horizontalGap} / {config.verticalGap} mm</div>
                <div className="text-muted-foreground">Beading width</div>
                <div className="font-mono text-right">{config.beadingWidth} mm</div>
                <div className="text-muted-foreground">Panel–beading gap</div>
                <div className="font-mono text-right">{cuts.panelBeadingGap} mm</div>
              </div>

              <Separator />

              {/* MDF */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">MDF Panels</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="text-muted-foreground">Top panels (×2)</div>
                  <div className="font-mono text-right">{cuts.panelWidth} × {cuts.topPanelHeight} mm</div>
                  <div className="text-muted-foreground">Bottom panels (×2)</div>
                  <div className="font-mono text-right">{cuts.panelWidth} × {cuts.bottomPanelHeight} mm</div>
                </div>
              </div>

              <Separator />

              {/* Beading */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Beading (45° mitres)</h4>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm items-center">
                  <div />
                  <div className="text-[10px] text-muted-foreground text-right uppercase">Long pt</div>
                  <div className="text-[10px] text-muted-foreground text-right uppercase">Short pt</div>

                  <div className="text-muted-foreground">Top horiz (×4)</div>
                  <div className="font-mono text-right">{cuts.topHorizontalBeading}</div>
                  <div className="font-mono text-right text-muted-foreground">{cuts.topHorizontalBeadingShort}</div>

                  <div className="text-muted-foreground">Top vert (×4)</div>
                  <div className="font-mono text-right">{cuts.topVerticalBeading}</div>
                  <div className="font-mono text-right text-muted-foreground">{cuts.topVerticalBeadingShort}</div>

                  <div className="text-muted-foreground">Bottom horiz (×4)</div>
                  <div className="font-mono text-right">{cuts.bottomHorizontalBeading}</div>
                  <div className="font-mono text-right text-muted-foreground">{cuts.bottomHorizontalBeadingShort}</div>

                  <div className="text-muted-foreground">Bottom vert (×4)</div>
                  <div className="font-mono text-right">{cuts.bottomVerticalBeading}</div>
                  <div className="font-mono text-right text-muted-foreground">{cuts.bottomVerticalBeadingShort}</div>
                </div>
              </div>

              <Separator />

              {/* Totals */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">Total MDF pieces</div>
                <div className="font-mono text-right font-medium">4</div>
                <div className="text-muted-foreground">Total beading pieces</div>
                <div className="font-mono text-right font-medium">16</div>
                <div className="text-muted-foreground">Total beading length</div>
                <div className="font-mono text-right font-medium">
                  {(
                    cuts.topHorizontalBeading * 4 +
                    cuts.topVerticalBeading * 4 +
                    cuts.bottomHorizontalBeading * 4 +
                    cuts.bottomVerticalBeading * 4
                  ).toFixed(0)} mm
                </div>
              </div>

              <Separator />

              {/* Copy buttons */}
              <div className="flex flex-wrap gap-2">
                <CopyButton text={formatSummaryText(activeDoor.name, config, cuts)} label="Copy full summary" />
                <CopyButton text={formatCompactText(activeDoor.name, config, cuts)} label="Copy compact" />
              </div>
            </CollapsibleCard>
        )}
        </div>
      </div>
    </div>
  )
}
