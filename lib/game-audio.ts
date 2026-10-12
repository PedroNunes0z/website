/**
 * Áudio procedural dos jogos via Web Audio API (zero assets).
 *
 * Efeitos sintetizados: chute na bola, toque no disco, rebote na parede,
 * trave de metal e festa da torcida no gol, além de um fundo de torcida em
 * loop baixo. Tudo nasce aqui com osciladores e ruído filtrado, então não há
 * download nem decodificação: custo de CPU desprezível e latência mínima.
 *
 * O contexto só é criado no primeiro gesto do usuário (exigência dos
 * navegadores), através de `ensure()`.
 */

type SfxKind = "kick" | "wall" | "post" | "goal";

const MUTE_KEY = "pedro-games-muted";

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
      } catch {
        this.muted = false;
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // sem persistência, segue só em memória
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  /** Cria/retoma o contexto. Chamar em gestos (clique, tecla) e no unmute. */
  ensure(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.startCrowd();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Torcida de fundo: ruído em loop baixo com filtro passa-baixa. */
  private startCrowd(): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.noiseBuffer(2);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    this.crowd = this.ctx.createGain();
    this.crowd.gain.value = 0.035;
    source.connect(filter).connect(this.crowd).connect(this.master);
    source.start();
  }

  private thump(frequency: number, duration: number, gain: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * 0.4), now + duration);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(envelope).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noiseHit(duration: number, cutoff: number, gain: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buffer = this.noiseBuffer(duration + 0.05);
    if (!buffer) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  private metallic(base: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = this.ctx.currentTime;
    for (const [frequency, gain] of [[base, 0.22], [base * 1.6, 0.12]] as Array<[number, number]>) {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      const envelope = this.ctx.createGain();
      envelope.gain.setValueAtTime(gain, now);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(envelope).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  }

  /** Gol: torcida explode e volta ao fundo em ~2 s. */
  private cheer(): void {
    if (!this.ctx || !this.crowd || this.muted) return;
    const now = this.ctx.currentTime;
    this.crowd.gain.cancelScheduledValues(now);
    this.crowd.gain.setValueAtTime(this.crowd.gain.value, now);
    this.crowd.gain.linearRampToValueAtTime(0.32, now + 0.15);
    this.crowd.gain.exponentialRampToValueAtTime(0.035, now + 2.2);
  }

  play(kind: SfxKind, intensity = 1): void {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    const power = Math.max(0.15, Math.min(1, intensity));
    switch (kind) {
      case "kick":
        this.thump(150, 0.13, 0.5 * power);
        this.noiseHit(0.07, 900, 0.25 * power);
        break;
      case "wall":
        this.noiseHit(0.08, 420, 0.4 * power);
        break;
      case "post":
        this.metallic(740);
        break;
      case "goal":
        this.cheer();
        this.thump(110, 0.3, 0.4);
        break;
    }
  }
}

export const gameAudio = new GameAudio();
