/**
 * Builds the stratified study sample (study/README.md, "Sample").
 *
 * usage: tsx --conditions=development study/sample.ts [--dir study] [--per-agent 100] [--humans 150]
 *        [--seed 20261101] [--per-repo 3] [--max-calls N] [--agents copilot,devin]
 *
 * Search is sequential with 8 s between calls. The script is resumable: strata
 * already filled in sample.jsonl are skipped, candidates already accepted or
 * rejected are never looked at twice, and finished search pages are recorded in
 * cache/progress.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENTS,
  AGENT_QUERIES,
  HUMAN_EXCLUDE,
  LANGUAGES,
  MAX_LINES,
  MIN_LINES,
  MIN_STARS,
  PERIOD,
  agentMarkers,
  appendJsonl,
  diffStat,
  flag,
  ghSearch,
  log,
  looksAssisted,
  mirror,
  readJsonl,
  repoMeta,
  repoOf,
  rng,
  sanitiseBody,
  searchCallCount,
  sha256,
  shuffle,
  studyDir,
  studyLanguage,
  type Agent,
  type Cohort,
  type Language,
  type Rejected,
  type SampleRow,
  type SearchItem,
} from './lib.js';

const dir = studyDir();
const perAgent = flag('per-agent', 100);
const humans = flag('humans', 150);
const seed = flag('seed', 20261101);
const perRepoCap = flag('per-repo', 3);
const maxCalls = flag('max-calls', Number.POSITIVE_INFINITY);
const agentsArg = process.argv.indexOf('--agents');
const agents: Agent[] = agentsArg >= 0 ? (process.argv[agentsArg + 1] ?? '').split(',').filter((a): a is Agent => (AGENTS as readonly string[]).includes(a)) : [...AGENTS];

const sampleFile = join(dir, 'sample.jsonl');
const rejectedFile = join(dir, 'rejected.jsonl');
mkdirSync(join(dir, 'cache'), { recursive: true });
const progressFile = join(dir, 'cache', 'progress.json');
const progress: { pages: Record<string, boolean>; exhausted: Record<string, boolean> } = existsSync(progressFile)
  ? JSON.parse(readFileSync(progressFile, 'utf8'))
  : { pages: {}, exhausted: {} };
const saveProgress = () => writeFileSync(progressFile, JSON.stringify(progress, null, 1));

const sample = readJsonl<SampleRow>(sampleFile);
const seen = new Set<string>([...sample.map((r) => r.url), ...readJsonl<Rejected>(rejectedFile).map((r) => r.url)]);

class Budget extends Error {}
const checkBudget = () => {
  if (searchCallCount() >= maxCalls) throw new Budget(`stopped after ${searchCallCount()} search calls (--max-calls)`);
};

const filled = (agent: Cohort, lang?: Language) => sample.filter((r) => r.agent === agent && (lang === undefined || r.language === lang)).length;

/** Split a total over the three languages; strata that ran dry keep what they have and the rest moves to the others. */
function targets(cohort: Cohort, total: number): Record<Language, number> {
  const t = { typescript: 0, python: 0, java: 0 } as Record<Language, number>;
  const dry = LANGUAGES.filter((l) => progress.exhausted[`${cohort}|${l}`]);
  const open = LANGUAGES.filter((l) => !dry.includes(l));
  let left = total;
  for (const l of dry) {
    t[l] = Math.min(filled(cohort, l), total);
    left -= t[l];
  }
  open.forEach((l, i) => {
    t[l] = Math.floor(Math.max(left, 0) / open.length) + (i < Math.max(left, 0) % open.length ? 1 : 0);
  });
  return t;
}

/** Seven day windows over the study period, so results are not all from the last week. */
function windows(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const end = new Date(`${PERIOD.to}T00:00:00Z`);
  for (let d = new Date(`${PERIOD.from}T00:00:00Z`); d <= end; d = new Date(d.getTime() + 7 * 864e5)) {
    const e = new Date(Math.min(d.getTime() + 6 * 864e5, end.getTime()));
    out.push([d.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]);
  }
  return out;
}

const seedFor = (s: string) => seed ^ parseInt(sha256(s).slice(0, 8), 16);

function reject(item: SearchItem, cohort: Cohort, reason: string, language?: string) {
  seen.add(item.html_url);
  const rec: Rejected = { url: item.html_url, agent: cohort, reason, ...(language ? { language } : {}) };
  appendJsonl(rejectedFile, rec);
}

/** Checks one candidate end to end; appends to the sample when it qualifies. */
async function consider(item: SearchItem, cohort: Cohort, lang: Language, pageRepos: string[], perRepo: number): Promise<boolean> {
  seen.add(item.html_url);
  const repo = repoOf(item);
  const login = item.user.login;
  const body = item.body ?? '';
  if (!item.pull_request?.merged_at) return reject(item, cohort, 'not merged'), false;
  if (item.created_at < PERIOD.from || item.created_at.slice(0, 10) > PERIOD.to) return reject(item, cohort, 'outside period'), false;
  if (cohort === 'human') {
    if (item.user.type !== 'User' || looksAssisted(login, body)) return reject(item, cohort, 'assistant signal in author or body'), false;
  } else {
    const m = agentMarkers(login, body);
    if (!m.has(cohort)) return reject(item, cohort, 'agent marker absent'), false;
    if (m.size > 1) return reject(item, cohort, 'markers of more than one agent'), false;
  }
  if (sample.filter((r) => r.agent === cohort && r.repo.toLowerCase() === repo.toLowerCase()).length >= perRepo) {
    seen.delete(item.html_url); // not a property of the PR, may qualify later if caps change
    return false;
  }
  checkBudget();
  // Look this repository up together with the next few unknown ones on the page.
  const at = pageRepos.indexOf(repo);
  const meta = (await repoMeta([repo, ...pageRepos.slice(at + 1, at + 6)])).get(repo)!;
  if (meta.missing) return reject(item, cohort, 'repository not found by search'), false;
  if (meta.stars < MIN_STARS) return reject(item, cohort, `under ${MIN_STARS} stars`), false;
  const language = studyLanguage(meta);
  if (language !== lang) return reject(item, cohort, 'primary language not in stratum', meta.language ?? 'none'), false;
  let stat;
  try {
    stat = diffStat(mirror(repo, item.number), item.number);
  } catch (e) {
    return reject(item, cohort, `git: ${String((e as Error).message).split('\n')[0]!.slice(0, 120)}`, lang), false;
  }
  if (typeof stat === 'string') return reject(item, cohort, stat, lang), false;
  const lines = stat.additions + stat.deletions;
  if (lines < MIN_LINES || lines > MAX_LINES) return reject(item, cohort, `changed lines outside ${MIN_LINES} to ${MAX_LINES}`, lang), false;
  if (stat.testFiles === 0) return reject(item, cohort, 'touches no test file', lang), false;
  const row: SampleRow = {
    url: item.html_url,
    repo,
    number: item.number,
    agent: cohort,
    language: lang,
    stars: meta.stars,
    license: meta.license,
    created_at: item.created_at,
    merged_at: item.pull_request.merged_at,
    changed_lines: lines,
    additions: stat.additions,
    deletions: stat.deletions,
    files_changed: stat.files.length,
    test_files: stat.testFiles,
    base_sha: stat.base,
    head_sha: stat.head,
    title: item.title,
    body: sanitiseBody(item.body),
  };
  sample.push(row);
  appendJsonl(sampleFile, row);
  log(`accepted ${cohort}/${lang} ${filled(cohort, lang)}: ${lines} lines, ${stat.testFiles} test files`);
  return true;
}

async function fillAgentStratum(agent: Agent, lang: Language): Promise<void> {
  const key = `${agent}|${lang}`;
  if (progress.exhausted[key]) return;
  const rand = (() => {
    const r = rng(seedFor(key));
    return r;
  })();
  for (const [from, to] of shuffle(windows(), rand)) {
    for (const q of AGENT_QUERIES[agent]) {
      for (let page = 1; page <= 10; page++) {
        if (filled(agent, lang) >= targets(agent, perAgent)[lang]) return;
        const pageKey = `${key}|${q}|${from}|${page}`;
        if (progress.pages[pageKey]) continue;
        checkBudget();
        const res = await ghSearch<SearchItem>('search/issues', {
          q: `${q} is:pr is:merged created:${from}..${to} language:${lang}`,
          sort: 'created',
          order: 'desc',
          per_page: '100',
          page: String(page),
        });
        const items = shuffle(res.items, rand).filter((i) => !seen.has(i.html_url));
        const pageRepos = [...new Set(items.map(repoOf))];
        for (const item of items) {
          if (filled(agent, lang) >= targets(agent, perAgent)[lang]) break;
          await consider(item, agent, lang, pageRepos, perRepoCap);
        }
        if (filled(agent, lang) < targets(agent, perAgent)[lang]) {
          progress.pages[pageKey] = true;
          saveProgress();
        }
        if (res.items.length < 100 || page * 100 >= res.total_count) break;
      }
    }
  }
  if (filled(agent, lang) < targets(agent, perAgent)[lang]) {
    progress.exhausted[key] = true;
    saveProgress();
    log(`${key} ran dry at ${filled(agent, lang)}; the remainder moves to the other languages`);
  }
}

async function fillHumanStratum(lang: Language): Promise<void> {
  const key = `human|${lang}`;
  if (progress.exhausted[key]) return;
  const repos = [...new Set(sample.filter((r) => r.agent !== 'human' && r.language === lang).map((r) => r.repo))];
  if (repos.length === 0) {
    progress.exhausted[key] = true;
    saveProgress();
    return;
  }
  const rand = rng(seedFor(key));
  const cap = Math.max(2, Math.ceil(targets('human', humans)[lang] / repos.length));
  for (const repo of shuffle(repos.sort(), rand)) {
    for (let page = 1; page <= 3; page++) {
      if (filled('human', lang) >= targets('human', humans)[lang]) return;
      if (sample.filter((r) => r.agent === 'human' && r.repo === repo).length >= cap) break;
      const pageKey = `${key}|${repo}|${page}`;
      if (progress.pages[pageKey]) continue;
      checkBudget();
      const res = await ghSearch<SearchItem>('search/issues', {
        q: `repo:${repo} is:pr is:merged created:${PERIOD.from}..${PERIOD.to} ${HUMAN_EXCLUDE}`,
        sort: 'created',
        order: 'desc',
        per_page: '50',
        page: String(page),
      });
      for (const item of shuffle(res.items, rand).filter((i) => !seen.has(i.html_url))) {
        if (filled('human', lang) >= targets('human', humans)[lang]) break;
        if (sample.filter((r) => r.agent === 'human' && r.repo === repo).length >= cap) break;
        await consider(item, 'human', lang, [repo], cap);
      }
      if (sample.filter((r) => r.agent === 'human' && r.repo === repo).length < cap) {
        progress.pages[pageKey] = true;
        saveProgress();
      }
      if (res.items.length < 50) break;
    }
  }
  if (filled('human', lang) < targets('human', humans)[lang]) {
    progress.exhausted[key] = true;
    saveProgress();
    log(`${key} ran dry at ${filled('human', lang)}`);
  }
}

async function main() {
  try {
    for (const agent of agents) {
      // Repeat until the agent total is met or every language ran dry (redistribution can reopen a stratum's target).
      for (let pass = 0; pass < 3 && filled(agent) < perAgent; pass++) {
        for (const lang of LANGUAGES) await fillAgentStratum(agent, lang);
      }
    }
    if (humans > 0) {
      for (let pass = 0; pass < 2 && filled('human') < humans; pass++) {
        for (const lang of LANGUAGES) await fillHumanStratum(lang);
      }
    }
  } catch (e) {
    if (!(e instanceof Budget)) throw e;
    log(e.message);
  }
  const counts: Record<string, Record<string, number>> = {};
  for (const r of sample) (counts[r.agent] ??= {})[r.language] = (counts[r.agent]![r.language] ?? 0) + 1;
  process.stdout.write(`sample: ${sample.length} PRs, ${searchCallCount()} search calls this run\n`);
  for (const [a, c] of Object.entries(counts)) process.stdout.write(`  ${a.padEnd(12)} ${JSON.stringify(c)}\n`);
  const rej: Record<string, number> = {};
  for (const r of readJsonl<Rejected>(rejectedFile)) rej[r.reason.replace(/^git: .*/, 'git error')] = (rej[r.reason.replace(/^git: .*/, 'git error')] ?? 0) + 1;
  process.stdout.write(`rejected: ${JSON.stringify(rej)}\n`);
}

await main();
