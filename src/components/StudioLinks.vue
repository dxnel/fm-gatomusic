<script setup>
import { ref, computed, nextTick } from 'vue'
import { Plus, ExternalLink, Search, X, Copy, Trash2, Undo2, Check, ListChecks } from '@lucide/vue'
import { PLATFORMS, PRESAVE, SOCIALS, LINK_COLUMNS, platformFromUrl, platformById, searchUrl, followInfo, normalizeUrl } from '../lib/platforms'
import { planLinkImport, linkPatch, undoLinkPatch } from '../lib/studio'

const props = defineProps({
  links: { type: Object, required: true },
  reviewSet: { type: Set, required: true },
  busy: Boolean,
  searchQuery: { type: String, default: '' },
  confirmAction: { type: Function, required: true }
})
const emit = defineEmits(['change', 'review', 'notify', 'copy'])
const groups = [
  { id: 'streaming', label: 'Streaming', items: PLATFORMS },
  { id: 'presave', label: 'Pre-save & pre-order', hint: 'Shown before release day.', items: PRESAVE },
  { id: 'profiles', label: 'Artist & social profiles', items: [{ id: 'artist', column: 'artist_url', label: 'Artist profile' }, ...SOCIALS] }
]
const workspace = ref(null)
const query = ref('')
const view = ref(LINK_COLUMNS.some((column) => props.links[column]?.trim()) ? 'added' : 'all')
const selecting = ref(false)
const selected = ref(new Set())
const pasteText = ref('')
const replaceExisting = ref(false)
const history = ref([])
const pending = ref(false)
const locked = computed(() => props.busy || pending.value)
const filled = computed(() => LINK_COLUMNS.filter((column) => props.links[column]?.trim()))
const visibleGroups = computed(() => groups.map((group) => ({
  ...group,
  items: group.items.filter((item) => (!query.value.trim() || `${item.label} ${group.label}`.toLowerCase().includes(query.value.trim().toLowerCase()))
    && (view.value !== 'added' || props.links[item.column]?.trim()))
})).filter((group) => group.items.length))
const visibleFilled = computed(() => visibleGroups.value.flatMap((group) => group.items).filter((item) => props.links[item.column]?.trim()).map((item) => item.column))
const allSelected = computed(() => visibleFilled.value.length > 0 && visibleFilled.value.every((column) => selected.value.has(column)))
const selectedCount = computed(() => [...selected.value].filter((column) => props.links[column]?.trim()).length)

const issue = (item, group) => {
  if (props.reviewSet.has(item.column)) return 'Verify match'
  if (group === 'streaming' && props.links[item.column]) {
    const detected = platformFromUrl(props.links[item.column])
    if (detected && detected !== item.id) return `Looks like ${platformById(detected)?.label || detected}`
  }
  if (item.column === 'artist_url' && followInfo(props.links.artist_url)?.looksWrong) return 'Check artist profile'
  return ''
}
const change = (column, value) => {
  emit('change', column, value)
  emit('review', column)
}
const apply = (values, label) => {
  const patch = linkPatch(props.links, values)
  if (!patch.length) return 0
  history.value.push({ patch, label, review: patch.filter(({ column }) => props.reviewSet.has(column)).map(({ column }) => column) })
  if (history.value.length > 20) history.value.shift()
  patch.forEach(({ column, after }) => change(column, after))
  return patch.length
}
const undo = () => {
  if (locked.value) return
  const entry = history.value.pop()
  if (!entry) return
  const values = undoLinkPatch(props.links, entry.patch)
  Object.entries(values).forEach(([column, value]) => change(column, value))
  entry.review.filter((column) => column in values).forEach((column) => emit('review', column, true))
  emit('notify', Object.keys(values).length ? 'Link changes undone.' : 'Later edits were kept.', 'info')
}
const toggleSelected = (column) => {
  if (selected.value.has(column)) selected.value.delete(column)
  else selected.value.add(column)
}
const selectVisible = () => {
  if (allSelected.value) visibleFilled.value.forEach((column) => selected.value.delete(column))
  else visibleFilled.value.forEach((column) => selected.value.add(column))
}
const endSelection = () => { selecting.value = false; selected.value.clear() }
const clearLinks = async (columns, label) => {
  if (locked.value) return
  const targets = columns.filter((column) => props.links[column]?.trim())
  if (!targets.length) return
  if (targets.length > 1) {
    pending.value = true
    const confirmed = await props.confirmAction({ title: `Remove ${targets.length} links?`, message: 'You can undo this here. Changes reach the public page when you save.', confirmLabel: 'Remove links', danger: true })
    pending.value = false
    if (!confirmed) return
  }
  const count = apply(Object.fromEntries(targets.map((column) => [column, ''])), label)
  endSelection()
  nextTick(() => workspace.value?.querySelector('.undo')?.focus({ preventScroll: true }))
  emit('notify', `${count} link${count === 1 ? '' : 's'} removed. Undo is available.`, 'info')
}
const importLinks = () => {
  if (locked.value) return
  const { values, unknown, skipped } = planLinkImport(pasteText.value, props.links, replaceExisting.value)
  const count = apply(values, 'Import links')
  pasteText.value = unknown.join('\n')
  emit('notify', `${count} link${count === 1 ? '' : 's'} added${skipped ? ` · ${skipped} existing kept` : ''}${unknown.length ? ` · ${unknown.length} unrecognised` : ''}.`, count ? 'success' : 'info')
}
const copyLinks = () => {
  const columns = selecting.value ? filled.value.filter((column) => selected.value.has(column)) : filled.value
  emit('copy', columns.map((column) => props.links[column].trim()).join('\n'), `${columns.length} links copied.`)
}
</script>

<template>
  <div ref="workspace" class="link-workspace" :aria-busy="locked">
    <details class="link-import">
      <summary>Paste multiple links <Plus class="ico" :size="17" aria-hidden="true" /></summary>
      <div class="import-body">
        <textarea v-model="pasteText" class="g-input" rows="3" aria-label="Links to import" placeholder="Paste streaming links, one per line or separated by spaces." :disabled="locked"></textarea>
        <div class="import-actions">
          <label class="check-row"><input v-model="replaceExisting" type="checkbox" :disabled="locked" />Replace existing links</label>
          <button class="g-btn g-btn--sm" :disabled="locked || !pasteText.trim()" @click="importLinks">Sort links</button>
        </div>
      </div>
    </details>

    <div class="link-tools">
      <div class="link-tools-top">
        <div class="link-views" role="group" aria-label="Show links">
          <button :aria-pressed="view === 'added'" @click="view = 'added'">Added <span>{{ filled.length }}</span></button>
          <button :aria-pressed="view === 'all'" @click="view = 'all'">All platforms</button>
        </div>
        <button class="text-action" :disabled="locked || (!selecting && !filled.length)" :aria-pressed="selecting" @click="selecting ? endSelection() : selecting = true"><Check v-if="selecting" :size="16" aria-hidden="true" /><ListChecks v-else :size="16" aria-hidden="true" />{{ selecting ? 'Done' : 'Select' }}</button>
      </div>
      <input v-model="query" class="g-input platform-search" type="search" aria-label="Find a platform" placeholder="Find a platform…" />
      <div v-if="selecting" class="selection-tools">
        <label class="check-row"><input type="checkbox" :checked="allSelected" :disabled="locked || !visibleFilled.length" @change="selectVisible" />Select visible</label>
        <span role="status">{{ selectedCount }} selected</span>
      </div>
      <div v-if="selecting || history.length" class="link-bulk-actions">
        <button v-if="selecting" class="text-action" :disabled="locked || !selectedCount" @click="copyLinks"><Copy :size="16" aria-hidden="true" />Copy selected</button>
        <button v-if="selecting" class="text-action danger" :disabled="locked || !selectedCount" @click="clearLinks([...selected], 'Remove selected')"><Trash2 :size="16" aria-hidden="true" />Remove selected</button>
        <button v-if="history.length" class="text-action undo" :disabled="locked" :title="`Undo: ${history[history.length - 1].label}`" @click="undo"><Undo2 :size="16" aria-hidden="true" />Undo</button>
      </div>
    </div>

    <div v-if="!visibleGroups.length" class="links-empty">
      <p>{{ query ? 'No matching platforms.' : 'No links added yet.' }}</p>
      <button class="text-action" @click="query = ''; view = 'all'">Show all platforms</button>
    </div>
    <section v-for="group in visibleGroups" :key="group.id" class="link-group" :aria-labelledby="`link-group-${group.id}`">
      <header class="link-group-head"><h3 :id="`link-group-${group.id}`">{{ group.label }}</h3><span>{{ group.items.filter(item => links[item.column]?.trim()).length }}/{{ group.items.length }}</span></header>
      <p v-if="group.hint" class="hint">{{ group.hint }}</p>
      <div v-for="item in group.items" :key="item.column" class="link-entry">
        <div class="link-entry-head">
          <label v-if="selecting" class="selection-check"><input type="checkbox" :checked="selected.has(item.column)" :disabled="locked || !links[item.column]?.trim()" :aria-label="`Select ${item.label}`" @change="toggleSelected(item.column)" /></label>
          <img v-if="item.id !== 'artist'" :src="`/icons/${item.id}.png`" alt="" width="18" height="18" />
          <label :for="`studio-${item.column}`">{{ item.label }}</label>
          <button v-if="reviewSet.has(item.column)" class="review-tag" :disabled="locked" :aria-label="`Mark ${item.label} as reviewed`" @click="emit('review', item.column)">Mark reviewed</button>
          <span v-else-if="issue(item, group.id)" class="issue">{{ issue(item, group.id) }}</span>
        </div>
        <div class="link-entry-input">
          <input :id="`studio-${item.column}`" :value="links[item.column]" class="g-input" :aria-label="`${item.label} URL`" :placeholder="item.column === 'artist_url' ? 'https://open.spotify.com/artist/…' : 'https://'" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" :disabled="locked" @input="change(item.column, $event.target.value)" />
          <a v-if="links[item.column]?.trim()" class="icon-btn" :href="normalizeUrl(links[item.column])" target="_blank" rel="noopener" :title="`Open ${item.label}`" :aria-label="`Open ${item.label}`"><ExternalLink class="ico" :size="17" aria-hidden="true" /></a>
          <a v-else-if="group.id === 'streaming' && searchQuery" class="icon-btn" :href="searchUrl(item.id, searchQuery)" target="_blank" rel="noopener" :title="`Search ${item.label}`" :aria-label="`Search ${item.label}`"><Search class="ico" :size="17" aria-hidden="true" /></a>
          <button v-if="links[item.column]?.trim()" class="icon-btn clear-link" :disabled="locked || !links[item.column]?.trim()" :title="`Remove ${item.label}`" :aria-label="`Remove ${item.label}`" @click="clearLinks([item.column], `Remove ${item.label}`)"><X class="ico" :size="17" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
    <p class="hint save-note">Link changes are applied when you save the release.</p>
  </div>
</template>

<style scoped>
.link-workspace { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.ico { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.link-import { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
.link-import summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; min-height: 20px; cursor: pointer; list-style: none; font-size: 0.78rem; font-weight: 500; }
.link-import summary::-webkit-details-marker { display: none; }
.link-import[open] summary .ico { transform: rotate(45deg); }
.link-import summary .ico { transition: transform 180ms; }
.import-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.import-body textarea { resize: vertical; min-height: 88px; }
.import-actions, .link-tools-top, .selection-tools, .link-bulk-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.link-tools { display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 14px; }
.link-views { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--surface); }
.link-views button { border: 0; border-radius: 9px; padding: 10px 14px; min-height: 44px; background: transparent; color: var(--fg-dim); font: 500 0.76rem var(--font-ui); cursor: pointer; }
.link-views button[aria-pressed="true"] { background: var(--surface-hover); color: var(--fg); }
.link-views span { margin-left: 6px; color: var(--fg-faint); font-size: 0.7rem; }
.text-action { gap: 6px; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--fg-dim); font: 500 0.74rem var(--font-ui); cursor: pointer; }
.text-action:hover:not(:disabled) { background: var(--surface-hover); color: var(--fg); }
.text-action:disabled, .icon-btn:disabled { opacity: 0.35; cursor: default; }
.text-action.danger { color: var(--danger); }
.link-bulk-actions { justify-content: flex-start; gap: 4px; margin: -6px -8px; }
.undo { margin-left: auto; color: var(--fg); }
.selection-tools { font-size: 0.72rem; color: var(--fg-dim); }
.check-row { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 0.72rem; color: var(--fg-dim); cursor: pointer; }
input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--fg); margin: 0; flex-shrink: 0; }
.selection-check { display: grid; place-items: center; width: 32px; min-height: 32px; cursor: pointer; }
.link-group { display: flex; flex-direction: column; gap: 14px; }
.link-group + .link-group { padding-top: 18px; border-top: 1px solid var(--line); }
.link-group-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.link-group-head h3 { margin: 0; font-size: 0.8rem; font-weight: 600; }
.link-group-head > span { font-size: 0.68rem; color: var(--fg-faint); font-variant-numeric: tabular-nums; }
.link-entry { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.link-entry-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 24px; }
.link-entry-head img { object-fit: contain; }
.link-entry-head > label:not(.selection-check) { font-size: 0.75rem; font-weight: 500; color: var(--fg-dim); }
.link-entry-input { display: flex; align-items: center; gap: 6px; }
.link-entry-input .g-input { flex: 1; min-width: 0; }
.icon-btn { display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; flex-shrink: 0; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--fg-dim); cursor: pointer; text-decoration: none; transition: background 160ms, color 160ms; }
.icon-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--fg); }
.clear-link { border-color: transparent; }
.clear-link:hover:not(:disabled) { color: var(--danger); }
.issue, .review-tag { color: var(--warn); font-size: 0.65rem; }
.review-tag { border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent); background: color-mix(in srgb, var(--warn) 8%, transparent); border-radius: 8px; padding: 8px; cursor: pointer; min-height: 36px; }
.hint { margin: 0; font-size: 0.7rem; color: var(--fg-faint); line-height: 1.5; }
.links-empty { padding: 16px; text-align: center; font-size: 0.8rem; color: var(--fg-dim); }
.save-note { text-align: center; padding: 8px 0; }
:where(button, a, input, textarea, summary):focus-visible { outline: 2px solid var(--fg); outline-offset: 3px; }
@media (max-width: 380px) {
  .link-entry-input { gap: 4px; }
  .link-entry-input .g-input { padding-left: 10px; padding-right: 10px; }
  .link-views button { padding: 10px; }
}
</style>
