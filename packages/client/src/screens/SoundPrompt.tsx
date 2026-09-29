import { audioReady, mediaBlocked, onAudioChange, unlockAudio } from '@split-signal/puzzles/audio';
import { useSyncExternalStore } from 'react';

const soundOn = () => typeof AudioContext === 'undefined' || (audioReady() && !mediaBlocked());

/**
 * Phones keep a page silent until it's tapped, and after a reload you can be back in a room
 * without having tapped anything. Any tap turns sound on; this just makes it obvious.
 */
export function SoundPrompt() {
  const on = useSyncExternalStore(onAudioChange, soundOn, () => true);
  if (on) return null;
  return (
    <button className="sound-prompt" onClick={unlockAudio}>
      🔇 Sound is off until you tap. Tap here to turn it on.
    </button>
  );
}
