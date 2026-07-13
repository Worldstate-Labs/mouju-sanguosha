export type GameSoundKind = "attack" | "card" | "defend" | "heal" | "draw" | "equip" | "skill" | "damage" | "discard" | "choice" | "turn" | "system";

const SOUND_NOTES: Record<GameSoundKind, number[]> = {
  attack: [196, 147],
  card: [294, 392],
  defend: [523, 392],
  heal: [330, 440, 587],
  draw: [440, 494],
  equip: [659, 988],
  skill: [392, 523, 784],
  damage: [130, 98],
  discard: [247, 196],
  choice: [392, 494],
  turn: [294, 440],
  system: [262, 330],
};

export const GAME_SOUND_KINDS = Object.freeze(Object.keys(SOUND_NOTES) as GameSoundKind[]);

export class GameAudioEngine {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private phrase = 0;
  private musicEnabled = false;
  private effectsEnabled = false;

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled) void this.unlock();
    else this.stopMusic();
  }

  setEffectsEnabled(enabled: boolean) {
    this.effectsEnabled = enabled;
    if (enabled) void this.unlock();
  }

  async unlock() {
    if (typeof window === "undefined") return false;
    if (!this.context) {
      this.context = new AudioContext();
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus.gain.value = 0.34;
      this.effectsBus.gain.value = 0.72;
      this.musicBus.connect(this.context.destination);
      this.effectsBus.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (this.musicEnabled) this.startMusic();
    return this.context.state === "running";
  }

  play(kind: GameSoundKind, options: { pan?: number; major?: boolean; force?: boolean } = {}) {
    if ((!this.effectsEnabled && !options.force) || document.visibilityState === "hidden") return;
    void this.unlock().then((ready) => {
      if (!ready || !this.context || !this.effectsBus) return;
      const now = this.context.currentTime + 0.015;
      const notes = SOUND_NOTES[kind];
      const duration = kind === "skill" ? 0.7 : kind === "damage" || kind === "attack" ? 0.48 : 0.38;
      const wave: OscillatorType = kind === "damage" ? "square" : kind === "attack" || kind === "equip" ? "triangle" : "sine";
      const spatialBus = this.context.createGain();
      const panner = typeof this.context.createStereoPanner === "function" ? this.context.createStereoPanner() : null;
      if (panner) {
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, options.pan ?? 0)), now);
        spatialBus.connect(panner).connect(this.effectsBus);
      } else spatialBus.connect(this.effectsBus);
      if (options.major && this.musicEnabled && this.musicBus) {
        this.musicBus.gain.cancelScheduledValues(now);
        this.musicBus.gain.setTargetAtTime(0.11, now, 0.05);
        this.musicBus.gain.setTargetAtTime(0.34, now + 0.72, 0.28);
      }
      notes.forEach((frequency, index) => this.tone(frequency, now + index * 0.075, duration, wave, kind === "damage" ? 0.09 : 0.055, spatialBus));
      if (kind === "attack" || kind === "damage" || kind === "defend" || kind === "draw" || kind === "discard") {
        this.noise(now, kind === "damage" ? 0.28 : 0.16, kind === "damage" ? 0.12 : 0.045, kind === "defend" ? 1700 : kind === "draw" || kind === "discard" ? 900 : 520, spatialBus);
      }
      window.setTimeout(() => { try { spatialBus.disconnect(); panner?.disconnect(); } catch {} }, 1300);
    }).catch(() => undefined);
  }

  destroy() {
    this.stopMusic();
    const context = this.context;
    this.context = null;
    this.musicBus = null;
    this.effectsBus = null;
    if (context && context.state !== "closed") void context.close();
  }

  private tone(frequency: number, at: number, duration: number, wave: OscillatorType, peak: number, bus = this.effectsBus) {
    if (!this.context || !bus) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }

  private noise(at: number, duration: number, peak: number, cutoff: number, bus = this.effectsBus) {
    if (!this.context || !bus) return;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(bus);
    source.start(at);
  }

  private startMusic() {
    if (!this.context || !this.musicBus || this.context.state !== "running" || this.musicTimer !== null) return;
    this.schedulePhrase();
  }

  private stopMusic() {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
    if (this.context && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
      this.musicBus.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.12);
    }
  }

  private schedulePhrase() {
    if (!this.context || !this.musicBus || !this.musicEnabled || this.context.state !== "running") {
      this.musicTimer = null;
      return;
    }
    const now = this.context.currentTime + 0.08;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setTargetAtTime(0.34, now, 0.2);
    const pentatonic = [196, 220, 262, 294, 330, 392];
    const patterns = [[0, 2, 3, 5, 3, 2], [2, 3, 5, 4, 3, 0], [0, 3, 2, 5, 4, 2]];
    const pattern = patterns[this.phrase % patterns.length];
    pattern.forEach((note, index) => this.tone(pentatonic[note], now + index * 1.12, 1.35, "sine", index === 0 ? 0.035 : 0.024, this.musicBus));
    this.tone(this.phrase % 2 ? 98 : 110, now, 5.9, "sine", 0.028, this.musicBus);
    this.phrase += 1;
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = null;
      this.schedulePhrase();
    }, 7200);
  }
}
