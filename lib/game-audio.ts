/**
 * Áudio dos jogos com amostras reais em `/games/sounds` e fallback
 * procedural (Web Audio API, zero dependências).
 *
 * Amostras e momentos:
 * - `kick.mp3` pé na bola; `puck-hit.mp3` taco e tabelas no gelo;
 * - `futebol_beam.mp3` traves nos dois jogos; `net-hit.mp3` rede no gol;
 * - `dash.mp3`/`dash2.mp3` alternados no dash;
 * - `metal-whistle.mp3` e `one-metal-whistle.mp3` apito de início,
 *   `end-metal-whistle.mp3` apito final;
 * - `football-commentary-*.mp3` narração do gol (alternadas);
 * - `stadium.mp3` torcida de fundo em loop; `stadium2.mp3` + `stomps`
 *   na festa do gol; `menu-theme-music.mp3` tema dos menus.
 *
 * Para não ficar repetitivo, cada disparo varia o tom (`playbackRate`) e o
 * ganho pela intensidade, e o material adapta o timbre (parede usa a amostra
 * abafada com passa-baixa). Se algum arquivo falhar ou ainda estiver
 * carregando, o sintetizador interno assume sem quebrar o jogo.
 *
 * Modos: `playMenu()`/`stopMenu()` para as telas, `startMatch()`/`stopMatch()`
 * para a partida (torcida). O contexto abre após gesto via `ensure()`;
 * `preload()` busca e decodifica cedo, sem precisar de gesto.
 */

type SfxKind = "kick" | "wall" | "post" | "goal" | "dash" | "net" | "commentary" | "whistleStart" | "whistleEnd";
type GameKind = "haxball" | "hoquei";

const FILES = {
  kick: "/games/sounds/kick.mp3",
  puck: "/games/sounds/puck-hit.mp3",
  beam: "/games/sounds/futebol_beam.mp3",
  net: "/games/sounds/net-hit.mp3",
  dashA: "/games/sounds/dash.mp3",
  dashB: "/games/sounds/dash2.mp3",
  whistleStart: "/games/sounds/one-metal-whistle.mp3",
  whistleStartAlt: "/games/sounds/metal-whistle.mp3",
  whistleEnd: "/games/sounds/end-metal-whistle.mp3",
  commentaryA: "/games/sounds/football-commentary-with-goal-scored.mp3",
  commentaryB: "/games/sounds/football-commentary-with-goal-scored-1.mp3",
  stadium: "/games/sounds/stadium.mp3",
  stadiumGoal: "/games/sounds/stadium2.mp3",
  stomps: "/games/sounds/powerful-stomps-claps-cheering-sport-rhythmic-applause.mp3",
  menuTheme: "/games/sounds/menu-theme-music.mp3",
} as const;

const MUTE_KEY = "pedro-games-muted";
const VOLUME_KEY = "pedro-games-volume";

function jitter(base: number, amount: number): number {
  return base + (Math.random() * 2 - 1) * amount;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private menuSource: AudioBufferSourceNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private dashFlip = false;
  private commentaryFlip = false;
  private muted = false;
  private volume = 0.8;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
        const saved = Number(window.localStorage.getItem(VOLUME_KEY));
        if (Number.isFinite(saved)) this.volume = Math.max(0, Math.min(1, saved));
      } catch {
        this.muted = false;
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    try {
      window.localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // sem persistência, segue só em memória
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // sem persistência, segue só em memória
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  private createContext(): boolean {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    return true;
  }

  /** Cria/retoma o contexto. Chamar em gestos (clique, tecla) e no unmute. */
  ensure(): void {
    if (!this.createContext() || !this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
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
    })();
  }

  /** Tema dos menus em loop (bri baixo para não brigar com cliques). */
  playMenu(): void {
    this.ensure();
    if (!this.ctx || !this.master || this.menuSource) return;
    const buffer = this.buffers.get("menuTheme");
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.32;
    source.connect(gain).connect(this.master);
    source.start();
    this.menuSource = source;
  }

  stopMenu(): void {
    try {
      this.menuSource?.stop();
    } catch {
      // já parado
    }
    this.menuSource = null;
  }

  /** Torcida de fundo da partida em loop baixo. */
  startMatch(): void {
    this.ensure();
    if (!this.ctx || !this.master || this.crowdSource) return;
    const buffer = this.buffers.get("stadium");
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.crowd = this.ctx.createGain();
    this.crowd.gain.value = 0.12;
    source.connect(this.crowd).connect(this.master);
    source.start();
    this.crowdSource = source;
  }

  stopMatch(): void {
    try {
      this.crowdSource?.stop();
    } catch {
      // já parado
    }
    this.crowdSource = null;
    this.crowd = null;
  }

  private playSample(key: keyof typeof FILES, rate: number, gain: number, cutoff?: number, delay = 0): boolean {
    if (!this.ctx || !this.master || this.muted) return false;
    const buffer = this.buffers.get(key);
    if (!buffer) return false;
    const safeRate = Math.max(0.4, rate);
    const now = this.ctx.currentTime + Math.max(0, delay);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = safeRate;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + buffer.duration / safeRate);
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

  /** Gol: rede, narração alternada, festa da torcida e fundo que incha e volta. */
  private cheer(): void {
    if (!this.ctx || this.muted) return;
    this.playSample("net", jitter(1, 0.04), 0.9);
    this.commentaryFlip = !this.commentaryFlip;
    this.playSample(this.commentaryFlip ? "commentaryA" : "commentaryB", jitter(1, 0.02), 0.9, undefined, 0.15);
    this.playSample("stadiumGoal", jitter(1, 0.03), 0.8);
    this.playSample("stomps", jitter(1, 0.04), 0.45, undefined, 0.35);
    if (this.ctx && this.crowd) {
      const now = this.ctx.currentTime;
      this.crowd.gain.cancelScheduledValues(now);
      this.crowd.gain.setValueAtTime(this.crowd.gain.value, now);
      this.crowd.gain.linearRampToValueAtTime(0.5, now + 0.2);
      this.crowd.gain.exponentialRampToValueAtTime(0.12, now + 4);
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
          if (!this.playSample("puck", jitter(1, 0.08), 1.0 * power)) {
            this.thump(220, 0.09, 0.45 * power);
          }
        } else if (!this.playSample("kick", jitter(1, 0.08), 1.0 * power)) {
          this.thump(150, 0.13, 0.5 * power);
          this.noiseHit(0.07, 900, 0.25 * power);
        }
        break;
      case "wall":
        // Mesmo material, abafado: tom mais grave com passa-baixa.
        if (game === "hoquei") {
          if (!this.playSample("puck", jitter(0.8, 0.07), 0.7 * power, 1200)) {
            this.noiseHit(0.08, 500, 0.4 * power);
          }
        } else if (!this.playSample("kick", jitter(0.68, 0.06), 0.7 * power, 700)) {
          this.noiseHit(0.08, 420, 0.4 * power);
        }
        break;
      case "post":
        if (!this.playSample("beam", game === "hoquei" ? jitter(1.15, 0.06) : jitter(1, 0.05), 1.0 * power)) {
          this.metallic(740);
        }
        break;
      case "dash":
        this.dashFlip = !this.dashFlip;
        if (!this.playSample(this.dashFlip ? "dashA" : "dashB", jitter(1, 0.05), 0.65 * power)) {
          this.noiseHit(0.18, 1800, 0.35 * power);
        }
        break;
      case "net":
        if (!this.playSample("net", jitter(1, 0.04), 0.9 * power)) {
          this.noiseHit(0.15, 800, 0.5 * power);
        }
        break;
      case "commentary":
        this.commentaryFlip = !this.commentaryFlip;
        this.playSample(this.commentaryFlip ? "commentaryA" : "commentaryB", jitter(1, 0.02), 0.9 * power);
        break;
      case "whistleStart":
        if (!this.playSample("whistleStart", jitter(1, 0.02), 0.8 * power)) {
          this.noiseHit(0.3, 2500, 0.4 * power);
        }
        break;
      case "whistleEnd":
        if (!this.playSample("whistleEnd", jitter(1, 0.02), 0.85 * power)) {
          this.noiseHit(0.8, 2500, 0.4 * power);
        }
        break;
      case "goal":
        this.cheer();
        break;
    }
  }
}

export const gameAudio = new GameAudio();
