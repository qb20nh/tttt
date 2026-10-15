# AI validation and measurement

These runners load the TypeScript engine into isolated temporary CommonJS modules.
They need the repository's installed `typescript` dependency and Node 22 or newer;
they do not change the browser build.

```sh
node scripts/ai/validate.mjs
node scripts/ai/integration.mjs
node scripts/ai/benchmark.mjs --baseline /tmp/tttt-ai-baseline --budget 50 --depth 5 --output /tmp/tttt-benchmark.json
node scripts/ai/selfplay.mjs --baseline /tmp/tttt-ai-baseline --pairs 20 --budget 20 --output /tmp/tttt-selfplay.json
```

Capture an immutable comparison before editing, or extract any known commit:

```sh
mkdir -p /tmp/tttt-ai-baseline
git archive HEAD src/game | tar -x -C /tmp/tttt-ai-baseline
git rev-parse HEAD > /tmp/tttt-ai-baseline/revision.txt
```

The JSON labels `baseline` and `current` refer to `--baseline` and `--engine`;
`--engine` defaults to the working directory. Keep source copies fixed during a
comparison and record their revisions or working-tree diffs alongside the result.
For an uncommitted candidate, copy `src/game` into a fresh snapshot with the same
directory layout and pass that snapshot to `--engine`.

Validation compares packed board legal moves and terminal status with the game's
public tree rules along seeded legal trajectories at board depths 1 through 4.
It checks mutation/undo, incremental evaluation against full reconstruction,
actual search move routing, all reachable D1 positions against independent exact
minimax including fastest forced wins, slowest forced losses, exact root-relative
mate scores, and sound narrow-window bounds, and 24 seeded
reachable D2 endgames with at most eight globally playable
cells against a separate tree-rule minimax oracle. Warm transposition tests cover
different constraint layers, board depths, mate distances, collisions, zero
identities, and aging. Deadlines of 0/2/10 ms are checked at board depths 2–4.
Validation deliberately fails when an old version violates these contracts.

The default validator also runs two exhaustive table checks. `lookup-tables.mjs`
independently derives all six 3×3 tables from geometric lines and literal rules,
compares all 1,572,864 entries and seven constants, and checks repeated
initialization. It preserves ordered dual-win precedence and treats ordinary
Draw blockers separately from possibility masks. `order-ranks.mjs` checks ranks
for every empty cell in ordinary and Draw-containing local keys for both players,
including color normalization and Draw fallback. It compares exact packed
ordering with the original formula under TT, killer, history, and root-win
priorities, mixed parent types, nonzero offsets, and the single-move representation.
Run either check separately with:

```sh
node scripts/ai/lookup-tables.mjs --output /tmp/tttt-lookup-tables.json
node scripts/ai/order-ranks.mjs --output /tmp/tttt-order-ranks.json
```

`leaf-wins.mjs` uses public tree legality and winner propagation to enumerate
immediate whole-game wins independently of the AI's packed masks. It checks D1–D4,
both colors, target widening, explicit closures, complete input restoration, and
mirrored depth-one routing traps. It runs once in default validation and can also
run alone with `node scripts/ai/leaf-wins.mjs`. This exact frontier proof changes
some fixed-depth results; it is evaluated by paired play as well as exact oracles.

Higher-depth exact endgame checks are opt-in because reaching the last few
playable cells requires hundreds or thousands of legal moves. The runner samples
states independently of AI evaluation, solves outcome and mate distance from
tree rules, and compares cold and warm search results. Replay the saved fixtures
to reproduce the deeper checks without generating new trajectories:

```sh
node scripts/ai/endgames.mjs --boards 3 --cases 8 --cases-file scripts/ai/fixtures/deep-endgames.json
node scripts/ai/endgames.mjs --boards 4 --cases 1 --max-cells 16 --cases-file scripts/ai/fixtures/deep-endgames.json
```

To generate and save additional cases, then replay them:

```sh
node scripts/ai/endgames.mjs --boards 3 --cases 2 --games 10 --save-cases /tmp/tttt-d3-endgames.json
node scripts/ai/endgames.mjs --boards 4 --cases 1 --games 1 --seed 20588698 --max-cells 16 --save-cases /tmp/tttt-d4-endgame.json
node scripts/ai/endgames.mjs --boards 4 --cases 1 --max-cells 16 --cases-file /tmp/tttt-d4-endgame.json
```

Not every random game reaches eight remaining playable cells before ending.
Insufficient cases, an exceeded `--oracle-nodes` budget, or an unfinished search
fail the run. Increase `--games`, change `--seed`, or reuse saved trajectories;
saved cases are replayed legally from an empty board before they are solved.
The default D3 generation bound is ten games and D4 is one game. `--max-cells`
defaults to eight and accepts up to sixteen, retaining the same hard oracle node
budget and exact outcome/score assertions. These optional
checks do not silently weaken the standard validation suite.

Opening tests independently reconstruct all eight square symmetries and verify
3/15/105/861 maximum-index orbit representatives at depths 1–4, complete coverage,
root-only use, and rejection of constrained, occupied, or explicitly closed
positions. The default validator also checks diagnostic reuse after deadline
abort, one-probe reuse of fully cached proofs, and that closed-sector empty leaves
do not extend solved Draw searches. Six tactical cases cover X/O root-win cascades
at depths 2–4, zero-time fallback, exact mate scores, and preserved ordinary TT and
local tactical preferences when no immediate root win exists. A depth-seven
analysis must prove these immediate wins with at most two nodes; once a
nonterminal node reaches the best possible mate score, other moves cannot help.

The integration runner exercises the actual worker's messages, terminal roots,
zero-time legal fallback, invalid/error result recovery, and retained TT data. A
fake Worker validates pool ownership, cancellation, queued messages, reuse, and
postMessage error recovery. Hook lifecycle checks cover shared X/O ownership,
restored AI turns, reset request IDs, and unmount cancellation.
`pnpm ai:validate` runs both validation scripts.

Benchmarks use a fixed seed to select legal opening/middle/endgame positions
independently of evaluation. `--boards 2,3,4`, `--samples 6`, `--depth 5`, and
`--budget 50` configure the suite. Cold-table fixed-depth and equal-time results
are both reported. Nodes per second alone is not a strength measure: pruning can
reduce node count while improving the completed depth.

For performance changes that preserve behavior, `compare-equivalent.mjs`
requires identical fixed-depth scores, selected moves, and node counts. Every
run must also return a legal move and restore all Board fields and private
caches. Use fixed source snapshots taken before and after the change:

```sh
node scripts/ai/compare-equivalent.mjs --baseline /tmp/tttt-performance-base --engine /tmp/tttt-performance-candidate --seed 20261014 --repeats 9 --output /tmp/tttt-equivalent.json
```

The runner selects nine seeded legal positions at board depths 2/3/4 and searches
them at fixed depths 7/7/6. By default, each position receives three unmeasured
warmups per version, followed by nine repeats with alternating execution order.
Engine modules remain loaded, while every run clears the TT and creates a fresh
Search instance. Timings cover fixed-depth analysis; source loading, position generation,
TT reset, Search construction, and snapshot/legality checks are excluded. The
report retains every timing sample, per-position medians, and the geometric mean
of median speedups. Exact score/move/node comparisons apply to behavior-preserving
optimizations; changed heuristics or search policies require their own correctness
and holdout self-play evidence.

`node scripts/ai/opening-benchmark.mjs --output /tmp/tttt-opening-benchmark.json`
isolates opening symmetry pruning within the current engine. It compares empty
D2/D3/D4 roots at search depths 8/7/6 with pruning enabled and disabled, warms
both copies, alternates execution order for three repetitions, and checks equal
fixed-depth scores, legal moves, and exact input restoration. This measures the
opening optimization separately from the comparison against an older engine.

Self-play uses the same seeded four-ply opening twice with colors swapped. Both
versions receive the same requested time budget and depth limit, and their moves
are applied under the current engine's public game rules. Actual time and
overruns are reported; a version exceeding its deadline receives more actual
computation.

Search instances persist as they do in workers, retaining ordering history and
move buffers; transposition tables reset between games. Use `--board 3`,
`--opening 4`, `--pairs 20`, `--seed 20261013`, and `--budget 20` to configure a
match. In self-play, `--depth` sets the maximum search depth: it defaults to 30,
accepts integers from 1 through 255, and can be set to 64 to match the application's
current limit. The benchmark runner's `--depth` instead selects its fixed-depth
pass; its equal-time pass requests depth 30.

Self-play defaults to full public legal-move enumeration on every ply.
`--fast-legal` opts into an independent traversal of the constrained game tree
and updates each game's tree in place. Both color games start from separate
opening copies. The traversal is checked against the full public legal-move set
on every opening ply, at the start of each color game, and every 128 played plies.
Every selected move still passes the public `isValidPath` and constraint checks,
and every search must restore its exact input snapshot. The report's `legality`
fields record this policy; `publicOracleChecks` counts the explicit traversal
cross-checks in fast mode.

```sh
node scripts/ai/selfplay.mjs --baseline /tmp/tttt-ai-baseline --board 4 --pairs 20 --depth 64 --budget 20 --fast-legal --output /tmp/tttt-d4-selfplay.json
```

`matchElapsedMs` measures opening generation and all paired games after engine
loading, including searches, move application, and harness checks.
`playedPliesPerSecond` divides played plies after the openings by elapsed
seconds. These measure the whole match harness; changes from `--fast-legal` do not
establish faster AI search. Use the per-engine `timing` fields to compare measured
search time. The Elo estimate is descriptive for the recorded sources, opponent,
opening distribution, depth limit, and time budget; the paired confidence
interval reflects sample uncertainty and is not a universal Elo rating.

Use a different `--seed` for a holdout match after tuning. Run performance and
strength measurements sequentially to avoid competing for CPU time.

After building, `node scripts/ai/built-worker.mjs` checks that the referenced
production worker asset exists and executes its compiled, compressed code against
legal-move, terminal-board, and immediate-win cases.
