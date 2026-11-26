<script setup>
import { ref, watch, nextTick, onUnmounted, useId } from 'vue'
import { Ellipsis, Link, ExternalLink, Pencil, Link2, CopyPlus, Trash2, X } from '@lucide/vue'
const props = defineProps({
  label: { type: String, default: 'Release actions' },
  releaseTitle: { type: String, default: '' },
  href: { type: String, required: true },
  disabled: Boolean,
  overlay: Boolean,
  library: Boolean
})
const emit = defineEmits(['edit', 'links', 'copy', 'duplicate', 'delete'])
const open = ref(false)
const mobile = ref(false)
const opensUp = ref(false)
const availableHeight = ref(400)
const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const id = `studio-actions-${useId()}`
const close = (restore = false) => { open.value = false; if (restore) trigger.value?.focus({ preventScroll: true }) }
const outside = (event) => { if (!root.value?.contains(event.target)) close() }
const resize = () => close(true)
const cleanup = () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize) }
watch(open, async (value) => {
  if (!value) { cleanup(); return }
  mobile.value = window.matchMedia('(max-width: 640px), (hover: none)').matches
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', resize)
  await nextTick()
  if (!open.value) return
  if (!mobile.value) {
    const rect = trigger.value.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 16
    const above = rect.top - 16
    opensUp.value = below < menu.value.scrollHeight && above > below
    availableHeight.value = Math.max(120, opensUp.value ? above : below)
  }
  menu.value?.querySelector('button, a')?.focus({ preventScroll: true })
})
watch(() => props.disabled, (value) => { if (value) close() })
onUnmounted(cleanup)
const run = (action) => { close(true); emit(action) }
const onKey = (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  const items = [...menu.value.querySelectorAll('button:not(:disabled), a[href]')].filter((item) => item.getClientRects().length)
  const index = items.indexOf(document.activeElement)
  if (mobile.value && event.key === 'Tab') {
    event.stopPropagation()
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
    else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus() }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
</script>

<template>
  <div ref="root" class="studio-actions" :class="{ 'is-open': open, 'on-cover': overlay }" @click.stop @focusout="!mobile && !$event.currentTarget.contains($event.relatedTarget) && close()">
    <div v-if="overlay" class="hover-shortcuts">
      <button class="action-trigger" :disabled="disabled" aria-label="Copy release link" title="Copy link" @click="emit('copy')"><Link :size="18" aria-hidden="true" /></button>
      <a class="action-trigger" :href="href" target="_blank" rel="noopener" aria-label="Open release page" title="Open page"><ExternalLink :size="18" aria-hidden="true" /></a>
    </div>
    <button ref="trigger" class="action-trigger more-trigger" :disabled="disabled" :aria-label="label" :title="label" :aria-expanded="open" :aria-controls="id" @click="open = !open" @keydown.down.prevent="open = true" @keydown.esc.stop="close(true)">
      <Ellipsis :size="20" aria-hidden="true" />
    </button>
    <div v-if="open && mobile" class="action-backdrop" aria-hidden="true" @click="close(true)" @touchmove.prevent @wheel.prevent></div>
    <Transition name="menu">
      <div v-if="open" :id="id" ref="menu" class="action-list" :class="{ 'opens-up': opensUp && !mobile, 'action-sheet': mobile }" :style="mobile ? undefined : { maxHeight: `${availableHeight}px` }" :role="mobile ? 'dialog' : 'group'" :aria-modal="mobile ? 'true' : undefined" :aria-label="label" @keydown="onKey">
        <header v-if="mobile" class="sheet-head"><h3>{{ releaseTitle || 'Release actions' }}</h3><button class="sheet-close" aria-label="Close actions" @click="close(true)"><X :size="20" aria-hidden="true" /></button></header>
        <div v-if="mobile" class="sheet-shortcuts" :class="{ 'two-shortcuts': !library }">
          <button v-if="library" @click="run('edit')"><Pencil :size="21" aria-hidden="true" /><span>Edit</span></button>
          <button @click="run('copy')"><Link :size="21" aria-hidden="true" /><span>Copy link</span></button>
          <a :href="href" target="_blank" rel="noopener" @click="close(true)"><ExternalLink :size="21" aria-hidden="true" /><span>Open page</span></a>
        </div>
        <div v-if="library" class="menu-section">
          <button v-if="!mobile" @click="run('edit')"><Pencil :size="17" aria-hidden="true" />Edit release</button>
          <button @click="run('links')"><Link2 :size="17" aria-hidden="true" />Manage links</button>
        </div>
        <div v-if="!overlay && !mobile" class="menu-section">
          <button @click="run('copy')"><Link :size="17" aria-hidden="true" />Copy link</button>
          <a :href="href" target="_blank" rel="noopener" @click="close(true)"><ExternalLink :size="17" aria-hidden="true" />Open page</a>
        </div>
        <div class="menu-section"><button @click="run('duplicate')"><CopyPlus :size="17" aria-hidden="true" />Duplicate release</button></div>
        <div class="menu-section"><button class="danger" @click="run('delete')"><Trash2 :size="17" aria-hidden="true" />Delete release</button></div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.studio-actions, .hover-shortcuts { display: flex; align-items: center; gap: 5px; }
.studio-actions { position: relative; flex-shrink: 0; }
.studio-actions.is-open { z-index: 30; }
.action-trigger { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--fg-dim); cursor: pointer; text-decoration: none; transition: background 120ms, color 120ms; box-sizing: border-box; }
.action-trigger:hover, .action-trigger[aria-expanded="true"] { background: var(--surface-hover); color: var(--fg); }
.action-trigger:disabled { opacity: 0.4; cursor: wait; }
.on-cover { opacity: 0; pointer-events: none; transition: opacity 100ms; }
.on-cover.is-open { opacity: 1; pointer-events: auto; }
.on-cover .action-trigger { background: rgba(15, 15, 17, 0.8); border-color: rgba(255, 255, 255, 0.15); color: #f2efe9; }
.on-cover .action-trigger:hover { background: #151517; }
.action-list { position: absolute; top: calc(100% + 6px); right: 0; width: min(224px, calc(100vw - 32px)); padding: 5px; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2); }
.action-list.opens-up { top: auto; bottom: calc(100% + 6px); }
.menu-section + .menu-section { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 4px; }
.menu-section :is(button, a) { display: flex; align-items: center; gap: 11px; min-height: 44px; width: 100%; padding: 10px 12px; box-sizing: border-box; border: 0; border-radius: 9px; background: transparent; color: var(--fg); font: 500 0.8rem var(--font-ui); text-decoration: none; text-align: left; cursor: pointer; }
.menu-section svg { flex-shrink: 0; color: var(--fg-dim); }
.menu-section :is(button, a):hover { background: var(--surface-hover); }
.menu-section .danger, .menu-section .danger svg { color: var(--danger); }
:where(button, a):focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.menu-enter-active, .menu-leave-active { transition: opacity 100ms; }
.menu-enter-from, .menu-leave-to { opacity: 0; }
.action-backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.55); }
.action-list.action-sheet { position: fixed; z-index: 101; top: auto; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); width: auto; max-height: calc(100dvh - 48px); padding: 8px; border-radius: 20px; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 4px 12px 12px; }
.sheet-head h3 { margin: 0; min-width: 0; font-size: 0.9rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sheet-close { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 50%; background: var(--surface); color: var(--fg-dim); cursor: pointer; }
.sheet-shortcuts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 0 4px 12px; }
.sheet-shortcuts.two-shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sheet-shortcuts :is(button, a) { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 80px; padding: 12px 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--fg); font: 500 0.75rem var(--font-ui); text-decoration: none; cursor: pointer; }
@media (max-width: 640px), (hover: none) {
  .on-cover { opacity: 1; pointer-events: auto; }
  .hover-shortcuts { display: none; }
  .on-cover .action-trigger { color: var(--fg-dim); background: transparent; border-color: transparent; }
  .on-cover .action-trigger:hover, .on-cover .action-trigger[aria-expanded="true"] { background: var(--surface-hover); color: var(--fg); }
}
@media (min-width: 641px) and (hover: none) {
  .on-cover .action-trigger { background: rgba(15, 15, 17, 0.8); color: #f2efe9; border-color: rgba(255, 255, 255, 0.15); }
}
</style>
