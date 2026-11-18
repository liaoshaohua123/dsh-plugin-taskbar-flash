import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

// Same profile discovery as reminders.test.mjs: index.js resolves schemastery
// from the running DSH profile.
if (!process.env.DSH_PROFILE_DIR) {
  for (const name of ['desktop', 'web', 'headless']) {
    const dir = join(homedir(), '.dsh', 'profiles', name)
    if (existsSync(join(dir, 'package.json'))) {
      process.env.DSH_PROFILE_DIR = dir
      break
    }
  }
}
const {
  CUSTOM_PREFIX,
  ROUTE,
  createHandler,
  listCustomSounds,
  normalizeSound,
  resolvePlayback,
  sanitizeFileName,
} = await import('../index.js')

function tempSoundDir() {
  const dir = mkdtempSync(join(tmpdir(), 'taskbar-flash-'))
  writeFileSync(join(dir, 'mine.wav'), Buffer.alloc(2048, 1))
  writeFileSync(join(dir, 'voice.mp3'), Buffer.alloc(1024, 2))
  writeFileSync(join(dir, 'notes.txt'), 'not audio')
  writeFileSync(join(dir, 'empty.wav'), '')
  writeFileSync(join(dir, '.hidden.wav'), Buffer.alloc(64, 3))
  mkdirSync(join(dir, 'nested.wav'))
  return dir
}

test('only bare audio file names are accepted as custom sounds', () => {
  for (const name of ['mine.wav', 'voice.mp3', 'A B.m4a', 'x.ogg', 'y.flac', 'z.wma'])
    assert.equal(sanitizeFileName(name), name)
  for (const name of ['notes.txt', 'empty.wav.bak', '../escape.wav', 'dir/x.wav', 'C:\\x.wav',
    '.hidden.wav', '', '  ', 'noext', undefined, null, 42])
    assert.equal(sanitizeFileName(name), '')
  assert.equal(normalizeSound('file:mine.wav'), `file:mine.wav`)
  assert.equal(normalizeSound('FILE:mine.wav'), `file:mine.wav`)
  // A path traversal attempt degrades to the safe default instead of reading outside the folder.
  assert.equal(normalizeSound('file:../../secret.wav'), 'chime')
  assert.equal(normalizeSound('file:notes.txt'), 'chime')
})

test('the listing skips non-audio, hidden, empty and directory entries', () => {
  const dir = tempSoundDir()
  try {
    assert.deepEqual(listCustomSounds(dir).map((sound) => sound.name).sort(),
      ['mine.wav', 'voice.mp3'])
    assert.deepEqual(listCustomSounds(join(dir, 'missing')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('playback falls back to the chime when a stored custom file disappears', () => {
  const dir = tempSoundDir()
  try {
    assert.deepEqual(resolvePlayback('file:mine.wav', dir),
      { sound: 'custom', file: join(dir, 'mine.wav') })
    assert.deepEqual(resolvePlayback('file:gone.wav', dir),
      { sound: 'chime', missing: 'gone.wav' })
    assert.deepEqual(resolvePlayback('velvet', dir), { sound: 'velvet' })
    assert.deepEqual(resolvePlayback('file:../escape.wav', dir), { sound: 'chime' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the browser route lists and streams custom sounds, and refuses escapes', async () => {
  const dir = tempSoundDir()
  const server = createServer(createHandler(dir))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${ROUTE}`
  try {
    const listing = await fetch(`${base}/sounds`).then((response) => response.json())
    assert.equal(listing.dir, dir)
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(listing.version, manifest.version)
    assert.match(listing.version, /^\d+\.\d+\.\d+$/)
    assert.deepEqual(listing.sounds.map((sound) => sound.name).sort(),
      ['mine.wav', 'voice.mp3'])

    const audio = await fetch(`${base}/sound/mine.wav`)
    assert.equal(audio.status, 200)
    assert.equal(audio.headers.get('content-type'), 'audio/wav')
    assert.equal((await audio.arrayBuffer()).byteLength, 2048)

    const ranged = await fetch(`${base}/sound/voice.mp3`, { headers: { range: 'bytes=0-99' } })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.headers.get('content-range'), 'bytes 0-99/1024')
    assert.equal((await ranged.arrayBuffer()).byteLength, 100)

    for (const bad of ['notes.txt', 'missing.wav', '..%2F..%2Fsecret.wav'])
      assert.equal((await fetch(`${base}/sound/${bad}`)).status, 404)
    assert.equal((await fetch(`${base}/nope`)).status, 404)

    // Minimal canonical 44.1 kHz PCM export, using the same WAV layout as the studio.
    const wav = Buffer.alloc(48)
    wav.write('RIFF'); wav.writeUInt32LE(40, 4)
    wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
    wav.write('data', 36); wav.writeUInt32LE(4, 40)
    wav.writeInt16LE(1203, 44); wav.writeInt16LE(-2455, 46)
    const trimUrl = `${base}/trim?${new URLSearchParams({ title: '完成提示' })}`
    const headers = { 'content-type': 'audio/wav', 'x-dsh-sound-action': 'save-trim', 'sec-fetch-site': 'same-origin' }
    const save = async () => {
      const response = await fetch(trimUrl, { method: 'POST', headers, body: wav })
      assert.equal(response.status, 201)
      return response.json()
    }
    const a = await save()
    const b = await save()
    assert.match(a.name, /^完成提示-[a-f0-9]{8}\.wav$/)
    assert.notEqual(a.name, b.name)
    assert.ok(listCustomSounds(dir).some(({ name }) => name === a.name))
    const trimmed = await fetch(`${base}/sound/${encodeURIComponent(a.name)}`)
    assert.deepEqual(Buffer.from(await trimmed.arrayBuffer()), wav)
    assert.deepEqual(resolvePlayback(`file:${a.name}`, dir), { sound: 'custom', file: join(dir, a.name) })

    const post = (body, overrides = {}) => fetch(trimUrl, { method: 'POST', headers: { ...headers, ...overrides }, body })
    assert.equal((await post(wav, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await post(wav, { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post(Buffer.alloc(46))).status, 400)
    assert.equal((await post(Buffer.alloc(44 + 44100 * 4 * 15 + 4))).status, 413)

    // The Add sound button posts the picked file and never overwrites an existing clip.
    const upload = (name, body, overrides = {}) => fetch(`${base}/add?${new URLSearchParams({ name })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-dsh-sound-action': 'add-sound', 'sec-fetch-site': 'same-origin', ...overrides },
      body,
    })
    const clip = Buffer.alloc(4096, 7)
    const first = await upload('mine.wav', clip)
    assert.equal(first.status, 201)
    assert.equal((await first.json()).name, 'mine-2.wav')
    assert.deepEqual(readFileSync(join(dir, 'mine-2.wav')), clip)
    const second = await upload('mine.wav', clip)
    assert.equal((await second.json()).name, 'mine-3.wav')
    assert.equal((await upload('notes.txt', clip)).status, 400)
    assert.equal((await upload('../escape.wav', clip)).status, 400)
    assert.equal((await upload('mine.wav', Buffer.alloc(0))).status, 400)
    assert.equal((await upload('mine.wav', Buffer.alloc(13 * 1024 * 1024))).status, 413)
    assert.equal((await upload('mine.wav', clip, { 'x-dsh-sound-action': 'open-folder' })).status, 403)
    assert.equal((await upload('mine.wav', clip, { 'sec-fetch-site': 'cross-site' })).status, 403)
    const listed = await fetch(`${base}/sounds`).then((response) => response.json())
    assert.ok(listed.sounds.some(({ name }) => name === 'mine-3.wav'))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
