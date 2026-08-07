import type { Router } from 'vitepress'

const SELECTOR = '.vp-doc > div > h2, .vp-doc > div > h3, .vp-doc > div > p, .vp-doc > div > table, .vp-doc > div > .custom-block, .VPFeature'

let observer: IntersectionObserver | null = null

function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function observe(): void {
  if (reduceMotion()) return
  if (!observer) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('h-reveal-in')
            observer!.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
  }
  document.querySelectorAll(SELECTOR).forEach(el => {
    if (el.classList.contains('h-reveal-in')) return
    el.classList.add('h-reveal')
    observer!.observe(el)
  })
}

export function setupReveal(router: Router): void {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(observe))
  run()
  router.onAfterRouteChange = () => run()
}
