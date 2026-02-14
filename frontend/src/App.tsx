/*
  App.tsx — Spend Propensity Explorer (React)

  Pages:
   - Executive Summary: one‑page brief with KPIs, top correlations, segment sizes, actions.
   - Overview: EDA with Quick Insights, Distribution Explorer (histogram + mini boxplot), correlations, CV chart, anomalies.
   - Member Profile: toolbar → Get Recommendation → KPI chips, score and lift charts, Top K table with badges/tooltips.
   - Segments: auto‑cluster via elbow; segment summary, centroid profiles, lift tables.
   - Summary: global category means/std and full correlation heatmap.

  Palette for charts is centralized in PALETTE below to keep the business‑blue/green/amber look consistent.
*/
import React, { useMemo, useRef, useState } from 'react'
import { Bar, Line, Doughnut, Radar, Chart as ReactChart } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Tooltip,
  Legend,
} from 'chart.js'
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, RadialLinearScale, Tooltip, Legend, MatrixController, MatrixElement)

// Centralized palette for charts (light theme)
const PALETTE = {
  blue: 'rgba(13,110,253,0.7)',
  blueSoft: 'rgba(13,110,253,0.3)',
  green: 'rgba(25,135,84,0.6)',
  amber: 'rgba(255,193,7,0.6)',
  amberSoft: 'rgba(255,193,7,0.5)',
  gray: 'rgba(108,117,125,0.6)',
  red: 'rgba(220,53,69,0.7)'
} as const

// Deterministic seed for clustering to ensure stable segments between runs
const KMEANS_SEED = 12345

// Optional business-friendly names by top1 category
const SEGMENT_NAME_DICT: Record<string, string> = {
  Transportation: 'Commuters',
  Health: 'Wellness Focus',
  LuxuryGoods: 'Luxury‑leaning',
  Service: 'Service Seekers',
  Telecommunications: 'Connected Core',
  Groceries: 'Essentialists',
  Clothing: 'Style Savvy',
  'Food&Beverage': 'Foodies',
  PublicUtilities: 'Utility Focus',
  Others: 'Misc Explorers',
}

const CATEGORY_NAMES = [
  'Transportation','Health','LuxuryGoods','Service','Telecommunications','Groceries','Clothing','Food&Beverage','PublicUtilities','Others'
] as const

type Matrix = number[][]

function parseCSV(text: string): Matrix {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((v) => Number(v)))
}

function rankCategories(scores: number[]) {
  return scores
    .map((s, i) => ({ cat: CATEGORY_NAMES[i], s }))
    .sort((a, b) => b.s - a.s)
}

function recommendForMember(
  mat: Matrix,
  memberIndex: number,
  topK = 3,
  minThreshold = 0.0,
) {
  if (!mat || !mat.length) throw new Error('Matrix is empty')
  if (mat[0].length !== 10) throw new Error('Expected 10 columns')
  if (memberIndex < 0 || memberIndex >= mat.length)
    throw new Error('memberIndex out of range')
  const scores = mat[memberIndex]
  const ranked = rankCategories(scores)
  const filtered = ranked.filter((r) => r.s >= minThreshold)
  const chosen = (filtered.length ? filtered : ranked).slice(0, topK)
  return chosen.map((r) => [r.cat, r.s] as const)
}

function summaryStats(mat: Matrix) {
  const n = mat.length,
    m = mat[0].length
  const cols = Array.from({ length: m }, (_, j) =>
    mat.map((r) => r[j]).sort((a, b) => a - b),
  )
  const mean = cols.map((c) => c.reduce((a, b) => a + b, 0) / n)
  const std = cols.map((c, i) =>
    Math.sqrt(c.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / n),
  )
  const p = (c: number[], q: number) => {
    const k = (c.length - 1) * q
    const f = Math.floor(k)
    const d = k - f
    return f + 1 < c.length ? c[f] * (1 - d) + c[f + 1] * d : c[f]
  }
  const p50 = cols.map((c) => p(c, 0.5))
  const p90 = cols.map((c) => p(c, 0.9))
  const order = mean
    .map((v, i) => [i, v] as const)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
  const summary = order.map((i) => ({
    category: CATEGORY_NAMES[i],
    mean: mean[i],
    std: std[i],
    p50: p50[i],
    p90: p90[i],
  }))
  // correlations
  const corrMatrix: number[][] = Array.from({ length: m }, () => Array(m).fill(0))
  const topCorr: [string, string, number][] = []
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const a = cols[i],
        b = cols[j]
      const ma = mean[i],
        mb = mean[j]
      let num = 0,
        da = 0,
        db = 0
      for (let k = 0; k < n; k++) {
        const xa = a[k] - ma,
          xb = b[k] - mb
        num += xa * xb
        da += xa * xa
        db += xb * xb
      }
      const r = num / Math.sqrt(da * db || 1)
      corrMatrix[i][j] = r
      corrMatrix[j][i] = r
      topCorr.push([CATEGORY_NAMES[i], CATEGORY_NAMES[j], r])
    }
  }
  topCorr.sort((x, y) => y[2] - x[2])
  // set diagonal to 1
  for (let d = 0; d < m; d++) corrMatrix[d][d] = 1
  return { summary, topCorr: topCorr.slice(0, 5), corrMatrix, means: mean, stds: std }
}

export default function App() {
  const [mat, setMat] = useState<Matrix | null>(null)
  const [rows, setRows] = useState(0)
  const [memberIndex, setMemberIndex] = useState(0)
  const [topK, setTopK] = useState(3)
  const [minThreshold, setMinThreshold] = useState(0.0)
  const [recs, setRecs] = useState<readonly [string, number][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [activeTab, setActiveTab] = useState<'Executive Summary' | 'Overview' | 'Member Profile' | 'Segments' | 'Summary'>('Executive Summary')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filterColumn, setFilterColumn] = useState<number | 'any'>('any')
  const [filterQuery, setFilterQuery] = useState<string>('')
  const [overviewCat, setOverviewCat] = useState<number>(0)
  const [overviewExcludeSelf, setOverviewExcludeSelf] = useState<boolean>(true)
  const [overviewSortCorr, setOverviewSortCorr] = useState<boolean>(true)
  const [k, setK] = useState(3)
  const [clusterLabels, setClusterLabels] = useState<number[] | null>(null)
  const [centroids, setCentroids] = useState<number[][] | null>(null)
  const [selectedCluster, setSelectedCluster] = useState<number>(0)
  const [clusterSeed, setClusterSeed] = useState<number>(KMEANS_SEED)
  const [elbow, setElbow] = useState<{ ks: number[]; inertia: number[]; silhouette: number[]; suggestedK: number; bestBySil: number; finalK: number } | null>(null)
  const [selectionMethod, setSelectionMethod] = useState<'silhouette' | 'elbow' | 'compromise'>('silhouette')
  const [silMinGap, setSilMinGap] = useState<number>(0.05)
  const [segmentNames, setSegmentNames] = useState<string[] | null>(null)
  const [computing, setComputing] = useState<boolean>(false)
  const [segRightTab, setSegRightTab] = useState<'Profile' | 'Lift'>('Profile')
  const [segSort, setSegSort] = useState<'value' | 'lift'>('value')
  const [segTopN, setSegTopN] = useState<number>(10)
  const [segCompareMode, setSegCompareMode] = useState<'population' | 'segment'>('population')
  const [segCompareIdx, setSegCompareIdx] = useState<number>(0)
  const [sigExpanded, setSigExpanded] = useState<boolean>(true)
  const [sigSortKey, setSigSortKey] = useState<'score'|'share'|'index'>('score')
  const [sigSortDir, setSigSortDir] = useState<'desc'|'asc'>('desc')
  const [liftExpanded, setLiftExpanded] = useState<boolean>(true)
  const [liftSortKey, setLiftSortKey] = useState<'lift'|'seg'|'pop'|'category'>('lift')
  const [liftRows, setLiftRows] = useState<number>(8)
  const [liftTopOrder, setLiftTopOrder] = useState<'desc'|'asc'>('desc')
  const [liftUnderOrder, setLiftUnderOrder] = useState<'desc'|'asc'>('asc')
  const [summaryShowCorr, setSummaryShowCorr] = useState<boolean>(false)

  const summary = useMemo(() => (mat ? summaryStats(mat) : null), [mat])

  // Auto-load CSV from frontend/public (written by export_csv.py)
  // Uses an AbortController and a StrictMode guard to avoid double loads in dev.
  const loadAbortRef = useRef<AbortController | null>(null)
  async function loadCsv() {
    setLoading(true)
    setError(null)
    try {
      // Abort any previous in-flight load
      if (loadAbortRef.current) {
        try { loadAbortRef.current.abort() } catch {}
      }
      const controller = new AbortController()
      loadAbortRef.current = controller
      let res = await fetch('/spend_propensity.csv', { cache: 'no-store', signal: controller.signal as any })
      if (!res.ok) {
        // Fallback to relative path in case base URL or dev server config differs
        res = await fetch('spend_propensity.csv', { cache: 'no-store', signal: controller.signal as any })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const matrix = parseCSV(text)
      if (!matrix.length || matrix[0].length !== 10)
        throw new Error('CSV must be N×10 (no header).')
      setMat(matrix)
      setRows(matrix.length)
      setMemberIndex(0)
      // Compute a deterministic seed from data contents, but do not auto-cluster
      // Clustering runs only after explicit confirmation on the Segments page
      const seed = hashMatrixForSeed(matrix)
      setClusterSeed(seed)
      setElbow(null)
      setClusterLabels(null)
      setCentroids(null)
      setSegmentNames(null)
    } catch (err: any) {
      setError(
        (err?.message || String(err)) +
          '\nHint: run `python scripts/export_csv.py` to generate frontend/public/spend_propensity.csv, then reload.',
      )
      setMat(null)
      setRows(0)
    } finally {
      setLoading(false)
    }
  }

  // Guard against React 18 StrictMode double-invoking effects in dev: load once.
  const didLoadRef = useRef(false)
  React.useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    // Read query params for method/seed/gap to make runs reproducible across interviews
    try {
      const params = new URLSearchParams(window.location.search)
      const m = params.get('method') as any
      const s = params.get('seed')
      const g = params.get('gap')
      if (m && (m==='silhouette' || m==='elbow' || m==='compromise')) setSelectionMethod(m)
      if (s && !Number.isNaN(Number(s))) setClusterSeed(parseInt(s,10))
      if (g && !Number.isNaN(Number(g))) setSilMinGap(parseFloat(g))
    } catch {}
    loadCsv()
  }, [])

  // Persist selection method/seed/gap into URL so sessions are shareable
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('method', selectionMethod)
      url.searchParams.set('seed', String(clusterSeed))
      url.searchParams.set('gap', String(silMinGap))
      window.history.replaceState({}, '', url.toString())
    } catch {}
  }, [selectionMethod, clusterSeed, silMinGap])

  // Compute elbow (K=2..10), set suggestedK, and cluster automatically
  async function autoCluster(input: Matrix, seed: number = clusterSeed) {
    if (computing) return
    setComputing(true)
    const ks: number[] = []
    const inertia: number[] = []
    const silhouette: number[] = []
    for (let kk = 2; kk <= 10; kk++) {
      const res = kmeans(input, kk, 30, seed)
      ks.push(kk)
      inertia.push(res.inertia)
      silhouette.push(silhouetteApprox(input, res.labels, res.centroids))
    }
    const suggestedK = suggestElbow(ks, inertia)
    const bestBySil = ks[(silhouette as number[]).reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0)]
    // Selection modes
    let finalK = suggestedK
    if (selectionMethod === 'silhouette') {
      finalK = bestBySil
    } else if (selectionMethod === 'elbow') {
      finalK = suggestedK
    } else {
      // compromise: within 1 -> smaller; else silhouette must beat elbow by >= silMinGap
      const idxEl = ks.indexOf(suggestedK)
      const idxSi = ks.indexOf(bestBySil)
      const silEl = silhouette[idxEl]
      const silBest = silhouette[idxSi]
      if (Math.abs(suggestedK - bestBySil) <= 1) finalK = Math.min(suggestedK, bestBySil)
      else finalK = (silBest - silEl >= silMinGap) ? bestBySil : suggestedK
    }
    setElbow({ ks, inertia, silhouette, suggestedK, bestBySil, finalK })
    try {
      const best = kmeans(input, finalK, 30, seed)
      setClusterLabels(best.labels)
      setCentroids(best.centroids)
      setSegmentNames(nameSegments(best.centroids))
      setSelectedCluster(0)
    } finally {
      setComputing(false)
    }
  }

  // Clear recommendations when key inputs change to avoid showing stale content
  React.useEffect(() => {
    setRecs(null)
  }, [memberIndex, topK, minThreshold])

  // Re-cluster only on explicit confirmation (removed auto debounce). Users adjust seed/method then click confirm.

  function onRecommend() {
    try {
      if (!mat) throw new Error('Please upload a CSV first.')
      const r = recommendForMember(mat, memberIndex, topK, minThreshold)
      setRecs(r)
    } catch (err: any) {
      setError(err.message || String(err))
    }
  }

  const chartData = useMemo(() => {
    if (!summary) return null
    return {
      labels: summary.summary.map((s) => s.category),
      datasets: [
        {
          label: 'Mean propensity',
          data: summary.summary.map((s) => s.mean),
          backgroundColor: PALETTE.blue,
        },
        {
          label: 'Std dev (volatility)',
          data: summary.summary.map((s) => s.std),
          backgroundColor: PALETTE.amber,
        },
      ],
    }
  }, [summary])

  const heatmapData = useMemo(() => {
    if (!summary) return null
    const labels = CATEGORY_NAMES as unknown as string[]
    const data: { x: string; y: string; v: number }[] = []
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        data.push({ x: labels[i], y: labels[j], v: summary.corrMatrix[i][j] })
      }
    }
    return {
      labels,
      datasets: [
        {
          label: 'Correlation',
          data,
          parsing: { xAxisKey: 'x', yAxisKey: 'y', value: 'v' } as any,
          width: ({ chart }) => {
            const xs: any = (chart as any).scales?.x
            const n = xs?.ticks?.length || labels.length || 1
            const cell = (xs?.width || (chart.chartArea?.width || 0)) / n
            return Math.max(8, cell - 6)
          },
          height: ({ chart }) => {
            const ys: any = (chart as any).scales?.y
            const n = ys?.ticks?.length || labels.length || 1
            const cell = (ys?.height || (chart.chartArea?.height || 0)) / n
            return Math.max(8, cell - 6)
          },
          backgroundColor: (ctx: any) => {
            const v = Math.max(-1, Math.min(1, ctx.raw.v as number))
            // Normalize to palette: red (negative) → white → blue (positive)
            const mix = (a:number[], b:number[], t:number) => {
              const c = a.map((av, i) => Math.round(av + (b[i]-av)*t)) as number[]
              return `rgba(${c[0]},${c[1]},${c[2]},0.9)`
            }
            const RED = [220,53,69]
            const BLUE = [13,110,253]
            const WHITE = [245,248,252]
            if (v < 0) return mix(WHITE, RED, -v) // 0..1
            if (v > 0) return mix(WHITE, BLUE, v) // 0..1
            return `rgba(${WHITE[0]},${WHITE[1]},${WHITE[2]},0.9)`
          },
          borderWidth: 0.5,
          borderColor: 'rgba(0,0,0,0.15)',
        },
      ],
    }
  }, [summary])

  return (
    <div className="container">
      <div className="title">Spend Propensity & Recommendation</div>
      <div className="tabs">
        {(['Executive Summary', 'Overview', 'Member Profile', 'Segments', 'Summary'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`tab-btn ${activeTab===t ? 'active' : ''}`}
            style={{
              marginRight: 8,
              background: activeTab === t ? 'var(--accent)' : '#1a2440',
              color: 'white',
              border: 'none',
              borderRadius: 999,
              padding: '0.4rem 0.8rem',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {activeTab === 'Overview' && (
        <div className="callout" style={{ marginBottom: '.75rem' }}>
          Business Focus: concise EDA, clear rationale, and actionable findings are prioritized here.
        </div>
      )}
      {!mat && (
        <div className="callout" style={{ marginBottom: '.75rem' }}>
          <div>Data not loaded. Click “Compute Segments” on Executive Summary or run: python scripts/export_csv.py</div>
          {error && <pre style={{whiteSpace:'pre-wrap', color:'#b94a48', marginTop:'.5rem'}}>{String(error)}</pre>}
          <div className="no-print" style={{ display:'flex', gap:10, marginTop: '.5rem', flexWrap:'wrap' }}>
            <button className="primary" onClick={loadCsv}>Retry Load Data</button>
          </div>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        {/* Controls moved inside Member Profile as a horizontal toolbar */}
        {activeTab === 'Member Profile' && (
          <div className="card">
            <h2>Member Profile</h2>
            {!mat && <p className="muted">Upload or load a dataset to view a member profile.</p>}
            {mat && (
              <>
                <div className="callout" style={{ marginBottom: '.5rem' }}>
                  Purpose: per‑member view. The story flows as: What (Scores) → Why (Lift vs Population/Segment) → What to do (Top Recommendations, Deviations, and Action Plan).
                </div>
                <div className="guidance" style={{ marginBottom: '.5rem' }}>
                  <strong>How to read:</strong>
                  <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                    <li>Pick a member and generate recommendations.</li>
                    <li>Scan Scores (what this member prefers across categories).</li>
                    <li>Compare Category Lift (why these are recommended: member vs population and segment).</li>
                    <li>Review Top Recommendations and strongest Deviations to shortlist actions.</li>
                    <li>Use the Action Plan to finalize messaging and bundles.</li>
                  </ol>
                </div>
                <div className="toolbar" style={{ display:'flex', gap:12, alignItems:'end', flexWrap:'wrap', margin: '.25rem 0 0.75rem 0' }}>
                  <div style={{ minWidth: 220 }}>
                    <label>Member (index and top category)</label>
                    <select
                      value={memberIndex}
                      onChange={(e) => setMemberIndex(parseInt(e.target.value, 10))}
                      style={{ width: '100%', padding: '0.45rem 0.6rem' }}
                    >
                      {Array.from({ length: rows }, (_, i) => {
                        const scores = mat ? mat[i] : null
                        let label = `#${i}`
                        if (scores) {
                          const r = rankCategories(scores)[0]
                          label = `#${i} — Top: ${r.cat} (${r.s.toFixed(2)})`
                        }
                        return (
                          <option key={i} value={i}>
                            {label}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <label>Top K</label>
                    <input type="number" min={1} max={10} value={topK} onChange={(e) => setTopK(parseInt(e.target.value || '1', 10))} />
                  </div>
                  <div>
                    <label>Min Threshold</label>
                    <input type="number" step={0.01} value={minThreshold} onChange={(e) => setMinThreshold(parseFloat(e.target.value || '0'))} />
                  </div>
                  <div>
                    <button className="primary" onClick={onRecommend} disabled={!mat || loading}>Get Recommendation</button>
                  </div>
                  {loading && <span className="muted">Loading…</span>}
                  {error && (
                    <span style={{ color: '#ff8080' }}>
                      {String(error).split('\n')[0]}
                    </span>
                  )}
                </div>
                {!recs && (
                  <div className="muted" style={{ padding: '1rem 0' }}>
                    Press “Get Recommendation” to view member insights.
                  </div>
                )}
                {recs && (
                  <>
                    {(() => {
                      const scores = mat[memberIndex]
                      const total = scores.reduce((a,b)=>a+b, 0)
                      const max = Math.max(...scores)
                      const idx = scores.indexOf(max)
                      const topCat = (CATEGORY_NAMES as unknown as string[])[idx]
                      const seg = clusterLabels ? clusterLabels[memberIndex] : null
                      let kpiClass = ''
                      let zTop = 0
                      if (summary) {
                        const mu = summary.means[idx]
                        const sd = summary.stds[idx]
                        zTop = sd > 0 ? (max - mu) / sd : 0
                        if (zTop > 1.5) kpiClass = 'opportunity'
                        else if (zTop > 0.5) kpiClass = 'watch'
                      }
                      return (
                        <div className="kpis">
                          <span
                            className={`kpi-chip ${kpiClass}`}
                            title={`Opportunity if z > 1.5 (watch if 0.5–1.5). Current z=${zTop.toFixed(2)} for ${topCat}.`}
                          >
                            <strong>Top</strong>{topCat} ({max.toFixed(2)})
                          </span>
                          <span className="kpi-chip" title="Sum of this member's 10 category scores."><strong>Total</strong>{total.toFixed(2)}</span>
                      {seg!=null && (
                            <span className="kpi-chip" title="Cluster assignment from Segments (K-Means).">
                              <strong>Segment</strong>{segmentNames ? (segmentNames[seg]||`S${seg}`) : seg}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                    <h3>Scores by Category</h3>
                    <div className="chart-lg">
                      <Bar
                        data={{
                          labels: CATEGORY_NAMES as unknown as string[],
                          datasets: [
                            {
                              label: `Member #${memberIndex}`,
                              data: mat[memberIndex],
                              backgroundColor: PALETTE.green,
                            },
                          ],
                        }}
                        options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
                      />
                    </div>
                    <div className="subtitle">What this means: higher bars indicate stronger category propensity for this member; use this with Top K and threshold to tune recommendations.</div>
                    <h3 style={{ marginTop: '1rem' }}>Category Lift (vs population{clusterLabels ? ' & segment' : ''})</h3>
                    <div className="chart-lg">
                      {summary && (
                        <Bar
                          data={{
                            labels: CATEGORY_NAMES as unknown as string[],
                            datasets: [
                              { label: 'Member', data: mat[memberIndex], backgroundColor: PALETTE.green },
                              { label: 'Population mean', data: summary.means, backgroundColor: PALETTE.blueSoft },
                              ...(clusterLabels && centroids ? [{ label: `Segment ${clusterLabels[memberIndex]} mean`, data: centroids[clusterLabels[memberIndex]], backgroundColor: PALETTE.amberSoft }] : []),
                            ],
                          }}
                          options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
                        />
                      )}
                    </div>
                    <div className="subtitle">How to read: compare member vs population (and segment if available). Large positive gaps indicate immediate opportunities; small gaps suggest parity.</div>
                    <div className="subtitle">What this means: compare member vs population (and segment if available) to justify “why recommended”. Large positive gaps indicate immediate opportunities.</div>

                    {recs && summary && (
                      <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                        <h3 style={{ marginTop: 0 }}>Story Summary</h3>
                        {(() => {
                          const scores = mat[memberIndex]
                          const total = scores.reduce((a,b)=>a+b,0) || 1
                          const max = Math.max(...scores)
                          const idxTop = scores.indexOf(max)
                          const topCat = (CATEGORY_NAMES as unknown as string[])[idxTop]
                          const mu = summary.means[idxTop]
                          const sd = summary.stds[idxTop]
                          const zTop = sd>0 ? (max - mu)/sd : 0
                          const indexTop = mu>0 ? max / mu : 0
                          const over = CATEGORY_NAMES.map((c,i)=>{
                            const z = summary.stds[i]>0 ? (scores[i]-summary.means[i])/summary.stds[i] : 0
                            return { c, z }
                          }).sort((a,b)=> b.z - a.z).slice(0,2)
                          const seg = clusterLabels ? clusterLabels[memberIndex] : null
                          return (
                            <ul>
                              <li><strong>Who</strong>: Member #{memberIndex}{seg!=null?`, Segment ${segmentNames ? (segmentNames[seg]||`S${seg}`) : seg}`:''}.</li>
                              <li><strong>What</strong>: Top category {topCat} (score {max.toFixed(2)}; total {total.toFixed(2)}).</li>
                              <li><strong>Why</strong>: Over-index vs population (index {indexTop.toFixed(2)}, z {zTop.toFixed(2)}). Also strong: {over.map(x=>`${x.c} (z ${x.z.toFixed(2)})`).join(', ')}.</li>
                              <li><strong>Do</strong>: Use Top Recommendations below to pick offers; tailor creative to {topCat} and bundle with positively correlated categories.</li>
                            </ul>
                          )
                        })()}
                      </div>
                    )}

                <div>
                  <h3>Top Recommendations</h3>
                    {recs ? (
                      <div style={{ maxHeight: 300, overflow: 'auto' }}>
                      <table className="table-sticky">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Category</th>
                            <th>Score</th>
                            <th>z</th>
                            <th>Index</th>
                            <th>Signals</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recs.map(([c, s], i) => {
                            const idx = (CATEGORY_NAMES as unknown as string[]).indexOf(c)
                            let badge = null
                            let tooltip = ''
                            let z = 0
                            let index = 0
                            if (summary && idx >= 0) {
                              const mu = summary.means[idx]
                              const sd = summary.stds[idx]
                              const raw = mat[memberIndex][idx]
                              z = sd > 0 ? (raw - mu) / sd : 0
                              index = mu > 0 ? raw / mu : 0
                              const segVal = (clusterLabels && centroids) ? centroids[clusterLabels[memberIndex]][idx] : null
                              const segLift = segVal != null && mu > 0 ? segVal / mu : null
                              badge = z > 1.5 ? <span className="badge high">High Lift</span> : z > 0.8 ? <span className="badge med">Lift</span> : null
                              tooltip = `Why recommended: raw=${raw.toFixed(3)}, z=${z.toFixed(2)}${segLift!=null?`, seg.lift=${(isFinite(segLift)?segLift:0).toFixed(2)}`:''}`
                            }
                            return (
                              <tr key={c} title={tooltip}>
                                <td>{i + 1}</td>
                                <td>{c}</td>
                                <td>{s.toFixed(3)}</td>
                                <td>{z.toFixed(2)}</td>
                                <td>{index.toFixed(2)}</td>
                                <td>{badge}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                       </table>
                       </div>
                    ) : (
                      <p className="muted">Use controls to generate Top K recommendations.</p>
                    )}
                    {summary && (
                      <>
                        <h3 style={{ marginTop: '1rem' }}>Strongest Deviations (z-score)</h3>
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                        <table className="table-sticky">
                          <thead>
                            <tr>
                              <th>Category</th>
                              <th>Score</th>
                              <th>z</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const ms = mat[memberIndex]
                              const rows = CATEGORY_NAMES.map((c, i) => {
                                const mu = summary.means[i]
                                const sd = summary.stds[i]
                                const z = sd > 0 ? (ms[i] - mu) / sd : 0
                                return { c, s: ms[i], z }
                              })
                                .sort((a, b) => b.z - a.z)
                                .slice(0, 5)
                              return rows.map((r) => (
                                <tr key={r.c}>
                                  <td>{r.c}</td>
                                  <td>{r.s.toFixed(3)}</td>
                                  <td>{r.z.toFixed(2)}</td>
                                </tr>
                              ))
                            })()}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )}
                  </div>
                
                {/* Executive-ready insights for decisioning */}
                {recs && (
                  <>
                    {summary && (
                      <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                        <h3 style={{ marginTop: 0 }}>Business Signals</h3>
                        {(() => {
                          const ms = mat[memberIndex]
                          const total = ms.reduce((a,b)=>a+b,0) || 1
                          const ranked = CATEGORY_NAMES.map((c,i)=>({ c, s: ms[i], share: ms[i]/total, mu: summary.means[i], sd: summary.stds[i] }))
                            .sort((a,b)=> b.s - a.s)
                          const top = ranked[0]
                          const zTop = top.sd>0? (top.s - top.mu)/top.sd : 0
                          const stdsSorted = summary.stds.slice().sort((a,b)=>a-b)
                          const q75 = stdsSorted[Math.floor(0.75*(stdsSorted.length-1))]
                          const timing = ranked.filter(r=> r.s>=0.6 && r.sd>=q75).slice(0,2)
                          const nurture = ranked.filter(r=> (r.sd>0 ? (r.s - r.mu)/r.sd : 0) < -0.8).slice(0,2)
                          return (
                            <div className="kpis">
                              <span className={`kpi-chip ${zTop>1.5?'opportunity': zTop>0.5?'watch':''}`} title={`z=${zTop.toFixed(2)} vs population`}><strong>Harvest</strong>{top.c} ({top.s.toFixed(2)})</span>
                              {timing.map(t=> (<span key={t.c} className="kpi-chip watch" title={`High volatility globally (σ=${t.sd.toFixed(2)})`}><strong>Timing</strong>{t.c}</span>))}
                              {nurture.map(n=> (<span key={n.c} className="kpi-chip" title={`Under-index vs population`}><strong>Nurture</strong>{n.c}</span>))}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                    {summary && (
                      <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                        <h3 style={{ marginTop: 0 }}>Opportunity Gap & Index</h3>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                          <div style={{ height: 280 }}>
                            {(() => {
                              const ms = mat[memberIndex]
                              const gaps = CATEGORY_NAMES.map((_,i)=> ms[i] - summary.means[i])
                              const colors = gaps.map(g => g>=0 ? 'rgba(25,135,84,0.7)' : 'rgba(108,117,125,0.6)')
                              return (
                                <Bar data={{ labels:(CATEGORY_NAMES as any), datasets:[{ label:'Gap (Member − Population mean)', data: gaps, backgroundColor: colors as any }] }} options={{ maintainAspectRatio:false, indexAxis:'y' as any, plugins:{ legend:{ position:'bottom' } } }} />
                              )
                            })()}
                            <div className="subtitle">Positive gap = immediate upside; negative = nurture.</div>
                          </div>
                          <div style={{ height: 280 }}>
                            {(() => {
                              const ms = mat[memberIndex]
                              const idx = CATEGORY_NAMES.map((_,i)=> { const mu = summary.means[i]; return mu>0? ms[i]/mu : 0 })
                              return (
                                <Bar data={{ labels:(CATEGORY_NAMES as any), datasets:[{ label:'Index (Member / Population mean)', data: idx, backgroundColor: 'rgba(13,110,253,0.6)' }] }} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true } } }} />
                              )
                            })()}
                            <div className="subtitle">Index &gt; 1 justifies bundle focus and budget.</div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Propensity Mix</h3>
                      {(() => {
                        const vals = mat[memberIndex]
                        const total = vals.reduce((a,b)=>a+b,0) || 1
                        const parts = CATEGORY_NAMES.map((c,i)=>({ c, v: vals[i] })).sort((a,b)=>b.v-a.v)
                        const top5 = parts.slice(0,5)
                        const other = parts.slice(5).reduce((s,x)=>s+x.v,0)
                        const labels = top5.map(x=>x.c).concat(other>0? ['Other'] : [])
                        const data = top5.map(x=>x.v).concat(other>0? [other] : [])
                        const top5Share = (data.slice(0,5).reduce((a,b)=> a + b, 0) / total) * 100
                        const colors = ['#2ecc71','#0d6efd','#ffc107','#20c997','#6f42c1','#adb5bd']
                        return (
                    <div className="chart-lg">
                      <Doughnut data={{ labels: labels as any, datasets:[{ data, backgroundColor: colors.slice(0,data.length) as any }] }} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }} />
                      <div className="subtitle">Top 5 categories cover {top5Share.toFixed(1)}% of member propensity.</div>
                    </div>
                        )
                      })()}
                    </div>
                    {summary && (
                      <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                        <h3 style={{ marginTop: 0 }}>Correlated Cross‑Sell</h3>
                        {(() => {
                          const ms = mat[memberIndex]
                          const topIdx = ms.indexOf(Math.max(...ms))
                          const m = CATEGORY_NAMES.length
                          const rows: {cat:string; r:number; member:number; mu:number}[] = []
                          for (let j=0;j<m;j++) if (j!==topIdx){ rows.push({ cat:(CATEGORY_NAMES as any)[j], r: summary.corrMatrix[topIdx][j], member: ms[j], mu: summary.means[j] }) }
                          const top = rows.sort((a,b)=> b.r - a.r).slice(0,5)
                          const base = (CATEGORY_NAMES as any)[topIdx]
                          return (
                            <>
                              <div className="muted" style={{ marginBottom: '.4rem' }}>Anchor: {base}. Bundle with highest positive r below.</div>
                              <table className="table-sticky">
                                <thead><tr><th>Category</th><th>r</th><th>Member</th><th>Population mean</th></tr></thead>
                                <tbody>
                                  {top.map((x)=> (<tr key={x.cat}><td>{x.cat}</td><td>{x.r.toFixed(3)}</td><td>{x.member.toFixed(2)}</td><td>{x.mu.toFixed(2)}</td></tr>))}
                                </tbody>
                              </table>
                            </>
                          )
                        })()}
                      </div>
                    )}
                    {/* Prescriptive next steps for managers */}
                    <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Action Plan</h3>
                      {(() => {
                        const ms = mat[memberIndex]
                        const total = ms.reduce((a,b)=>a+b,0) || 1
                        const parts = CATEGORY_NAMES.map((c,i)=>({ c, v: ms[i] }))
                          .sort((a,b)=> b.v-a.v)
                        const top1 = parts[0]
                        const top2 = parts[1]
                        // Breadth (count ≥ 0.5)
                        const breadth = ms.filter(v=> v>=0.5).length
                        const topShare = top1.v / total
                        // Suggest bundle: pick most positively correlated to top1
                        let bundle: string | null = null
                        if (summary){
                          const i = (CATEGORY_NAMES as any as string[]).indexOf(top1.c)
                          if (i>=0){
                            const pairs = (CATEGORY_NAMES as any as string[]).map((c,j)=>({ c, r: summary.corrMatrix[i][j], v: ms[j] }))
                              .filter(x=> x.c!==top1.c)
                              .sort((a,b)=> b.r - a.r)
                            bundle = pairs[0]?.c ?? null
                          }
                        }
                        return (
                          <ul>
                            <li><strong>Lead</strong>: {top1.c} ({top1.v.toFixed(2)}) — align creative to this theme.</li>
                            {bundle && <li><strong>Bundle</strong>: {top1.c} + {bundle} (highest positive correlation).</li>}
                            <li><strong>Breadth</strong>: {breadth} categories ≥ 0.5 — {breadth>=3? 'broad; include variety' : 'narrow; keep message focused'}.</li>
                            <li><strong>Concentration</strong>: Top1 share {(100*topShare).toFixed(0)}% — {topShare>=0.5? 'high concentration; avoid dilution' : 'balanced; test cross‑sell'}.</li>
                            {segmentNames && clusterLabels && <li><strong>Segment</strong>: {segmentNames[clusterLabels[memberIndex]] ?? `S${clusterLabels[memberIndex]}`} — use segment hero offers.</li>}
                          </ul>
                        )
                      })()}
                      <div className="subtitle">Rationale: lead with the member’s strongest category, pair with the most correlated, and adapt breadth by concentration.</div>
                    </div>
                    <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Similar Members</h3>
                      {(() => {
                        const a = mat[memberIndex]
                        const n = mat.length
                        const step = Math.max(1, Math.floor(n/1500))
                        let best: {i:number; sim:number; top:string; score:number}[] = []
                        const norm = Math.sqrt(a.reduce((s,x)=>s+x*x,0)) || 1
                        for (let i=0;i<n;i+=step){ if (i===memberIndex) continue; const b = mat[i]; let dot=0, nb=0; for (let j=0;j<b.length;j++){ dot+= a[j]*b[j]; nb+= b[j]*b[j] } const sim = dot / (norm * (Math.sqrt(nb)||1)); const max = Math.max(...b); const arg = b.indexOf(max); best.push({ i, sim, top: (CATEGORY_NAMES as any)[arg], score: max }) }
                        best.sort((x,y)=> y.sim - x.sim); best = best.slice(0,5)
                        return (
                          <table>
                            <thead><tr><th>#</th><th>Similarity</th><th>Top Category</th><th>Score</th></tr></thead>
                            <tbody>
                              {best.map(r=> (<tr key={r.i}><td>#{r.i}</td><td>{r.sim.toFixed(3)}</td><td>{r.top}</td><td>{r.score.toFixed(2)}</td></tr>))}
                            </tbody>
                          </table>
                        )
                      })()}
                    </div>
                  </>
                )}
                {summary && recs && (
                  <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Methodology</h3>
                    <ul>
                      <li>Recommendation ranks 10 category scores descending; applies optional minimum threshold; returns top K.</li>
                      <li>z-score = (member − population mean) / population std per category to highlight unusual strengths.</li>
                      <li>Lift chart compares member vs population mean; if segmented, also shows the member’s cluster centroid.</li>
                    </ul>
                  </div>
                )}
                  </>
                )}
                <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Data Quality: Global Anomalies</h3>
                  {(() => {
                    const perCat = CATEGORY_NAMES.map((c, j) => {
                      let below = 0, above = 0
                      for (let i = 0; i < rows; i++) {
                        const v = mat[i][j]
                        if (v < 0) below++
                        else if (v > 1) above++
                      }
                      const total = below + above
                      const pct = rows > 0 ? (100 * total) / rows : 0
                      return { c, below, above, total, pct }
                    })
                    const totalAnomalies = perCat.reduce((s, x) => s + x.total, 0)
                    const any = totalAnomalies > 0
                    return (
                      <>
                        <div className="muted" style={{ marginBottom: '.5rem' }}>
                          Total anomalies across all categories: <span style={{ color: any ? '#ff8080' : 'var(--muted)' }}>{totalAnomalies}</span>
                        </div>
                        <table>
                          <thead>
                            <tr>
                              <th>Category</th>
                              <th>Below 0</th>
                              <th>Above 1</th>
                              <th>Total</th>
                              <th>% Rows</th>
                            </tr>
                          </thead>
                          <tbody>
                            {perCat.map((r) => (
                              <tr key={r.c}>
                                <td>{r.c}</td>
                                <td style={{ color: r.below ? '#ff8080' : 'var(--muted)' }}>{r.below}</td>
                                <td style={{ color: r.above ? '#ff8080' : 'var(--muted)' }}>{r.above}</td>
                                <td style={{ color: r.total ? '#ff8080' : 'var(--muted)' }}>{r.total}</td>
                                <td>{r.pct.toFixed(2)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="muted" style={{ marginTop: '.5rem' }}>
                          Values should be in [0, 1]. Investigate any non-zero counts; consider clipping or re-scaling upstream.
                        </p>
                      </>
                    )
                  })()}
                </div>
                <h3 style={{ marginTop: '1rem' }}>Category Lift (vs population{clusterLabels ? ' & segment' : ''})</h3>
                <div style={{ height: 260 }}>
                  {summary && (
                    <Bar
                      data={{
                        labels: CATEGORY_NAMES as unknown as string[],
                        datasets: [
                          {
                            label: 'Member',
                            data: mat[memberIndex],
                            backgroundColor: 'rgba(40, 167, 69, 0.6)',
                          },
                          {
                            label: 'Population mean',
                            data: summary.means,
                            backgroundColor: 'rgba(13, 110, 253, 0.5)',
                          },
                          ...(clusterLabels && centroids
                            ? [
                                {
                                  label: `Segment ${clusterLabels[memberIndex]} mean`,
                                  data: centroids[clusterLabels[memberIndex]],
                                  backgroundColor: 'rgba(255, 193, 7, 0.5)',
                                },
                              ]
                            : []),
                        ],
                      }}
                    />
                  )}
                </div>
                {summary && (
                  <>
                    <h3 style={{ marginTop: '1rem' }}>Strongest Positive Deviations (z-score)</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Score</th>
                          <th>z</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const ms = mat[memberIndex]
                          const rows = CATEGORY_NAMES.map((c, i) => {
                            const mu = summary.means[i]
                            const sd = summary.stds[i]
                            const z = sd > 0 ? (ms[i] - mu) / sd : 0
                            return { c, s: ms[i], z }
                          })
                            .sort((a, b) => b.z - a.z)
                            .slice(0, 5)
                          return rows.map((r) => (
                            <tr key={r.c}>
                              <td>{r.c}</td>
                              <td>{r.s.toFixed(3)}</td>
                              <td>{r.z.toFixed(2)}</td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'Overview' && (
          <div className="card">
            <h2>Overview & EDA</h2>
            {!mat && <p className="muted">Load a dataset to preview rows.</p>}
            {mat && (
              <>
                <div className="callout" style={{ marginBottom: '.5rem' }}>
                  Purpose: dataset EDA — distributions, relationships, anomalies. Interview focus: how insights inform thresholds (Distribution Explorer), bundles/suppression (Category Relationships), and risk.
                </div>
                {summary && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '.75rem' }}>
                    <div className="card" style={{ padding: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Quick Insights</h3>
                      <ul>
                        {(() => {
                          const topMean = summary.summary.slice().sort((a,b)=>b.mean-a.mean).slice(0,3)
                          const topStd = summary.summary.slice().sort((a,b)=>b.std-a.std).slice(0,2)
                          const topP90 = summary.summary.slice().sort((a,b)=>b.p90-a.p90)[0]
                          return [
                            `Top means: ${topMean.map(x=>`${x.category} (${x.mean.toFixed(2)})`).join(', ')}`,
                            `Most variable: ${topStd.map(x=>`${x.category} (σ=${x.std.toFixed(2)})`).join(', ')}`,
                            `Highest 90th percentile: ${topP90.category} (${topP90.p90.toFixed(2)})`,
                          ].map((t,i)=>(<li key={i}>{t}</li>))
                        })()}
                      </ul>
                    </div>
                    <div className="card" style={{ padding: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Top Members</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Top Category</th>
                            <th>Score</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const totals = mat.map((r, i) => ({ i, total: r.reduce((a,b)=>a+b,0), max: Math.max(...r), arg: r.indexOf(Math.max(...r)) }))
                            return totals
                              .sort((a,b)=>b.total-a.total)
                              .slice(0,5)
                              .map((t)=> (
                                <tr key={t.i}>
                                  <td>#{t.i}</td>
                                  <td>{CATEGORY_NAMES[t.arg]}</td>
                                  <td>{t.max.toFixed(2)}</td>
                                  <td>{t.total.toFixed(2)}</td>
                                </tr>
                              ))
                          })()}
                        </tbody>
                      </table>
                      <div className="subtitle">How to read: each row shows a high‑value member (by total). Use Top Category and Score to tailor bundles; Total reflects breadth and depth of propensity.</div>
                    </div>
                  </div>
                )}

                {/* Category Overview: mean & std, plus coefficient of variation */}
                {summary && (
                  <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Category Overview</h3>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                      <div style={{ height: 280 }}>
                        {chartData && (
                          <Bar data={chartData} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }} />
                        )}
                        <div className="subtitle">Means (blue) show average propensity; std (amber) shows volatility.</div>
                      </div>
                      <div style={{ height: 280 }}>
                        <Bar
                          data={{
                            labels: (CATEGORY_NAMES as unknown as string[]),
                            datasets: [
                              { label: 'CV (σ/μ)', data: summary.summary.map(s=> (s.mean>0? s.std/s.mean : 0)), backgroundColor: PALETTE.amber }
                            ]
                          }}
                          options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true } } }}
                        />
                        <div className="subtitle">Coefficient of variation (σ/μ): higher = more timing‑sensitive.</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Coverage by threshold across categories */}
                {mat && (
                  <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Coverage by Threshold</h3>
                    {(() => {
                      const N = mat.length || 1
                      const cov = (t:number) => (CATEGORY_NAMES as unknown as string[]).map((_,j)=> 100*mat.filter(r=> r[j] >= t).length / N)
                      const c50 = cov(0.5)
                      const c80 = cov(0.8)
                      return (
                        <div style={{ height: 280 }}>
                          <Bar
                            data={{
                              labels: (CATEGORY_NAMES as unknown as string[]),
                              datasets: [
                                { label: '≥ 0.5', data: c50, backgroundColor: PALETTE.blue },
                                { label: '≥ 0.8', data: c80, backgroundColor: PALETTE.green },
                              ]
                            }}
                            options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true, ticks:{ callback: (v:any)=> `${v}%` } } } }}
                          />
                          <div className="subtitle">Percent of members above thresholds per category. Use to size audiences.</div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Correlation preview & heatmap snippet */}
                {summary && (
                  <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Category Relationships</h3>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom: '.75rem' }}>
                      <div>
                        <h4>Top Positive</h4>
                        <table>
                          <thead><tr><th>A</th><th>B</th><th>r</th></tr></thead>
                          <tbody>
                            {summary.topCorr.map(([a,b,r]) => (
                              <tr key={`${a}-${b}-pos`}><td>{a}</td><td>{b}</td><td>{r.toFixed(3)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <h4>Most Negative</h4>
                        <table>
                          <thead><tr><th>A</th><th>B</th><th>r</th></tr></thead>
                          <tbody>
                            {(() => {
                              const pairs: [string,string,number][] = []
                              for (let i=0;i<CATEGORY_NAMES.length;i++) for (let j=i+1;j<CATEGORY_NAMES.length;j++) pairs.push([(CATEGORY_NAMES as any)[i], (CATEGORY_NAMES as any)[j], summary.corrMatrix[i][j]])
                              return pairs.sort((x,y)=>x[2]-y[2]).slice(0,5).map(([a,b,r]) => (
                                <tr key={`${a}-${b}-neg`}><td>{a}</td><td>{b}</td><td>{r.toFixed(3)}</td></tr>
                              ))
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {heatmapData && (
                      <div style={{ height: 320 }}>
                        <MatrixChart data={heatmapData} />
                      </div>
                    )}
                    <div className="subtitle">Blue = positive co‑movement (bundle), red = negative (suppress together).</div>
                  </div>
                )}

                {/* Data quality: anomalies per category */}
                {mat && (
                  <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Data Quality: Anomalies by Category</h3>
                    {(() => {
                      const below: number[] = []
                      const above: number[] = []
                      for (let j=0;j<CATEGORY_NAMES.length;j++){
                        let b=0,a=0; for (let i=0;i<mat.length;i++){ const v=mat[i][j]; if (v<0) b++; else if (v>1) a++; }
                        below.push(b); above.push(a)
                      }
                      const total = below.map((b,i)=> b + above[i])
                      return (
                        <div style={{ height: 260 }}>
                          <Bar
                            data={{ labels:(CATEGORY_NAMES as any), datasets:[ { label:'Total anomalies', data: total, backgroundColor: PALETTE.red } ] }}
                            options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true } } }}
                          />
                          <div className="subtitle">Counts outside [0,1]. Investigate upstream scaling or clip values.</div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Distribution Explorer</h3>
                  <div className="row">
                    <div>
                      <label>Category</label>
                      <select value={overviewCat} onChange={(e)=>setOverviewCat(parseInt(e.target.value,10))}
                        style={{ width: '100%', padding: '0.5rem 0.6rem' }}>
                        {CATEGORY_NAMES.map((c,i)=>(<option key={c} value={i}>{c}</option>))}
                      </select>
                    </div>
                  </div>
                  {(() => {
                    const col = mat.map(r=>r[overviewCat])
                    const n = col.length
                    const min = Math.min(...col)
                    const max = Math.max(...col)
                    const mean = col.reduce((a,b)=>a+b,0)/n
                    const std = Math.sqrt(col.reduce((s,x)=>s+(x-mean)**2,0)/n)
                    const sorted = col.slice().sort((a,b)=>a-b)
                    const q = (p:number)=> { const k=(n-1)*p, f=Math.floor(k), d=k-f; return f+1<n? sorted[f]*(1-d)+sorted[f+1]*d : sorted[f] }
                    const p10=q(0.1), p50=q(0.5), p90=q(0.9)
                    // Pearson's moment skewness (approx) using centralized third moment
                    let m3=0; for (let i=0;i<n;i++){ const z=col[i]-mean; m3+= z*z*z }
                    m3/=n; const skew = std>0? m3/(std**3):0
                    // anomalies outside [0,1]
                    let below=0, above=0; for (const x of col){ if (x<0) below++; else if (x>1) above++; }
                    // histogram
                    const bins=10
                    const edges = Array.from({length:bins+1}, (_,i)=> min + (i*(max-min||1))/bins)
                    const counts = Array(bins).fill(0)
                    for(const x of col){
                      let b = Math.floor(((x-min)/(max-min||1))*bins); if (b===bins) b=bins-1; counts[b]++
                    }
                    const labels = counts.map((_,i)=> `${edges[i].toFixed(2)}–${edges[i+1].toFixed(2)}`)
                    const maxCount = Math.max(1, ...counts)
                    const colors = counts.map(c => {
                      const t = c / maxCount // 0..1
                      const a = 0.2 + 0.7 * t
                      return `rgba(13,110,253,${a.toFixed(3)})`
                    })
                    // boxplot scaling
                    const scale = (v:number)=> ((v - min) / (max - min || 1)) * 100
                    return (
                      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'1rem', marginTop: '.5rem' }}>
                        <div style={{ height: 260 }}>
                          <Bar data={{ labels, datasets:[{ label:'Frequency', data: counts, backgroundColor: colors as any } ] }} />
                          <div className="subtitle">What this means: bins with higher intensity show where most members sit; use skewness and quantiles to choose thresholds.</div>
                        </div>
                        <div>
                          <table>
                            <tbody>
                              <tr><td>Min</td><td>{min.toFixed(3)}</td></tr>
                              <tr><td>P10</td><td>{p10.toFixed(3)}</td></tr>
                              <tr><td>Median</td><td>{p50.toFixed(3)}</td></tr>
                              <tr><td>P90</td><td>{p90.toFixed(3)}</td></tr>
                              <tr><td>Max</td><td>{max.toFixed(3)}</td></tr>
                              <tr><td>Mean</td><td>{mean.toFixed(3)}</td></tr>
                              <tr><td>Std</td><td>{std.toFixed(3)}</td></tr>
                              <tr><td>Skewness</td><td>{skew.toFixed(2)}</td></tr>
                              <tr>
                                <td>Anomalies</td>
                                <td>
                                  <span style={{color: below+above>0? '#ff8080': 'var(--muted)'}}>
                                    below 0: {below} • above 1: {above}
                                  </span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <p className="muted">Right-skewed (&gt;0) suggests a long high-value tail; left-skewed (&lt;0) indicates many low values with a high tail.</p>
                          <div style={{ marginTop: '.5rem' }}>
                            <h4 style={{ margin: '0 0 .25rem 0', display:'flex', alignItems:'center', gap:6 }}>
                              Mini Boxplot
                              <span
                                title="How to read: whiskers mark min/max; blue box spans P10–P90; vertical line is median. Use to gauge spread and tails when setting thresholds."
                                style={{ cursor:'help', color:'#0d6efd', fontSize:'0.95rem' }}
                              >ⓘ</span>
                            </h4>
                            <div style={{ position:'relative', height: 24, background:'#eef3ff', border:'1px solid #d6e3ff', borderRadius:6 }}>
                              {/* whisker line (min→max) */}
                              <div style={{ position:'absolute', top: 11, left: `${scale(min)}%`, width: `${Math.max(0, scale(max)-scale(min))}%`, height:2, background:'#9ab6f9' }} />
                              {/* IQR box */}
                              <div style={{ position:'absolute', top:4, left:`${scale(p10)}%`, width:`${Math.max(2, scale(p90)-scale(p10))}%`, height:16, background:'rgba(13,110,253,0.18)', border:'1px solid rgba(13,110,253,0.9)', borderRadius:4 }} />
                              {/* median */}
                              <div style={{ position:'absolute', top:4, left:`${scale(p50)}%`, width:2, height:16, background:'#4f8cff' }} />
                              {/* endpoints */}
                              <div style={{ position:'absolute', top:8, left:`${scale(min)}%`, width:2, height:8, background:'#0d6efd' }} />
                              <div style={{ position:'absolute', top:8, left:`${scale(max)}%`, width:2, height:8, background:'#0d6efd' }} />
                            </div>
                            <div className="muted" style={{ fontSize: '.9rem', marginTop: '.35rem' }}>
                              Legend: whiskers = min/max, blue box = P10–P90, line = median. Scaled to [min, max] for this category.
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Methodology</h3>
                  <ul>
                    <li>Data parsed as N×10 matrix, no header.</li>
                    <li>Summary uses mean, standard deviation, median (p50), and p90 per category.</li>
                    <li>Filter keeps rows with values ≥ threshold in the selected column (or any column).</li>
                    <li>Pagination is client-side; page size is adjustable for performance.</li>
                  </ul>
                </div>
                <div className="muted" style={{ marginBottom: '.5rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Rows: {rows} • Columns: {CATEGORY_NAMES.length}</span>
                  <span>Page size:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
                    style={{ padding: '0.3rem 0.5rem' }}
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span>Filter:</span>
                  <select
                    value={filterColumn}
                    onChange={(e) => { const v = e.target.value === 'any' ? 'any' : parseInt(e.target.value, 10); setFilterColumn(v as any); setPage(1); }}
                    style={{ padding: '0.3rem 0.5rem' }}
                  >
                    <option value="any">Any Category</option>
                    {CATEGORY_NAMES.map((c, i) => (
                      <option key={c} value={i}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="min score"
                    value={filterQuery}
                    onChange={(e) => { setFilterQuery(e.target.value); setPage(1); }}
                    style={{ width: 120, padding: '0.3rem 0.5rem' }}
                    step={0.01}
                  />
                  <button className="primary" onClick={() => { setFilterQuery(''); setFilterColumn('any'); setPage(1); }}>Clear</button>
                </div>
                {(() => {
                  const q = filterQuery.trim()
                  const threshold = q === '' ? null : Number(q)
                  const filtered = threshold === null || Number.isNaN(threshold)
                    ? mat
                    : mat.filter((row) => {
                        if (filterColumn === 'any') return row.some((v) => v >= threshold)
                        return row[(filterColumn as number)] >= threshold
                      })
                  const total = filtered.length
                  const maxPage = Math.max(1, Math.ceil(total / pageSize))
                  const p = Math.min(page, maxPage)
                  const start = (p - 1) * pageSize
                  const end = Math.min(start + pageSize, total)
                  const pageRows = filtered.slice(start, end)
                  return (
                    <>
                      <div className="muted" style={{ margin: '-0.25rem 0 .5rem 0' }}>
                        Showing {start + 1}-{end} of {total} rows
                      </div>
                      <div style={{ overflow: 'auto', maxHeight: 520 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>#</th>
                              {CATEGORY_NAMES.map((c) => (
                                <th key={c}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pageRows.map((r, i) => (
                              <tr key={start + i}>
                                <td>{start + i}</td>
                                {r.map((v, j) => (
                                  <td key={j}>{v.toFixed(3)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '.5rem' }}>
                        <button className="primary" onClick={() => setPage((pp) => Math.max(1, pp - 1))} disabled={p === 1}>
                          Prev
                        </button>
                        <span className="muted">
                          Page {p} / {maxPage}
                        </span>
                        <button
                          className="primary"
                          onClick={() => setPage((pp) => Math.min(maxPage, pp + 1))}
                          disabled={p >= maxPage}
                        >
                          Next
                        </button>
                      </div>
                      <div className="subtitle">How to read: this table shows raw propensities (0–1) per category. Use filters to surface VIP tails (e.g., ≥0.8) and adjust page size for quick scanning.</div>
                    </>
                  )
                })()}
              </>
            )}
          </div>
        )}
        {activeTab === 'Member Profile' && (
          <div className="card">
            <h2>Member Profile</h2>
            {!mat && <p className="muted">Upload or load a dataset to view a member profile.</p>}
            {mat && (
              <>
                <h3>Scores by Category</h3>
                    <div className="chart-lg">
                      <Bar
                        data={{
                          labels: CATEGORY_NAMES as unknown as string[],
                          datasets: [
                            {
                          label: `Member #${memberIndex}`,
                          data: mat[memberIndex],
                          backgroundColor: 'rgba(40, 167, 69, 0.6)',
                        },
                      ],
                    }}
                  options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
                  />
                </div>
                {summary && (
                  <>
                <h3 style={{ marginTop: '1rem' }}>Strongest Positive Deviations (z-score)</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Score</th>
                          <th>z</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const ms = mat[memberIndex]
                          const rows = CATEGORY_NAMES.map((c, i) => {
                            const mu = summary.means[i]
                            const sd = summary.stds[i]
                            const z = sd > 0 ? (ms[i] - mu) / sd : 0
                            return { c, s: ms[i], z }
                          })
                            .sort((a, b) => b.z - a.z)
                            .slice(0, 5)
                          return rows.map((r) => (
                            <tr key={r.c}>
                              <td>{r.c}</td>
                              <td>{r.s.toFixed(3)}</td>
                              <td>{r.z.toFixed(2)}</td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                    <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Methodology</h3>
                      <ul>
                        <li>Recommendation ranks 10 category scores descending; applies optional minimum threshold; returns top K.</li>
                        <li>z-score = (member − population mean) / population std per category to highlight unusual strengths.</li>
                        <li>Lift chart compares member vs population mean; if segmented, also shows the member’s cluster centroid.</li>
                      </ul>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'Summary' && (
          <div className="card">
            <h2>Summary</h2>
            {!summary && <p className="muted">Loading dataset summary…</p>}
            {summary && (
              <>
                <div className="callout" style={{ marginBottom: '.5rem' }}>
                  Purpose: global performance and relationships. Interview focus: dominant drivers, volatility hotspots, positive/negative pairs, concentration & coverage to connect to tactics.
                </div>
                {chartData && (
                  <>
                    <Bar data={chartData} />
                    <div className="subtitle">How to read: blue bars show average propensity by category; amber bars show volatility (std). High mean = strong category; high std = timing‑sensitive.</div>
                  </>
                )}
                <div className="grid-2">
                  <div>
                    <h3>Top Inter-Category Correlations</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>A</th>
                          <th>B</th>
                          <th>r</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.topCorr.map(([a, b, r]) => (
                          <tr key={`${a}-${b}`}>
                            <td>{a}</td>
                            <td>{b}</td>
                            <td>{r.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3>Most Negative Correlations</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>A</th>
                          <th>B</th>
                          <th>r</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const pairs: [string,string,number][] = []
                          for (let i = 0; i < CATEGORY_NAMES.length; i++) {
                            for (let j = i + 1; j < CATEGORY_NAMES.length; j++) {
                              pairs.push([CATEGORY_NAMES[i], CATEGORY_NAMES[j], summary.corrMatrix[i][j]])
                            }
                          }
                          return pairs.sort((x,y)=>x[2]-y[2]).slice(0,5).map(([a,b,r]) => (
                            <tr key={`${a}-${b}-neg`}>
                              <td>{a}</td>
                              <td>{b}</td>
                              <td>{r.toFixed(3)}</td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="section-title" style={{ marginTop: '.5rem' }}>
                  <h3 style={{ margin: 0 }}>Correlations</h3>
                  <button className="primary" onClick={()=> setSummaryShowCorr(x=>!x)}>{summaryShowCorr ? 'Hide' : 'Show'}</button>
                </div>
                {summaryShowCorr && (
                  <>
                    <div className="grid-2">
                      <div>
                        <h3>Top Inter-Category Correlations</h3>
                        <table>
                          <thead>
                            <tr>
                              <th>A</th>
                              <th>B</th>
                              <th>r</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.topCorr.map(([a, b, r]) => (
                              <tr key={`${a}-${b}`}>
                                <td>{a}</td>
                                <td>{b}</td>
                                <td>{r.toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <h3>Most Negative Correlations</h3>
                        <table>
                          <thead>
                            <tr>
                              <th>A</th>
                              <th>B</th>
                              <th>r</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const pairs: [string,string,number][] = []
                              for (let i = 0; i < CATEGORY_NAMES.length; i++) {
                                for (let j = i + 1; j < CATEGORY_NAMES.length; j++) {
                                  pairs.push([CATEGORY_NAMES[i] as any, CATEGORY_NAMES[j] as any, summary.corrMatrix[i][j]])
                                }
                              }
                              return pairs.sort((x,y)=>x[2]-y[2]).slice(0,5).map(([a,b,r]) => (
                                <tr key={`${a}-${b}-neg`}>
                                  <td>{a}</td>
                                  <td>{b}</td>
                                  <td>{r.toFixed(3)}</td>
                                </tr>
                              ))
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <h3>Correlation Heatmap</h3>
                    {heatmapData && (
                      <div style={{ height: 420 }}>
                        <MatrixChart data={heatmapData} />
                      </div>
                    )}
                    {heatmapData && (
                      <div className="subtitle">How to read: blue = positive co‑movement (bundle candidates), red = negative (suppress together). Diagonal is 1 by definition.</div>
                    )}
                  </>
                )}
                {(() => {
                  if (!summary) return null
                  // Correlation sanity check
                  const m = CATEGORY_NAMES.length
                  let off = 0, nearOne = 0
                  for (let i=0;i<m;i++){
                    for (let j=0;j<m;j++){
                      if (i===j) continue
                      off++
                      const r = summary.corrMatrix[i][j]
                      if (Math.abs(r) >= 0.99) nearOne++
                    }
                  }
                  const frac = off ? nearOne/off : 0
                  if (frac >= 0.8) {
                    return (
                      <div className="callout" style={{ marginTop: '.5rem' }}>
                        Correlations appear unusually high (≥0.99 for {(100*frac).toFixed(0)}% of pairs). This often indicates duplicated/identical columns or a preprocessing bug. Please verify the CSV generation and that columns are distinct.
                      </div>
                    )
                  }
                  return null
                })()}
                <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Key Stats</h3>
                  {(() => {
                    if (!summary || !mat) return null
                    // Pareto: top cats to reach 90% of total mean
                    const meansSorted = summary.summary.map(s=>s.mean).sort((a,b)=>b-a)
                    const total = meansSorted.reduce((a,b)=>a+b,0) || 1
                    let cum=0, k90=meansSorted.length
                    for (let i=0;i<meansSorted.length;i++){ cum+=meansSorted[i]; if (cum/total>=0.9){ k90=i+1; break } }
                    // Average per-member HHI
                    let hhi = 0
                    for (const row of mat){ const s=row.reduce((a,b)=>a+b,0)||1; let h=0; for (const v of row){ const q=v/s; h+=q*q } hhi+=h }
                    hhi/=mat.length
                    // Coverage
                    const cov = (t:number)=> (100*mat.filter(r=> r.some(v=>v>=t)).length/mat.length).toFixed(1)
                    // Top CV
                    const cv = summary.summary.map(s=> ({ c:s.category, v: s.mean>0 ? s.std/s.mean : 0 })).sort((a,b)=> b.v-a.v).slice(0,3)
                    return (
                      <ul>
                        <li>Pareto (to reach 90% of mean): {k90} categories</li>
                        <li>Average concentration (HHI): {hhi.toFixed(2)}</li>
                        <li>Coverage ≥ 0.5: {cov(0.5)}% • ≥ 0.7: {cov(0.7)}%</li>
                        <li>Most timing-sensitive (CV): {cv.map(x=> `${x.c} (${x.v.toFixed(2)})`).join(', ')}</li>
                      </ul>
                    )
                  })()}
                </div>
                <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Drivers & Risks (Insights)</h3>
                  {(() => {
                    // Dominance by mean
                    const dom = summary.summary.slice().sort((a,b)=>b.mean-a.mean).slice(0,3)
                    // Volatility by std
                    const vol = summary.summary.slice().sort((a,b)=>b.std-a.std).slice(0,3)
                    // Connectivity = sum |r| excluding diagonal
                    const m = CATEGORY_NAMES.length
                    const conn = Array.from({length:m}, (_,i)=>({
                      category: (CATEGORY_NAMES as any)[i],
                      score: summary.corrMatrix[i].reduce((s,v,j)=> s + (i===j?0:Math.abs(v)), 0)
                    })).sort((a,b)=>b.score-a.score).slice(0,3)
                    // Strongest negative pairs (top 3)
                    const negPairs: {a:string;b:string;r:number}[] = []
                    for (let i=0;i<m;i++) for (let j=i+1;j<m;j++) negPairs.push({a:(CATEGORY_NAMES as any)[i], b:(CATEGORY_NAMES as any)[j], r: summary.corrMatrix[i][j]})
                    const topNeg = negPairs.sort((x,y)=>x.r-y.r).slice(0,3)
                    // Opportunity quadrants by median mean/std
                    const means = summary.summary.map(s=>s.mean)
                    const stds = summary.summary.map(s=>s.std)
                    const med = (arr:number[])=> arr.slice().sort((a,b)=>a-b)[Math.floor(arr.length/2)]
                    const meanMed = med(means), stdMed = med(stds)
                    const hiHi = summary.summary.filter(s=> s.mean>=meanMed && s.std>=stdMed).map(s=>s.category)
                    const hiLo = summary.summary.filter(s=> s.mean>=meanMed && s.std<stdMed).map(s=>s.category)
                    return (
                      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'1rem' }}>
                        <div>
                          <h4 style={{ marginTop: 0 }}>Top Drivers</h4>
                          <ul>
                            <li>Dominant means: {dom.map(d=>`${d.category} (${d.mean.toFixed(2)})`).join(', ')}</li>
                            <li>Volatility hotspots: {vol.map(v=>`${v.category} (σ ${v.std.toFixed(2)})`).join(', ')}</li>
                            <li>Most connected: {conn.map(c=>`${c.category}`).join(', ')}</li>
                          </ul>
                        </div>
                        <div>
                          <h4 style={{ marginTop: 0 }}>Risks & Trade‑offs</h4>
                          <ul>
                            {topNeg.map(p=> (
                              <li key={`${p.a}-${p.b}`}>{p.a} vs {p.b}: r={p.r.toFixed(2)} (avoid co‑messaging)</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 style={{ marginTop: 0 }}>Opportunity Quadrants</h4>
                          <table>
                            <thead><tr><th>Quadrant</th><th>Categories</th></tr></thead>
                            <tbody>
                              <tr><td>High mean • High std</td><td>{hiHi.join(', ') || '-'}</td></tr>
                              <tr><td>High mean • Low std</td><td>{hiLo.join(', ') || '-'}</td></tr>
                            </tbody>
                          </table>
                          <div className="subtitle">High mean • High std → big upside, time carefully. High mean • Low std → always‑on strong performers.</div>
                        </div>
                      </div>
                  )
                  })()}
                </div>
                {/* Summary trimmed to essentials: keep core insights only */}
              </>
            )}
          </div>
        )}
        {activeTab === 'Segments' && (
          <div className="card">
            <h2>Segments</h2>
            {!mat && <p className="muted">Load data first to run clustering.</p>}
            {mat && (
              <>
                <div className="callout" style={{ marginBottom: '.5rem' }}>
                  Purpose: segmentation controls and insights. Explain K choice (silhouette/elbow/compromise), review segment sizes, centroid profiles, and lift tables to design segment strategies.
                </div>
                <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                  <div className="stats-row">
                    <div className="stat">
                      <div className="stat-label">Final K</div>
                      <div className="stat-value">{elbow ? elbow.finalK : '—'}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Method</div>
                      <div className="stat-value" title="K selection">{selectionMethod}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Seed</div>
                      <div className="stat-value">{clusterSeed}</div>
                    </div>
                  </div>
                  <div className="controls-grid">
                    <div>
                      <label>Selection Method</label>
                      <select value={selectionMethod} onChange={(e)=> setSelectionMethod(e.target.value as any)}>
                        <option value="silhouette">Silhouette only</option>
                        <option value="elbow">Elbow only</option>
                        <option value="compromise">Compromise</option>
                      </select>
                    </div>
                    <div>
                      <label>Silhouette min gap (compromise)</label>
                      <input type="number" step={0.01} value={silMinGap} onChange={(e)=> setSilMinGap(parseFloat(e.target.value||'0')||0)} />
                    </div>
                    <div>
                      <label>Seed</label>
                      <input type="number" value={clusterSeed} onChange={(e)=> setClusterSeed(parseInt(e.target.value||'0',10)||0)} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'flex-end' }}>
                      <button className="primary btn-inline" onClick={()=> mat && autoCluster(mat, clusterSeed)} disabled={computing}>
                        {computing && <span className="spinner" />}
                        {computing ? 'Applying…' : (elbow ? 'Recompute Segments' : 'Compute Segments')}
                      </button>
                    </div>
                  </div>
                </div>
                {elbow && (
                  <div style={{ marginTop: '.75rem' }}>
                    <div className="section-title"><h3 style={{ margin: 0 }}>Elbow Plot</h3></div>
                    <div style={{ height: 280 }}>
                      <Line data={{
                        labels: elbow.ks.map(String),
                        datasets: [
                          { label: 'Inertia', data: elbow.inertia, borderColor: 'rgba(13,110,253,0.9)', backgroundColor: 'rgba(13,110,253,0.3)', pointRadius: 3 },
                          { label: 'Suggested K', data: elbow.ks.map((k,i)=> elbow.ks[i]===elbow.suggestedK ? elbow.inertia[i] : null),
                            borderColor: 'rgba(255,193,7,1)', backgroundColor: 'rgba(255,193,7,1)', showLine: false, pointRadius: 6, pointHoverRadius: 7 }
                        ]
                      }} options={{ responsive: true, maintainAspectRatio: false }} />
                    </div>
                    <div className="subtitle">Suggested K: {elbow.suggestedK} • Best by Silhouette: {elbow.bestBySil} • Final K: {elbow.finalK} (method: {selectionMethod})</div>
                    <div className="subtitle">How to read: lower inertia is better for a given K; silhouette closer to 1 indicates well‑separated clusters. Final K follows your chosen method/seed.</div>
                  </div>
                )}
                {clusterLabels && centroids && (
                  <>
                    <div className="muted" style={{marginTop:'.5rem'}}>Computed {centroids.length} segments with seed {clusterSeed}. <a href="#" onClick={(e)=>{e.preventDefault(); setActiveTab('Segments')}}>View method/seed</a>.</div>
                    <div style={{ marginTop:'.75rem' }}>
                      <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                        <h3 style={{ marginTop: 0 }}>Segment Summary</h3>
                        <table className="table-sticky table-wrap">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Name</th>
                              <th>Size</th>
                              <th>% of Total</th>
                              <th>Top categories</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const counts = Array.from({length: centroids.length}, ()=>0)
                              clusterLabels.forEach((l)=>counts[l]++)
                              return centroids.map((c, i)=>{
                                const tops = c
                                  .map((v, j)=>({j, v}))
                                  .sort((a,b)=>b.v-a.v)
                                  .slice(0,3)
                                  .map(x=>`${CATEGORY_NAMES[x.j]} (${x.v.toFixed(2)})`)
                                  .join(', ')
                                const name = segmentNames ? segmentNames[i] : `Segment ${i}`
                                const pct = rows>0 ? (100*counts[i]/rows).toFixed(1)+'%' : '-'
                                return (
                                  <tr key={i}>
                                    <td>{i}</td>
                                    <td>{name}</td>
                                    <td>{counts[i]}</td>
                                    <td>{pct}</td>
                                    <td>{tops}</td>
                                  </tr>
                                )
                              })
                            })()}
                          </tbody>
                        </table>
                      </div>
                      <div className="card" style={{ padding: '.75rem' }}>
                        <h3>Segment Detail</h3>
                        <div style={{ display:'flex', gap:8, marginBottom: '.5rem', flexWrap:'wrap', alignItems:'end' }}>
                          <div style={{ display:'flex', gap:8 }}>
                            <button className={`tab-btn ${segRightTab==='Profile'?'active':''}`} onClick={()=>setSegRightTab('Profile')}>Profile</button>
                            <button className={`tab-btn ${segRightTab==='Lift'?'active':''}`} onClick={()=>setSegRightTab('Lift')}>Lift</button>
                          </div>
                          <div style={{flex:1}} />
                          <div>
                            <label className="muted" style={{ display:'block', fontSize:'.82rem' }}>Sort</label>
                            <select value={segSort} onChange={(e)=> setSegSort(e.target.value as any)} style={{ padding:'0.4rem 0.6rem' }}>
                              <option value="value">Score</option>
                              <option value="lift">Lift</option>
                            </select>
                          </div>
                          <div>
                            <label className="muted" style={{ display:'block', fontSize:'.82rem' }}>Top N</label>
                            <input type="number" min={3} max={10} value={segTopN} onChange={(e)=> setSegTopN(Math.min(10, Math.max(3, parseInt(e.target.value||'10',10))))} style={{ width:80, padding:'0.4rem 0.6rem' }} />
                          </div>
                          <div>
                            <label className="muted" style={{ display:'block', fontSize:'.82rem' }}>Compare Against</label>
                            <select value={segCompareMode} onChange={(e)=> setSegCompareMode(e.target.value as any)} style={{ padding:'0.4rem 0.6rem' }}>
                              <option value="population">Population</option>
                              <option value="segment">Another Segment</option>
                            </select>
                          </div>
                          {segCompareMode==='segment' && (
                            <div style={{minWidth:220}}>
                              <label className="muted" style={{ display:'block', fontSize:'.82rem' }}>Segment</label>
                              <select value={segCompareIdx} onChange={(e)=> setSegCompareIdx(parseInt(e.target.value,10))} style={{ width:'100%', padding:'0.4rem 0.6rem' }}>
                                {centroids.map((_,i)=>(<option key={i} value={i}>{segmentNames ? segmentNames[i] : `Segment ${i}`}</option>))}
                              </select>
                            </div>
                          )}
                          <div style={{minWidth:220}}>
                            <label className="muted" style={{ display:'block', fontSize:'.82rem' }}>Focus Segment</label>
                            <select value={selectedCluster} onChange={(e)=>setSelectedCluster(parseInt(e.target.value,10))}
                              style={{ width: '100%', padding: '0.4rem 0.6rem' }}>
                              {centroids.map((_,i)=>(<option key={i} value={i}>{segmentNames ? segmentNames[i] : `Segment ${i}`}</option>))}
                            </select>
                          </div>
                        </div>
                        {segRightTab==='Profile' && summary && (
                          (() => {
                            const base = centroids[selectedCluster]
                            const comp = summary.means
                            const rows = CATEGORY_NAMES.map((c,i)=>{
                              const v = base[i]
                              const idx = (comp[i]||1e-9) > 0 ? v/comp[i] : 0
                              return { c, v, idx }
                            }).sort((a,b)=> b.v-a.v).slice(0, segTopN)
                            const s = base.reduce((a,b)=>a+b,0) || 1
                            const labels = CATEGORY_NAMES as any
                            // Breadth histogram in this segment (≥0.5)
                            const ids = clusterLabels.map((l,i)=> l===selectedCluster ? i : -1).filter(i=> i>=0)
                            const counts = Array(11).fill(0)
                            for (const r of ids){ const k = mat[r].filter(v=> v>=0.5).length; counts[k]++ }
                            const pct = counts.map(c=> ids.length? 100*c/ids.length : 0)
                            return (
                              <>
                                <div className="kpis" style={{ marginTop: '.25rem' }}>
                                  {(() => {
                                    const size = ids.length
                                    const pctPop = clusterLabels.length ? (100*size/clusterLabels.length).toFixed(1)+'%' : '-'
                                    // centroid HHI
                                    let h=0; for (const x of base){ const q=x/s; h+= q*q }
                                    return (
                                      <>
                                        <span className="kpi-chip"><strong>Size</strong>{size} ({pctPop})</span>
                                        <span className="kpi-chip"><strong>Hero</strong>{rows[0]?.c}</span>
                                        <span className="kpi-chip"><strong>HHI</strong>{h.toFixed(2)}</span>
                                      </>
                                    )
                                  })()}
                                </div>
                                {(() => {
                                  // compute enrichments for sorting
                                  let sigRows = CATEGORY_NAMES.map((c,i)=>({ c, v: base[i], idx: (comp[i]||1e-9)>0 ? base[i]/comp[i] : 0, share: (100*base[i]/s) }))
                                    .sort((a:any,b:any)=> {
                                      const key = sigSortKey === 'score' ? 'v' : sigSortKey
                                      const d = (b as any)[key] - (a as any)[key]
                                      return sigSortDir==='desc' ? (d || ((b.v-a.v))) : - (d || ((b.v-a.v)))
                                    })
                                    .slice(0, segTopN)
                                  const sigTable = (
                                    <>
                                      <div className="toolbar compact" style={{ margin: '.25rem 0' }}>
                                        <div className="field">
                                          <label>Sort by</label>
                                          <select value={sigSortKey} onChange={(e)=> setSigSortKey(e.target.value as any)}>
                                            <option value="score">Score</option>
                                            <option value="share">Share</option>
                                            <option value="index">Index</option>
                                          </select>
                                        </div>
                                        <div className="field">
                                          <label>Order</label>
                                          <button className="primary" onClick={()=> setSigSortDir(d=> d==='desc'?'asc':'desc')}>{sigSortDir==='desc'?'Desc':'Asc'}</button>
                                        </div>
                                        <div className="field">
                                          <label>Expand</label>
                                          <button className="primary" onClick={()=> setSigExpanded(x=>!x)}>{sigExpanded?'Collapse':'Expand'}</button>
                                        </div>
                                      </div>
                                      <h4 style={{ margin: 0 }}>Signature (Top {segTopN})</h4>
                                      <table className="table-sticky table-wrap">
                                        <thead><tr><th>Category</th><th>Score</th><th>Share</th><th>Index</th><th>Role</th></tr></thead>
                                        <tbody>
                                          {sigRows.map(r=> {
                                            const role = r.idx>=1.2 ? 'Hero' : r.idx>=1.0 ? 'Support' : 'Niche'
                                            return (<tr key={r.c}><td>{r.c}</td><td>{r.v.toFixed(2)}</td><td>{r.share.toFixed(1)}%</td><td>{r.idx.toFixed(2)}</td><td>{role}</td></tr>)
                                          })}
                                        </tbody>
                                      </table>
                                    </>
                                  )
                                  if (sigExpanded){
                                    return (
                                      <>
                                        <div className="chart-md">
                                          <Radar data={{ labels, datasets:[
                                            { label: segmentNames ? segmentNames[selectedCluster] : `Segment ${selectedCluster}`, data: base, backgroundColor: 'rgba(255,193,7,0.25)', borderColor: 'rgba(255,193,7,0.9)', pointBackgroundColor: 'rgba(255,193,7,0.9)', borderWidth: 2 },
                                            { label: 'Population', data: comp, backgroundColor: 'rgba(13,110,253,0.18)', borderColor: 'rgba(13,110,253,0.9)', pointBackgroundColor: 'rgba(13,110,253,0.9)', borderWidth: 2 }
                                          ] }} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ r:{ beginAtZero:true, suggestedMax:1 } } }} />
                                        </div>
                                        <div style={{ marginTop: '.5rem' }}>{sigTable}</div>
                                      </>
                                    )
                                  }
                                  return (
                                    <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.2fr) minmax(0,1fr)', gap:'1rem' }}>
                                      <div className="chart-md">
                                        <Radar data={{ labels, datasets:[
                                          { label: segmentNames ? segmentNames[selectedCluster] : `Segment ${selectedCluster}`, data: base, backgroundColor: 'rgba(255,193,7,0.25)', borderColor: 'rgba(255,193,7,0.9)', pointBackgroundColor: 'rgba(255,193,7,0.9)', borderWidth: 2 },
                                          { label: 'Population', data: comp, backgroundColor: 'rgba(13,110,253,0.18)', borderColor: 'rgba(13,110,253,0.9)', pointBackgroundColor: 'rgba(13,110,253,0.9)', borderWidth: 2 }
                                        ] }} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ r:{ beginAtZero:true, suggestedMax:1 } } }} />
                                      </div>
                                      <div style={{ maxHeight: 300, overflow:'auto' }}>{sigTable}</div>
                                    </div>
                                  )
                                })()}
                                <div style={{ height: 220, marginTop: '.75rem' }}>
                                  <Bar data={{ labels: Array.from({length:11},(_,i)=>String(i)) as any, datasets:[{ label:'Breadth (count ≥ 0.5)', data: pct, backgroundColor: PALETTE.blue, borderRadius: 6 as any, borderSkipped: false as any }] }} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:(v:any)=> `${v}%` } } } }} />
                                </div>
                              </>
                            )
                          })()
                        )}
                        {summary && segRightTab==='Lift' && (
                          <>
                            {(() => {
                              const seg = centroids[selectedCluster]
                              const lifts = CATEGORY_NAMES.map((c,i)=> ({ c, seg: seg[i], pop: summary.means[i], lift: (summary.means[i]||1e-9)>0? seg[i]/summary.means[i] : 0 }))
                              const topLift = lifts.slice().sort((a,b)=> b.lift-a.lift)[0]
                              const strong = lifts.filter(x=> x.lift>=1.2).length
                              const weak = lifts.filter(x=> x.lift<=0.8).length
                              // controls
                              return (
                                <>
                                  <div className="kpis" style={{ marginTop: '.25rem' }}>
                                    <span className="kpi-chip opportunity"><strong>Top Lift</strong>{topLift?.c} ({(isFinite(topLift?.lift)? topLift?.lift : 0).toFixed(2)})</span>
                                    <span className="kpi-chip"><strong>Lift ≥ 1.2</strong>{strong}</span>
                                    <span className="kpi-chip"><strong>Lift ≤ 0.8</strong>{weak}</span>
                                  </div>
                                  <div className="toolbar compact" style={{ marginBottom: '.5rem' }}>
                                    <div className="field">
                                      <label>Sort by</label>
                                      <select value={liftSortKey} onChange={(e)=> setLiftSortKey(e.target.value as any)}>
                                        <option value="lift">Lift</option>
                                        <option value="seg">Segment</option>
                                        <option value="pop">Population</option>
                                        <option value="category">Category</option>
                                      </select>
                                    </div>
                                    <div className="field">
                                      <label>Rows</label>
                                      <input type="number" min={3} max={15} value={liftRows} onChange={(e)=> setLiftRows(Math.max(3, Math.min(15, parseInt(e.target.value||'8',10))))} />
                                    </div>
                                    <div className="field">
                                      <label>Top Order</label>
                                      <button className="primary" onClick={()=> setLiftTopOrder(o=> o==='desc'?'asc':'desc')}>{liftTopOrder==='desc'?'Desc':'Asc'}</button>
                                    </div>
                                    <div className="field">
                                      <label>Under Order</label>
                                      <button className="primary" onClick={()=> setLiftUnderOrder(o=> o==='asc'?'desc':'asc')}>{liftUnderOrder==='asc'?'Asc':'Desc'}</button>
                                    </div>
                                    <div className="field">
                                      <label>Expand</label>
                                      <button className="primary" onClick={()=> setLiftExpanded(x=>!x)}>{liftExpanded?'Collapse':'Expand'}</button>
                                    </div>
                                  </div>
                                  <h3 style={{ marginTop: 0 }}>Segment Lift vs Population</h3>
                                </>
                              )
                            })()}
                            <div>
                              {(() => {
                                const seg = centroids[selectedCluster]
                                const all = CATEGORY_NAMES.map((c,i)=> ({ c, seg: seg[i], pop: summary.means[i], lift: (summary.means[i]||1e-9)>0? seg[i]/summary.means[i] : 0 }))
                                const cmp = (a:any,b:any) => {
                                  const key = liftSortKey
                                  const av = key==='category'? a.c : a[key]
                                  const bv = key==='category'? b.c : b[key]
                                  if (typeof av === 'string') return av.localeCompare(bv)
                                  return av - bv
                                }
                                const top = all.slice().sort((a,b)=> liftTopOrder==='desc' ? -cmp(a,b) : cmp(a,b)).slice(0, liftRows)
                                const under = all.slice().sort((a,b)=> liftUnderOrder==='asc' ? cmp(a,b) : -cmp(a,b)).slice(0, liftRows)
                                const layoutWrap = (content:any) => liftExpanded ? (<div style={{ marginTop: '.25rem' }}>{content}</div>) : (
                                  <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'1rem' }}>{content}</div>
                                )
                                return layoutWrap(
                                  <>
                                    <div>
                                      <h4 style={{ marginTop: 0 }}>Top</h4>
                                      <table className="table-sticky table-wrap">
                                        <thead>
                                          <tr>
                                            <th>Category</th>
                                            <th>Lift</th>
                                            <th>Segment</th>
                                            <th>Population</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {top.map(r => {
                                            const isPos = r.lift >= 1
                                            const color = isPos ? '#198754' : '#adb5bd'
                                            const txt = (isFinite(r.lift)? r.lift : 0).toFixed(2)
                                            return (
                                              <tr key={r.c}>
                                                <td>{r.c}</td>
                                                <td style={{ color, fontWeight: isPos ? 700 : 400 }}>{txt}</td>
                                                <td>{r.seg.toFixed(2)}</td>
                                                <td>{r.pop.toFixed(2)}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div>
                                      <h4 style={{ marginTop: 0 }}>Under-indexed</h4>
                                      <table className="table-sticky table-wrap">
                                        <thead>
                                          <tr>
                                            <th>Category</th>
                                            <th>Lift</th>
                                            <th>Segment</th>
                                            <th>Population</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {under.map(r => {
                                            const isPos = r.lift >= 1
                                            const color = isPos ? '#198754' : '#adb5bd'
                                            const txt = (isFinite(r.lift)? r.lift : 0).toFixed(2)
                                            return (
                                              <tr key={r.c}>
                                                <td>{r.c}</td>
                                                <td style={{ color, fontWeight: isPos ? 700 : 400 }}>{txt}</td>
                                                <td>{r.seg.toFixed(2)}</td>
                                                <td>{r.pop.toFixed(2)}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                )
                              })()}
                            </div>
                <div className="muted" style={{ marginTop: '.35rem' }}>
                  Legend: <span className="badge high">Lift ≥ 1</span> indicates over‑indexing; values &lt; 1 appear muted.
                </div>
                            <div style={{ height: 220, marginTop: '.75rem' }}>
                              {(() => {
                                const seg = centroids[selectedCluster]
                                const lifts = CATEGORY_NAMES.map((c,i)=>({ c, v: (summary.means[i]||1e-9) > 0 ? seg[i]/summary.means[i] : 0 }))
                                  .sort((a,b)=> b.v-a.v).slice(0,8)
                                return (
                                  <Bar data={{
                                    labels: lifts.map(x=>x.c) as any,
                                    datasets:[{ label:'Lift', data: lifts.map(x=>x.v), backgroundColor: PALETTE.green }]
                                  }} options={{ responsive:true, maintainAspectRatio:false, plugins:{ tooltip:{ callbacks:{ label:(ctx:any)=> `Lift: ${(ctx.parsed.y ?? ctx.parsed).toFixed ? (ctx.parsed.y ?? ctx.parsed).toFixed(2) : Number(ctx.parsed.y ?? ctx.parsed).toFixed(2)}` } } } }} />
                                )
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="subtitle">What this means: the distribution highlights concentration, tail behavior, and skew. Use this to set thresholds and identify VIP tails.</div>
                    </div>
                    <div style={{marginTop:'.75rem'}}>
                      <h3>Member Assignment</h3>
                      <p className="muted">Member #{memberIndex} belongs to Segment {clusterLabels[memberIndex]}.</p>
                    </div>
                    <div className="card" style={{ padding: '.75rem', marginTop: '.75rem' }}>
                      <h3 style={{ marginTop: 0 }}>Methodology</h3>
                      <ul>
                        <li>K‑Means with random unique seeding; Euclidean distance on 10D space; max 30 iterations.</li>
                        <li>Centroids are per-segment means; sizes reflect member counts per segment.</li>
                        <li>Inertia is within-cluster sum of squared distances; lower is better for a given K.</li>
                        <li>Elbow heuristic picks K with maximum perpendicular distance to the line from K=2 to K=10.</li>
                      </ul>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'Executive Summary' && (
          <div className="card">
            <h2>Executive Summary</h2>
            {!mat && <p className="muted">Load data to generate the summary.</p>}
            {mat && (
              <>
                <div className="callout" style={{ marginBottom: '.75rem' }}>
                  One‑page brief with key KPIs, drivers, and actions. Designed for quick decisions.
                </div>
                <div className="stats-row" style={{ marginBottom: '.75rem' }}>
                  <div className="stat">
                    <div className="stat-label">Members</div>
                    <div className="stat-value">{rows}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Final K</div>
                    <div className="stat-value">{elbow ? elbow.finalK : '—'}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Top Correlation</div>
                    <div className="stat-value">{summary ? `${summary.topCorr[0][0]}–${summary.topCorr[0][1]}` : '—'}</div>
                  </div>
                </div>
                <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Recommendation Strategy (Executive)</h3>
                  <ul>
                    <li><strong>Prioritization</strong>: rank by raw score; justify with z‑score (member vs population) and segment lift. Harvest when z &gt; 1.5 or lift &gt; 1.3; nurture when 0.5–1.5; otherwise hold/explore.</li>
                    <li><strong>Bundles &amp; Suppression</strong>: bundle positive pairs; suppress negative pairs within 14 days to avoid cannibalization; rotate bundles by segment to reduce fatigue.</li>
                    <li><strong>Explore Slots</strong>: reserve 1 of K for under‑indexed categories to grow breadth without hurting harvest outcomes.</li>
                    <li><strong>Scenario Efficacy</strong>:
                      <ul>
                        <li>Harvest windows (payday/holidays): raise thresholds (≥0.7), reduce K (e.g., 2), focus on high‑std categories and positive‑pair bundles.</li>
                        <li>Always‑on lifecycle: thresholds around ≥0.5; emphasize education and brand recall; strict negative‑pair suppression.</li>
                        <li>Upsell/Cross‑sell: segment‑lift driven; lead with top‑lift and include one growth bet; lighter incentives in high‑lift segments to protect margin.</li>
                        <li>Retention: deprioritize weak‑lift + negative‑pair categories; reinforce segment hero offers with capped frequency.</li>
                      </ul>
                    </li>
                    <li><strong>Limits</strong>: function doesn’t model channel or price; use KPIs (incremental ARPU, cost per lifted member, CTR/CVR) to tune thresholds, bundles, and incentives.</li>
                  </ul>
                </div>
                {!elbow && (
                  <div className="callout" style={{ marginBottom: '.75rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
                    <span>Segments are not computed yet. Compute now to see segment insights.</span>
                    <button className="primary" onClick={()=> autoCluster(mat, clusterSeed)} disabled={computing}>
                      {computing ? 'Computing…' : 'Compute Segments'}
                    </button>
                  </div>
                )}
                
                <div className="kpis">
                  {(() => {
                    if (!summary) return null
                    const topMean = summary.summary.slice().sort((a,b)=>b.mean-a.mean)[0]
                    const mostVar = summary.summary.slice().sort((a,b)=>b.std-a.std)[0]
                    return (
                      <>
                        <span className="kpi-chip" title="Highest average propensity across members."><strong>Top Mean</strong>{topMean.category} ({topMean.mean.toFixed(2)})</span>
                        <span className="kpi-chip watch" title="Largest standard deviation; volatile response—prefer event-triggered messages."><strong>Most Variable</strong>{mostVar.category} (σ {mostVar.std.toFixed(2)})</span>
                        <span className="kpi-chip" title="Total members in the dataset."><strong>Members</strong>{rows}</span>
                        {elbow && (
                        <span className="kpi-chip" title="Final K from compromise rule: prefer smaller K when elbow and silhouette are close (≤1); otherwise choose silhouette K if it improves ≥0.05; else elbow."><strong>Final K</strong>{elbow.finalK}</span>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div className="muted" style={{ margin: '-.35rem 0 .5rem 0' }}>
                  Legend: <span className="badge high">Opportunity</span> high positive lift • <span className="badge med">Watch</span> moderate lift/volatility
                </div>
                {summary && (
                  <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'1rem' }}>
                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>Top Correlations</h3>
                      <table>
                        <thead><tr><th>A</th><th>B</th><th>r</th></tr></thead>
                        <tbody>
                          {summary.topCorr.map(([a,b,r])=> (
                            <tr key={`${a}-${b}`}><td>{a}</td><td>{b}</td><td>{r.toFixed(3)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="subtitle">Implication: bundle positive pairs; avoid negative pairs in the same journey.</div>
                    </div>
                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>Segment Overview</h3>
                      {!clusterLabels || !centroids ? (
                        <p className="muted">Run Segments → Elbow → Set K and Cluster to populate.</p>
                      ) : (
                        <table>
                      <thead><tr><th>ID</th><th>Name</th><th>Size</th><th>Top 2</th></tr></thead>
                      <tbody>
                        {centroids.map((c, i) => {
                          const tops = c.map((v,j)=>({j,v})).sort((a,b)=>b.v-a.v).slice(0,2).map(x=> (CATEGORY_NAMES as any)[x.j]).join(', ')
                          const size = clusterLabels.filter(l=>l===i).length
                          const name = segmentNames ? segmentNames[i] : `Segment ${i}`
                          return <tr key={i}><td>{i}</td><td>{name}</td><td>{size}</td><td>{tops}</td></tr>
                        })}
                      </tbody>
                        </table>
                      )}
                      <div className="subtitle">Implication: create 1–2 flagship offers per segment aligned to lifts.</div>
                    </div>
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'1rem', marginTop: '.75rem' }}>
                  <div className="card">
                    <h3 style={{ marginTop: 0 }}>Top Members</h3>
                    <table>
                      <thead><tr><th>#</th><th>Top Category</th><th>Score</th><th>Total</th></tr></thead>
                      <tbody>
                        {(() => {
                          const totals = mat.map((r, i) => ({ i, total: r.reduce((a,b)=>a+b,0), max: Math.max(...r), arg: r.indexOf(Math.max(...r)) }))
                          return totals.sort((a,b)=>b.total-a.total).slice(0,5).map(t => (
                            <tr key={t.i}><td>#{t.i}</td><td>{(CATEGORY_NAMES as any)[t.arg]}</td><td>{t.max.toFixed(2)}</td><td>{t.total.toFixed(2)}</td></tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                    <div className="subtitle">Action: flag these members for premium offers and concierge campaigns; tailor bundles to their top category.</div>
                  </div>
                  <div className="card">
                    <h3 style={{ marginTop: 0 }}>Elbow Summary</h3>
                    {!elbow ? (
                      <p className="muted">Auto clustering runs on load. Adjust method/seed then click Confirm to recompute.</p>
                    ) : (
                      <>
                        <div style={{ height: 220 }}>
                          <Line data={{ labels: elbow.ks.map(String), datasets:[
                            { label:'Inertia', data: elbow.inertia, borderColor: 'rgba(13,110,253,0.9)', backgroundColor: PALETTE.blueSoft, pointRadius:3, yAxisID: 'y' },
                            { label:'Silhouette (approx)', data: elbow.silhouette, borderColor: 'rgba(255,193,7,0.9)', backgroundColor: 'rgba(255,193,7,0.3)', pointRadius:3, yAxisID: 'y1' },
                          ] }} options={{ responsive:true, maintainAspectRatio:false, scales: { y: { position:'left' }, y1: { position:'right', suggestedMin: -0.1, suggestedMax: 1 } } }} />
                        </div>
                        <div className="subtitle">Suggested K (Elbow): {elbow.suggestedK} • Best by Silhouette: {elbow.bestBySil} • Final K: {elbow.finalK}. Rule: if within 1, pick smaller; otherwise use elbow for consistency.</div>
                        <div style={{ overflow:'auto', maxHeight: 220, marginTop: '.5rem' }}>
                          <table>
                            <thead><tr><th>K</th><th>Inertia</th><th>Silhouette</th><th>Selected</th></tr></thead>
                            <tbody>
                              {elbow.ks.map((k, i)=> {
                                let tag = ''
                                if (k === elbow.finalK) tag = 'Final'
                                else if (k === elbow.suggestedK) tag = 'Elbow'
                                else if (k === elbow.bestBySil) tag = 'Silhouette'
                                return (
                                  <tr key={k}>
                                    <td>{k}</td>
                                    <td>{elbow.inertia[i].toFixed(0)}</td>
                                    <td>{elbow.silhouette[i].toFixed(3)}</td>
                                    <td>{tag}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {clusterLabels && centroids && (
                  <div className="card" style={{ marginTop: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Segment Sizes</h3>
                    {(() => {
                      const sizes = centroids.map((_, i)=> clusterLabels.filter(l=>l===i).length)
                      return (
                        <div style={{ height: 220 }}>
                          <Bar data={{ labels: (segmentNames ? segmentNames : sizes.map((_,i)=>`S${i}`)) as any, datasets:[{ label:'Members', data: sizes, backgroundColor: PALETTE.blue }] }} options={{ responsive:true, maintainAspectRatio:false }} />
                          <div className="subtitle">Use larger segments for reach campaigns; smaller high-value segments for premium upsell.</div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                {clusterLabels && centroids && (
                  <div className="card" style={{ marginTop: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Segment Coverage by Threshold</h3>
                    {(() => {
                      const K = centroids.length
                      const labels = Array.from({length:K}, (_,i)=> segmentNames ? segmentNames[i] : `S${i}`)
                      const idxHero = centroids.map(c => c.reduce((bi,v,i,arr)=> v>arr[bi]? i: bi, 0))
                      const membersBySeg: number[][] = Array.from({length:K}, ()=> [])
                      for (let i=0;i<clusterLabels.length;i++) membersBySeg[clusterLabels[i]].push(i)
                      const pctAny = (t:number) => membersBySeg.map(ids => 100 * ids.filter(r=> mat[r].some(v=> v>=t)).length / Math.max(1, ids.length))
                      const pctHero = (t:number) => membersBySeg.map((ids,s)=> 100 * ids.filter(r=> mat[r][idxHero[s]]>=t).length / Math.max(1, ids.length))
                      const any50 = pctAny(0.5)
                      const any80 = pctAny(0.8)
                      const hero70 = pctHero(0.7)
                      return (
                        <div style={{ height: 260 }}>
                          <Bar data={{ labels: labels as any, datasets:[
                            { label:'Any ≥ 0.5', data: any50, backgroundColor: PALETTE.blue },
                            { label:'Any ≥ 0.8', data: any80, backgroundColor: PALETTE.green },
                            { label:'Hero ≥ 0.7', data: hero70, backgroundColor: PALETTE.amber },
                          ] }} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:(v:any)=> `${v}%` } } } }} />
                          <div className="subtitle">Audience sizing per segment. “Hero” is the segment’s top category.</div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                {clusterLabels && centroids && summary && (
                  <div className="card" style={{ marginTop: '.75rem' }}>
                    <h3 style={{ marginTop: 0 }}>Segment Concentration & Opportunity</h3>
                    {(() => {
                      const K = centroids.length
                      const labels = Array.from({length:K}, (_,i)=> segmentNames ? segmentNames[i] : `S${i}`)
                      // HHI per segment (average across members in segment)
                      const hhi: number[] = []
                      const opp: number[] = []
                      for (let s=0;s<K;s++){
                        const ids = clusterLabels.map((l,i)=> l===s ? i : -1).filter(i=> i>=0)
                        let sumHHI=0
                        for (const r of ids){
                          const row = mat[r]
                          const tot = row.reduce((a,b)=>a+b,0) || 1
                          let h=0; for (let j=0;j<row.length;j++){ const q=row[j]/tot; h += q*q }
                          sumHHI += h
                        }
                        hhi.push(ids.length ? sumHHI/ids.length : 0)
                        // Opportunity index: mean of top-3 lifts for this segment
                        const lifts = CATEGORY_NAMES.map((_,j)=>{
                          const mu = summary.means[j] || 1e-9
                          return mu>0 ? centroids[s][j]/mu : 0
                        }).sort((a,b)=> b-a).slice(0,3)
                        opp.push(lifts.reduce((a,b)=>a+b,0)/Math.max(1,lifts.length))
                      }
                      return (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                          <div style={{ height: 240 }}>
                            <Bar data={{ labels: labels as any, datasets:[{ label:'Avg HHI (0–1)', data: hhi, backgroundColor: PALETTE.blueSoft }] }} options={{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true, suggestedMax:1 } } }} />
                            <div className="subtitle">Higher HHI = more concentrated preferences; tailor fewer, stronger creatives.</div>
                          </div>
                          <div style={{ height: 240 }}>
                            <Bar data={{ labels: labels as any, datasets:[{ label:'Opportunity Index (Top‑3 Lift mean)', data: opp, backgroundColor: PALETTE.green }] }} options={{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ position:'bottom' } } }} />
                            <div className="subtitle">Higher index = stronger relative propensity; allocate budgets accordingly.</div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                <div className="card" style={{ marginTop: '.75rem' }}>
                  <h3 style={{ marginTop: 0 }}>Recommended Actions</h3>
                  <ul>
                    <li>Activate synergy bundles from top positive correlations.</li>
                    <li>Suppress conflicting categories (negative correlations) in the same week.</li>
                    <li>Use thresholds from Distribution Explorer to target the high tail.</li>
                    <li>Prioritize segment lifts for tailored creative and incentives.</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Lightweight wrapper component for matrix chart via react-chartjs-2
function MatrixChart({ data }: { data: any }) {
  // Use the generic Chart component from react-chartjs-2 for matrix type
  const options = {
    type: 'matrix' as const,
    scales: {
      x: { type: 'category' as const, offset: true, grid: { display: false, drawBorder: false }, ticks: { autoSkip: false, maxRotation: 0, minRotation: 0, font: { size: 10 } } },
      y: { type: 'category' as const, offset: true, reverse: true, grid: { display: false, drawBorder: false }, ticks: { autoSkip: false, font: { size: 10 } } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const r = ctx.raw
            return `${r.x} × ${r.y}: r=${r.v.toFixed(3)}`
          },
        },
      },
    },
    maintainAspectRatio: false,
  }
  return <ReactChart type={'matrix' as any} data={data} options={options as any} />
}

// Build a deterministic seed from matrix contents. We sample a subset for speed.
function hashMatrixForSeed(mat: Matrix): number {
  let h = 2166136261 >>> 0 // FNV-1a 32-bit offset basis
  const N = mat.length
  const step = Math.max(1, Math.floor(N / 128))
  for (let i = 0; i < N; i += step) {
    const row = mat[i]
    for (let j = 0; j < row.length; j++) {
      // Quantize to 3 decimals to avoid tiny noise
      const v = Math.round(row[j] * 1000)
      h ^= v & 0xff
      h = Math.imul(h, 16777619)
      h ^= (v >>> 8) & 0xff
      h = Math.imul(h, 16777619)
      h ^= (v >>> 16) & 0xff
      h = Math.imul(h, 16777619)
    }
  }
  // Ensure positive 31-bit integer
  return (h >>> 0) & 0x7fffffff
}

// Approximate silhouette score using distances to centroids.
// For each point i, s_i ≈ (b - a) / max(a, b), where
//  a = distance to own centroid
//  b = distance to nearest other centroid
// This proxy avoids O(N^2) costs and is sufficient for model selection.
function silhouetteApprox(mat: Matrix, labels: number[], centroids: number[][]): number {
  const N = mat.length
  if (N === 0) return 0
  const D = mat[0].length
  const dist = (a:number[], b:number[]) => {
    let s=0; for (let d=0; d<D; d++){ const dd=a[d]-b[d]; s+=dd*dd } return Math.sqrt(s)
  }
  let sum = 0
  for (let i=0; i<N; i++){
    const row = mat[i]
    const own = labels[i]
    const a = dist(row, centroids[own])
    let b = Infinity
    for (let c=0; c<centroids.length; c++){
      if (c===own) continue
      const d = dist(row, centroids[c])
      if (d < b) b = d
    }
    const s = (b - a) / Math.max(a, b || 1)
    sum += s
  }
  return sum / N
}

// Derive human-friendly segment names from centroids (e.g., "LuxuryGoods & Service").
function nameSegments(centroids: number[][]): string[] {
  return centroids.map((c, i) => {
    const idx = c.map((v, j) => ({ j, v })).sort((a, b) => b.v - a.v)
    const top1 = (CATEGORY_NAMES as any)[idx[0].j]
    const top2 = (CATEGORY_NAMES as any)[idx[1]?.j ?? idx[0].j]
    // Prefer business-friendly name by top1; fallback to Top1 & Top2
    return SEGMENT_NAME_DICT[top1] || `${top1} & ${top2}`
  })
}
// Simple K-Means implementation for small matrices (N x 10)
function kmeans(mat: Matrix, K: number, maxIter = 30, seed = KMEANS_SEED, nInit = 10) {
  // Deterministic, multi-start K-Means (nInit restarts); picks lowest inertia.
  const N = mat.length
  const D = mat[0].length

  // Seeded RNG (mulberry32)
  function rngMulberry32(s: number) {
    return function() {
      let t = (s += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const dist2 = (a:number[], b:number[]) => {
    let s = 0
    for (let i=0;i<D;i++){ const d = a[i]-b[i]; s += d*d }
    return s
  }

  function runOnce(initSeed: number) {
    // Shuffle indices deterministically
    const rnd = rngMulberry32(initSeed)
    const idx = Array.from({ length: N }, (_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t
    }
    const centers = idx.slice(0, K).map(i => mat[i].slice())
    const labels = new Array<number>(N).fill(0)
    let changed = true
    let it = 0
    while (changed && it < maxIter) {
      changed = false
      it++
      // assign
      for (let i = 0; i < N; i++) {
        let best = 0, bestd = Infinity
        for (let c = 0; c < K; c++) {
          const d = dist2(mat[i], centers[c])
          if (d < bestd) { bestd = d; best = c }
        }
        if (labels[i] !== best) { labels[i] = best; changed = true }
      }
      // update
      const sums = Array.from({length:K}, ()=>Array(D).fill(0))
      const counts = Array.from({length:K}, ()=>0)
      for (let i = 0; i < N; i++) {
        const l = labels[i]
        counts[l]++
        const row = mat[i]
        for (let d = 0; d < D; d++) sums[l][d] += row[d]
      }
      for (let c = 0; c < K; c++) {
        if (counts[c] === 0) continue
        for (let d = 0; d < D; d++) sums[c][d] /= counts[c]
        centers[c] = sums[c]
      }
    }
    let inertia = 0
    for (let i = 0; i < N; i++) inertia += dist2(mat[i], centers[labels[i]])
    return { labels, centers, inertia }
  }

  // Multi-start with deterministic seeds (seed + init index)
  let best = runOnce(seed)
  for (let t = 1; t < nInit; t++) {
    const trial = runOnce(seed + t * 101)
    if (trial.inertia < best.inertia) best = trial
  }
  return { labels: Array.from(best.labels), centroids: best.centers, inertia: best.inertia }
}

// Elbow suggestion via maximum perpendicular distance to the line between endpoints
function suggestElbow(ks: number[], inertia: number[]): number {
  if (ks.length !== inertia.length || ks.length < 3) return ks[Math.floor(ks.length/2)]
  const x1 = ks[0], y1 = inertia[0]
  const x2 = ks[ks.length-1], y2 = inertia[inertia.length-1]
  const dx = x2 - x1, dy = y2 - y1
  let bestK = ks[0]
  let bestD = -Infinity
  for (let i=1; i<ks.length-1; i++) {
    const x0 = ks[i], y0 = inertia[i]
    const num = Math.abs(dy*x0 - dx*y0 + x2*y1 - y2*x1)
    const den = Math.sqrt(dx*dx + dy*dy) || 1
    const d = num / den
    if (d > bestD) { bestD = d; bestK = ks[i] }
  }
  return bestK
}
