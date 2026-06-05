import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Harness',
  description: 'A WebSocket-based agent harness — profile-driven, MCP-native, multi-agent.',
  base: '/base/',
  ignoreDeadLinks: 'localhostLinks',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/profiles' },
    ],
    sidebar: [
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Reference',
        items: [
          { text: 'Profiles', link: '/profiles' },
          { text: 'Built-in Tools', link: '/builtin-tools' },
          { text: 'Skills', link: '/skills' },
          { text: 'Memory', link: '/memory' },
          { text: 'MCP Servers', link: '/mcp-servers' },
          { text: 'Multi-Agent', link: '/multi-agent' },
          { text: 'Hooks', link: '/hooks' },
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
      message: 'Released under the ISC License.',
    },
  },
})
