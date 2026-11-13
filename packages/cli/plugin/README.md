# testwitness plugin for Claude Code

Bundles two things from the `testwitness` npm package:

* the agent guard: `testwitness hook --agent claude` on PreToolUse (Bash and the edit tools), Stop and SubagentStop
* the read only MCP server: `testwitness mcp`

Both start through `npx --no-install testwitness`, so the package must already be installed: add `testwitness` to the
devDependencies of the project, or run `npm i -g testwitness`. The plugin never downloads anything.

Try it from a checkout or from `node_modules`:

```bash
claude --plugin-dir node_modules/testwitness/plugin
```

Check the manifest with `claude plugin validate node_modules/testwitness/plugin`.

The layout follows the Claude Code plugin reference (https://code.claude.com/docs/en/plugins-reference, read 13 Nov
2026): `.claude-plugin/plugin.json`, `hooks/hooks.json` and `.mcp.json` at the plugin root. `hooks/hooks.json` is
generated from the same code as `testwitness init --agent claude`; a test keeps the two equal.

What the guard blocks, the loop guard and the limits: docs/agent-guard.md in the repository.
