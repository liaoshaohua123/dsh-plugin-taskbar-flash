import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// index.js resolves schemastery from the running DSH profile. The host sets
// DSH_PROFILE_DIR; a bare `node --test` falls back to the first installed
// profile so the module can still be imported.
if (!process.env.DSH_PROFILE_DIR) {
  for (const name of ['desktop', 'web', 'headless']) {
    const dir = join(homedir(), '.dsh', 'profiles', name)
    if (existsSync(join(dir, 'package.json'))) {
      process.env.DSH_PROFILE_DIR = dir
      break
    }
  }
}
const { Config, SOUND_IDS, isCompletion, normalizeSound, registerReminders } = await import('../index.js')

const root = { id: 'root', header: {} }
const ended = { type: 'turn/end', data: { reason: { kind: 'completed' } } }

test('completion reflects durable successful root turns, not cancellation, replay, or child work', () => {
  assert.equal(isCompletion(root, ended), true)
  for (const kind of ['aborted', 'error', 'blocked', 'interrupted', 'forked']) {
    assert.equal(isCompletion(root, { ...ended, data: { reason: { kind } } }), false)
  }
  assert.equal(isCompletion(root, { type: 'assistant/message', data: {} }), false)
  assert.equal(isCompletion({ header: { origin: 'subagent' } }, ended), false)
  assert.equal(isCompletion({ header: { delegationDepth: 1 } }, ended), false)
  assert.equal(isCompletion({ header: { parentSession: 'fork-parent' } }, ended), true)
})

test('question and approval observers preserve downstream outcomes and ignore aborted requests', async () => {
  const handlers = new Map()
  const alerts = []
  registerReminders({ on(name, callback, prepend) { handlers.set(name, { callback, prepend }) } },
    (...args) => alerts.push(args))
  handlers.get('session/event').callback(root, ended)
  assert.deepEqual(alerts.shift(), ['completed', 'root'])
  assert.deepEqual(handlers.get('session/event').prepend, { global: true })
  for (const [event, kind, answer] of [
    ['approval/request', 'approval', 'allowed-once'],
    ['user-questions/request', 'question', { answers: [{ id: 'q1', selected: ['yes'] }] }],
  ]) {
    const { callback, prepend } = handlers.get(event)
    assert.deepEqual(prepend, { prepend: true, global: true })
    let called = 0
    const downstream = Promise.resolve(answer)
    const returned = callback({ agent: { id: 'child-or-root' } }, () => { called++; return downstream })
    assert.equal(returned, downstream)
    assert.equal(await returned, answer)
    assert.equal(called, 1)
    assert.deepEqual(alerts.shift(), [kind, 'child-or-root'])
    await callback({ signal: AbortSignal.abort() }, () => Promise.resolve(answer))
    assert.equal(alerts.length, 0)
    const failure = new Error('downstream failed')
    await assert.rejects(callback({}, () => Promise.reject(failure)), (error) => error === failure)
    alerts.length = 0
  }
})

test('sound choice is normalized to a supported built-in', () => {
  assert.deepEqual([...SOUND_IDS],
    ['chime', 'bright', 'soft', 'triple', 'deep', 'velvet', 'ember', 'resolve', 'system', 'none'])
  for (const id of SOUND_IDS) assert.equal(normalizeSound(id), id)
  for (const value of ['', 'CHIME', 'alert', undefined, null, 3, {}]) {
    assert.equal(normalizeSound(value), 'chime')
  }
  assert.equal(Config({}).sound.get(), 'ember')
  assert.equal(Config({}).attentionSound.get(), 'triple')
  assert.equal(Config({ sound: 'deep' }).sound.get(), 'deep')
})

test('completion, approval and questions use the intended configurable sounds', async () => {
  const { playbackForEvent } = await import('../index.js')
  assert.deepEqual(playbackForEvent(Config({}), 'completed'), { sound: 'ember' })
  assert.deepEqual(playbackForEvent(Config({}), 'approval'), { sound: 'triple' })
  assert.deepEqual(playbackForEvent(Config({}), 'question'), { sound: 'triple' })
  assert.deepEqual(playbackForEvent(Config({ sound: 'deep', attentionSound: 'same' }), 'approval'), { sound: 'deep' })
  assert.deepEqual(playbackForEvent(Config({ sound: 'bright', attentionSound: 'none' }), 'question'), { sound: 'none' })
})
