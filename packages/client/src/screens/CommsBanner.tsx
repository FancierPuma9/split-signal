import { findRule, type CommsSpec, type CommsState } from '@split-signal/shared';
import { useCountdown } from '../puzzle/useCountdown';

interface CommsBannerProps {
  spec: CommsSpec;
  comms: CommsState & { receivedAt: number };
  meId: string;
  paused: boolean;
  /** Voice with reportLevel: your mic loudness (dBFS), null while the mic is off. */
  micLevel?: number | null | undefined;
}

/** dBFS shown as an empty meter and as a full one. */
const METER_FLOOR_DB = -60;
const METER_CEIL_DB = -10;

/**
 * Who holds the floor (one-way voice), how long voice stays open (timed voice), and how loud you
 * are when the puzzle listens to that.
 */
export function CommsBanner({ spec, comms, meId, paused, micLevel }: CommsBannerProps) {
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

  if (micLevel !== undefined) {
    const fill =
      micLevel === null
        ? 0
        : Math.max(0, Math.min(1, (micLevel - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB)));
    return (
      <div className="comms-banner loudness" role="status">
        <span>{micLevel === null ? '🎙 Mic off' : '🎙 Your loudness'}</span>
        <span className="loudness-meter" aria-hidden="true">
          <span style={{ width: `${fill * 100}%` }} />
        </span>
      </div>
    );
  }
  if (findRule(spec, 'voice-alternating') && comms.activePlayerId) {
    const live = comms.activePlayerId === meId;
    return (
      <div className={`comms-banner ${live ? 'live' : 'listening'}`} role="status">
        {live ? '🎙 You’re live: talk now' : '🎧 Listening: your mic is off'}
        {comms.swapInMs !== undefined && ` · swapping in ${Math.ceil(swapIn / 1000)}s`}
      </div>
    );
  }
  if (findRule(spec, 'voice-timed') && comms.voiceRemainingMs !== undefined) {
    return (
      <div className={`comms-banner ${voiceLeft > 0 ? 'live' : 'listening'}`} role="status">
        {voiceLeft > 0 ? `🎙 Voice closes in ${Math.ceil(voiceLeft / 1000)}s` : '🤐 Voice is closed'}
      </div>
    );
  }
  return null;
}
