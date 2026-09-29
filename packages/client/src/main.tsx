import { StrictMode } from 'react';
import { unlockAudio } from '@split-signal/puzzles/audio';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Phones only start sound inside a user gesture, and most of the game's sound is triggered by
// the server, so every tap or key press unlocks it. (On touch screens it's pointerup, not
// pointerdown, that counts as a gesture.)
for (const event of ['pointerup', 'keydown', 'click']) {
  window.addEventListener(event, unlockAudio, { capture: true });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
