import { useEffect, useState } from 'react';
import { decodeClip } from './audio';

/**
 * Decodes a base64 audio asset (from the puzzle's assets()) into an AudioBuffer. Null while it
 * loads or before the asset arrives; 'error' if this device can't decode it.
 */
export function useAssetBuffer(data: string | undefined): AudioBuffer | 'error' | null {
  const [decoded, setDecoded] = useState<{ data: string; buffer: AudioBuffer | 'error' } | null>(
    null,
  );
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    decodeClip(data).then(
      (buffer) => !cancelled && setDecoded({ data, buffer }),
      () => !cancelled && setDecoded({ data, buffer: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, [data]);
  return decoded && decoded.data === data ? decoded.buffer : null;
}
