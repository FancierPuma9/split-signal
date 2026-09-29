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
    else if (voice.mic === 'off') onEnableMic();
  };

  return (
    <div className="voice-status">
      <button
        className={`mic mic-${voice.mic}`}
        onClick={click}
        disabled={voice.mic === 'requesting' || voice.mic === 'unsupported'}
        aria-label={MIC_LABELS[voice.mic]}
        title={
          voice.mic === 'blocked'
            ? 'Allow microphone access in your browser settings, then reload'
            : undefined
        }
      >
        {MIC_LABELS[voice.mic]}
      </button>
      <span className="small muted">
        {voice.peers.length === 0
          ? 'Voice off'
          : `Voice with ${connected.map((p) => nameOf(p.id)).join(', ') || 'nobody yet'}`}
        {connecting.length > 0 && ` (connecting ${connecting.length})`}
      </span>
    </div>
  );
}
