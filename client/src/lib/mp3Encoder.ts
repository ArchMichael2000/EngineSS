/**
 * Client-side MP3 encoding.
 * 
 * Uses the lamejs library for true MP3 encoding from PCM audio data.
 * Falls back to WAV with audio/mpeg MIME type if lamejs is unavailable.
 */

// Dynamic import of lamejs (loaded from CDN at runtime)
let lameEncoder: any = null;

async function loadLame(): Promise<any> {
  if (lameEncoder) return lameEncoder;
  
  try {
    // Try to use the globally loaded lamejs
    if ((window as any).lamejs) {
      lameEncoder = (window as any).lamejs;
      return lameEncoder;
    }
    
    // Load lamejs from CDN
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load lamejs'));
      document.head.appendChild(script);
    });
    
    lameEncoder = (window as any).lamejs;
    return lameEncoder;
  } catch {
    return null;
  }
}

export async function encodeToMp3(audioBuffer: AudioBuffer): Promise<Blob> {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0);
  const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
  
  // Try to use lamejs for real MP3 encoding
  const lame = await loadLame();
  
  if (lame && lame.Mp3Encoder) {
    return encodeMp3WithLame(lame, left, right, sampleRate, numChannels);
  }
  
  // Fallback: use MediaRecorder API if available
  try {
    return await encodeWithMediaRecorder(audioBuffer);
  } catch {
    // Final fallback: return WAV (clearly labeled)
    return encodeAsWavFallback(left, right, sampleRate);
  }
}

function encodeMp3WithLame(
  lame: any,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  numChannels: number
): Blob {
  const kbps = 192; // High quality MP3
  const encoder = new lame.Mp3Encoder(numChannels, sampleRate, kbps);
  
  const mp3Data: any[] = [];
  const blockSize = 1152; // LAME's frame size
  
  // Convert Float32 [-1,1] to Int16 [-32768, 32767]
  const leftInt16 = floatToInt16(left);
  const rightInt16 = floatToInt16(right);
  
  for (let i = 0; i < leftInt16.length; i += blockSize) {
    const leftChunk = leftInt16.subarray(i, i + blockSize);
    const rightChunk = rightInt16.subarray(i, i + blockSize);
    
    const mp3buf = numChannels === 1
      ? encoder.encodeBuffer(leftChunk)
      : encoder.encodeBuffer(leftChunk, rightChunk);
    
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf.buffer || mp3buf));
    }
  }
  
  // Flush remaining data
  const end = encoder.flush();
  if (end.length > 0) {
    mp3Data.push(end);
  }
  
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

function floatToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

async function encodeWithMediaRecorder(audioBuffer: AudioBuffer): Promise<Blob> {
  // Create an offline context and play the buffer through MediaRecorder
  const ctx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);
  
  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(dest.stream, { mimeType });
  const chunks: Blob[] = [];
  
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    
    recorder.onstop = () => {
      ctx.close();
      resolve(new Blob(chunks, { type: mimeType }));
    };
    
    recorder.onerror = () => {
      ctx.close();
      reject(new Error('MediaRecorder failed'));
    };
    
    source.onended = () => {
      setTimeout(() => recorder.stop(), 100);
    };
    
    recorder.start(100);
    source.start();
  });
}

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'audio/webm';
}

function encodeAsWavFallback(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Blob {
  // Downsample to reduce file size (simulating compression)
  const targetRate = 22050;
  const ratio = sampleRate / targetRate;
  const newLength = Math.floor(left.length / ratio);
  
  const numChannels = 2;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = newLength * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  let offset = 44;
  for (let i = 0; i < newLength; i++) {
    const srcIdx = Math.floor(i * ratio);
    
    let sL = Math.max(-1, Math.min(1, left[srcIdx]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
    offset += 2;
    
    let sR = Math.max(-1, Math.min(1, right[srcIdx]));
    view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
    offset += 2;
  }
  
  // Return as audio/wav since we can't truly encode MP3 without a library
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
