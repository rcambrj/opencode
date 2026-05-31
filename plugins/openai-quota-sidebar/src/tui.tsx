/** @jsxImportSource @opentui/solid */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiSlotPlugin, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const AUTH_PATH = join(homedir(), ".local/share/opencode/auth.json")
const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const REQUEST_TIMEOUT_MS = 10_000
const REFRESH_INTERVAL_ACTIVE_MS = 60_000 * 2
const REFRESH_INTERVAL_INACTIVE_MS = 60_000 * 15
const MIN_REFRESH_INTERVAL_MS = Math.min(REFRESH_INTERVAL_ACTIVE_MS, REFRESH_INTERVAL_INACTIVE_MS)
const BAR_WIDTH = 30

type OpenAIAuthData = {
  type?: string
  access?: string
  expires?: number
}

type AuthData = {
  openai?: OpenAIAuthData
}

type RateLimitWindow = {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
}

type OpenAIUsageResponse = {
  plan_type: string
  rate_limit: {
    limit_reached: boolean
    primary_window: RateLimitWindow
    secondary_window: RateLimitWindow | null
  } | null
}

type QuotaWindow = {
  name: string
  remainingPercent: number
  resetIn: string
}

type QuotaState = {
  plan: string
  windows: QuotaWindow[]
  limitReached: boolean
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; quota: QuotaState; fetchedAt: number }
  | { status: "error"; message: string; fetchedAt: number }

type JwtPayload = {
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const padLen = (4 - (base64.length % 4)) % 4
  return Buffer.from(base64 + "=".repeat(padLen), "base64").toString("utf8")
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload
  } catch {
    return null
  }
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

function formatWindowName(seconds: number): string {
  const days = Math.round(seconds / 86_400)
  if (days >= 1) return `${days}-day limit`
  return `${Math.round(seconds / 3_600)}-hour limit`
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
      throw new Error("OpenAI quota request timed out")
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function loadOpenAIQuota(): Promise<QuotaState> {
  let authData: AuthData

  try {
    authData = JSON.parse(await readFile(AUTH_PATH, "utf8")) as AuthData
  } catch (err) {
    throw new Error(`Failed to read OpenAI auth: ${err instanceof Error ? err.message : String(err)}`)
  }

  const auth = authData.openai
  if (!auth || auth.type !== "oauth" || !auth.access) {
    throw new Error("OpenAI OAuth account is not configured")
  }

  if (auth.expires && auth.expires < Date.now()) {
    throw new Error("OpenAI OAuth token expired. Use an OpenAI model once to refresh it.")
  }

  const jwt = parseJwt(auth.access)
  const accountId = jwt?.["https://api.openai.com/auth"]?.chatgpt_account_id
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.access}`,
    "User-Agent": "OpenCode-OpenAI-Quota-Sidebar/1.0",
  }

  if (accountId) headers["ChatGPT-Account-Id"] = accountId

  const response = await fetchWithTimeout(OPENAI_USAGE_URL, { headers })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI quota request failed (${response.status}): ${text}`)
  }

  const usage = (await response.json()) as OpenAIUsageResponse
  const windows = [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window].flatMap((window) => {
    if (!window) return []
    const remainingPercent = Math.round(100 - window.used_percent)
    return [{
      name: formatWindowName(window.limit_window_seconds),
      remainingPercent,
      resetIn: formatDuration(window.reset_after_seconds),
    }]
  })

  return {
    plan: usage.plan_type,
    windows,
    limitReached: usage.rate_limit?.limit_reached ?? false,
  }
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
  inFlightRefresh = loadOpenAIQuota()
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
        <b>OpenAI Account Quota{current().status === "ready" ? ` (${current().quota.plan})` : ""}</b>
      </text>

      {current().status === "loading" && (
        <box marginTop={1}>
          <text fg={props.theme.textMuted}>Loading OpenAI quota...</text>
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
    order: 150,
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
  id: "openai-quota-sidebar",
  tui,
}
