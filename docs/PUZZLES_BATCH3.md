# Split Signal - Puzzle Batch 3

Ten new puzzle modules. Companion to `SPLIT_SIGNAL_PLAN.md` (v1) and `SPLIT_SIGNAL_PUZZLES_BATCH2.md`, and assumes both are implemented: the puzzle contract, the clip pipeline with hold/jitter/budget, the draw stream, `voice-alternating` renegotiation, `voice-timed`, Arena mode (`instance: 'shared'`), `points` scoring, `InitContext.roundIndex`, and `<Blackout>`.

Written to be handed to Claude Code and worked through in order. Section 3 is the engine work that must land first; sections 4 and 5 are the modules.

Names: **Earshot, Patchwork, Card Talk, Overdraft, YappinMaze, Telegraph** and **Dictionary** are final. **Pass It On, Scavenge** and **Hot Mic** are working names; rename freely.

---

## 1. What this batch adds

Batches 1 and 2 covered: full voice, silence, arrow signals, nudge, garbled clips, fading ink, fixed and jittered delay, talk-time budget, one-way alternating voice, plan-then-silence, actions-only, and Arena mode.

Batch 3 opens these:

- **Ring relay with scrambled clips.** Voice travels one direction around a 3-4 player ring, and every clip is chopped into slices and shuffled before it lands.
- **Split audio.** One clip, sliced and divided between two players, with the other player's slices masked as noise.
- **Mutual stop-to-talk.** Mic and ears only work while you are standing still, for both players, with no indication of whether your partner has stopped.
- **Loudness as position.** How loud you speak sets how far away you can be heard. Your voice is the only thing you control.
- **One button, hold length.** A single key; the tone lasts as long as you hold it.
- **Sound buttons versus open voice.** One player has a growing palette of onomatopoeia buttons; the other has a normal mic.
- **Shared voice room across teams.** Both teams in one voice channel, talking at once, with per-team targets.
- **Send-count budget with a hard per-send cap.** Twelve sends per team, two seconds each, broadcast to every teammate.
- **Replayed voice.** Open voice, but the game replays things your partner really said earlier, out of context.

Two rules carried over and reinforced:

1. **Every constraint is enforced mechanically.** Nothing in this batch needs speech transcription. Word counts, "questions only," and similar rules stay rejected. Two modules (Earshot, YappinMaze) rely on a client-reported _input_ (mic level, utterance boundaries); section 3.10 spells out the trust model for those. Inputs the client reports are acceptable; _restrictions_ the client enforces are not.
2. **Two-team viable by default.** Every module here supports two teams except Scavenge, which is three-plus by design (section 5.1 explains why).

---

## 2. At a glance

| #   | Name       | Channel                            | Instance | Win                 | Team shape               |
| --- | ---------- | ---------------------------------- | -------- | ------------------- | ------------------------ |
| 1   | Pass It On | Ring clips, sliced and shuffled    | Per team | Race                | 3-4 per team, 2-3 teams  |
| 2   | Patchwork  | Split TTS clip, shared text box    | Per team | Compare (accuracy)  | 2 per team, 2-3 teams    |
| 3   | Telegraph  | One button, hold length            | Per team | Race                | 2 per team, 2-3 teams    |
| 4   | Dictionary | Sound buttons vs. one-way voice    | Per team | Compare (stages)    | 2 per team, 2-3 teams    |
| 5   | Overdraft  | 12 team sends, 2s cap, broadcast   | Per team | Compare (net score) | 3 per team, 2-3 teams    |
| 6   | Card Talk  | Voice, all teams, one room         | Shared   | Compare (points)    | 2 per team, 2-3 teams    |
| 7   | YappinMaze | Open voice + replayed utterances   | Per team | Race                | 2 per team, 2-3 teams    |
| 8   | Hot Mic    | Voice gated on both standing still | Per team | Race                | 2-3 per team, 2-3 teams  |
| 9   | Earshot    | Loudness sets audible range        | Shared   | Compare (points)    | 2 per team, 2-3 teams    |
| 10  | Scavenge   | Team voice, contested bin          | Shared   | Race                | 2 per team, **3+ teams** |

Suggested build order is in section 7.

---

## 3. Engine additions (do these first)

All additive. Batch 1 and 2 modules must not need changes.

### 3.1 Rule composition

A manifest may now declare several comms rules at once:

```ts
interface PuzzleManifest {
  // ...
  comms: CommsRule | CommsRule[];
}
```

The comms controller applies each rule independently (a voice topology and a signal set can coexist). Dictionary needs this (signals plus one-way voice); Earshot uses it (voice plus level reporting).

### 3.2 CommsRule extensions

```ts
type CommsRule =
  // --- existing, unchanged ---
  | { type: 'none' }
  | { type: 'signals'; signals: string[]; cooldownMs?: number }
  | { type: 'voice-alternating'; swapIntervalMs: [number, number]; warningMs?: number }
  | { type: 'voice-timed'; scope: 'team' | 'all'; openSeconds: number }
  | { type: 'draw'; fadeMs: number; from: 'any' | 'role'; extraSignals?: string[] }
  | {
      type: 'delayed-clips';
      maxSeconds: number;
      delayMs?: number;
      delayRangeMs?: [number, number];
      extraSignals?: string[];
    }

  // --- existing, extended ---
  | { type: 'voice'; scope: 'team' | 'all'; reportLevel?: boolean } // reportLevel: client streams mic RMS as an action (3.7)
  | {
      type: 'clips';
      maxSeconds: number;
      direction: 'one-way' | 'two-way' | 'ring';
      transform?: ClipTransform;
      extraSignals?: string[];
    }
  | {
      type: 'budget-clips';
      maxSeconds: number;
      budgetSeconds?: number;
      budgetSends?: number;
      budgetScope?: 'player' | 'team';
      extraSignals?: string[];
    }

  // --- new ---
  | { type: 'voice-oneway'; scope: 'team' } // who may speak is decided per player by commsState (3.3)
  | { type: 'voice-gated'; scope: 'team'; debounceMs?: number } // send AND receive decided per player by commsState (3.3)
  | { type: 'voice-replay'; scope: 'team'; vad: VadConfig; bufferSeconds: number }; // open voice plus a client-side utterance buffer the server can trigger (3.8)

type ClipTransform =
  | { kind: 'shuffle'; sliceMs: number } // chop into fixed slices, permute with the seeded RNG
  | { kind: 'reverse' }; // whole-clip reversal

interface VadConfig {
  thresholdDb: number;
  minUtteranceMs: number;
  silenceMs: number;
}
```

- `clips.direction: 'ring'`: each player's clips go only to the next seat in team order, wrapping. Requires `playersPerTeam.min >= 3`.
- `budget-clips`: `budgetSeconds` (batch 2, per player) and `budgetSends` (new) may be combined. `budgetScope: 'team'` makes one pool for the team. When `budgetSends` is set, `maxSeconds` is the hard cap per send: the client stops recording at the cap and the server truncates anything longer.
- `ClipTransform` is applied on the receiver's client with Web Audio, same trust model as Radio Tune distortion (fine for friends; server-side is a drop-in later). Implement it as a pure function `transformPcm(pcm: Float32Array, sampleRate, transform, rng)` in `packages/shared` so Patchwork can run the identical slicer on the server (3.6).

### 3.3 `commsState` hook

New optional server-module method. The comms controller calls it after every accepted action and every state-changing tick, diffs against the last result per player, and pushes changes.

```ts
commsState?(state: State, playerId: string, ctx: Context): {
  send?: boolean;                                              // may this player's mic transmit right now (default true)
  receive?: boolean;                                           // may this player hear anything right now (default true)
  peers?: Record<PlayerId, { audible: boolean; gain?: number }>; // per-source override, used by Earshot
};
```

Enforcement is the batch 2 renegotiation path: `send: false` sets the player's transceivers to `recvonly`/`inactive`; `receive: false` sets them to `sendonly`/`inactive`. `peers` toggles individual transceivers and ships a `gain` hint the receiving client applies with a `GainNode` (falloff only; audibility itself is enforced by the transceiver direction).

Debounce (`voice-gated.debounceMs`, default 300) so a player toggling between moving and still doesn't renegotiate ten times a second. Expect 100-300ms between a state change and the audio actually opening or closing; design the modules so that is acceptable (Hot Mic stops last seconds, not milliseconds).

Used by: Hot Mic (send/receive on stillness), Earshot (per-peer audibility, mute), Dictionary (`send` for the sender is always false under `voice-oneway`).

### 3.4 Signal rejection

`onSignal` may now return `{ reject: string }`. A rejected signal is neither applied nor relayed. Dictionary uses this to enforce the unlocked vocabulary server-side; the client only _renders_ the unlocked buttons, the server _refuses_ the rest.

Signals continue to carry server timestamps. Telegraph needs nothing else: `down` and `up` are ordinary signals and the receiver's client renders a tone between them.

### 3.5 Clip pipeline: ring routing, send counts, hard caps

- **Ring.** Route each clip to `players[(seatIndex + 1) % n]`. The sender's view gets `comms.nextSeat` / `comms.prevSeat` so modules can label "you hear from X, you speak to Y."
- **Send counts.** `remainingSends` per player or per team (by `budgetScope`), decremented on upload, shown in every teammate's view (`comms.budget.sends`), rejected at zero.
- **Hard cap.** The client stops the recorder at `maxSeconds`; the server truncates on upload regardless. A truncated send is still a full send against the budget. Show a shrinking ring around the record button so the cutoff is visible.

### 3.6 Server-side slicer for content clips

Patchwork slices a _content_ clip (pre-rendered TTS), not a mic clip, and the full clip must never reach a client (it is the answer). So for Patchwork the slicing runs on the server:

- Content is stored as 16-bit mono WAV so the server can slice raw PCM with no decoder dependency.
- `splitClip(pcm, rng, { minSliceMs, maxSliceMs })` produces seeded random-length slices and a seeded A/B assignment (not strict alternation; runs of 2-3 are allowed).
- For each player, build a WAV of the same length: their slices verbatim, every other slice replaced with pink noise at the clip's RMS, with a 20ms crossfade at every boundary so the seams don't click and don't give away slice length.
- Serve the two WAVs from memory for the round (or a temp dir), never the original.

Uses the same `transformPcm` primitives as 3.2; put both in `packages/shared/audio/`.

### 3.7 Mic level reporting

When a `voice` rule has `reportLevel: true`, the client measures its own mic RMS with an `AnalyserNode` (100ms window) and sends `{ type: '__micLevel', db }` as a rate-limited action (10 Hz max, server drops faster). The runtime forwards it to `apply` like any action. Earshot maps it to audible radius.

Mic level also drives a small "your loudness" meter in the client shell so the speaker can see what the game is seeing.

### 3.8 Utterance buffer and replay (`voice-replay`)

Live voice is untouched (normal team WebRTC). In addition, each client runs voice activity detection on the **incoming** partner stream:

- Energy above `thresholdDb` for `minUtteranceMs` marks a start; below it for `silenceMs` marks an end. Record the utterance (Float32 PCM) with server-synchronized start/end timestamps into a ring buffer of `bufferSeconds`.
- The server never receives the audio. It only sends `comms.replay { fromPlayerId, windowStartMs, windowEndMs }`; the client picks the longest utterance fully inside the window and plays it through the same output node as live voice, at the same gain, with no visual indicator. If nothing is in the window, nothing plays and the client reports `comms.replayMissed` so the server can try another window.

Trust model: a modified client could refuse to replay. That helps only the cheater's own team, in a friends-only room, so it is accepted for v1. Hardening path: upload utterances through the clip pipeline and have the server push the audio instead of a window.

Why VAD and not fixed windows: fixed windows catch half a word. Utterance boundaries give clean, replayable phrases. Why timing and not content: the server knows when a player took a turn; whatever the partner said in the few seconds before that turn was almost certainly about it. No transcription anywhere.

### 3.9 Shared-instance additions

- `InitContext.teams` (batch 2) is enough for Card Talk, Earshot and Scavenge.
- Arena rounds with per-team roles need a stable role assignment: add `ctx.rng.pickRole(teamId)` helper or just derive from seat index. Nothing new in the engine; noted so modules do it consistently.
- Scavenge needs `manifest.teams.min = 3`. Catalog filtering already handles this; make sure the lobby UI shows _why_ a puzzle was excluded when a host has only two teams ("needs 3+ teams") so the module is discoverable.

### 3.10 Trust model summary for this batch

| Thing                                                              | Where enforced                   | Cheat                               | Effect of cheating                                    |
| ------------------------------------------------------------------ | -------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Ring routing, send budgets, per-send cap, slicing of content clips | Server                           | none                                |                                                       |
| Clip shuffle/reverse on mic clips                                  | Receiver client                  | play it clean                       | helps cheater; same as Radio Tune, accepted           |
| Stop-to-talk gating, one-way voice, mutes, audibility              | Server via transceiver direction | none                                |                                                       |
| Distance falloff gain (Earshot)                                    | Receiver client                  | hear in-range ghosts at full volume | mild; audibility itself is server-enforced            |
| Mic level (Earshot)                                                | Ghost's client reports it        | misreport                           | symmetric range means lying can't favor you           |
| Replay (YappinMaze)                                                | Client buffer, server trigger    | skip replays                        | helps cheater; accepted for v1, hardening path in 3.8 |

---

## 4. Per-team modules

Each entry: concept, views, actions, resolution, comms, win, teams, content, and **Defaults I chose** for anything not decided in design.

### 4.1 Pass It On

- **Concept.** Three or four players in a ring. Every clip you send goes to the next seat only, and it arrives chopped into slices and shuffled. To answer a question from the person who feeds you, you have to send the answer forward, around the whole ring, through people who each have to reassemble it before they can relay it. Nobody can confirm anything with the person who told them.
- **Roles (3 players).** Builder (A) has the workbench and the parts but no instructions. Reader (B) has the instruction steps, written in glyphs. Keyholder (C) has the glyph-to-part key. Ring: C -> B -> A -> C. So the key goes C->B, the decoded steps go B->A, and the Builder's questions go A->C, who can only relay them onward to B. Every hop is scrambled.
- **Roles (4 players).** Add Toolsmith (D) holding which tool each step needs; ring C -> D -> B -> A -> C.
- **Views.** Builder: bench, parts tray, tool rack, current assembly, record button, incoming clips, "you hear from B, you speak to C." Reader: glyph steps. Keyholder: key. Toolsmith: step-to-tool table. Everyone sees their own send/receive seats and the clip player.
- **Actions.** Builder: `attach { partId, slot }`, `useTool { toolId }`, `undo`. Others: clips only.
- **Resolution.** Solved when the assembly matches the seeded target. A wrong attach is accepted but flagged after the round (no live feedback); every wrong step at the end costs 15s added to elapsed time.
- **Comms.** `{ type: 'clips', maxSeconds: 5, direction: 'ring', transform: { kind: 'shuffle', sliceMs: 600 } }`.
- **Win.** `race` on elapsed time including penalties. Round cap 4 min.
- **Teams.** 3-4 per team.
- **Content.** Reuse Recipe Cipher's procedural glyph generator. Assembly = 6 steps, each attaching one of 10 parts to one of 4 slots, some steps needing one of 3 tools.
- **Defaults I chose.**
  - 600ms slices as the default. 400 is hard, 900 is nearly readable. Expose as a manifest option and consider a per-round seeded slice length so some rounds are mush and some are merely annoying.
  - **Reverse Charges** is a manifest variant: same module, `transform: { kind: 'reverse' }`. Register it as a second catalog entry (`pass-it-on-reversed`) so the seed can pick it independently.
  - No live feedback on wrong attaches. Live feedback would let the Builder brute-force slots without the ring.

### 4.2 Patchwork

- **Concept.** A text-to-speech sentence is chopped into random-length slices and split between two players. Between them they have every slice; neither has a whole sentence, and the slices they're missing are masked with noise so they can't even tell how long the gaps are. Both hear their own version, both talk freely, and they type what they think the sentence was into one shared text box. Scored on how close they got.
- **Views.** Both: play/replay button for their own version, waveform scrubber, the shared text box (live, both cursors visible), Submit button, round timer. Neither ever gets the other's audio.
- **Actions.** `replay`, `edit { op: 'insert' | 'delete', index, text }` (server-authoritative string, last-write-wins on conflicts, broadcast to both), `submit` (either player; ends the team's round).
- **Slicing.** 3.6, with `minSliceMs 300`, `maxSliceMs 2500`. Seeded, so both teams get identical slicing of the identical sentence.
- **Resolution.** Normalize both strings (lowercase, strip punctuation, collapse whitespace). `dist` = word-level Levenshtein distance. `points = max(0, 1 - dist / max(len(truth), len(guess)))`. Result screen shows the true sentence and the guess with word-level diff highlighting.
- **Comms.** `{ type: 'voice', scope: 'team' }`.
- **Win.** `compare`, highest `points`; tie by earlier submit.
- **Teams.** 2 per team.
- **Content.** A sentence pack rendered offline. `scripts/gen-patchwork.ts` reads `sentences.json`, renders each to 16-bit mono 22.05kHz WAV with whatever TTS the contributor has installed (recommend piper; `say` on macOS and espeak-ng also work), and writes to `packages/puzzles/patchwork/content/`. Ship a starter pack of ~40 sentences, 10-15 words each, written to contain confusable words and phrases. Sentences are the contributor surface; nobody touches code to add one.
- **Defaults I chose.**
  - Unlimited replays. The round timer (90s) is the pressure. If teams just loop the clip, cap replays at 5.
  - Word-level distance rather than character-level, so "math" vs "mathematics" is one error, not seven, and typos aren't brutal.
  - Pink noise masking at matched RMS with crossfades. Silence was rejected in design; a tone would also work but noise reads more like a bad line.
  - Pre-rendered WAV instead of runtime TTS. Browser `speechSynthesis` can't be captured into a buffer reliably, and a runtime server TTS dependency is a real cost for contributors. Runtime TTS is a later option behind the same interface.

### 4.3 Telegraph

- **Concept.** Both players see the same irregular board: a random arrangement of cells, up to 10x10, with gaps, arms, and stray dots, different every round. The Sender's copy has some cells filled in. The Receiver's copy is empty and they click cells to fill them. The only channel is one button: hold it and a tone plays on the Receiver's side for as long as you hold. No pre-agreed code can work because the shape is different every time; the pair has to invent a traversal for _this_ board and the Receiver has to infer it from the taps.
- **Loop.** Sender taps. Receiver fills and hits Submit. Submit reveals the Receiver's board to the Sender (this is the only feedback in either direction). If wrong, the Sender chooses: tap corrections, or start over from the top. Each submit carries a time penalty.
- **Views.** Sender: the board with the target pattern, the hold button, a "tone playing" indicator, the Receiver's last submitted board (after a submit) with correct/incorrect cells marked. Receiver: the empty board, their fills, Submit, a tone indicator (visual flash while the tone plays, for players with sound off), submit-penalty countdown.
- **Actions.** Receiver: `toggle { cell }`, `submit`. Sender: signals only.
- **Board generation.** Seeded. Start from a 10x10, carve a connected irregular region of 20-45 cells (random walk plus a few detached 1-2 cell islands), then fill 30-40% of the region as the target. Identical for all teams.
- **Resolution.** Submit with an exact match solves. Wrong submit: Receiver's input locked for 8s, and 8s added to elapsed time.
- **Comms.** `{ type: 'signals', signals: ['down', 'up'], cooldownMs: 0 }`. Sender's view has `canSignal: true`; Receiver's client never shows the button. Receiver's client plays a tone (Web Audio oscillator) between `down` and `up`; also flashes the board border.
- **Win.** `race` on elapsed time including penalties. Round cap 3 min.
- **Teams.** 2 per team (3-player: two Receivers each own a half of the board, one Sender).
- **Defaults I chose.**
  - Region size 20-45 cells and 30-40% fill. Smaller than that and a numbering scheme works after all; larger and 3 minutes isn't enough.
  - 8s penalty, both as an input lock and added time. Lock alone would let a race-mode team spam submits with no time cost.
  - The revealed board marks which cells are wrong. Revealing only "wrong" with no per-cell marks would be harder and is a manifest option; try both.

### 4.4 Dictionary

- **Concept.** The Sender sees the task; the Receiver has to perform it. The Sender has no mic. Their entire channel is a palette of labeled onomatopoeia buttons (BOOM, CLAP, DING...) that play their sound on the Receiver's side. The Receiver has an open mic back to the Sender. So it's one-way sound against one-way voice: the Receiver asks questions, the Sender answers with whatever the vocabulary can express. Each stage cleared unlocks more sounds, and the next stage needs them. Meanings the team invented in stage one are still in force in stage four, and reassigning one mid-round desyncs the pair.
- **Stages (6).** Each is a split-information task; Sender sees the answer, Receiver has the controls.
  1. Two shapes; pick the right one. (3 sounds)
  2. Four shapes; pick the right one. (4 sounds)
  3. Three tiles; arrange in order. (5 sounds)
  4. Five tiles; arrange in order. (7 sounds)
  5. Two dials, 0-9 each; set both. (9 sounds)
  6. Five tiles, arrange and rotate each to one of four orientations. (12 sounds)
- **Views.** Sender: current task with the answer marked, the unlocked sound buttons (labeled), stage counter, the Receiver's live controls (so they can see what's being tried). Receiver: the controls, a Submit button, stage counter, incoming sounds as a scrolling log with the label (so a missed sound can be read back).
- **Actions.** Receiver: `pick`, `move`, `rotate`, `setDial`, `submit`. Sender: signals only.
- **Resolution.** Submit correct: stage cleared, vocabulary grows, next task. Submit wrong: 5s lockout, no other penalty. Round ends at 6 stages or timer. `points = stages cleared`; tie by elapsed time.
- **Comms.** `[ { type: 'signals', signals: ALL_12_SOUNDS, cooldownMs: 250 }, { type: 'voice-oneway', scope: 'team' } ]`. `commsState` returns `send: false` for the Sender. `onSignal` rejects any sound not yet unlocked (3.4). Client module plays the clip on incoming and shows the label.
- **Win.** `compare`, highest `points`; tie by time. Round cap 4 min.
- **Teams.** 2 per team.
- **Content.** 12 sounds. Synthesize with Web Audio where it's easy (ding, buzz, tick, zap, whoosh) and ship tiny CC0 clips for the rest (boom, clap, pow, splat, honk, ribbit, crunch). Labels are the sound words in caps.
- **Defaults I chose.**
  - Unlock order and counts above. The stages are written so stage N is awkward but possible with stage N's vocabulary and comfortable with N+1's, so teams feel the squeeze.
  - The Sender sees the Receiver's controls live. Without it the Sender is answering questions about a state they can't see; with it, the loop closes and the questions get sharper. If it's too easy, hide it.
  - The Receiver's log shows labels. Sound-only would punish players with bad speakers for no design reason.

### 4.5 Overdraft

- **Concept.** Three players. Each has a board of items and must pick the correct ones, but which ones are correct is known only by their teammates: the answers for A's board are split between B and C, and so on around. Every send goes to _both_ teammates at once, and the team has twelve sends for the whole round, each capped at two seconds. Two seconds is five or six words, so you can't address a teammate and instruct them in the same breath. Nobody knows how many answers they personally need, or how the team's total is split, so a listener can never assume a send was for them. Submit once at the end.
- **Views.** Each player: their own board (8 items, nothing marked), a checkbox per item, the team's remaining sends, the two-second ring on the record button, incoming clips labeled by sender, Submit. Plus an "answers you hold" panel: 1-3 entries of the form "on B's board: the striped one" and "on C's board: the tall one" with no indication of how many total answers exist on any board.
- **Actions.** `toggle { itemId }`, `submit` (per player; the team's round ends when all three have submitted or the timer expires; a player who never submits counts as submitting their current selection).
- **Generation.** Seeded. Team quota T in [5, 7]. Distribute T correct items across the three boards non-uniformly (allow 0 on a board). For each correct item, assign knowledge of it to exactly one of the other two players. Items on each board are drawn from a tight visual cluster (same generator as Split Hairs' pictures or Scavenge's parts) so descriptions cost words.
- **Scoring.** With `correct` = correct picks across the team, `picks` = total picks, `owed` = T:
  - `missed = owed - correct`
  - `surplus = max(0, picks - owed)`
  - `points = correct - missed - surplus`
    A blank slot costs the same as a wrong pick, so caution is never safe. A wrong pick within quota is already counted in `missed`; only picks _past_ the quota cost extra.
- **Comms.** `{ type: 'budget-clips', maxSeconds: 2, budgetSends: 12, budgetScope: 'team' }`, broadcast to all teammates (default clip routing for `two-way` is teammates, which is already both of them).
- **Win.** `compare`, highest `points`; tie by earlier final submit. Round cap 3 min.
- **Teams.** Exactly 3 per team.
- **Defaults I chose.**
  - 8 items per board, T in 5-7, non-uniform split including zeros.
  - Answers are shown to holders as pictures plus the target board, not as text, so the holder has to describe rather than read.
  - Submit is per player. A single team submit would let one player stall; per-player submits with a timer keeps it moving and preserves "you don't know if the others are done."

### 4.6 YappinMaze

- **Concept.** Both players walk their own maze. Each sees the _other_ player's maze with the solution path highlighted, and their own maze without. Voice is open, so both are guiding and both are walking at once. The twist: the game keeps what your partner said and replays it later, at a junction where it's now wrong. Real voice, real person, wrong moment. A chatty team generates more ammunition; a team that takes turns and speaks tersely moves slower but stays clean. The round ends only when both players are out.
- **Views.** Each player: their own maze with fog beyond a small radius (walls visible within 2 tiles), their avatar; the partner's full maze with the partner's avatar and the solution path drawn; a "both out" progress indicator. No replay indicator of any kind.
- **Actions.** `move { dir }` (grid steps, walls reject).
- **Maze generation.** Seeded. Two distinct 15x15 perfect mazes per team (A's and B's), identical pairs across teams. Junction count 25-35 per maze so there is plenty to say.
- **Replay engine.** Server tracks, per player, every junction arrival and the direction taken, with timestamps. A seeded schedule marks roughly every third junction as a replay junction. When player A arrives at a replay junction, the server picks an earlier junction of A's where the direction taken differs from the correct direction at the current junction, and sends A's client `comms.replay { from: B, window: [tThatTurn - 4000, tThatTurn - 300] }`. If the client reports a miss, try the next candidate junction. Cap at one replay per 8s per player.
- **Resolution.** Solved when both players are on their exit tiles.
- **Comms.** `{ type: 'voice-replay', scope: 'team', vad: { thresholdDb: -40, minUtteranceMs: 250, silenceMs: 400 }, bufferSeconds: 60 }`.
- **Win.** `race`. Round cap 4 min.
- **Teams.** 2 per team.
- **Defaults I chose.**
  - Fog on your own maze (2 tiles). Without it you could solve your own maze by sight and the voice channel would only matter for the partner's. With it you depend on them.
  - Every third junction, one replay per 8s. Tune from playtests; the aim is that a replay lands often enough to be distrusted but not so often that players ignore all voice.
  - Replays are picked to be _wrong_ at the current junction. Random replays would sometimes be accidentally right, which is less funny and less fair.
  - Both mazes differ. Same maze for both would let a player memorize their partner's route as their own.

### 4.7 Hot Mic

- **Concept.** Both players run their own lane of a timed obstacle course. You can't see your own hazards; you can see your partner's. Your mic transmits only while you are standing still, and you can only _hear_ while you are standing still, so a message lands only when you both happen to have stopped. There is no indication whether your partner is stopped or listening; the only acknowledgment is them talking back, which costs them the same. Hitting a hazard costs five seconds. Teams have to agree a rhythm up front and hold it while the course tries to break it.
- **Views.** Each player: their own lane scrolling ahead (terrain visible, hazards invisible), their runner, a "mic live" indicator that is on only while stationary; the partner's lane with the partner's runner and the hazards revealed in a window ahead of them (next 3 hazards or 8 tiles, whichever is less). Finish line for both.
- **Actions.** `run` (held), `stop`, `jump`, `duck`, `stepLeft`, `stepRight`. Hazards require a specific action within a timing window: hurdle (jump), beam (duck), pit left/right (step). Wrong or no action: 5s stun.
- **Stationary.** A player is stationary when no `run` input has arrived for 300ms. Both send and receive open on stationary and close on the next `run`.
- **Generation.** Seeded. Lane of 60 tiles with 14-18 hazards at irregular spacing. Both players' lanes are different; identical pairs across teams.
- **Resolution.** Team finishes when both runners cross the line. Elapsed time includes stuns.
- **Comms.** `{ type: 'voice-gated', scope: 'team', debounceMs: 300 }`. `commsState` returns `send: stationary, receive: stationary` for each player.
- **Win.** `race`. Round cap 3 min.
- **Teams.** 2 per team (3-player: three lanes in a ring, each player sees the next player's hazards).
- **Defaults I chose.**
  - Hazard reveal window of 3 hazards / 8 tiles on the partner's lane. Full visibility would let teams front-load the whole lane while stopped at the start.
  - 300ms stillness threshold. Matches the renegotiation debounce; shorter would feel flaky.
  - 5s stun on a hit, per the design conversation, so a missed warning costs about what a stop costs.
  - Hazard types need distinct actions so "jump" and "duck" are worth saying; a single-action course would collapse to "now."

---

## 5. Shared-instance modules

### 5.1 Scavenge (3+ teams)

- **Why 3+.** With two teams, the only way to break a tie between two competent teams is a scarce bin, and a scarce bin decides the round by luck. With three or more teams a griefer who shadows one team hands the round to the third, so no scarcity is needed and the bin can be generous. Two-team play was rejected in design for this reason; the manifest sets `teams.min = 3`.
- **Concept.** One shared bin of parts. Each team is assembling a _different_ thing. Parts come in tight visual clusters (12 variations on a bracket, 8 kinds of gear) so the Reader, who sees the schematic, has to describe the exact variant to the Grabber, who sees the bin. Grabs are committed simultaneously and resolve on a tick; contested grabs return to the bin. Each team has a limited number of grabs for the round.
- **Roles.** Reader (schematic, cannot grab). Grabber (bin, tray, cannot see schematic).
- **Views.** Reader: schematic with the 8 required parts marked as exact variants, the team tray, the tick timer, remaining grabs, other teams' trays (public). Grabber: the bin (all parts, unlabeled), their hovered part, their tray, the tick timer, remaining grabs, other teams' trays. Hovers are private.
- **Actions.** Grabber: `hover { partId }` (may change freely before the tick), `commit` (optional; an uncommitted hover at the tick counts as a grab of that part; hovering nothing = pass). Reader: none.
- **Tick.** Every 5s. All hovered parts resolve at once: uncontested -> the part moves to that team's tray; contested by 2+ teams -> nobody gets it and it stays in the bin. Every grab attempt, contested or not, consumes one of the team's grabs.
- **Generation.** Seeded. 8 clusters x 5 variants = 40 parts in the bin. Each team's assembly needs 8 parts. Assemblies overlap by design: each pair of teams shares exactly 2 required parts, and the bin holds exactly one of every variant, so the contested parts are known in advance to be contested and every team has the same number of them. Non-required parts exist so "grab something to deny them" is possible but costs a grab. Grab budget 12 per team.
- **Resolution.** A team is done when all 8 required parts are in its tray. First team done wins; if the timer expires, `compare` fallback on parts completed, then grabs remaining.
- **Comms.** `{ type: 'voice', scope: 'team' }`.
- **Win.** `race`, compare fallback. Round cap 3 min.
- **Teams.** 2 per team, 3-4 teams.
- **Defaults I chose.**
  - Hovers private, results public. The design conversation left this open between "visible in the last second" and "hidden." Hidden makes mirroring impossible and turns denial into a prediction from public trays, which is the more interesting skill. Expose `hoverRevealMs` as an option if you want the chicken-game version.
  - Overlap structure (each pair shares 2, one of each variant). This is what keeps it fair without randomness: every team faces the same amount of contention.
  - Taken parts stay taken; no returning to the bin. Hoarding is a real, costly choice.
  - 8 clusters x 5 variants. Descriptions need to hit cluster _and_ variant.

### 5.2 Card Talk

- **Concept.** One board of about 25 picture cards, both teams in one voice room, everyone talking at once, real time, no turns. Each team's Caller sees a key marking which cards are theirs, which are contested (on every team's list), and which are neutral traps. Each team's Grabber sees the unmarked board and clicks. Own cards are worth five, contested cards ten, neutrals nothing. A wrong grab costs three and, if the card belonged to someone, hands it to them unclaimed... wait, it hands them the points: the owning team scores it as if they had grabbed it. All claims are public. So you're describing cards in front of the competition, who may steal a contested card off your description, or be baited into grabbing one of yours.
- **Roles.** Caller (sees the key, cannot click). Grabber (sees the board, clicks). Fixed per round; alternate by `roundIndex` across a match.
- **Views.** Caller: the board with the full key (own / contested / neutral / each other team's), claims as they happen, team scores, timer. Grabber: the board, claims, scores, timer, a 1s cooldown ring on their cursor after each click.
- **Actions.** Grabber: `grab { cardId }`, rate-limited to one per second server-side.
- **Board.** `8 x teams + 5 + 4` cards. Per team 8 own cards worth 5; 5 contested cards worth 10, on every team's list; 4 neutral cards worth 0. Cards are pictures with no text, procedurally composed from attributes (shape, color, pattern, small motif) so that each card shares 2 of 4 attributes with several neighbors. "The striped one" is never enough. Seeded and identical for all teams (it's one board).
- **Resolution.** On `grab`:
  - Own card: +5 to the grabbing team, card claimed.
  - Contested card: +10 to the grabbing team, card claimed (first claim wins).
  - Neutral: -3 to the grabbing team, card claimed (removed).
  - Another team's card: -3 to the grabbing team, +5 to the owning team, card claimed.
    Round ends when all contested cards are claimed and every team's own cards are claimed or the timer expires. `points` = team score.
- **Comms.** `{ type: 'voice', scope: 'all' }`.
- **Win.** `compare`, highest `points`; tie by time of last scoring grab. Round cap 2 min.
- **Teams.** 2 per team, 2-3 teams.
- **Defaults I chose.**
  - Roles. The design conversation implied one player describes and one clicks; without split roles nobody would need to talk. Caller/Grabber is the minimal split.
  - The Caller sees the full key including the other teams' cards. This is what makes deliberate baiting possible ("describe my safe card like it's contested"); if it proves too strong, hide the other teams' cards from the Caller.
  - A stolen own-card credits the owner +5 rather than leaving it unclaimed. Design said "hand the card to its owner"; crediting the points is the simplest reading and makes the swing concrete.
  - Procedural composite pictures instead of an icon pack. No content dependency and similarity is tunable. An icon pack can replace it later behind the same card interface.
  - 1s grab cooldown, per design, instead of a larger penalty.

### 5.3 Earshot

- **Concept.** Hide and seek where the hider can't hide. Each team has a Ghost and a Hunter. The Ghost drifts through a maze on a seeded random walk with no control over where they go; they see everything (the map, themselves, every hunter). Their only input is how loudly they speak, which sets how far away they can be heard. The Hunter sees walls but no ghosts and navigates on voice: louder means closer. Enemy hunters hear your Ghost at the same range yours does, and can catch it, which mutes and teleports it for five seconds so your Hunter is now running toward a spot the Ghost hasn't been in for a while. Hunters carry a flashlight with a slow-recharging battery: ears for the approach, light for the catch.
- **Views.** Ghost: full map, own position, all hunters, own loudness meter and audible radius drawn as a circle, mute countdown when muted. Hunter: walls in a radius, own position, other hunters, flashlight beam and battery, catch button state, team score. No ghosts, ever, except inside the beam.
- **Actions.** Hunter: `move { dir }`, `flashlight` (toggle; drains while on), `catch`. Ghost: `__micLevel` only (3.7).
- **Ghost motion.** In `tick`: seeded random walk, one tile per 1.5s, never reversing unless at a dead end. Each team's Ghost has its own seeded path.
- **Audibility.** Ghost radius `r = lerp(2, 12, clamp((db + 50) / 40))` tiles, smoothed over 500ms. For every Hunter in the room, `audible = pathDistance(hunter, ghost) <= r`; `gain = 1 - pathDistance / r`. Path distance (through the maze), not straight-line, so walls matter. Served through `commsState.peers` (3.3). Symmetric for own and enemy hunters. A muted Ghost is inaudible to everyone.
- **Flashlight.** Lights the 2 tiles ahead in the facing direction while on. Battery 100, drains 20/s while on, recharges 5/s while off. A Ghost inside a lit tile is rendered on that Hunter's screen.
- **Catch.** Succeeds only if a Ghost is currently in the Hunter's lit tiles. 2s cooldown. Own Ghost: +5, Ghost respawns at a seeded far-away tile, continues drifting. Enemy Ghost: +3 to the catcher, enemy Ghost muted 5s and teleported to a seeded far-away tile.
- **Resolution.** Timed; `points` per team. Round 2 min.
- **Comms.** `[ { type: 'voice', scope: 'all', reportLevel: true }, { type: 'voice-gated', scope: 'all' } ]` conceptually; implement as `voice` with `reportLevel` plus `commsState` returning `send: !muted` for Ghosts, `send: false` for Hunters, and `peers` for every Hunter listing every Ghost's audibility and gain.
- **Win.** `compare`, highest `points`; tie by earlier last catch.
- **Teams.** 2 per team, 2-3 teams.
- **Defaults I chose.**
  - Hunters have no mic. The Ghost sees everything, so the Hunter has nothing to tell them. If playtests want banter, give Hunters team-scoped send and let Ghosts hear their own Hunter.
  - Catch only inside the beam. Blind catches would be spammed while walking.
  - Battery numbers (20/s drain, 5/s recharge, 2-tile beam). Aim: about 5s of light per 20s of hunting.
  - Path distance for audibility so a Ghost behind a wall sounds farther than one down the corridor. Straight-line is cheaper if path distance is a perf problem at 10 Hz; cache BFS from each Ghost per tick.
  - No stereo panning. A player on a mono speaker must be able to play; direction is inferred by moving and hearing the gain change. Panning can be an optional client enhancement that never carries information the gain doesn't.
  - Symmetric hearing to start; "enemy hears better" is a tuning knob (`enemyRangeMultiplier`, default 1.0, never below 1).

---

## 6. Content and assets

| Module     | Needs                                                    | Blocking?                                                                              |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pass It On | Glyphs (reuse Recipe Cipher), 10 parts, 3 tools as icons | No: flat shapes                                                                        |
| Patchwork  | Sentence pack + offline TTS render script                | **Yes for playtest.** ~40 sentences; the script is the deliverable, WAVs are generated |
| Telegraph  | None                                                     | Procedural                                                                             |
| Dictionary | 12 sounds (synth + a few CC0 clips), shape/tile art      | No: synth all 12 if clips are a hassle                                                 |
| Overdraft  | Item pictures in visual clusters                         | No: reuse the Card Talk composite generator                                            |
| YappinMaze | None                                                     | Procedural                                                                             |
| Hot Mic    | Runner sprite, 4 hazard types                            | No: rectangles                                                                         |
| Earshot    | Ghost/hunter sprites, flashlight cone                    | No                                                                                     |
| Scavenge   | 8 part clusters x 5 variants as SVG                      | No: procedural variants (holes, notches, orientation)                                  |
| Card Talk  | None                                                     | Procedural composites                                                                  |

Only Patchwork depends on writing. Start the sentence pack early.

---

## 7. Build order

Ordered so each step reuses something the previous one built. Playtest after C2, C5 and C8.

**C0: Engine**

- Rule composition (3.1), rule extensions (3.2), `commsState` (3.3), signal rejection (3.4)
- Clip pipeline: ring routing, send counts, hard caps (3.5)
- `transformPcm` and `splitClip` in `packages/shared/audio/` with tests (3.2, 3.6)
- Mic level reporting (3.7)
- Utterance buffer + replay (3.8), including a dev page that records, detects, and replays so VAD thresholds can be tuned without a puzzle
- Puzzle test harness: scripted `commsState` assertions and signal-rejection cases

**C1: Pass It On, Patchwork**

- Share the slicer. Patchwork first (server-side slicing, content pack, shared text box), then Pass It On (ring routing + client-side shuffle, reuse Recipe Cipher glyphs). Register the reversed variant.

**C2: Telegraph, Dictionary**

- Both nearly UI-only. Telegraph validates `down`/`up` tones. Dictionary validates rule composition, `voice-oneway`, and signal rejection.
- **Playtest checkpoint.**

**C3: Overdraft**

- `budget-clips` with `budgetSends` + `budgetScope: 'team'` + 2s hard cap. Generation and scoring have unit tests for the worked examples in 4.5.

**C4: Card Talk**

- First Arena module of the batch; smallest one. Procedural composite card generator lands here and is reused by Overdraft and Scavenge.

**C5: YappinMaze**

- `voice-replay`. The replay picker (wrong-at-current-junction) has unit tests against a scripted walk.
- **Playtest checkpoint.** This is where VAD thresholds and replay frequency get tuned.

**C6: Hot Mic**

- `voice-gated` on stillness. Measure the real open/close latency of renegotiation here and adjust `debounceMs`.

**C7: Earshot**

- `reportLevel`, per-peer `commsState.peers`, path-distance audibility, flashlight, catch rules. Heaviest comms work in the batch.

**C8: Scavenge**

- Arena with a shared tickable bin and overlap-structured assemblies. Test that the generator always produces the exact overlap structure.
- **Playtest checkpoint.** Full batch.

**C9: Docs**

- `PUZZLE_AUTHORING.md`: rule composition, `commsState`, signal rejection, clip transforms, `voice-replay` and its trust model, content pack scripts. Per-module `README.md`.

---

## 8. Tuning defaults

| Setting                         | Default                                               |
| ------------------------------- | ----------------------------------------------------- |
| Pass It On slice length         | 600ms                                                 |
| Pass It On clip cap / round     | 5s / 4 min                                            |
| Pass It On wrong-step penalty   | 15s each, applied at end                              |
| Patchwork slice range           | 300-2500ms                                            |
| Patchwork round                 | 90s                                                   |
| Patchwork replays               | unlimited                                             |
| Telegraph region / fill         | 20-45 cells / 30-40%                                  |
| Telegraph submit penalty        | 8s lock + 8s time                                     |
| Telegraph round cap             | 3 min                                                 |
| Dictionary stages / sounds      | 6 / 3,4,5,7,9,12                                      |
| Dictionary wrong-submit lockout | 5s                                                    |
| Dictionary round cap            | 4 min                                                 |
| Overdraft sends / cap           | 12 per team / 2s                                      |
| Overdraft board / quota         | 8 items per board / T in 5-7                          |
| Overdraft round cap             | 3 min                                                 |
| Card Talk board                 | 8 per team + 5 contested + 4 neutral                  |
| Card Talk values                | own 5 / contested 10 / neutral 0 / wrong -3           |
| Card Talk grab cooldown         | 1s                                                    |
| Card Talk round cap             | 2 min                                                 |
| YappinMaze maze                 | 15x15, 25-35 junctions                                |
| YappinMaze own-maze fog         | 2 tiles                                               |
| YappinMaze replay schedule      | ~every 3rd junction, max 1 per 8s                     |
| YappinMaze VAD                  | -40dB, 250ms min, 400ms silence                       |
| YappinMaze round cap            | 4 min                                                 |
| Hot Mic lane                    | 60 tiles, 14-18 hazards                               |
| Hot Mic stillness threshold     | 300ms                                                 |
| Hot Mic hazard reveal window    | 3 hazards / 8 tiles                                   |
| Hot Mic stun                    | 5s                                                    |
| Earshot ghost speed             | 1 tile / 1.5s                                         |
| Earshot audible radius          | 2-12 tiles by loudness                                |
| Earshot flashlight              | 2 tiles, drain 20/s, recharge 5/s                     |
| Earshot catch                   | own +5, enemy +3, enemy mute+teleport 5s, 2s cooldown |
| Earshot round                   | 2 min                                                 |
| Scavenge bin                    | 8 clusters x 5 variants                               |
| Scavenge assembly / overlap     | 8 parts / each pair of teams shares 2                 |
| Scavenge tick / grabs           | 5s / 12 per team                                      |
| Scavenge round cap              | 3 min                                                 |
| Renegotiation debounce          | 300ms                                                 |
| Clip cooldown                   | 2s                                                    |

---

## 9. Decisions made in this document that were not made in design

Flagged inline; collected here so they're easy to veto in one pass.

1. **Pass It On:** roles are Builder / Reader / Keyholder (+ Toolsmith at 4), ring direction C->B->A->C, no live feedback on wrong attaches, 600ms slices, Reverse Charges registered as a variant catalog entry.
2. **Patchwork:** unlimited replays, word-level distance, pink-noise masking with crossfades, pre-rendered WAV content pack rather than runtime TTS.
3. **Telegraph:** region 20-45 cells, 30-40% fill, 8s penalty as lock + time, reveal marks wrong cells.
4. **Dictionary:** the six stages and unlock counts, the Sender sees the Receiver's controls live, the Receiver's log shows labels.
5. **Overdraft:** 8 items per board, T in 5-7 with zeros allowed, per-player submit, answers shown as pictures.
6. **Card Talk:** Caller/Grabber roles, the Caller sees the full key, a stolen own-card credits the owner +5, procedural composite pictures.
7. **YappinMaze:** fog on your own maze, replay every ~3rd junction max 1/8s, replays chosen to be wrong at the current junction, different mazes for the two partners.
8. **Hot Mic:** 3-hazard reveal window, 300ms stillness, four hazard types with distinct actions.
9. **Earshot:** Hunters have no mic, catch only inside the beam, battery numbers, path-distance audibility, no panning, `enemyRangeMultiplier` knob.
10. **Scavenge:** hovers private, overlap structure (each pair shares 2, one of each variant), no returning parts, 8x5 bin.

Two engine calls worth a second look:

- `commsState` is a polling hook rather than an event. It keeps modules ignorant of WebRTC, which is the contract's whole point, at the cost of a diff per state change. Fine at this scale.
- YappinMaze's replay buffer lives on the client (3.8). It's the cheapest correct version and the cheat only hurts the cheater's team; the upload-based hardening is a contained change if it ever matters.

---

## 10. Still on the shelf

Discussed this batch and not specified:

- **Rehearsal:** 30s to study the puzzle with open voice, then it's hidden and you execute from memory, still talking.
- **Hot Potato:** control of the shared puzzle swaps unannounced; whoever holds it can act but can't see the goal.
- **Understudy:** you see your partner's screen, they see yours, both talk at once about different things.
- **Last Word:** a hard cap on message _count_, any length (superseded by Overdraft's count + cap; a two-player variant is a manifest change).
- **Secondhand (pure hub):** A and C never communicate; B relays between two puzzles they can't see.
- **Countdown:** voice opens only for the last ten seconds (inverse of plan-then-silence). `voice-timed` with an `openAtEnd` flag.
- **Signal quotas:** Sliding Grid with twelve arrows for the whole round. Manifest change.

Scrapped with reasons, so they don't come back:

- **Tandem** (shared cursor, one axis each): the mechanic _is_ the tight loop between two people, which cross-region latency breaks rather than degrades.
- **Gridlock** (Arena sliding grid): rejected outright.
- **Stereo** (left ear / right ear): mono speakers can't play it and the player wouldn't know why. Became Patchwork.
