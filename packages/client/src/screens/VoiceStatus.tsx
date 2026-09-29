import type { VoiceSnapshot } from '../voice/voice-manager';

interface VoiceStatusProps {
  voice: VoiceSnapshot;
  nameOf: (playerId: string) => string;
  onMute: (muted: boolean) => void;
  onEnableMic: () => void;
}

const MIC_LABELS: Record<VoiceSnapshot['mic'], string> = {
  off: 'Enable mic',
  requesting: 'Allow mic…',
  on: 'Mic on',
  muted: 'Muted',
  blocked: 'Mic blocked',
  unsupported: 'No mic support',
};

/** Mic toggle plus who you can currently hear. The server decides the second part. */
export function VoiceStatus({ voice, nameOf, onMute, onEnableMic }: VoiceStatusProps) {
  const connected = voice.peers.filter((p) => p.state === 'connected');
  const connecting = voice.peers.filter((p) => p.state !== 'connected');
  const click = () => {
    if (voice.mic === 'on') onMute(true);
    else if (voice.mic === 'muted') onMute(false);
    // Asking again after a refusal works if the player has since allowed it in site settings.
    else if (voice.mic === 'off' || voice.mic === 'blocked') onEnableMic();
  };

  return (
    <div className="voice-status">
      <button
        className={`mic mic-${voice.mic}`}
        onClick={click}
        disabled={voice.mic === 'requesting' || voice.mic === 'unsupported'}
        aria-label={MIC_LABELS[voice.mic]}
      >
        {MIC_LABELS[voice.mic]}
      </button>
      <span className="small muted">
        {voice.mic === 'blocked'
          ? // Shown, not a tooltip: phones have no hover.
            'Allow the microphone for this site in your browser settings, then tap Mic blocked.'
          : voice.peers.length === 0
            ? 'Voice off'
            : `Voice with ${connected.map((p) => nameOf(p.id)).join(', ') || 'nobody yet'}`}
        {voice.mic !== 'blocked' && connecting.length > 0 && ` (connecting ${connecting.length})`}
      </span>
    </div>
  );
}
