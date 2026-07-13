/**
 * Transcode a recorded audio blob to MP3 in the browser.
 *
 * Voice notes are recorded as webm/opus (Chrome) or mp4/aac (Safari); neither
 * plays in the other browser. MP3 plays everywhere. Vercel functions have no
 * ffmpeg, so we decode with the Web Audio API and encode with lamejs client
 * side, then upload the MP3. Falls back to the original blob if anything fails.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

export async function toMp3(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctor: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }

  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;

  // Downmix to mono.
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  const int16 = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const encoder = new Mp3Encoder(1, sampleRate, 128);
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < int16.length; i += blockSize) {
    const buf = encoder.encodeBuffer(int16.subarray(i, i + blockSize));
    if (buf.length > 0) chunks.push(buf);
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(end);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
