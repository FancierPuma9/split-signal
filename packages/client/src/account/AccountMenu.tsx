import { useState } from 'react';
import type { AccountState } from '../game/reducer';
import type { GameActions } from '../game/useGame';
import { GoogleSignIn } from './GoogleSignIn';
import { StatsDialog } from './StatsDialog';

/**
 * Sign-in in the top bar. Hidden entirely on servers without Google sign-in; accounts are only
 * ever for keeping stats, never needed to play.
 */
export function AccountMenu({ account, actions }: { account: AccountState; actions: GameActions }) {
  const [open, setOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  if (!account.googleClientId) return null;

  if (!account.user) {
    return (
      <GoogleSignIn
        clientId={account.googleClientId}
        onCredential={actions.signInWithGoogle}
        size="small"
        text="signin"
      />
    );
  }

  return (
    <div className="account">
      <button
        className="secondary account-button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {account.user.name}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <button
            role="menuitem"
            className="link"
            onClick={() => {
              setOpen(false);
              setShowStats(true);
              actions.loadStats();
            }}
          >
            Your stats
          </button>
          <button
            role="menuitem"
            className="link"
            onClick={() => {
              setOpen(false);
              actions.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
      {showStats && (
        <StatsDialog
          name={account.user.name}
          stats={account.stats}
          onClose={() => setShowStats(false)}
        />
      )}
    </div>
  );
}
