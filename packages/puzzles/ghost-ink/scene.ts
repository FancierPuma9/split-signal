/** Width / height of the scene. Positions are normalized to [0, 1] on both axes. */
export const ASPECT = 4 / 3;

export interface SceneObject {
  id: string;
  label: string;
  icon: string;
}

/** The full palette. Every Placer sees all of it; the target scene uses a subset. */
export const PALETTE: readonly SceneObject[] = [
  { id: 'tree', label: 'Tree', icon: '🌳' },
  { id: 'house', label: 'House', icon: '🏠' },
  { id: 'dog', label: 'Dog', icon: '🐕' },
  { id: 'boat', label: 'Boat', icon: '⛵' },
  { id: 'sun', label: 'Sun', icon: '☀️' },
  { id: 'ladder', label: 'Ladder', icon: '🪜' },
  { id: 'bucket', label: 'Bucket', icon: '🪣' },
  { id: 'chair', label: 'Chair', icon: '🪑' },
  { id: 'key', label: 'Key', icon: '🔑' },
  { id: 'cloud', label: 'Cloud', icon: '☁️' },
  { id: 'fish', label: 'Fish', icon: '🐟' },
  { id: 'hat', label: 'Hat', icon: '🎩' },
];

export const objectById = new Map(PALETTE.map((o) => [o.id, o]));
