import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'testwitness',
  description: 'Did this PR weaken its tests, and did they actually run?',
  base: '/testwitness/',
  // Working documents for the maintainer, not site pages.
  srcExclude: ['ASSESSMENT-AND-ROADMAP.md'],
  // Serve the report and history schemas at their $id, https://testwitness.github.io/testwitness/<name>.schema.json.
  buildEnd(site) {
    copyFileSync(join(site.srcDir, 'report.schema.json'), join(site.outDir, 'report.schema.json'));
    copyFileSync(join(site.srcDir, 'history.schema.json'), join(site.outDir, 'history.schema.json'));
  },
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
      { text: 'Run history', link: '/history' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'CLI', link: '/cli' },
      { text: 'Agent guard (hooks)', link: '/agent-guard' },
      { text: 'MCP server for agents', link: '/mcp' },
      { text: 'Fork PRs and security', link: '/security' },
      { text: 'Rules reference', link: '/rules' },
      { text: 'Precision', link: '/precision' },
      { text: 'How we measure precision', link: '/how-we-measure-precision' },
      { text: 'Design', link: '/design' },
      { text: 'Mutation on request', link: '/mutation-on-request' },
      { text: 'Mutation testing (our own)', link: '/mutation' },
      { text: 'Contributing', link: 'https://github.com/testwitness/testwitness/blob/main/CONTRIBUTING.md' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/testwitness/testwitness' }],
  },
});
