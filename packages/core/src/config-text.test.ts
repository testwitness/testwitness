import { describe, expect, it } from 'vitest';
import { blockBodies, jsValuesForKey, lineOf, parseIni, parseProperties, parseTomlSafe, parseXml, parseYamlOrJson } from './config-text.js';

const crlf = (s: string) => s.replace(/\n/g, '\r\n');

// The engine hands config files to the rules with LF line endings (git.ts showFile), and these readers also accept
// CRLF themselves, so a config file read from a Windows checkout parses the same.
describe('config readers with CRLF line endings', () => {
  it('INI (setup.cfg, tox.ini, pytest.ini): continuation lines and comments', () => {
    const ini = '[tool:pytest]\naddopts = -q\n    --ignore=tests/integration\n# a comment\ntestpaths =\n    tests\n';
    expect(parseIni(crlf(ini))).toEqual(parseIni(ini));
    expect(parseIni(crlf(ini))['tool:pytest']!['addopts']).toBe('-q\n--ignore=tests/integration');
  });

  it('Java properties', () => {
    const props = 'junit.jupiter.conditions.deactivate = *\n# comment\nexcludedGroups=slow\n';
    expect(parseProperties(crlf(props))).toEqual(parseProperties(props));
  });

  it('YAML with a block scalar, JSON, TOML and XML', () => {
    const yaml = 'jobs:\n  test:\n    steps:\n      - run: |\n          npm ci\n          npm test\n';
    expect(parseYamlOrJson(crlf(yaml))).toEqual(parseYamlOrJson(yaml));
    const json = '{\n  "jest": {\n    "testPathIgnorePatterns": ["/e2e/"]\n  }\n}\n';
    expect(parseYamlOrJson(crlf(json))).toEqual(parseYamlOrJson(json));
    const toml = '[tool.pytest.ini_options]\naddopts = "-q"\nnorecursedirs = [\n  "generated",\n]\n';
    expect(parseTomlSafe(crlf(toml))).toEqual(parseTomlSafe(toml));
    const xml = '<project>\n  <build>\n    <excludes>\n      <exclude>**/*IT.java</exclude>\n    </excludes>\n  </build>\n</project>\n';
    const strip = (n: unknown): unknown => JSON.parse(JSON.stringify(n, (k, v: unknown) => (k === 'parent' ? undefined : typeof v === 'string' ? v.replace(/\r/g, '') : v)));
    expect(strip(parseXml(crlf(xml)))).toEqual(strip(parseXml(xml)));
  });

  it('JavaScript config values and blocks, and line numbers', () => {
    const js = "module.exports = {\n  testPathIgnorePatterns: [\n    '/node_modules/',\n    '/e2e/',\n  ],\n};\n";
    expect(jsValuesForKey(crlf(js), 'testPathIgnorePatterns')).toEqual(jsValuesForKey(js, 'testPathIgnorePatterns'));
    const gradle = 'test {\n  exclude "**/slow/**"\n}\n';
    expect(blockBodies(crlf(gradle), /\btest\s*\{/).map((b) => b.body.replace(/\r/g, ''))).toEqual(blockBodies(gradle, /\btest\s*\{/).map((b) => b.body));
    expect(lineOf(crlf(js), "'/e2e/'")).toBe(4);
  });
});
