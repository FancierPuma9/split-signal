import { useEffect, useRef, useState } from 'react';

/** The bits of Google Identity Services we use. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        auto_select?: boolean;
      }): void;
      renderButton(
        element: HTMLElement,
        options: {
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'small' | 'medium' | 'large';
          text?: 'signin_with' | 'signin' | 'continue_with';
          shape?: 'pill' | 'rectangular';
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleIdentity> | null = null;
let initializedFor: string | null = null;
/** Every button hands credentials to the latest handler. */
let handler: (credential: string) => void = () => {};

/** Loads Google's sign-in script once, only when a sign-in button is actually shown. */
function loadGoogle(): Promise<GoogleIdentity> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('No GIS')));
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signin' | 'continue_with';
}

/** Google's own "Sign in with Google" button. The ID token goes to the server to verify. */
export function GoogleSignIn({
  clientId,
  onCredential,
  size = 'medium',
  text = 'signin_with',
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    handler = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGoogle().then(
      (google) => {
        if (cancelled || !container.current) return;
        if (initializedFor !== clientId) {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (response) => handler(response.credential),
          });
          initializedFor = clientId;
        }
        google.accounts.id.renderButton(container.current, {
          theme: 'filled_black',
          size,
          text,
          shape: 'pill',
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clientId, size, text]);

  if (failed) return <span className="small muted">Google sign-in is unavailable</span>;
  return <div ref={container} className="google-signin" />;
}
