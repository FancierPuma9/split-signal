# Press Together

Development dummy for shared (arena) instances. Everyone in the room is in one instance and has a
button; the first team where every member has pressed wins the round. It exercises the shared
runtime path: `instance: 'shared'`, `InitContext.teams`, per-team `score().teams`, and a round that
ends when one team finishes. Only reachable with `pnpm dev --puzzle press-together`.
