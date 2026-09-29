// localStorage can be unavailable (private windows, blocked storage); everything here degrades to
// "nothing remembered" instead of throwing.
//
// Seat tokens live in localStorage so a player can get back in after closing the tab. Tabs share
// localStorage, though (and developers open one tab per player), so each room keeps a list of
// seats, and a per-tab marker in sessionStorage records which seat this tab holds. Only that tab
// rejoins automatically; other tabs offer "Rejoin as ..." instead of silently taking a seat over.

const NAME_KEY = 'split-signal:name';
const SESSION_KEY = 'split-signal:session';
const seatsKey = (code: string) => `split-signal:seats:${code}`;
const activeKey = (code: string) => `split-signal:active:${code}`;

export interface SavedSeat {
  token: string;
  name: string;
}

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // Not remembered; rejoining after a reload won't work in this browser.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

function isSeat(value: unknown): value is SavedSeat {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SavedSeat).token === 'string' &&
    typeof (value as SavedSeat).name === 'string'
  );
}

function writeSeats(code: string, seats: SavedSeat[]): void {
  write(local, seatsKey(code), seats.length > 0 ? JSON.stringify(seats) : null);
}

export const storage = {
  name: () => read(local, NAME_KEY) ?? '',
  setName: (name: string) => write(local, NAME_KEY, name),

  /** The sign-in session token, shared by every tab in this browser. */
  sessionToken: () => read(local, SESSION_KEY),
  setSessionToken: (token: string | null) => write(local, SESSION_KEY, token),

  /** Seats saved for a room in this browser. */
  savedSeats(code: string): SavedSeat[] {
    try {
      const parsed: unknown = JSON.parse(read(local, seatsKey(code)) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isSeat) : [];
    } catch {
      return [];
    }
  },

  /** The seat token this tab holds in a room, if any. */
  activeToken(code: string): string | null {
    const token = read(session, activeKey(code));
    return token && this.savedSeats(code).some((s) => s.token === token) ? token : null;
  },

  claimSeat(code: string, seat: SavedSeat): void {
    writeSeats(code, [...this.savedSeats(code).filter((s) => s.token !== seat.token), seat]);
    write(session, activeKey(code), seat.token);
  },

  /** This tab stops holding its seat (another tab took it over); the seat stays saved. */
  releaseSeat(code: string): void {
    write(session, activeKey(code), null);
  },

  /** Forget one seat, or every seat in the room if no token is given. */
  forgetSeat(code: string, token?: string): void {
    writeSeats(code, token ? this.savedSeats(code).filter((s) => s.token !== token) : []);
    if (!token || read(session, activeKey(code)) === token) write(session, activeKey(code), null);
  },
};
