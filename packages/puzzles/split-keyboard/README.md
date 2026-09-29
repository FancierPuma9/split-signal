# Split Keyboard

Everyone sees the same phrase. The keyboard (26 letters, space, apostrophe) is dealt out at random,
so each player owns a scattered handful of keys, highlighted on their own keyboard only. The server
accepts a keypress only from the owner of that key, and only if it's the next character.

- **Input:** physical keyboard on desktop, on-screen keyboard on mobile.
- **Comms:** signals only: `nudge` (1 s cooldown). No voice. A nudge just flashes on teammates'
  screens: "it might be yours!"
- **Win:** race. First team through both phrases.
- **Teams:** 2-3 players (keys split evenly).
- **Phrases:** picked from a seeded list (`phrases.ts`) so every team types the same text.
