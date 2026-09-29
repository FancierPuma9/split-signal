import type { Room } from './room';

/**
 * All room access goes through this interface; nothing else touches the underlying map. Rooms are
 * plain data, so a persistent store (e.g. Redis as a write-through cache) is a one-file change.
 */
export interface RoomStore {
  get(code: string): Room | undefined;
  set(room: Room): void;
  delete(code: string): void;
  list(): Room[];
}

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  set(room: Room): void {
    this.rooms.set(room.code, room);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }
}
