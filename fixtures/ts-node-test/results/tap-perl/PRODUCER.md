# Producer

- Runner: perl 5.38.2 with Test::More 1.302194 (the system Perl of the workspace). Produced on 4 Nov 2026. Nothing was edited after Perl wrote the files.
- Source: `source/t/text.t` (the slugify tests of `../../project` in Perl, with SKIP, TODO and a subtest) and `source/t/bail.t` (BAIL_OUT after the first test).

## Commands (run from `source/`; stderr, where Test::More writes diagnostics, is dropped)

    perl t/text.t > ../text.tap 2>/dev/null
    perl t/bail.t > ../bail.tap 2>/dev/null

There is no `TAP version` line. The TODO failure's diagnostics go to stdout as comment lines.
