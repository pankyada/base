import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Harness',
  description: 'A profile-driven agent harness with conditional ACLs, a provenance gate, durable deferred asks, watch/poll triggers, autonomy budgets, temporal memory, and pluggable channels.',
  base: '/',
  ignoreDeadLinks: 'localhostLinks',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
    }],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Use Cases', link: '/use-cases' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Reference', link: '/profiles' },
    ],
    sidebar: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Use Cases', link: '/use-cases' },
      { text: 'Architecture', link: '/architecture' },
      {
        text: 'Reference',
        items: [
          { text: 'Profiles', link: '/profiles' },
          { text: 'Built-in Tools', link: '/builtin-tools' },
          { text: 'Safety & Governance', link: '/safety' },
          { text: 'Automation', link: '/automation' },
          { text: 'Skills', link: '/skills' },
          { text: 'Memory', link: '/memory' },
          { text: 'Voice', link: '/voice' },
          { text: 'MCP Servers', link: '/mcp-servers' },
          { text: 'Multi-Agent', link: '/multi-agent' },
          { text: 'Hooks', link: '/hooks' },
          { text: 'Context Projection', link: '/context' },
          { text: 'Self-Improvement', link: '/self-improvement' },
          { text: 'Telemetry', link: '/telemetry' },
          { text: 'CLI & TUI', link: '/cli-tui' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/pankyada/base' },
    ],
    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
