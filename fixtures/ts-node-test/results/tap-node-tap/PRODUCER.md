# Producer

- Runner: node-tap 21.8.1 (`npm install -D tap@21.8.1` in a temporary project), Node v22.23.4, `--reporter=tap` (TAP version 14). Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after node-tap wrote the file.
- Source: `source/test/text.test.js` and `source/text.js` (here), the slugify and clamp tests of `../../project` written with node-tap's `t.test`.

## Command (run from the temporary project holding `source/`)

    npx tap --disable-coverage --reporter=tap test/text.test.js > results.tap

Summary comment at the end of the file: `# { total: 5, pass: 2, fail: 1, todo: 1, skip: 1 }`.
