/**
 * Áudio dos jogos com amostras reais em `/games/sounds` e fallback
 * procedural (Web Audio API, zero dependências).
 *
 * Amostras:
 * - `kick.mp3` pé na bola; `puck-hit.mp3` taco e tabelas no gelo;
 * - `futebol_beam.mp3` traves nos dois jogos;
 * - `dash.mp3`/`dash2.mp3` alternados no dash;
 * - `stadium.mp3` torcida de fundo em loop; `stadium2.mp3` festa do gol.
 *
 * Para não ficar repetitivo, cada disparo varia o tom (`playbackRate`) e o
 * ganho pela intensidade, e o material adapta o timbre (parede usa a amostra
 * abafada com passa-baixa). Se algum arquivo falhar, o sintetizador interno
 * assume sem quebrar o jogo.
 *
 * O contexto só é criado após gesto do usuário (exigência dos navegadores)
 * via `ensure()`; `preload()` pode ser chamado no mount para buscar e
 * decodificar antes, sem precisar de gesto.
 */

type SfxKind = "kick" | "wall" | "post" | "goal" | "dash";
type GameKind = "haxball" | "hoquei";

const FILES = {
  kick: "/games/sounds/kick.mp3",
  puck: "/games/sounds/puck-hit.mp3",
  beam: "/games/sounds/futebol_beam.mp3",
  dashA: "/games/sounds/dash.mp3",
  dashB: "/games/sounds/dash2.mp3",
  stadium: "/games/sounds/stadium.mp3",
  stadiumGoal: "/games/sounds/stadium2.mp3",
} as const;

const MUTE_KEY = "pedro-games-muted";

function jitter(base: number, amount: number): number {
  return base + (Math.random() * 2 - 1) * amount;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private crowdStarted = false;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private dashFlip = false;
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

  private createContext(): boolean {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    }
    return true;
  }

  /** Cria/retoma o contexto. Chamar em gestos (clique, tecla) e no unmute. */
  ensure(): void {
    if (!this.createContext() || !this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.startCrowd();
  }

  /** Busca e decodifica as amostras (pode rodar no mount, sem gesto). */
  preload(): void {
    if (typeof window === "undefined" || this.loading) return;
    this.createContext();
    this.loading = (async () => {
      await Promise.allSettled(
        Object.entries(FILES).map(async ([key, url]) => {
          if (this.buffers.has(key)) return;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`audio ${response.status}`);
          const data = await response.arrayBuffer();
          if (!this.ctx) return;
          const buffer = await this.ctx.decodeAudioData(data);
          this.buffers.set(key, buffer);
        }),
      );
      this.startCrowd();
    })();
  }

  /** Torcida de fundo em loop baixo. */
  private startCrowd(): void {
    if (!this.ctx || !this.master || this.crowdStarted) return;
    const buffer = this.buffers.get("stadium");
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.crowd = this.ctx.createGain();
    this.crowd.gain.value = 0.3;
    source.connect(this.crowd).connect(this.master);
    source.start();
    this.crowdStarted = true;
  }

  private playSample(key: keyof typeof FILES, rate: number, gain: number, cutoff?: number): boolean {
    if (!this.ctx || !this.master || this.muted) return false;
    const buffer = this.buffers.get(key);
    if (!buffer) return false;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.4, rate);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + buffer.duration / Math.max(0.4, rate));
    if (cutoff) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      source.connect(filter).connect(envelope).connect(this.master);
    } else {
      source.connect(envelope).connect(this.master);
    }
    source.start(now);
    return true;
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
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

  /** Gol: festa da torcida sobre o fundo, que incha e volta em ~4 s. */
  private cheer(): void {
    if (!this.ctx || this.muted) return;
    this.playSample("stadiumGoal", jitter(1, 0.03), 0.85);
    if (this.ctx && this.crowd) {
      const now = this.ctx.currentTime;
      this.crowd.gain.cancelScheduledValues(now);
      this.crowd.gain.setValueAtTime(this.crowd.gain.value, now);
      this.crowd.gain.linearRampToValueAtTime(0.65, now + 0.2);
      this.crowd.gain.exponentialRampToValueAtTime(0.3, now + 4);
    } else {
      this.thump(110, 0.3, 0.4);
    }
  }

  play(kind: SfxKind, intensity = 1, game: GameKind = "haxball"): void {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    const power = Math.max(0.15, Math.min(1, intensity));
    switch (kind) {
      case "kick":
        if (game === "hoquei") {
          if (!this.playSample("puck", jitter(1, 0.08), 0.85 * power)) {
            this.thump(220, 0.09, 0.45 * power);
          }
        } else if (!this.playSample("kick", jitter(1, 0.08), 0.85 * power)) {
          this.thump(150, 0.13, 0.5 * power);
          this.noiseHit(0.07, 900, 0.25 * power);
        }
        break;
      case "wall":
        // Mesmo material, abafado: tom mais grave com passa-baixa.
        if (game === "hoquei") {
          if (!this.playSample("puck", jitter(0.8, 0.07), 0.5 * power, 1200)) {
            this.noiseHit(0.08, 500, 0.4 * power);
          }
        } else if (!this.playSample("kick", jitter(0.68, 0.06), 0.45 * power, 700)) {
          this.noiseHit(0.08, 420, 0.4 * power);
        }
        break;
      case "post":
        if (!this.playSample("beam", game === "hoquei" ? jitter(1.15, 0.06) : jitter(1, 0.05), 0.7 * power)) {
          this.metallic(740);
        }
        break;
      case "dash":
        this.dashFlip = !this.dashFlip;
        if (!this.playSample(this.dashFlip ? "dashA" : "dashB", jitter(1, 0.05), 0.5 * power)) {
          this.noiseHit(0.18, 1800, 0.35 * power);
        }
        break;
      case "goal":
        this.cheer();
        break;
    }
  }
}

export const gameAudio = new GameAudio();
