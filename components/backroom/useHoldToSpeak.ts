'use client';

/**
 * Hold to speak. The single persistent input of the Back Room.
 *
 * Captures audio on the device with MediaRecorder (works on iOS Safari and
 * Android Chrome, which is the constraint that gates the whole slice), then
 * hands the recorded blob back on release. Transcription and resolution
 * happen server-side; on-device speech APIs are deliberately not used.
 *
 * Safari records audio/mp4, Chrome records audio/webm; we pick whatever the
 * browser supports and pass the mime type through so the server transcriber
 * knows the container.
 */
import { useCallback, useRef, useState } from 'react';

export type SpeakState = 'idle' | 'recording' | 'processing' | 'error';

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of CANDIDATE_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on old Safari; fall through */
    }
  }
  return '';
}

export interface UseHoldToSpeak {
  state:   SpeakState;
  error:   string | null;
  start:   () => Promise<void>;
  stop:    () => void;
}

export function useHoldToSpeak(onUtterance: (blob: Blob) => void | Promise<void>): UseHoldToSpeak {
  const [state, setState] = useState<SpeakState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    if (state === 'recording') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState('processing');
        try {
          await onUtterance(blob);
          setState('idle');
        } catch (err) {
          setState('error');
          setError(err instanceof Error ? err.message : 'could not process that');
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setState('recording');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'microphone unavailable');
    }
  }, [state, onUtterance]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
  }, []);

  return { state, error, start, stop };
}
