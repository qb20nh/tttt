Stage 4 was measured on 2026-10-14 with Node v24.19.0, linux/x64.
The final runtime source is
`c2848a7066464dc7ac27a3455a67e518ac570f7c746adfcdb8c4d91eed9eed2b`;
its already optimized predecessor is `2bb7e3199f9a`.
[results.json](results.json) retains raw timings, every game, validation results,
source fingerprints, rejected trials, and the separately labeled Stage 3 history.

The new frontier check proves a legal whole-game win on the next move before
returning a static leaf evaluation. It follows only winning capture chains,
respects the normalized target constraint, and rejects closed descendants. The
proof returns an exact mate score without expanding ordinary quiet moves.
In a routed D2 trap, the predecessor's depth-one search captured sector 4 with
move 38 and allowed O to win the game immediately at move 20. The new search
chooses move 40 and avoids that reply. Existing root-win priority, mate-distance
normalization, and deadline handling remain covered by regression checks.

Both sides of the independent confirmation below have the same new performance
optimizations. The comparison isolates the frontier proof.

| D2 frontier proof comparison | Games | Wins / draws / losses | Score rate | Approx. paired 95% score interval | Descriptive Elo |
| --- | --- | --- | --- | --- | --- |
| Preliminary, seed 20401014 | 40 | 15 / 14 / 11 | 55% | 39.3%–70.7% | +35 |
| Independent confirmation, seed 20411014 | 80 | 37 / 24 / 19 | 61.25% | 52.5%–70.0% | +80 |

Both use paired four-ply openings with colors swapped, 10 ms requested per move,
and depth limit 64. The preliminary trial used the previous performance code on
both sides; confirmation uses final source `c2848a706646` against performance-only
source `46a78ece696b`. No games were discarded. Confirmation mean measured search
time was 8.45 ms for the opponent and 8.37 ms for the candidate; solved turns can
finish early. The confidence interval measures uncertainty for this experiment.
It does not establish a universal Elo rating or strength at the production
8.5-second budget.

Static local ordering scores now occupy compact immutable tables for the 3^9
ordinary local boards. O positions reuse X rows after swapping color bits;
imported Draw cells use the exact arithmetic fallback. Tactical, history,
killer, and transposition preferences retain their original packed ranks and
tie order. The tables add **878,582 bytes (0.84 MiB)** per JavaScript realm.
Common move routing uses constant divisors. Lookup initialization uses bitmasks
and popcounts in place of temporary cell arrays and repeated line decoding.

Each fixed-depth suite samples nine independently generated positions across
D2–D4, searches depths 7/7/6, warms each engine three times, and measures nine
alternating repetitions with fresh search objects and cleared tables. Only
search is timed. Legal moves and every board cache are checked outside the
clock. Both final suites produced exactly the predecessor's score, move, and
node count in all 18 positions.

| Compared with the already optimized predecessor | Seed 20261014 | Independent seed 20271014 |
| --- | --- | --- |
| Pure performance changes, before frontier proof | 1.142× | 1.116× |
| Final engine including frontier proof | **1.113×** | **1.131×** |

These are geometric means of per-position median speed ratios, not universal
speedups. The frontier proof can intentionally change results in other positions.
The pure-performance measurements isolate implementation throughput.

Nine alternating fresh-process pairs measured lookup initialization at
165.06 → 93.29 ms median (1.77×). Including compiled Search/Board imports and their
first construction, the performance-only candidate reached readiness in
184.05 → 111.46 ms (1.65×). This is Node initialization, not a measured browser
worker startup time. Both startup measurements include raw samples and exact
source identities in the JSON.

Several plausible changes were rejected after isolated measurements: dense and
lazy ordering tables, an extra scratch ranking row, undo snapshots, leaf-call
inlining, skipping leaf PVS re-search, and an internal move-generation shortcut.
Transposition-window tightening was also slower and introduced a mixed-depth
bound concern. Their evidence remains in `isolatedOptimizationTrials`; candidate
speedups are not assumed additive.

The final checks cover all 1,572,864 lookup entries and 1,179,648 static
order ranks including Draw/color cases, 300 dynamic packed orders, and
488 frontier-win checks using 292,032 public-rule candidate moves. They also cover
all 5,478 reachable D1 positions with exact
outcome and mate distance, public-rule trajectories, make/undo and routing,
narrow windows, deadline aborts, and exact D2 endgames. Saved D3/D4 endgames are
replayed through public rules and solved by an independent tree oracle; those
fixtures are Draws and do not prove general D3/D4 optimality. Worker/pool/lifecycle
integration, focused lint, strict AI TypeScript, production build, and 16 requests
against the actual compressed worker are checked separately. Existing project-wide
React/graphics type errors remain: 255 diagnostics, with none in the AI directory.
Focused strict AI typechecking passes.

Stage 3's 100-game D2 result against the original repository was 61.5% (+81
descriptive Elo). It and the earlier D3/D4 weight experiments remain under
`historicalStage`; they measure their own sources. Their Elo differences cannot
be added to Stage 4's result.

The exact Stage 4 predecessor can be reconstructed from the final source using
[the saved runtime patch](fixtures/stage4-improvements.patch):

```sh
mkdir -p /tmp/tttt-stage4-predecessor
cp -R src /tmp/tttt-stage4-predecessor/
git -C /tmp/tttt-stage4-predecessor apply --reverse /workspace/tttt/scripts/ai/fixtures/stage4-improvements.patch
node scripts/ai/validate.mjs
node scripts/ai/integration.mjs
node scripts/ai/compare-equivalent.mjs --baseline /tmp/tttt-stage4-predecessor --engine . --seed 20261014 --output /tmp/stage4-speed.json
node scripts/ai/compare-equivalent.mjs --baseline /tmp/tttt-stage4-predecessor --engine . --seed 20271014 --output /tmp/stage4-speed-holdout.json
node scripts/ai/built-worker.mjs # after building
```

Reconstruct the performance-only opponent for the isolated tactical confirmation
with [the frontier patch](fixtures/stage4-frontier-win.patch):

```sh
mkdir -p /tmp/tttt-stage4-performance
cp -R src /tmp/tttt-stage4-performance/
git -C /tmp/tttt-stage4-performance apply --reverse /workspace/tttt/scripts/ai/fixtures/stage4-frontier-win.patch
node scripts/ai/selfplay.mjs --baseline /tmp/tttt-stage4-performance --engine . --board 2 --pairs 40 --budget 10 --depth 64 --seed 20411014 --fast-legal --output /tmp/stage4-tactics-holdout.json
```

Both reverse patches were applied to fresh copies and checked against their
recorded complete runtime SHA256 identities.

Run measurements sequentially. [README.md](README.md) documents deeper endgames,
self-play, immutable snapshots, and interpretation limits. No absolute maximum
Elo or exhaustion of all possible improvements is claimed.
