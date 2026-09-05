<template>
  <section v-if="film" class="film" :aria-label="film.title + ' — animated architecture walkthrough'">
    <header class="film-head">
      <h3 class="film-title">{{ film.title }}</h3>
      <p class="film-premise">{{ film.premise }}</p>
    </header>

    <!-- Reduced-motion / no-JS fallback: every beat, always visible. -->
    <ol v-if="reduced" class="film-storyboard">
      <li
        v-for="(beat, index) in film.beats"
        :key="beat.id"
        class="film-storyboard__item"
        :class="'film-tone--' + (beat.tone ?? 'normal')"
      >
        <span class="film-storyboard__index">{{ index + 1 }}</span>
        <div>
          <strong class="film-storyboard__actor">
            {{ nodeLabel(beat.actor) }}<template v-if="beat.to"> → {{ nodeLabel(beat.to) }}</template>
          </strong>
          <p class="film-storyboard__caption">{{ beat.caption }}</p>
          <p v-if="beat.detail" class="film-storyboard__detail">{{ beat.detail }}</p>
          <p class="film-storyboard__source"><code v-for="s in beat.source" :key="s">{{ s }}</code></p>
        </div>
      </li>
    </ol>

    <template v-else>
      <div class="film-stage" ref="stageEl">
        <svg :viewBox="`0 0 ${STAGE.width} ${STAGE.height}`" class="film-svg" role="img" :aria-label="'Architecture diagram for ' + film.title">
          <!-- server container -->
          <rect
            :x="SERVER_BOX.x" :y="SERVER_BOX.y" :width="SERVER_BOX.w" :height="SERVER_BOX.h"
            rx="12" class="film-server-box"
          />
          <text :x="SERVER_BOX.x + 14" :y="SERVER_BOX.y + 20" class="film-server-label">
            Harness server — one process, ws + http :7337
          </text>

          <!-- zone captions -->
          <text :x="14" :y="104" class="film-zone-label">Clients</text>
          <text :x="152" :y="124" class="film-zone-label">Transport</text>
          <text :x="912" :y="134" class="film-zone-label">External</text>

          <!-- subsystem bands inside the server -->
          <g v-for="band in PLACED_BANDS" :key="band.group">
            <rect :x="band.x" :y="band.y" :width="band.w" :height="band.h" rx="8" class="film-band" />
            <text :x="band.x + 12" :y="band.y + band.h / 2 + 4" class="film-band-label" :style="{ fill: band.accent }">
              {{ band.label }}
            </text>
          </g>

          <!-- the film's whole route, faint, so the path is legible at a glance -->
          <path v-if="routePath" :d="routePath" class="film-route" />

          <!-- the active edge, drawn in -->
          <path v-if="edge" :d="edge.d" class="film-edge" :class="'film-tone--' + (currentBeat?.tone ?? 'normal')" ref="edgeEl" />
          <circle v-if="edge" r="5" class="film-packet" :class="'film-tone--' + (currentBeat?.tone ?? 'normal')" ref="packetEl" />

          <!-- nodes -->
          <g
            v-for="node in PLACED_NODES"
            :key="node.id"
            class="film-node"
            :class="[
              nodeState(node.id),
              'film-tone--' + (currentBeat?.actor === node.id ? (currentBeat?.tone ?? 'normal') : 'normal'),
            ]"
          >
            <rect :x="node.x" :y="node.y" :width="node.w" :height="node.h" rx="7" class="film-node-box" />
            <text
              v-for="(line, i) in node.lines"
              :key="i"
              :x="node.x + node.w / 2"
              :y="node.y + node.h / 2 + (node.lines.length === 1 ? 4 : i === 0 ? -3 : 10)"
              class="film-node-text"
            >{{ line }}</text>
          </g>
        </svg>
      </div>

      <div class="film-caption" :class="'film-tone--' + (currentBeat?.tone ?? 'normal')">
        <p class="film-caption__text">{{ currentBeat?.caption ?? '' }}</p>
        <p v-if="currentBeat?.detail" class="film-caption__detail">{{ currentBeat.detail }}</p>
        <p class="film-caption__source">
          <code v-for="s in currentBeat?.source ?? []" :key="s">{{ s }}</code>
        </p>
      </div>

      <div class="film-transport">
        <button type="button" class="film-btn film-btn--play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
          {{ playing ? '⏸' : (ended ? '↺' : '▶') }}
        </button>
        <button type="button" class="film-btn" :aria-pressed="speed === 2" @click="toggleSpeed">{{ speed }}×</button>
        <ol class="film-rail" role="list">
          <li v-for="(beat, index) in film.beats" :key="beat.id">
            <button
              type="button"
              class="film-rail__beat"
              :class="{ 'film-rail__beat--active': index === currentIndex }"
              :aria-current="index === currentIndex"
              :aria-label="'Beat ' + (index + 1) + ': ' + beat.caption"
              @click="seek(index)"
            >{{ index + 1 }}</button>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { animate } from 'motion'
import {
  filmById, NODE_BY_ID, PLACED_NODES, PLACED_BANDS, PLACED_BY_ID, SERVER_BOX, STAGE,
} from './films'

const props = defineProps<{ id: string }>()
const film = computed(() => filmById(props.id))

function nodeLabel(id: string): string {
  return NODE_BY_ID[id]?.lines.join(' ') ?? id
}

const reduced = ref(true)
const stageEl = ref<HTMLElement | null>(null)
const edgeEl = ref<SVGPathElement | null>(null)
const packetEl = ref<SVGCircleElement | null>(null)

const elapsed = ref(0)
const playing = ref(false)
const speed = ref(1)

const castSet = computed(() => new Set(film.value?.cast ?? []))

const currentIndex = computed(() => {
  const beats = film.value?.beats ?? []
  let index = 0
  for (let i = 0; i < beats.length; i++) if (elapsed.value >= beats[i].t) index = i
  return beats.length ? index : -1
})
const currentBeat = computed(() => film.value?.beats[currentIndex.value])
const ended = computed(() => !!film.value && elapsed.value >= film.value.runtime)

/** Centre of a placed node. */
function centre(id: string): { x: number; y: number } | null {
  const n = PLACED_BY_ID[id]
  return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null
}

/**
 * Fraction along the centre-to-centre vector at which the ray leaves `box`.
 * Proper ray/rectangle exit, so wide boxes do not over-trim the way a
 * naive per-axis minimum does.
 */
function exitParam(box: { w: number; h: number }, dx: number, dy: number): number {
  const kx = Math.abs(dx) > 1e-6 ? Math.abs(dx) / (box.w / 2) : 0
  const ky = Math.abs(dy) > 1e-6 ? Math.abs(dy) / (box.h / 2) : 0
  const k = Math.max(kx, ky)
  return k > 0 ? 1 / k : 0
}

/** Segment between two nodes, trimmed to their box edges with a small gap. */
function segment(fromId: string, toId: string): { d: string } | null {
  const from = PLACED_BY_ID[fromId]
  const to = PLACED_BY_ID[toId]
  if (!from || !to) return null
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return null

  const gap = 5 / len
  let ta = exitParam(from, dx, dy) + gap
  let tb = 1 - exitParam(to, dx, dy) - gap

  // Adjacent or overlapping boxes would otherwise collapse (or invert) the
  // segment; keep a short but visible connector instead.
  if (tb - ta < 0.06) {
    const mid = (ta + tb) / 2
    ta = mid - 0.03
    tb = mid + 0.03
  }

  const start = { x: a.x + dx * ta, y: a.y + dy * ta }
  const end = { x: a.x + dx * tb, y: a.y + dy * tb }

  // Gentle arc so long hops across the diagram stay readable.
  const sx = end.x - start.x
  const sy = end.y - start.y
  const slen = Math.hypot(sx, sy) || 1
  // Neighbours in the same band are only a few px apart; a floor on the bow
  // keeps that hop visible as an arc instead of a dot that never travels.
  const bow = Math.max(16, Math.min(42, slen * 0.16))
  const cx = (start.x + end.x) / 2 + (-sy / slen) * bow
  const cy = (start.y + end.y) / 2 + (sx / slen) * bow
  return { d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}` }
}

const edge = computed(() => {
  const beat = currentBeat.value
  return beat?.to ? segment(beat.actor, beat.to) : null
})

/** The film's full route, drawn faintly under everything. */
const routePath = computed(() => {
  const beats = film.value?.beats ?? []
  const parts: string[] = []
  for (const beat of beats) {
    if (!beat.to) continue
    const seg = segment(beat.actor, beat.to)
    if (seg) parts.push(seg.d)
  }
  return parts.join(' ')
})

function nodeState(id: string): string {
  const beat = currentBeat.value
  if (beat?.actor === id) return 'film-node--active'
  if (beat?.to === id) return 'film-node--target'
  return castSet.value.has(id) ? 'film-node--cast' : 'film-node--ghost'
}

let rafId: number | null = null
let lastFrame = 0
let animatedBeat: string | null = null
let observer: IntersectionObserver | null = null
let autoplayed = false

function tick(now: number): void {
  if (!playing.value || !film.value) return
  elapsed.value = Math.min(film.value.runtime, elapsed.value + (now - lastFrame) * speed.value)
  lastFrame = now
  if (elapsed.value >= film.value.runtime) { playing.value = false; return }
  rafId = requestAnimationFrame(tick)
}

function play(): void {
  if (!film.value || playing.value) return
  if (elapsed.value >= film.value.runtime) elapsed.value = 0
  playing.value = true
  lastFrame = performance.now()
  rafId = requestAnimationFrame(tick)
}

function pause(): void {
  playing.value = false
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = null
}

function toggle(): void { playing.value ? pause() : play() }
function toggleSpeed(): void { speed.value = speed.value === 1 ? 2 : 1 }

function seek(index: number): void {
  const beat = film.value?.beats[index]
  if (!beat) return
  pause()
  elapsed.value = beat.t
  if (typeof history !== 'undefined' && film.value) {
    history.replaceState(null, '', `#film-${film.value.id}-beat-${index + 1}`)
  }
}

/** Draw the active edge in and run a packet along it. */
function animateBeat(): void {
  const beat = currentBeat.value
  if (!beat || beat.id === animatedBeat) return
  animatedBeat = beat.id

  const node = PLACED_BY_ID[beat.actor]
  if (node) {
    const box = stageEl.value?.querySelector<SVGGElement>(`.film-node--active .film-node-box`)
    if (box) animate(box, { opacity: [0.65, 1] }, { duration: 0.45, easing: 'ease-out' })
  }

  const path = edgeEl.value
  const packet = packetEl.value
  if (!path || !packet) return

  let length = 0
  try { length = path.getTotalLength() } catch { return }
  if (!length) return

  const travel = Math.min(1.1, Math.max(0.5, beat.dur / 1800))
  path.style.strokeDasharray = String(length)
  animate(path, { strokeDashoffset: [length, 0] }, { duration: travel, easing: 'ease-in-out' })

  // Move the packet along the real curve, so it tracks the drawn trail.
  const start = performance.now()
  const step = (now: number) => {
    if (animatedBeat !== beat.id) return
    const progress = Math.min(1, (now - start) / (travel * 1000))
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
    try {
      const point = path.getPointAtLength(eased * length)
      packet.setAttribute('cx', String(point.x))
      packet.setAttribute('cy', String(point.y))
      packet.style.opacity = progress >= 1 ? '0' : '1'
    } catch { /* path detached mid-frame */ }
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

watch(currentIndex, () => nextTick(animateBeat))

onMounted(() => {
  reduced.value = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced.value) return

  const match = (typeof location !== 'undefined' ? location.hash : '').match(/^#film-([a-z]+)-beat-(\d+)$/)
  if (match && film.value && match[1] === film.value.id) {
    autoplayed = true
    const index = Math.max(0, Math.min(film.value.beats.length - 1, Number(match[2]) - 1))
    nextTick(() => seek(index))
    return
  }

  if (typeof IntersectionObserver === 'undefined' || !stageEl.value) { play(); return }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && !autoplayed) {
        autoplayed = true
        play()
        observer?.disconnect()
      }
    }
  }, { threshold: 0.3 })
  observer.observe(stageEl.value)
})

onBeforeUnmount(() => { pause(); observer?.disconnect() })
</script>
