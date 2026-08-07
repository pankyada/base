import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HeroSignal from './HeroSignal.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-before': () => h(HeroSignal),
    })
  },
  enhanceApp({ router }) {
    if (typeof window !== 'undefined') {
      import('./reveal').then(m => m.setupReveal(router))
    }
  },
} satisfies Theme
