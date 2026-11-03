import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'testwitness',
  description: 'Did this PR weaken its tests, and did they actually run?',
  base: '/testwitness/',
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/' },
      { text: 'Rules', link: '/rules' },
      { text: 'Precision', link: '/precision' },
      { text: 'Design', link: '/design' },
    ],
    sidebar: [
      { text: 'Quick start', link: '/' },
      { text: 'How it decides', link: '/how-it-decides' },
      { text: 'Evidence (reporters)', link: '/evidence' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'CLI', link: '/cli' },
      { text: 'Fork PRs and security', link: '/security' },
      { text: 'Rules reference', link: '/rules' },
      { text: 'Precision', link: '/precision' },
      { text: 'Design', link: '/design' },
      { text: 'Mutation testing', link: '/mutation' },
      { text: 'Contributing', link: 'https://github.com/testwitness/testwitness/blob/main/CONTRIBUTING.md' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/testwitness/testwitness' }],
  },
});
