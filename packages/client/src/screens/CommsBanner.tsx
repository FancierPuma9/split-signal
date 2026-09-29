import type { CommsRule, CommsState } from '@split-signal/shared';
import { useCountdown } from '../puzzle/useCountdown';

interface CommsBannerProps {
  rule: CommsRule;
  comms: CommsState & { receivedAt: number };
  meId: string;
  paused: boolean;
}

/** Who holds the floor (one-way voice) and how long voice stays open (timed voice). */
export function CommsBanner({ rule, comms, meId, paused }: CommsBannerProps) {
  const voiceLeft = useCountdown(
    comms.voiceRemainingMs ?? 0,
    comms.receivedAt,
    !paused && (comms.voiceRemainingMs ?? 0) > 0,
  );
  const swapIn = useCountdown(
    comms.swapInMs ?? 0,
    comms.receivedAt,
    !paused && comms.swapInMs !== undefined,
  );

  if (rule.type === 'voice-alternating' && comms.activePlayerId) {
    const live = comms.activePlayerId === meId;
    return (
      <div className={`comms-banner ${live ? 'live' : 'listening'}`} role="status">
        {live ? '🎙 You’re live: talk now' : '🎧 Listening: your mic is off'}
        {comms.swapInMs !== undefined && ` · swapping in ${Math.ceil(swapIn / 1000)}s`}
      </div>
    );
  }
  if (rule.type === 'voice-timed' && comms.voiceRemainingMs !== undefined) {
    return (
      <div className={`comms-banner ${voiceLeft > 0 ? 'live' : 'listening'}`} role="status">
        {voiceLeft > 0 ? `🎙 Voice closes in ${Math.ceil(voiceLeft / 1000)}s` : '🤐 Voice is closed'}
      </div>
    );
  }
  return null;
}
