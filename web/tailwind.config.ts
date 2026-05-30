import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './widgets/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config
