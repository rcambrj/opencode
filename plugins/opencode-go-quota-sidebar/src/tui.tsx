/** @jsxImportSource @opentui/solid */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiSlotPlugin, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const AUTH_PATH = join(homedir(), ".local/share/opencode/opencode-go-auth.json")
const DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/"
const DASHBOARD_URL_SUFFIX = "/go"
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
const REQUEST_TIMEOUT_MS = 10_000
const REFRESH_INTERVAL_ACTIVE_MS = 60_000 * 2
const REFRESH_INTERVAL_INACTIVE_MS = 60_000 * 15
const MIN_REFRESH_INTERVAL_MS = Math.min(REFRESH_INTERVAL_ACTIVE_MS, REFRESH_INTERVAL_INACTIVE_MS)
const BAR_WIDTH = 30

type AuthConfig = {
  workspaceId: string
  authCookie: string
}

type ScrapedWindow = {
  usagePercent: number
  resetInSec: number
}

type QuotaWindow = {
  name: string
  remainingPercent: number
  resetIn: string
}

type QuotaState = {
  windows: QuotaWindow[]
  limitReached: boolean
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; quota: QuotaState; fetchedAt: number }
  | { status: "error"; message: string; fetchedAt: number }

const SCRAPED_NUMBER = String.raw`(-?\d+(?:\.\d+)?)`

function makeWindowRegex(field: string): [RegExp, RegExp] {
  const pctFirst = new RegExp(
    String.raw`${field}:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER}[^}]*resetInSec:${SCRAPED_NUMBER}[^}]*\}`,
  )
  const resetFirst = new RegExp(
    String.raw`${field}:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER}[^}]*usagePercent:${SCRAPED_NUMBER}[^}]*\}`,
  )
  return [pctFirst, resetFirst]
}

const RE_ROLLING = makeWindowRegex("rollingUsage")
const RE_WEEKLY = makeWindowRegex("weeklyUsage")
const RE_MONTHLY = makeWindowRegex("monthlyUsage")

function parseWindow(html: string, [pctFirst, resetFirst]: [RegExp, RegExp]): ScrapedWindow | null {
  const m1 = pctFirst.exec(html)
  if (m1 && Number.isFinite(Number(m1[1])) && Number.isFinite(Number(m1[2]))) {
    return { usagePercent: Number(m1[1]), resetInSec: Number(m1[2]) }
  }
  const m2 = resetFirst.exec(html)
  if (m2 && Number.isFinite(Number(m2[1])) && Number.isFinite(Number(m2[2]))) {
    return { usagePercent: Number(m2[2]), resetInSec: Number(m2[1]) }
  }
  return null
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  return parts.join(" ")
}

function progressBar(remainingPercent: number): string {
  const safePercent = Math.max(0, Math.min(100, remainingPercent))
  const filled = Math.round((safePercent / 100) * BAR_WIDTH)
  return `${"░".repeat(filled)}${" ".repeat(BAR_WIDTH - filled)}`
}

function formatFetchedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OpenCode Go quota request timed out")
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function loadOpenCodeGoQuota(): Promise<QuotaState> {
  let authData: AuthConfig
  try {
    const raw = await readFile(AUTH_PATH, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const workspaceId = typeof parsed.workspaceId === "string" ? parsed.workspaceId.trim() : ""
    const authCookie = typeof parsed.authCookie === "string" ? parsed.authCookie.trim() : ""
    if (!workspaceId || !authCookie) {
      throw new Error(`Missing ${!workspaceId ? "workspaceId" : "authCookie"} in ${AUTH_PATH}`)
    }
    authData = { workspaceId, authCookie }
  } catch (err) {
    throw new Error(`Failed to read auth config: ${err instanceof Error ? err.message : String(err)}`)
  }

  const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(authData.workspaceId)}${DASHBOARD_URL_SUFFIX}`
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
      Cookie: `auth=${authData.authCookie}`,
    },
  })

  if (!response.ok) {
    const text = await response.text().then((t) => t.slice(0, 120).replace(/\s+/g, " ").trim())
    throw new Error(`Dashboard request failed (${response.status}): ${text}`)
  }

  const html = await response.text()
  const rolling = parseWindow(html, RE_ROLLING)
  const weekly = parseWindow(html, RE_WEEKLY)
  const monthly = parseWindow(html, RE_MONTHLY)

  if (!rolling && !weekly && !monthly) {
    throw new Error("Could not parse usage data from dashboard. The auth cookie may have expired.")
  }

  const windows: QuotaWindow[] = []
  let limitReached = false

  if (rolling) {
    const remaining = Math.round(100 - Math.max(0, rolling.usagePercent))
    windows.push({ name: "5h Rolling", remainingPercent: remaining, resetIn: formatDuration(Math.max(0, rolling.resetInSec)) })
    if (rolling.usagePercent >= 100) limitReached = true
  }
  if (weekly) {
    const remaining = Math.round(100 - Math.max(0, weekly.usagePercent))
    windows.push({ name: "Weekly", remainingPercent: remaining, resetIn: formatDuration(Math.max(0, weekly.resetInSec)) })
    if (weekly.usagePercent >= 100) limitReached = true
  }
  if (monthly) {
    const remaining = Math.round(100 - Math.max(0, monthly.usagePercent))
    windows.push({ name: "Monthly", remainingPercent: remaining, resetIn: formatDuration(Math.max(0, monthly.resetInSec)) })
    if (monthly.usagePercent >= 100) limitReached = true
  }

  return { windows, limitReached }
}

const SINGLE_BORDER = { type: "single" } as const

let cachedState: LoadState | undefined
let inFlightRefresh: Promise<LoadState> | undefined
let lastRefreshAt = 0

function refreshShared(force = false): Promise<LoadState> {
  if (inFlightRefresh) return inFlightRefresh
  if (!force && cachedState && Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
    return Promise.resolve(cachedState)
  }

  lastRefreshAt = Date.now()
  inFlightRefresh = loadOpenCodeGoQuota()
    .then((quota): LoadState => ({ status: "ready", quota, fetchedAt: Date.now() }))
    .catch((err): LoadState => ({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      fetchedAt: Date.now(),
    }))
    .then((state) => {
      cachedState = state
      return state
    })
    .finally(() => {
      inFlightRefresh = undefined
    })

  return inFlightRefresh
}

const QuotaWindowView = (props: { theme: TuiThemeCurrent; window: QuotaWindow }) => (
  <box width="100%" flexDirection="column" marginTop={1}>
    <box width="100%" flexDirection="row" justifyContent="space-between">
      <text fg={props.theme.text}><b>{props.window.name}</b></text>
      <text fg={props.theme.textMuted}>resets in {props.window.resetIn}</text>
    </box>
    <box width="100%" flexDirection="row" justifyContent="space-between">
      <text fg={props.theme.text}>{progressBar(props.window.remainingPercent)}</text>
      <text fg={props.theme.text}>{props.window.remainingPercent}%</text>
    </box>
  </box>
)

const SidebarContent = (props: { api: TuiPluginApi; theme: TuiThemeCurrent }) => {
  const [state, setState] = createSignal<LoadState>(cachedState ?? { status: "loading" })
  let interval: ReturnType<typeof setInterval> | undefined

  const refresh = (force = false) => {
    void refreshShared(force)
      .then(setState)
      .finally(() => {
        try {
          props.api.renderer.requestRender()
        } catch {
          // Rendering may already be scheduled by the host.
        }
      })
  }

  const refreshThrottled = () => {
    refresh(false)
  }

  onMount(() => {
    refresh(!cachedState)
    interval = setInterval(refreshThrottled, REFRESH_INTERVAL_INACTIVE_MS)
  })

  const unsubs = [
    props.api.event.on("message.updated", refreshThrottled),
    props.api.event.on("session.updated", refreshThrottled),
    props.api.event.on("message.removed", refreshThrottled),
  ]

  onCleanup(() => {
    if (interval) clearInterval(interval)
    for (const unsub of unsubs) unsub()
  })

  const current = createMemo(() => state())

  return (
    <box
      width="100%"
      flexDirection="column"
      border={SINGLE_BORDER}
      borderColor={props.theme.borderActive}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.theme.text}>
        <b>OpenCode Go Quota</b>
      </text>

      {current().status === "loading" && (
        <box marginTop={1}>
          <text fg={props.theme.textMuted}>Loading OpenCode Go quota...</text>
        </box>
      )}

      {current().status === "error" && (
        <box marginTop={1}>
          <text fg={props.theme.error}>{current().message}</text>
        </box>
      )}

      {current().status === "ready" && (
        <box width="100%" flexDirection="column">
          {current().quota.windows.map((window) => (
            <QuotaWindowView theme={props.theme} window={window} />
          ))}

          {current().quota.limitReached && (
            <box marginTop={1}>
              <text fg={props.theme.warning}>Rate limit reached!</text>
            </box>
          )}
        </box>
      )}

      {current().status !== "loading" && (
        <box width="100%" marginTop={1} flexDirection="row" justifyContent="flex-end">
          <text fg={props.theme.textMuted}>Last fetched at {formatFetchedAt(current().fetchedAt)}</text>
        </box>
      )}
    </box>
  )
}

function createSidebarContentSlot(api: TuiPluginApi): TuiSlotPlugin {
  return {
    order: 160,
    slots: {
      sidebar_content: (ctx) => {
        const theme = createMemo(() => ctx.theme.current)
        return <SidebarContent api={api} theme={theme()} />
      },
    },
  }
}

const tui: TuiPlugin = async (api) => {
  api.slots.register(createSidebarContentSlot(api))
}

export default {
  id: "opencode-go-quota-sidebar",
  tui,
}
