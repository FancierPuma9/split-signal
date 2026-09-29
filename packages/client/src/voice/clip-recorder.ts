const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** Records short clips from the microphone with MediaRecorder. */
export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Records until stop() or maxMs, and resolves with the audio. */
  record(mic: MediaStream, maxMs: number): Promise<{ blob: Blob; durationMs: number }> {
    if (this.recording) return Promise.reject(new Error('Already recording'));
    if (typeof MediaRecorder === 'undefined') {
      return Promise.reject(new Error("This browser can't record audio"));
    }
    // Record from a clone that is always enabled, so muting voice chat doesn't silence clips.
    const tracks = mic.getAudioTracks().map((t) => {
      const clone = t.clone();
      clone.enabled = true;
      return clone;
    });
    const stream = new MediaStream(tracks);
    const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];
    const started = performance.now();
    this.recorder = recorder;

    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(this.timer);
        for (const t of tracks) t.stop();
        if (this.recorder === recorder) this.recorder = null;
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        finish();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        resolve({ blob: new Blob(chunks, { type }), durationMs: performance.now() - started });
      };
      recorder.onerror = () => {
        finish();
        reject(new Error('Recording failed'));
      };
      recorder.start();
      this.timer = setTimeout(() => this.stop(), maxMs);
    });
  }

  stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the clip'));
    reader.readAsDataURL(blob);
  });
}
