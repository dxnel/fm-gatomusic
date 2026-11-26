import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as renderer from 'vue/server-renderer'
import * as platforms from '../src/lib/platforms.js'
import * as dates from '../src/lib/releaseDate.js'
import * as studio from '../src/lib/studio.js'
import * as lucide from '@lucide/vue'

const spotify = 'https://open.spotify.com/track/first'
const apple = 'https://music.apple.com/album/second'

test('duplicate receives a unique URL and clears release-specific identifiers without changing the original', () => {
  const source = { id: 'artist-song', title: 'Song', artist: 'Artist', isrc: 'CH1234567890', release_date: '2026-12-01', spotify_url: spotify }
  const original = { ...source }
  const copy = studio.makeReleaseCopy(source, [source, { id: 'artist-song-copy' }, { id: 'artist-song-copy-2' }])
  assert.equal(copy.id, 'artist-song-copy-3')
  assert.equal(copy.title, 'Song (copy)')
  assert.equal(copy.isrc, '')
  assert.equal(copy.release_date, '')
  assert.equal(copy.spotify_url, spotify)
  assert.deepEqual(source, original)
})

test('bulk import keeps existing links unless replacement is explicitly enabled', () => {
  const links = { spotify_url: spotify }
  const pasted = `https://open.spotify.com/track/new\n${apple}\nhttps://unknown.example/song`
  const result = studio.planLinkImport(pasted, links)
  assert.equal(result.skipped, 1)
  assert.deepEqual(result.values, { apple_url: apple })
  assert.deepEqual(result.unknown, ['https://unknown.example/song'])
  assert.equal(studio.planLinkImport(pasted, links, true).values.spotify_url, 'https://open.spotify.com/track/new')
  assert.deepEqual(links, { spotify_url: spotify })
})

test('bulk undo restores removed links while preserving subsequent manual edits', () => {
  const original = { spotify_url: spotify, apple_url: apple }
  const patch = studio.linkPatch(original, { spotify_url: '', apple_url: '' })
  assert.equal(patch.length, 2)
  assert.deepEqual(studio.undoLinkPatch({ spotify_url: '', apple_url: '' }, patch), original)
  assert.deepEqual(studio.undoLinkPatch({ spotify_url: 'https://open.spotify.com/track/manual', apple_url: '' }, patch), { apple_url: apple })
  assert.deepEqual(studio.linkPatch(original, original), [])
})

const dependencies = {
  vue: Vue,
  '@lucide/vue': lucide,
  'vue/server-renderer': renderer,
  '../supabase': { supabase: {} },
  '../lib/platforms': platforms,
  '../lib/releaseDate': dates,
  '../lib/studio': studio,
  '../lib/scan': { detectInput: () => null, runScan: () => {}, cleanIsrc: x => x },
  '../lib/palette': { loadPalette: () => {} },
  '../composables/useSystemChrome': { useSystemChrome: () => ({ set() {} }) },
  '../assets/gato_logo.png': { default: '/logo.png' }
}
function compileComponent(source, inlineTemplate = true) {
  const { descriptor } = parse(source)
  let code = compileScript(descriptor, { id: 'studio-test', inlineTemplate, templateOptions: { ssr: true } }).content
  code = code.replace(/^import ['"].*\.css['"];?$/gm, '')
  code = code.replace(/^import (.+) from ['"](.+)['"];?$/gm, (_, bindings, path) => {
    assert.ok(dependencies[path], `Missing fixture dependency: ${path}`)
    return bindings.startsWith('{') ? `const ${bindings.replace(/ as /g, ': ')} = deps[${JSON.stringify(path)}]` : `const ${bindings} = deps[${JSON.stringify(path)}].default`
  }).replace('export default', 'return')
  return new Function('deps', code)(dependencies)
}
const actionsComponent = compileComponent(readFileSync(new URL('../src/components/StudioActions.vue', import.meta.url), 'utf8'))
dependencies['../components/StudioActions.vue'] = { default: actionsComponent }
const linksComponent = compileComponent(readFileSync(new URL('../src/components/StudioLinks.vue', import.meta.url), 'utf8'))
dependencies['../components/StudioLinks.vue'] = { default: linksComponent }
const adminSource = readFileSync(new URL('../src/views/Admin.vue', import.meta.url), 'utf8')
const fixture = { id: 'test-song', title: 'Test song', artist: 'Artist', tracklist: null, release_date: '2026-12-01', spotify_url: spotify }

test('dashboard has hover shortcuts and one more trigger per release, with menu commands hidden', async () => {
  const source = adminSource.replace('const user = ref(null)', 'const user = ref({ id: "test" })').replace('const isLoading = ref(true)', 'const isLoading = ref(false)').replace('const releases = ref([])', `const releases = ref(${JSON.stringify([fixture])})`)
  const html = await renderer.renderToString(Vue.createSSRApp(compileComponent(source)))
  assert.equal((html.match(/class="action-trigger more-trigger"/g) || []).length, 1)
  assert.ok(html.includes('aria-label="Copy release link"'))
  assert.ok(html.includes('aria-label="Open release page"'))
  assert.ok(html.includes('aria-label="Log out"'))
  assert.ok(html.includes('Switch to light theme'))
  assert.ok(!html.includes('Delete release'))
  assert.ok(!html.includes('action-list'))
})

for (const tab of ['release', 'links', 'appearance']) {
  test(`${tab} renders with nullable metadata and only mounts its active section`, async () => {
    const source = adminSource.replace('const user = ref(null)', 'const user = ref({ id: "test" })').replace('const isLoading = ref(true)', 'const isLoading = ref(false)').replace('const showEditor = ref(false)', 'const showEditor = ref(true)').replace("const editorTab = ref('release')", `const editorTab = ref('${tab}')`).replace('const current = ref(emptyRelease())', `const current = ref({ ...emptyRelease(), ...${JSON.stringify(fixture)} })`)
    const html = await renderer.renderToString(Vue.createSSRApp(compileComponent(source)))
    assert.ok(html.includes(`aria-labelledby="editor-tab-${tab}"`))
    assert.equal(html.includes('class="link-workspace"'), tab === 'links')
    assert.equal(html.includes('id="release-title"'), tab === 'release')
    assert.equal(html.includes('id="cover-blur"'), tab === 'appearance')
    if (tab === 'links') {
      assert.ok(html.includes('Find a platform'))
      assert.ok(!html.includes('Remove all'))
      assert.ok(!html.includes('Copy all'))
    }
  })
}

async function adminStateWithDatabase(database) {
  dependencies['../supabase'] = { supabase: database }
  const component = compileComponent(adminSource, false)
  let state
  await renderer.renderToString(Vue.createSSRApp({ setup() {
    state = component.setup({}, { expose() {} })
    return () => Vue.h('div')
  } }))
  return state
}

test('cancelling release deletion makes no database calls', async () => {
  const state = await adminStateWithDatabase({ from() { assert.fail('Deletion was cancelled') } })
  const operation = state.deleteRelease(fixture)
  assert.equal(state.confirmState.value.confirmLabel, 'Delete release')
  state.answerConfirm(false)
  await operation
  assert.equal(state.deletingId.value, null)
})

test('a failed link deletion keeps the parent release and resets the busy state', async () => {
  const state = await adminStateWithDatabase({ from(table) {
    assert.equal(table, 'links', 'Parent must not be deleted after a link error')
    return {
      select() { return { eq() { return { maybeSingle: async () => ({ data: { release_id: fixture.id, spotify_url: spotify } }) } } } },
      delete() { return { eq: async () => ({ error: new Error('Offline') }) } }
    }
  } })
  state.releases.value = [fixture]
  const operation = state.deleteRelease(fixture)
  state.answerConfirm(true)
  await operation
  assert.equal(state.releases.value.length, 1)
  assert.equal(state.deletingId.value, null)
  assert.equal(state.toast.value.type, 'error')
})

test('a failed parent deletion restores the backed-up links', async () => {
  const backup = { release_id: fixture.id, spotify_url: spotify }
  let restored = null
  const state = await adminStateWithDatabase({ from(table) {
    return table === 'links' ? {
      select() { return { eq() { return { maybeSingle: async () => ({ data: backup }) } } } },
      delete() { return { eq: async () => ({ error: null }) } },
      async upsert(row) { restored = row; return { error: null } }
    } : {
      delete() { return { eq() { return { select: async () => ({ error: new Error('Cannot delete') }) } } } }
    }
  } })
  state.releases.value = [fixture]
  const operation = state.deleteRelease(fixture)
  state.answerConfirm(true)
  await operation
  assert.deepEqual(restored, backup)
  assert.equal(state.releases.value.length, 1)
  assert.equal(state.deletingId.value, null)
})


test('manage-links shortcut opens the Links section and keeps nullable fields safe', async () => {
  const state = await adminStateWithDatabase({ from() {
    return { select() { return { eq() { return { order: async () => ({ data: [] }) } } } } }
  } })
  state.openEditor(fixture, 'links')
  assert.equal(state.editorTab.value, 'links')
  assert.equal(state.current.value.tracklist, '')
  assert.equal(state.showEditor.value, true)
  assert.equal(state.isDirty.value, false)
  await Vue.nextTick()
})
