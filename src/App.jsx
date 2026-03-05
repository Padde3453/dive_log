import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './App.css'

const tabs = ['Dashboard', 'Enter Dive', 'Edit Dive']

const palette = {
  ocean: ['#0ea5e9', '#38bdf8', '#22d3ee', '#38bdf8', '#0ea5e9'],
  deep: ['#0b4a6f', '#0ea5e9', '#06b6d4', '#1e40af', '#38bdf8'],
}

const normalize = (value) => String(value || '').trim().toLowerCase()
const normalizeName = (value) => normalize(value).replace(/\s+/g, ' ')

const getField = (row, keys) => {
  const entries = Object.entries(row || {})
  for (const key of keys) {
    const target = normalize(key)
    const match = entries.find(([name]) => normalize(name) === target)
    if (match) {
      return match[1]
    }
  }
  return ''
}

const toNumber = (value) => {
  if (value === null || value === undefined) return 0
  const num = Number(String(value).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

const buildCounts = (rows, keys) => {
  const counts = new Map()
  rows.forEach((row) => {
    const value = getField(row, keys)
    const label = value ? String(value).trim() : 'Unknown'
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  return Array.from(counts.entries()).map(([label, value]) => ({ label, value }))
}

const countFilledFields = (row) => {
  return Object.entries(row || {}).reduce((count, [key, value]) => {
    if (key === '_rowNumber') return count
    const text = String(value ?? '').trim()
    return text ? count + 1 : count
  }, 0)
}

const parseTimeToMinutes = (value) => {
  if (!value) return null
  const text = String(value).trim().toLowerCase()
  const ampmMatch = text.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/)
  if (ampmMatch) {
    let hours = Number(ampmMatch[1])
    const minutes = Number(ampmMatch[2])
    const period = ampmMatch[3]
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    if (hours === 12) hours = 0
    if (period === 'pm') hours += 12
    return hours * 60 + minutes
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

const parseDateValue = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const parsed = Date.parse(text)
  if (!Number.isNaN(parsed)) return new Date(parsed)

  const parts = text.split(/[\/\-.]/).map((part) => Number(part))
  if (parts.length < 3) return null
  let [month, day, year] = parts
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null
  if (year < 100) year += 2000
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

const parseCoord = (value) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const normalized = text.includes('.') ? text : text.replace(',', '.')
  const num = Number(normalized.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(num) ? num : null
}

const toDateInputValue = (date) => {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const computeDiveTime = (timeIn, timeOut) => {
  const start = parseTimeToMinutes(timeIn)
  const end = parseTimeToMinutes(timeOut)
  if (start === null || end === null) return ''
  const diff = Math.max(end - start, 0)
  return diff ? String(diff) : '0'
}

const ordinal = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  const mod100 = number % 100
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`
  switch (number % 10) {
    case 1:
      return `${number}st`
    case 2:
      return `${number}nd`
    case 3:
      return `${number}rd`
    default:
      return `${number}th`
  }
}

const buildGradient = (segments, colors) => {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0)
  if (!total) return 'conic-gradient(#0f172a 0deg, #0f172a 360deg)'

  let current = 0
  const stops = segments.map((seg, index) => {
    const start = (current / total) * 360
    current += seg.value
    const end = (current / total) * 360
    const color = colors[index % colors.length]
    return `${color} ${start}deg ${end}deg`
  })

  return `conic-gradient(${stops.join(', ')})`
}

function PieChart({ title, segments, colors }) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0)
  const gradient = buildGradient(segments, colors)

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>{title}</h3>
        <span className="chart-total">{total} dives</span>
      </div>
      <div className="chart-body">
        <div className="pie" style={{ backgroundImage: gradient }}>
          <div className="pie-core" />
        </div>
        <div className="legend">
          {segments.map((seg, index) => (
            <div className="legend-item" key={seg.label}>
              <span
                className="legend-swatch"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <span className="legend-label">{seg.label}</span>
              <span className="legend-value">{seg.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FitBounds({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) {
      map.setView([0, 0], 2, { animate: false })
      return
    }
    const bounds = points.map((point) => [point.lat, point.lng])
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 2 })
  }, [map, points])

  return null
}

function App() {
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [status, setStatus] = useState({ state: 'idle', message: '' })
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' })
  const [formValues, setFormValues] = useState({})
  const [formReady, setFormReady] = useState(false)
  const [worldData, setWorldData] = useState(null)
  const [mapLayer, setMapLayer] = useState('choropleth')
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [yearIndex, setYearIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [filterCountry, setFilterCountry] = useState('')
  const [filterStart, setFilterStart] = useState('')
  const [filterEnd, setFilterEnd] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [editRow, setEditRow] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [editStatus, setEditStatus] = useState({ state: 'idle', message: '' })
  const [toast, setToast] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loginValues, setLoginValues] = useState({ username: '', password: '' })

  const fetchData = async () => {
    setStatus({ state: 'loading', message: 'Connecting to Google Sheets...' })
    try {
      const response = await fetch('/api/dives', { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }
      const data = await response.json()
      setHeaders(data.headers || [])
      setRows(data.rows || [])
      setStatus({ state: 'success', message: 'Connected to Google Sheets.' })
    } catch (error) {
      setStatus({ state: 'error', message: error.message })
    }
  }

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/session', { credentials: 'include' })
        const data = await response.json()
        const authed = Boolean(data.authenticated)
        setIsAuthenticated(authed)
        if (authed) {
          await fetchData()
        }
      } catch (error) {
        setIsAuthenticated(false)
      } finally {
        setAuthChecked(true)
      }
    }

    checkSession()
  }, [])

  useEffect(() => {
    const loadWorld = async () => {
      try {
        const response = await fetch('/world.geo.json')
        if (!response.ok) return
        const data = await response.json()
        setWorldData(data)
      } catch (error) {
        // silent fallback
      }
    }

    loadWorld()
  }, [])

  const validRows = useMemo(() => rows.filter((row) => countFilledFields(row) >= 6), [rows])

  const metrics = useMemo(() => {
    const totalDives = validRows.length
    const diveTimes = validRows.map((row) => toNumber(getField(row, ['Dive time', 'Dive Time', 'DiveTime'])))
    const maxDepths = validRows.map((row) => toNumber(getField(row, ['Max Depth', 'Max depth', 'MaxDepth'])))

    const minutesDived = diveTimes.reduce((sum, value) => sum + value, 0)
    const deepestDive = maxDepths.length ? Math.max(...maxDepths) : 0
    const longestDive = diveTimes.length ? Math.max(...diveTimes) : 0
    const avgMaxDepth = maxDepths.length ? Math.round(maxDepths.reduce((sum, value) => sum + value, 0) / maxDepths.length) : 0
    const avgDiveTime = diveTimes.length ? Math.round(minutesDived / diveTimes.length) : 0

    return {
      totalDives,
      minutesDived,
      deepestDive,
      longestDive,
      avgMaxDepth,
      avgDiveTime,
    }
  }, [validRows])

  const entrySegments = useMemo(() => buildCounts(validRows, ['Entry']), [validRows])
  const typeSegments = useMemo(() => buildCounts(validRows, ['Dive type', 'Dive Type']), [validRows])
  const oxygenSegments = useMemo(() => buildCounts(validRows, ['Oxygen']), [validRows])

  const availableYears = useMemo(() => {
    const years = new Set()
    validRows.forEach((row) => {
      const date = parseDateValue(getField(row, ['Date']))
      if (date) years.add(date.getFullYear())
    })
    return Array.from(years).sort((a, b) => a - b)
  }, [validRows])

  useEffect(() => {
    if (!availableYears.length) return
    if (yearIndex > availableYears.length - 1) {
      setYearIndex(availableYears.length - 1)
    }
  }, [availableYears, yearIndex])

  useEffect(() => {
    if (!validRows.length) return
    if (!filterStart) {
      const dates = validRows
        .map((row) => parseDateValue(getField(row, ['Date'])))
        .filter(Boolean)
      if (dates.length) {
        const earliest = new Date(Math.min(...dates.map((date) => date.getTime())))
        setFilterStart(toDateInputValue(earliest))
      }
    }
    if (!filterEnd) {
      setFilterEnd(toDateInputValue(new Date()))
    }
  }, [filterEnd, filterStart, validRows])

  useEffect(() => {
    if (!timelineEnabled || !isPlaying || !availableYears.length) return
    const interval = setInterval(() => {
      setYearIndex((prev) => {
        const next = prev + 1
        if (next >= availableYears.length) {
          setIsPlaying(false)
          return prev
        }
        return next
      })
    }, 1200)
    return () => clearInterval(interval)
  }, [availableYears.length, isPlaying, timelineEnabled])

  const selectedYear = timelineEnabled && availableYears.length ? availableYears[yearIndex] : null

  const mapRows = useMemo(() => {
    if (!selectedYear) return validRows
    return validRows.filter((row) => {
      const date = parseDateValue(getField(row, ['Date']))
      return date && date.getFullYear() <= selectedYear
    })
  }, [selectedYear, validRows])

  const locations = useMemo(() => {
    const counts = buildCounts(mapRows, ['Country'])
    return counts.sort((a, b) => b.value - a.value).slice(0, 6)
  }, [mapRows])

  const countryCounts = useMemo(() => {
    const counts = new Map()
    mapRows.forEach((row) => {
      const country = normalizeName(getField(row, ['Country']))
      if (!country) return
      counts.set(country, (counts.get(country) || 0) + 1)
    })
    return counts
  }, [mapRows])

  const maxCountryCount = useMemo(() => {
    const values = Array.from(countryCounts.values())
    return values.length ? Math.max(...values) : 0
  }, [countryCounts])

  const mapPoints = useMemo(() => {
    const points = []
    mapRows.forEach((row) => {
      const lat = parseCoord(getField(row, ['Latitude', 'Lat']))
      const lng = parseCoord(getField(row, ['Longitude', 'Long', 'Lng']))
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat <= 90 &&
        lat >= -90 &&
        lng <= 180 &&
        lng >= -180 &&
        !(lat === 0 && lng === 0)
      ) {
        points.push({
          lat,
          lng,
          site: getField(row, ['Reef - Dive Site', 'Dive Site', 'Site']),
          country: getField(row, ['Country']),
        })
      }
    })
    return points
  }, [mapRows])

  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: 'dive-marker',
        iconSize: [12, 12],
      }),
    [],
  )

  const getChoroplethColor = (count) => {
    if (!count) return '#0b1220'
    if (!maxCountryCount) return '#0b1220'
    const ratio = count / maxCountryCount
    if (ratio > 0.85) return '#0ea5e9'
    if (ratio > 0.6) return '#38bdf8'
    if (ratio > 0.35) return '#5ad4ff'
    if (ratio > 0.15) return '#7dd3fc'
    return '#a5f3fc'
  }

  const exampleLookup = useMemo(() => {
    const buildExamples = (key) => {
      const values = new Set()
      validRows.forEach((row) => {
        const value = getField(row, [key])
        if (value) values.add(String(value).trim())
      })
      return Array.from(values).slice(0, 6)
    }

    return {
      Weather: buildExamples('Weather'),
      Area: buildExamples('Area'),
      Oxygen: buildExamples('Oxygen'),
      'Dive type': buildExamples('Dive type'),
      'Special sighting': buildExamples('Special sighting'),
      Notes: buildExamples('Notes'),
    }
  }, [validRows])

  const nextDiveNumber = useMemo(() => {
    const maxDive = validRows.reduce((max, row) => {
      const current = toNumber(getField(row, ['Dive #', 'Dive#', 'Dive Number']))
      return current > max ? current : max
    }, 0)
    return maxDive + 1
  }, [validRows])

  const formFields = useMemo(
    () => [
      { name: 'Dive #', label: 'Dive #', type: 'number', readOnly: true },
      { name: 'Date', label: 'Date', type: 'date' },
      { name: 'Country', label: 'Country', type: 'text' },
      { name: 'Area', label: 'Area', type: 'text' },
      { name: 'Reef - Dive Site', label: 'Reef / Dive Site', type: 'text' },
      { name: 'Longitude', label: 'Longitude', type: 'number', step: 'any' },
      { name: 'Latitude', label: 'Latitude', type: 'number', step: 'any' },
      { name: 'Weather', label: 'Weather', type: 'text' },
      { name: 'Water Temp', label: 'Water Temp (°C)', type: 'number', step: 'any' },
      { name: 'Viz', label: 'Viz (m)', type: 'number', step: 'any' },
      { name: 'Sea conditions', label: 'Sea conditions', type: 'text' },
      { name: 'Time in', label: 'Time in', type: 'text', placeholder: 'HH:MM or 2:30 PM' },
      { name: 'Time out', label: 'Time out', type: 'text', placeholder: 'HH:MM or 2:30 PM' },
      { name: 'Dive time', label: 'Dive time (min)', type: 'number', readOnly: true },
      { name: 'Max Depth', label: 'Max Depth (m)', type: 'number', step: 'any' },
      { name: 'Weight', label: 'Weight (kg)', type: 'number', step: 'any' },
      { name: 'Wetsuit (mm)', label: 'Wetsuit (mm)', type: 'text' },
      { name: 'Oxygen', label: 'Oxygen', type: 'text' },
      { name: 'Entry', label: 'Entry', type: 'text' },
      { name: 'Dive type', label: 'Dive type', type: 'text' },
      { name: 'Special sighting', label: 'Special sighting', type: 'text' },
      { name: 'Notes', label: 'Notes', type: 'textarea' },
      { name: 'Buddy Name', label: 'Buddy Name', type: 'text' },
      { name: 'Picture signature', label: 'Picture signature', type: 'text' },
      { name: 'Link to pictures', label: 'Link to pictures', type: 'text' },
    ],
    [],
  )

  useEffect(() => {
    if (formReady) return
    if (!headers.length) return
    const initial = {}
    formFields.forEach((field) => {
      initial[field.name] = field.name === 'Dive #' ? nextDiveNumber : ''
    })
    setFormValues(initial)
    setFormReady(true)
  }, [formFields, formReady, headers.length, nextDiveNumber])

  const handleFieldChange = (name, value) => {
    setFormValues((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'Time in' || name === 'Time out') {
        next['Dive time'] = computeDiveTime(next['Time in'], next['Time out'])
      }
      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaveStatus({ state: 'loading', message: 'Saving dive...' })
    try {
      const response = await fetch('/api/dives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formValues),
      })
      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`)
      }
      setSaveStatus({ state: 'success', message: 'Dive saved.' })
      setToast({ type: 'success', message: 'Dive added successfully.' })
      setFormReady(false)
      await fetchData()
    } catch (error) {
      setSaveStatus({ state: 'error', message: error.message })
      setToast({ type: 'error', message: error.message })
    }
  }

  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timeout)
  }, [toast])

  const countryOptions = useMemo(() => {
    const values = new Set()
    validRows.forEach((row) => {
      const country = getField(row, ['Country'])
      if (country) values.add(String(country).trim())
    })
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [validRows])

  const filteredRows = useMemo(() => {
    const startDate = filterStart ? new Date(filterStart) : null
    const endDate = filterEnd ? new Date(filterEnd) : null
    return validRows.filter((row) => {
      const country = String(getField(row, ['Country']) || '').trim()
      if (filterCountry && normalizeName(country) !== normalizeName(filterCountry)) return false
      if (startDate || endDate) {
        const date = parseDateValue(getField(row, ['Date']))
        if (!date) return false
        if (startDate && date < startDate) return false
        if (endDate && date > endDate) return false
      }
      return true
    })
  }, [filterCountry, filterEnd, filterStart, validRows])

  const displayHeaders = useMemo(
    () => headers.filter((header) => normalizeName(header) !== normalizeName('Count Area')),
    [headers],
  )

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows
    const sorted = [...filteredRows]
    sorted.sort((a, b) => {
      const aVal = a[sortKey] ?? ''
      const bVal = b[sortKey] ?? ''
      if (normalizeName(sortKey) === normalizeName('Date')) {
        const aDate = parseDateValue(aVal)
        const bDate = parseDateValue(bVal)
        if (aDate && bDate) return aDate - bDate
      }
      const aNum = toNumber(aVal)
      const bNum = toNumber(bVal)
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && String(aVal).trim() && String(bVal).trim()) {
        return aNum - bNum
      }
      return String(aVal).localeCompare(String(bVal))
    })
    return sortDir === 'asc' ? sorted : sorted.reverse()
  }, [filteredRows, sortDir, sortKey])

  const beginEdit = (row) => {
    const next = {}
    headers.forEach((header) => {
      next[header] = row[header] ?? ''
    })
    setEditValues(next)
    setEditRow(row)
    setEditStatus({ state: 'idle', message: '' })
  }

  const handleEditChange = (name, value) => {
    setEditValues((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'Time in' || name === 'Time out') {
        next['Dive time'] = computeDiveTime(next['Time in'], next['Time out'])
      }
      return next
    })
  }

  const handleEditSubmit = async (event) => {
    event.preventDefault()
    if (!editRow) return
    setEditStatus({ state: 'loading', message: 'Saving changes...' })
    try {
      const response = await fetch(`/api/dives/${editRow._rowNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(editValues),
      })
      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`)
      }
      setEditStatus({ state: 'success', message: 'Changes saved.' })
      setToast({ type: 'success', message: 'Dive updated successfully.' })
      await fetchData()
    } catch (error) {
      setEditStatus({ state: 'error', message: error.message })
      setToast({ type: 'error', message: error.message })
    }
  }

  return (
    <div className="app">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
      {!authChecked ? (
        <div className="login">
          <div className="login-card">
            <h2>Welcome back</h2>
            <p className="muted">Sign in to access your dive log.</p>
          </div>
        </div>
      ) : !isAuthenticated ? (
        <div className="login">
          <form
            className="login-card"
            onSubmit={async (event) => {
              event.preventDefault()
              setToast(null)
              try {
                const response = await fetch('/api/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify(loginValues),
                })
                if (!response.ok) throw new Error('Invalid credentials.')
                setIsAuthenticated(true)
                await fetchData()
              } catch (error) {
                setToast({ type: 'error', message: error.message })
              }
            }}
          >
            <h2>Login</h2>
            <p className="muted">Enter your credentials to continue.</p>
            <label className="form-field">
              <span>Username</span>
              <input
                type="text"
                value={loginValues.username}
                onChange={(event) => setLoginValues((prev) => ({ ...prev, username: event.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                value={loginValues.password}
                onChange={(event) => setLoginValues((prev) => ({ ...prev, password: event.target.value }))}
              />
            </label>
            <button type="submit" className="primary">
              Sign in
            </button>
          </form>
        </div>
      ) : (
        <>
          <header className="app-header">
        <div>
          <p className="eyebrow">Dive Log</p>
          <h1>Patrick's Dive Log</h1>
        </div>
        <div className="header-actions">
          <div className={`status status-${status.state}`}>
            {status.message || 'Idle'}
          </div>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST', credentials: 'include' })
              setIsAuthenticated(false)
              setToast({ type: 'success', message: 'Logged out successfully.' })
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className="panel">
        {activeTab === 'Dashboard' && (
          <section className="dashboard">
            <div className="metrics">
              <div className="metric">
                <p>Total dives</p>
                <h2>{metrics.totalDives}</h2>
              </div>
              <div className="metric">
                <p>Minutes dived</p>
                <h2>{metrics.minutesDived}</h2>
              </div>
              <div className="metric">
                <p>Deepest dive (m)</p>
                <h2>{metrics.deepestDive}</h2>
              </div>
              <div className="metric">
                <p>Longest dive (min)</p>
                <h2>{metrics.longestDive}</h2>
              </div>
              <div className="metric">
                <p>Avg max depth (m)</p>
                <h2>{metrics.avgMaxDepth}</h2>
              </div>
              <div className="metric">
                <p>Avg dive time (min)</p>
                <h2>{metrics.avgDiveTime}</h2>
              </div>
            </div>

            <div className="map-panel">
              <div>
                <h3>Dive locations</h3>
                <p className="muted">Top countries by dives</p>
                <div className="location-list">
                  {locations.map((loc) => (
                    <div className="location" key={loc.label}>
                      <span>{loc.label}</span>
                      <strong>{loc.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="map-graphic">
                <MapContainer
                  center={[0, 0]}
                  zoom={2}
                  scrollWheelZoom={false}
                  className="map-leaflet"
                >
                  <TileLayer
                    attribution="&copy; OpenStreetMap contributors, &copy; CARTO"
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  <FitBounds points={mapLayer === 'markers' || mapLayer === 'both' ? mapPoints : []} />
                  {(mapLayer === 'choropleth' || mapLayer === 'both') && worldData && (
                    <GeoJSON
                      data={worldData}
                      style={(feature) => {
                        const name = normalizeName(feature?.properties?.name)
                        const count = countryCounts.get(name) || 0
                        return {
                          weight: 1,
                          color: '#1e3a8a',
                          fillColor: getChoroplethColor(count),
                          fillOpacity: count ? 0.8 : 0.25,
                        }
                      }}
                      onEachFeature={(feature, layer) => {
                        const name = feature?.properties?.name || 'Unknown'
                        const count = countryCounts.get(normalizeName(name)) || 0
                        layer.bindTooltip(`${name}: ${count}`)
                      }}
                    />
                  )}
                  {(mapLayer === 'markers' || mapLayer === 'both') && (
                    <MarkerClusterGroup chunkedLoading>
                      {mapPoints.map((point, index) => (
                        <Marker
                          key={`${point.lat}-${point.lng}-${index}`}
                          position={[point.lat, point.lng]}
                          icon={markerIcon}
                        >
                          <Tooltip direction="top" offset={[0, -4]} opacity={0.9}>
                            <strong>{point.site || 'Dive site'}</strong>
                            <div>{point.country || 'Unknown location'}</div>
                          </Tooltip>
                        </Marker>
                      ))}
                    </MarkerClusterGroup>
                  )}
                </MapContainer>
                <div className="map-title">OCEAN TRACK</div>
                <div className="map-controls">
                  <button
                    type="button"
                    className={mapLayer === 'choropleth' ? 'map-toggle active' : 'map-toggle'}
                    onClick={() => setMapLayer('choropleth')}
                  >
                    Choropleth
                  </button>
                  <button
                    type="button"
                    className={mapLayer === 'markers' ? 'map-toggle active' : 'map-toggle'}
                    onClick={() => setMapLayer('markers')}
                  >
                    Markers
                  </button>
                  <button
                    type="button"
                    className={mapLayer === 'both' ? 'map-toggle active' : 'map-toggle'}
                    onClick={() => setMapLayer('both')}
                  >
                    Both
                  </button>
                </div>
              </div>
            </div>
            <div className="map-timeline">
              <div className="timeline-controls">
                <button
                  type="button"
                  className={timelineEnabled ? 'map-toggle' : 'map-toggle active'}
                  onClick={() => {
                    setTimelineEnabled(false)
                    setIsPlaying(false)
                  }}
                >
                  All time
                </button>
                <button
                  type="button"
                  className={timelineEnabled ? 'map-toggle active' : 'map-toggle'}
                  onClick={() => setTimelineEnabled(true)}
                  disabled={!availableYears.length}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  className="map-toggle"
                  onClick={() => setIsPlaying((prev) => !prev)}
                  disabled={!timelineEnabled || !availableYears.length}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <div className="timeline-slider">
                <span>{selectedYear || 'All'}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(availableYears.length - 1, 0)}
                  value={yearIndex}
                  onChange={(event) => setYearIndex(Number(event.target.value))}
                  disabled={!timelineEnabled || !availableYears.length}
                />
                <span>{availableYears[availableYears.length - 1] || ''}</span>
              </div>
            </div>

            <div className="charts">
              <PieChart title="Entry" segments={entrySegments} colors={palette.ocean} />
              <PieChart title="Dive Type" segments={typeSegments} colors={palette.deep} />
              <PieChart title="Oxygen" segments={oxygenSegments} colors={['#38bdf8', '#7dd3fc', '#e0f2fe']} />
            </div>
          </section>
        )}
        {activeTab === 'Enter Dive' && (
          <section className="entry">
            <div className="entry-header">
              <div>
                <h2>Enter Dive</h2>
                <p className="muted">You log your {ordinal(nextDiveNumber)} dive.</p>
              </div>
              <div className={`status status-${saveStatus.state}`}>
                {saveStatus.message || 'Ready to save'}
              </div>
            </div>
            <form className="entry-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                {formFields.map((field) => (
                  <label className={`form-field ${field.type === 'textarea' ? 'full' : ''}`} key={field.name}>
                    <div className="field-label">
                      <span>{field.label}</span>
                      {exampleLookup[field.name] && exampleLookup[field.name].length > 0 && (
                        <div className="info">
                          <button type="button" className="info-button" aria-label={`${field.label} examples`}>
                            ?
                          </button>
                          <div className="info-popover">
                            <p>Examples</p>
                            <ul>
                              {exampleLookup[field.name].map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={3}
                        value={formValues[field.name] ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                      />
                    ) : (
                      <input
                        type={field.type}
                        step={field.step}
                        value={formValues[field.name] ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        readOnly={field.readOnly}
                        placeholder={field.placeholder}
                        name={field.name}
                        className={field.name === 'Dive time' ? 'no-spinner' : undefined}
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className="form-actions">
                <button type="submit" className="primary">
                  Save Dive
                </button>
              </div>
            </form>
          </section>
        )}
        {activeTab === 'Edit Dive' && (
          <section className="edit">
            <h2>Edit Dive</h2>
            <div className="filters">
              <label>
                <span>Location</span>
                <select value={filterCountry} onChange={(event) => setFilterCountry(event.target.value)}>
                  <option value="">All countries</option>
                  {countryOptions.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Start date</span>
                <input type="date" value={filterStart} onChange={(event) => setFilterStart(event.target.value)} />
              </label>
              <label>
                <span>End date</span>
                <input type="date" value={filterEnd} onChange={(event) => setFilterEnd(event.target.value)} />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {displayHeaders.map((header) => (
                      <th key={header}>
                        <button
                          type="button"
                          className="table-sort"
                          onClick={() => {
                            if (sortKey === header) {
                              setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortKey(header)
                              setSortDir('asc')
                            }
                          }}
                        >
                          {header}
                          {sortKey === header && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row._rowNumber}>
                      {displayHeaders.map((header) => (
                        <td key={`${row._rowNumber}-${header}`}>{row[header] ?? ''}</td>
                      ))}
                      <td>
                        <button type="button" className="table-action" onClick={() => beginEdit(row)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {editRow && (
              <section className="edit-form">
                <div className="entry-header">
                  <div>
                    <h3>Edit dive #{editRow['Dive #'] || editRow['Dive#'] || editRow['Dive Number'] || editRow._rowNumber}</h3>
                    <p className="muted">Update values and save.</p>
                  </div>
                  <div className={`status status-${editStatus.state}`}>
                    {editStatus.message || 'Ready to edit'}
                  </div>
                </div>
                <form className="entry-form" onSubmit={handleEditSubmit}>
                  <div className="form-grid">
                    {formFields.map((field) => (
                      <label className={`form-field ${field.type === 'textarea' ? 'full' : ''}`} key={field.name}>
                        <div className="field-label">
                          <span>{field.label}</span>
                        </div>
                        {field.type === 'textarea' ? (
                          <textarea
                            rows={3}
                            value={editValues[field.name] ?? ''}
                            onChange={(event) => handleEditChange(field.name, event.target.value)}
                          />
                        ) : (
                          <input
                            type={field.type}
                            step={field.step}
                            value={editValues[field.name] ?? ''}
                            onChange={(event) => handleEditChange(field.name, event.target.value)}
                            readOnly={field.readOnly}
                            placeholder={field.placeholder}
                            name={field.name}
                            className={field.name === 'Dive time' ? 'no-spinner' : undefined}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="primary">
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEditRow(null)
                        setEditValues({})
                        setEditStatus({ state: 'idle', message: '' })
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </section>
            )}
          </section>
        )}
      </main>
        </>
      )}
    </div>
  )
}

export default App
