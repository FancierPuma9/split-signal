import type { AccountState } from '../game/reducer';
import type { GameActions } from '../game/useGame';
import { GoogleSignIn } from './GoogleSignIn';

/**
 * Under the final results: "saved to your stats" for signed-in players, and an offer (never a
 * requirement) for guests to sign in and keep this match's results.
 */
export function ResultsSave({ account, actions }: { account: AccountState; actions: GameActions }) {
  const { results, googleClientId, user } = account;
  if (!googleClientId || !results) return null;
  if (results.status === 'saved') {
    return <p className="results-save saved">✓ Saved to your stats</p>;
  }
  if (user) return null; // Claiming is under way.
  return (
    <div className="results-save">
      <span>Sign in to keep these results in your stats.</span>
      <GoogleSignIn
        clientId={googleClientId}
        onCredential={actions.signInWithGoogle}
        text="continue_with"
      />
    </div>
  );
}
