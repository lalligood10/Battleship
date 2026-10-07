/** Speech commentary helpers plus the shared sound/mute surface (playback lives in audio/). */
import { audioManager } from '../audio/manager';

export { isMuted, setMuted } from '../audio/mute';

const SPEECH_KEY = 'broadside.commentary.speech';
const SPEECH_VOLUME_KEY = 'broadside.commentary.volume';

export function isSpeechEnabled(): boolean {
  return localStorage.getItem(SPEECH_KEY) === 'true';
}
export function setSpeechEnabled(enabled: boolean) {
  localStorage.setItem(SPEECH_KEY, String(enabled));
  if (!enabled && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
export function speechVolume(): number {
  const value = localStorage.getItem(SPEECH_VOLUME_KEY);
  if (value === null) return 0.8;
  const stored = Number(value);
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.8;
}
export function setSpeechVolume(volume: number) {
  localStorage.setItem(SPEECH_VOLUME_KEY, String(Math.max(0, Math.min(1, volume))));
}
export function speakCommentary(text: string) {
  if (!isSpeechEnabled() || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = speechVolume();
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  } catch {
    // Speech is best-effort; never let it break the game.
  }
}

export function play(kind: 'miss' | 'hit' | 'sunk' | 'win' | 'lose' | 'bomb') {
  try {
    switch (kind) {
      case 'miss':
        audioManager.play('splash');
        break;
      case 'hit':
        audioManager.play('explosion');
        break;
      case 'sunk':
        audioManager.play('explosion');
        audioManager.play('sinkRumble');
        break;
      case 'bomb':
        audioManager.play('bomb');
        break;
      case 'win':
        audioManager.play('win');
        break;
      case 'lose':
        audioManager.play('lose');
        break;
    }
  } catch {
    // Audio is best-effort; never let it break the game.
  }
}
