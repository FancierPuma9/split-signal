# YappinMaze

Both players walk their own maze. Each sees the other's maze with its way out drawn in, and only a
little of their own. Voice is open, so both are guiding and both are walking at once. The twist:
the game keeps what your partner said and replays it later, at a junction where it's now wrong.
Real voice, real person, wrong moment. A chatty team hands it more to work with; a team that
speaks tersely and takes turns moves slower but stays clean.

- **Comms:** `{ type: 'voice-replay', scope: 'team', vad: { thresholdDb: -40, minUtteranceMs:
250, silenceMs: 400 }, bufferSeconds: 60 }`. Live voice is ordinary team voice. Each client
  also buffers its partner's utterances (voice activity detection on the incoming stream, round
  timed). The server never gets audio: it only names a window of round time.
- **Replays:** about a third of each maze's junctions are replay junctions. Arriving at one picks
  an earlier turn of yours in a direction that would be wrong here (newest first, inside the
  minute clients keep) and asks your client to replay the longest thing your partner said from
  4 s to 0.3 s before that turn. If the client had nothing in that window it answers
  `__replayMissed` and the next candidate is tried. At most one replay per 8 s. There's no
  indicator of any kind.
- **Mazes:** two different 15x15 perfect mazes per team (so nobody can learn their partner's route
  as their own), 25-35 junctions each, corner to opposite corner; every team gets the same pair.
- **Fog:** you see walls within 2 cells of you in your own maze, and your partner's in full.
- **Win:** `race`; done when both are out.
- **Trust:** a modified client could skip replays, which only helps its own team, in a friends-only
  room. Hardening would upload utterances through the clip pipeline and have the server push them.
- **Tuning:** `/dev/vad` records your own mic as if it were a partner's, to tune detection.
