import { fileURLToPath } from 'node:url'
import { join, basename, extname } from 'node:path'
import { existsSync, mkdirSync, readdirSync, lstatSync, createReadStream, readFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { spawn as spawnDetached } from 'node:child_process'

export const inject = ['subprocess']
const script = fileURLToPath(new URL('./flash-window.ps1', import.meta.url))

const requireFromProfile = createRequire(
  join(process.env.DSH_PROFILE_DIR ?? process.cwd(), 'package.json'),
)
const z = requireFromProfile('@deepseek-ai/schemastery')

export const DEFAULT_SOUND = 'ember'
export const DEFAULT_ATTENTION_SOUND = 'triple'
export const SAME_AS_COMPLETION = 'same'

/** Editable from the Plugins page; read again for every reminder. */
export const Config = z.object({
  sound: z.string().default(DEFAULT_SOUND).volatile(),
  attentionSound: z.string().default(DEFAULT_ATTENTION_SOUND).volatile(),
})

/** Built-in sounds understood by flash-window.ps1. */
export const SOUND_IDS = Object.freeze([
  'chime', 'bright', 'soft', 'triple', 'deep',
  'velvet', 'ember', 'resolve', 'system', 'none',
])

/** Prefix that marks a user-supplied audio file living in CUSTOM_DIR. */
export const CUSTOM_PREFIX = 'file:'
export const CUSTOM_DIR = fileURLToPath(new URL('./custom-sounds', import.meta.url))
export const AUDIO_EXTENSIONS = Object.freeze(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.wma'])
const MAX_CUSTOM_BYTES = 12 * 1024 * 1024
export const ROUTE = '/plugins/taskbar-flash'

/** Manifest version, so the settings card can show which build is loaded. */
export const VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version

const MIME = Object.freeze({
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
})

/** A user file name is a bare file with a supported audio extension. */
export function sanitizeFileName(name) {
  if (typeof name !== 'string') return ''
  const trimmed = name.trim()
  if (!trimmed || trimmed !== basename(trimmed) || trimmed.startsWith('.') || /[<>:"|?*\\/\x00-\x1f]/u.test(trimmed)) return ''
  if (!AUDIO_EXTENSIONS.includes(extname(trimmed).toLowerCase())) return ''
  return trimmed
}

export function normalizeSound(value, fallback = 'chime') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (SOUND_IDS.includes(trimmed)) return trimmed
  if (trimmed.toLowerCase().startsWith(CUSTOM_PREFIX)) {
    const name = sanitizeFileName(trimmed.slice(CUSTOM_PREFIX.length))
    if (name) return CUSTOM_PREFIX + name
  }
  return fallback
}

function soundFileInfo(file) {
  try {
    const info = lstatSync(file)
    return info.isFile() && info.size > 0 && info.size <= MAX_CUSTOM_BYTES ? info : null
  } catch { return null }
}

/** Files the user dropped into CUSTOM_DIR, filtered to playable audio. */
export function listCustomSounds(dir = CUSTOM_DIR) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const sounds = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = sanitizeFileName(entry.name)
    if (!name) continue
    const info = soundFileInfo(join(dir, name))
    if (info) sounds.push({ name, bytes: info.size })
  }
  return sounds.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/**
 * Turn a config value into what the native helper needs: a built-in key, or a
 * `custom` key plus the absolute file it should play. A missing or invalid file
 * falls back to the default chime instead of failing silently.
 */
export function resolvePlayback(value, dir = CUSTOM_DIR, fallback = 'chime') {
  const key = normalizeSound(value, fallback)
  if (!key.startsWith(CUSTOM_PREFIX)) return { sound: key }
  const name = key.slice(CUSTOM_PREFIX.length)
  const file = join(dir, name)
  if (!soundFileInfo(file)) return { sound: fallback, missing: name }
  return { sound: 'custom', file }
}

export function playbackForEvent(config, kind, dir = CUSTOM_DIR) {
  const complete = config?.sound?.get?.() ?? config?.sound
  const attention = config?.attentionSound?.get?.() ?? config?.attentionSound
  return kind === 'completed' || attention === SAME_AS_COMPLETION
    ? resolvePlayback(complete, dir, DEFAULT_SOUND)
    : resolvePlayback(attention, dir, DEFAULT_ATTENTION_SOUND)
}

/** Only a successfully completed top-level turn is a completion reminder. */
export function isCompletion(session, event) {
  return event?.type === 'turn/end' && event.data?.reason?.kind === 'completed'
    && session?.header?.origin !== 'subagent'
    && !(session?.header?.delegationDepth > 0)
}

/** Inject the native runner separately so event routing can be verified in isolation. */
export function registerReminders(ctx, flash) {
  // Session events are dispatched through a scoped carrier; a plain listener can be
  // filtered out. `global` keeps this observer above that routing.
  ctx.on('session/event', (session, event) => {
    if (isCompletion(session, event)) flash('completed', session.id)
  }, { global: true })
  // Observe without answering or changing the downstream waterfall.
  ctx.on('approval/request', (request, next) => {
    if (!request.signal?.aborted) flash('approval', request.agent?.id)
    return next()
  }, { prepend: true, global: true })
  ctx.on('user-questions/request', (request, next) => {
    if (!request.signal?.aborted) flash('question', request.agent?.id)
    return next()
  }, { prepend: true, global: true })
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.length),
  })
  res.end(body)
}

function sendAudio(req, res, file, info) {
  const size = info.size
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = typeof req.headers?.range === 'string' ? req.headers.range : ''
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : size - Number(match[2])
    let end = match[1] && match[2] ? Number(match[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(size - 1, end)
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
      'cache-control': 'no-store',
    })
    const stream = createReadStream(file, { start, end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }
  res.writeHead(200, {
    'content-type': type,
    'accept-ranges': 'bytes',
    'content-length': String(size),
    'cache-control': 'no-store',
  })
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

const MAX_TRIM_BYTES = 44 + 44100 * 4 * 15

function isTrimWav(body) {
  if (body.length < 46 || body.length > MAX_TRIM_BYTES) return false
  if (body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 16) !== 'WAVEfmt '
    || body.toString('ascii', 36, 40) !== 'data') return false
  const channels = body.readUInt16LE(22)
  const frameBytes = channels * 2
  const dataBytes = body.length - 44
  return body.readUInt32LE(4) === body.length - 8 && body.readUInt32LE(16) === 16
    && body.readUInt16LE(20) === 1 && (channels === 1 || channels === 2)
    && body.readUInt32LE(24) === 44100 && body.readUInt32LE(28) === 44100 * frameBytes
    && body.readUInt16LE(32) === frameBytes && body.readUInt16LE(34) === 16
    && body.readUInt32LE(40) === dataBytes && dataBytes % frameBytes === 0
    && dataBytes <= 44100 * frameBytes * 15
}

async function saveTrim(req, res, dir, title) {
  // The custom header makes cross-origin HTML form submissions ineligible.
  if (req.headers['x-dsh-sound-action'] !== 'save-trim'
    || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
    return sendJson(res, 403, { error: 'origin' })
  }
  if (req.headers['content-type'] !== 'audio/wav') return sendJson(res, 415, { error: 'type' })
  if (Number(req.headers['content-length']) > MAX_TRIM_BYTES) {
    req.resume()
    return sendJson(res, 413, { error: 'too-large' })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_TRIM_BYTES) {
      req.resume()
      return sendJson(res, 413, { error: 'too-large' })
    }
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks, size)
  if (!isTrimWav(body)) return sendJson(res, 400, { error: 'invalid-wav' })
  const cleanTitle = (title ?? '').replace(/[^\p{L}\p{N}\p{M} _()-]/gu, ' ').trim().slice(0, 52).trim()
  const name = `${cleanTitle || 'Clip'}-${randomUUID().slice(0, 8)}.wav`
  mkdirSync(dir, { recursive: true })
  const temporary = join(dir, `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, body, { flag: 'wx' })
    await rename(temporary, join(dir, name))
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return sendJson(res, 201, { name, bytes: body.length })
}

/** The first free `<stem>[-n].<ext>` name in the folder, so an upload never overwrites a clip. */
function freeFileName(dir, name) {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = name
  for (let n = 2; existsSync(join(dir, candidate)); n += 1) candidate = `${stem}-${n}${ext}`
  return candidate
}

async function saveUpload(req, res, dir, name) {
  // Same cross-origin guard as the trim export: a foreign page cannot post here.
  if (req.headers['x-dsh-sound-action'] !== 'add-sound'
    || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
    return sendJson(res, 403, { error: 'origin' })
  }
  const clean = sanitizeFileName(name)
  if (!clean) return sendJson(res, 400, { error: 'invalid-name' })
  if (Number(req.headers['content-length']) > MAX_CUSTOM_BYTES) {
    req.resume()
    return sendJson(res, 413, { error: 'too-large' })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_CUSTOM_BYTES) {
      req.resume()
      return sendJson(res, 413, { error: 'too-large' })
    }
    chunks.push(chunk)
  }
  if (size === 0) return sendJson(res, 400, { error: 'empty' })
  const body = Buffer.concat(chunks, size)
  mkdirSync(dir, { recursive: true })
  const saved = freeFileName(dir, clean)
  const temporary = join(dir, `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, body, { flag: 'wx' })
    await rename(temporary, join(dir, saved))
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return sendJson(res, 201, { name: saved, bytes: body.length })
}

/** Browser-facing route for the custom sound library. */
export function createHandler(dir = CUSTOM_DIR) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const rest = url.pathname.startsWith(ROUTE) ? url.pathname.slice(ROUTE.length) : url.pathname
      const method = (req.method ?? 'GET').toUpperCase()

      if (rest === '/sounds' && method === 'GET') {
        sendJson(res, 200, { dir, version: VERSION, sounds: listCustomSounds(dir) })
        return
      }
      if (rest.startsWith('/sound/') && method === 'GET') {
        const name = sanitizeFileName(decodeURIComponent(rest.slice('/sound/'.length)))
        const file = name ? join(dir, name) : ''
        const info = file && soundFileInfo(file)
        if (!info) {
          sendJson(res, 404, { ok: false, error: 'not-found' })
          return
        }
        sendAudio(req, res, file, info)
        return
      }
      if (rest === '/trim' && method === 'POST') {
        await saveTrim(req, res, dir, url.searchParams.get('title'))
        return
      }
      if (rest === '/add' && method === 'POST') {
        await saveUpload(req, res, dir, url.searchParams.get('name'))
        return
      }
      if (rest === '/open-folder' && method === 'POST') {
        if (req.headers['x-dsh-sound-action'] !== 'open-folder'
          || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          return sendJson(res, 403, { error: 'origin' })
        }
        try {
          mkdirSync(dir, { recursive: true })
          const child = spawnDetached('explorer.exe', [dir], { detached: true, stdio: 'ignore' })
          await new Promise((resolve, reject) => {
            child.once('spawn', resolve)
            child.once('error', reject)
          })
          child.unref()
          sendJson(res, 200, { ok: true, dir })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
        return
      }
      sendJson(res, 404, { ok: false, error: 'not-found' })
    } catch (error) {
      try {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      } catch { /* connection already gone */ }
    }
  }
}

export function apply(ctx, config) {
  if (process.platform !== 'win32') return
  try {
    mkdirSync(CUSTOM_DIR, { recursive: true })
  } catch (error) {
    console.warn('[taskbar-flash] Cannot create the custom sound folder:', error.message)
  }
  // The settings page lists and previews custom files through this route. It is
  // optional: the reminder itself keeps working without a web server.
  const webServer = ctx.get?.('webServer') ?? ctx.webServer
  if (webServer?.register) {
    const handler = createHandler()
    ctx.effect(
      () => webServer.register({ kind: 'prefix', path: ROUTE, handler }),
      'taskbar-flash: sound catalogue route',
    )
  }
  // DSH's subprocess sandbox rejects Windows PowerShell 5.1 (`powershell.exe`)
  // with EPERM; PowerShell 7 (`pwsh.exe`) is allowed. Prefer it, keep 5.1 only
  // as a fallback for hosts that have no pwsh.
  const pwsh = join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  const legacy = join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const powershell = existsSync(pwsh) ? pwsh : legacy
  if (!existsSync(powershell)) throw new Error('PowerShell is required for taskbar flashing.')
  if (powershell === legacy)
    console.warn('[taskbar-flash] PowerShell 7 not found; Windows PowerShell 5.1 may be blocked by the DSH sandbox (spawn EPERM).')
  const active = new Set()
  let disposed = false
  const pending = new Set()
  let timer
  let lastAttempt = 0
  const run = () => {
    timer = undefined
    if (disposed || active.size || !pending.size) return
    const kind = pending.has('attention') ? 'attention' : 'completed'
    pending.delete(kind)
    lastAttempt = Date.now()
    try {
      const playback = playbackForEvent(config, kind)
      if (playback.missing)
        console.warn('[taskbar-flash] Custom reminder sound is missing:', playback.missing)
      const argv = [powershell, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass', '-File', script, '-HostPid', String(process.pid),
        '-Sound', playback.sound]
      if (playback.file) argv.push('-SoundFile', playback.file)
      const handle = ctx.subprocess.spawn({
        argv,
        cwd: tmpdir(),
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 1000,
      })
      active.add(handle)
      handle.done.then((outcome) => {
        if (!disposed && outcome.exitCode !== 0)
          console.warn('[taskbar-flash] Native reminder exited:', outcome.exitCode)
      }, (error) => {
        if (!disposed) console.warn('[taskbar-flash] Native reminder failed:', error.message)
      }).finally(() => {
        active.delete(handle)
        if (pending.size && !disposed) schedule()
      })
    } catch (error) {
      console.warn('[taskbar-flash] Cannot start native reminder:', error.message)
      if (pending.size && !disposed) schedule()
    }
  }
  // Coalesce bursts; preserve a trailing reminder if an event arrives during startup.
  const schedule = () => {
    if (disposed || timer || active.size) return
    timer = setTimeout(run, Math.max(0, 750 - (Date.now() - lastAttempt)))
    timer.unref?.()
  }
  registerReminders(ctx, (kind) => {
    pending.add(kind === 'completed' ? 'completed' : 'attention')
    schedule()
  })
  ctx.on('dispose', () => {
    disposed = true
    clearTimeout(timer)
    for (const handle of active) handle.terminate()
    active.clear()
  })
}
