import type { PuzzleServerModule } from '@split-signal/shared';
import { VALUES, generateBoard } from './board';
import { manifest } from './manifest';
import type { Action, Card, Claim, KeyMark, State, View } from './types';

/** A Grabber may grab once a second. */
export const GRAB_COOLDOWN_MS = 1000;

const keyFor = (card: Card, team: string): KeyMark =>
  typeof card.owner === 'string' ? card.owner : card.owner.team === team ? 'mine' : card.owner;

/** Over when every contested card and every team's own cards are claimed. */
function allClaimed(state: State): boolean {
  const claimed = new Set(state.claims.map((c) => c.card));
  return state.cards.every((card) => card.owner === 'neutral' || claimed.has(card.id));
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, teams, roundIndex }) {
    const roles: State['roles'] = {};
    const teamOf: State['teamOf'] = {};
    for (const team of teams) {
      team.playerIds.forEach((id, seat) => {
        roles[id] = seat === roundIndex % team.playerIds.length ? 'caller' : 'grabber';
        teamOf[id] = team.id;
      });
    }
    return {
      cards: generateBoard(teams, rng),
      roles,
      teamOf,
      claims: [],
      scores: Object.fromEntries(teams.map((t) => [t.id, 0])),
      lastScoreAt: {},
      lastGrabAt: {},
    };
  },

  view(state, playerId, ctx): View {
    const myTeam = state.teamOf[playerId] ?? '';
    const role = state.roles[playerId] ?? 'grabber';
    const last = state.lastGrabAt[playerId];
    return {
      role,
      myTeam,
      teamNames: Object.fromEntries(ctx.teams.map((t) => [t.id, t.name])),
      cards: state.cards.map((card) =>
        role === 'caller'
          ? { id: card.id, look: card.look, key: keyFor(card, myTeam) }
          : { id: card.id, look: card.look },
      ),
      claims: state.claims,
      scores: state.scores,
      cooldownUntil: role === 'grabber' && last !== undefined ? last + GRAB_COOLDOWN_MS : null,
    };
  },

  apply(state, playerId, action, ctx) {
    if (state.roles[playerId] !== 'grabber') return { reject: 'Callers talk; Grabbers grab' };
    if (action?.type !== 'grab') return { reject: 'Unknown action' };
    const last = state.lastGrabAt[playerId];
    if (last !== undefined && ctx.elapsedMs - last < GRAB_COOLDOWN_MS) {
      return { reject: 'One grab a second' };
    }
    const card = state.cards.find((c) => c.id === action.cardId);
    if (!card) return { reject: 'No such card' };
    if (state.claims.some((c) => c.card === card.id)) return { reject: 'Already taken' };

    const team = state.teamOf[playerId]!;
    const scores = { ...state.scores };
    const lastScoreAt = { ...state.lastScoreAt };
    const add = (t: string, points: number) => {
      scores[t] = (scores[t] ?? 0) + points;
      if (points > 0) lastScoreAt[t] = ctx.elapsedMs;
    };
    let result: Claim['result'];
    let creditedTo: string | null = null;
    if (card.owner === 'contested') {
      result = 'contested';
      add(team, VALUES.contested);
    } else if (card.owner === 'neutral') {
      result = 'neutral';
      add(team, VALUES.wrong);
    } else if (card.owner.team === team) {
      result = 'own';
      add(team, VALUES.own);
    } else {
      // Someone else's card: it costs you, and its owner scores it as if they'd grabbed it.
      result = 'stolen';
      creditedTo = card.owner.team;
      add(team, VALUES.wrong);
      add(card.owner.team, VALUES.own);
    }
    const claim: Claim = { card: card.id, by: team, result, creditedTo, at: ctx.elapsedMs };
    return {
      state: {
        ...state,
        claims: [...state.claims, claim],
        scores,
        lastScoreAt,
        lastGrabAt: { ...state.lastGrabAt, [playerId]: ctx.elapsedMs },
      },
    };
  },

  reveal(state, playerId, ctx) {
    const myTeam = state.teamOf[playerId] ?? '';
    return {
      role: 'reveal',
      myTeam,
      teamNames: Object.fromEntries(ctx.teams.map((t) => [t.id, t.name])),
      cards: state.cards.map((card) => ({
        id: card.id,
        look: card.look,
        key: keyFor(card, myTeam),
      })),
      claims: state.claims,
      scores: state.scores,
      cooldownUntil: null,
    };
  },

  isSolved: allClaimed,

  score: (state) => ({
    teams: Object.fromEntries(
      Object.entries(state.scores).map(([team, points]) => [
        team,
        {
          points,
          ...(state.lastScoreAt[team] !== undefined ? { elapsedMs: state.lastScoreAt[team] } : {}),
        },
      ]),
    ),
  }),
};

export default puzzle;
