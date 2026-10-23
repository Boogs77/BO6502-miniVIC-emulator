// Emulator - controller: macchina corrente, impostazioni, ciclo di esecuzione, input
//
// Il ciclo gira su requestAnimationFrame. Con l'audio attivo il ritmo lo da' la coda
// del worklet (si eseguono frame finche' ci sono ~70 ms di audio in coda), cosi' suono e
// video restano agganciati senza scatti; senza audio si segue l'orologio del browser.

import { Machine, NTSC_FPS } from '../core/Machine';
import { MachineConfig, MachineId, buildMachine, defaultConfig } from '../machines/profiles';
import { AudioOutput } from '../audio/AudioOutput';
import {
  AudioBoard, JoystickBoard, KeyboardBoard, SdCardBoard, SerialBoard,
  JOY_DOWN, JOY_FIRE1, JOY_FIRE2, JOY_LEFT, JOY_RIGHT, JOY_UP,
} from '../boards/Boards';
import { buildSdImage, SdProgram } from '../machines/sdimage';
import { GAMES, GAME_ENTRY, GAME_LOAD } from '../machines/games';
import { loadSettings, saveSettings, Settings } from './settings';
import { BoardType } from '../core/Board';

export type KeyMode = 'ps2' | 'joy';

/** tasti fisici -> joystick: P1 frecce + Z/X, P2 WASD + F/G */
const JOY_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, JOY_UP], ArrowDown: [0, JOY_DOWN], ArrowLeft: [0, JOY_LEFT], ArrowRight: [0, JOY_RIGHT],
  KeyZ: [0, JOY_FIRE1], KeyX: [0, JOY_FIRE2], Space: [0, JOY_FIRE1], ControlLeft: [0, JOY_FIRE1],
  KeyW: [1, JOY_UP], KeyS: [1, JOY_DOWN], KeyA: [1, JOY_LEFT], KeyD: [1, JOY_RIGHT],
  KeyF: [1, JOY_FIRE1], KeyG: [1, JOY_FIRE2],
};

export class Emulator {
  machine: Machine;
  config: MachineConfig;
  settings: Settings;
  readonly audio = new AudioOutput();

  powered = false;
  paused = false;
  /** velocita' (1 = tempo reale) */
  speed = 1;
  romData: Uint8Array | null = null;
  romName = '';
  sdImage: Uint8Array | null = null;
  sdName = '';

  /** chiamata a ogni frame emulato e mostrato */
  onFrame: () => void = () => {};
  /** cambio di stato (accensione, pausa, macchina...) */
  onState: () => void = () => {};
  /** byte trasmesso dalla seriale */
  onSerial: (byte: number) => void = () => {};
  /** messaggio per l'utente */
  onMessage: (text: string, kind?: 'info' | 'error') => void = () => {};

  // sorgenti dei joystick: virtuali (mouse), tastiera fisica, gamepad
  readonly joyVirtual = [0, 0];
  private joyKeys = [0, 0];
  private joyPad = [0, 0];

  private raf = 0;
  private lastTime = 0;
  private timeAcc = 0;
  fps = 0;
  private fpsCount = 0;
  private fpsTime = 0;

  constructor() {
    this.settings = loadSettings();
    this.config = this.settings.configs[this.settings.machine];
    this.machine = buildMachine(this.config);
  }

  // ---------------- macchina e configurazione ----------------
  get machineId(): MachineId {
    return this.config.id;
  }

  /** carica ROM e SD predefinite (all'avvio) */
  async init(): Promise<void> {
    await this.loadDefaultRom();
    await this.loadGamesSd().catch(() => this.onMessage('Giochi predefiniti non trovati', 'error'));
    this.rebuild();
  }

  async loadDefaultRom(): Promise<void> {
    const r = await fetch('./roms/minivic.bin');
    if (!r.ok) throw new Error('ROM predefinita non trovata');
    this.romData = new Uint8Array(await r.arrayBuffer());
    this.romName = 'BIOS miniVIC 30.09.26 (WozMon + MS BASIC + SD)';
  }

  async loadGamesSd(): Promise<void> {
    const programs: SdProgram[] = [];
    for (const g of GAMES) {
      const r = await fetch(`./games/${g.file}`);
      if (!r.ok) continue;
      programs.push({ name: g.title, data: new Uint8Array(await r.arrayBuffer()), load: GAME_LOAD, entry: GAME_ENTRY, run: true });
    }
    if (!programs.length) throw new Error('nessun gioco');
    this.sdImage = buildSdImage(programs);
    this.sdName = `Giochi miniVIC (${programs.length} programmi)`;
  }

  /** ricrea la macchina dalla configurazione (solo a macchina spenta) */
  rebuild(): void {
    this.machine = buildMachine(this.config);
    if (this.romData) this.machine.loadRom(this.romData);
    const sd = this.machine.board<SdCardBoard>('sdcard');
    if (sd) sd.card.insert(this.sdImage);
    const serial = this.machine.board<SerialBoard>('serial');
    if (serial) serial.acia.onTransmit = b => this.onSerial(b);
    this.applyAudioSettings();
    this.onState();
  }

  selectMachine(id: MachineId): void {
    if (id === this.machineId) return;
    const wasOn = this.powered;
    if (wasOn) this.powerOff();
    this.settings.machine = id;
    this.config = this.settings.configs[id];
    this.save();
    this.rebuild();
    if (wasOn) this.powerOn();
  }

  /** modifica la configurazione (rack) e ricostruisce la macchina */
  updateConfig(change: (c: MachineConfig) => void): void {
    if (this.powered) return;
    change(this.config);
    this.save();
    this.rebuild();
  }

  resetConfig(): void {
    if (this.powered) return;
    this.config = this.settings.configs[this.machineId] = defaultConfig(this.machineId);
    this.save();
    this.rebuild();
  }

  save(): void {
    saveSettings(this.settings);
  }

  // ---------------- alimentazione ----------------
  powerOn(): void {
    if (this.powered) return;
    void this.audio.start()
      .then(() => { this.machine.audio.outputRate = this.audio.sampleRate; })
      .catch(() => this.onMessage('Audio non disponibile nel browser', 'error'));
    this.machine.randomRam = this.settings.randomRam;
    this.machine.powerOn();
    this.powered = true;
    this.paused = false;
    this.audio.clear();
    this.machine.audio.take();
    this.startLoop();
    this.onState();
  }

  powerOff(): void {
    if (!this.powered) return;
    this.powered = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.clear();
    this.onState();
    this.onFrame();
  }

  reset(): void {
    if (!this.powered) return;
    this.keyboard?.keyboard.releaseAll();
    this.machine.reset();
    this.onState();
  }

  setPaused(p: boolean): void {
    if (!this.powered) return;
    this.paused = p;
    if (p) this.audio.clear();
    this.onState();
  }

  // ---------------- ciclo ----------------
  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    this.lastTime = performance.now();
    this.timeAcc = 0;
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.loopStep(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private loopStep(t: number): void {
    const dt = Math.min(0.1, (t - this.lastTime) / 1000);
    this.lastTime = t;
    if (!this.powered || this.paused) return;
    this.pollGamepads();

    let frames: number;
    const frameTime = 1 / (NTSC_FPS * this.speed);
    if (this.audio.running && this.speed === 1 && this.settings.volume > 0) {
      // agganciato all'audio: riempi la coda fino a ~70 ms
      const target = 0.07;
      const missing = target - this.audio.buffered;
      frames = Math.max(0, Math.min(4, Math.ceil(missing * NTSC_FPS)));
      this.timeAcc = 0;
    } else {
      this.timeAcc += dt;
      frames = Math.min(8, Math.floor(this.timeAcc / frameTime));
      this.timeAcc -= frames * frameTime;
    }

    for (let i = 0; i < frames; i++) {
      if (!this.machine.runFrame()) {
        this.paused = true;
        this.onMessage(`Breakpoint a $${this.machine.cpu.pc.toString(16).toUpperCase().padStart(4, '0')}`);
        this.onState();
        break;
      }
      const samples = this.machine.audio.take();
      if (this.speed === 1) this.audio.push(samples);
      this.fpsCount++;
    }
    if (t - this.fpsTime >= 1000) {
      this.fps = this.fpsCount * 1000 / (t - this.fpsTime);
      this.fpsCount = 0;
      this.fpsTime = t;
    }
    if (frames > 0 || this.paused) this.onFrame();
  }

  /** debugger: una istruzione */
  step(): void {
    if (!this.powered) return;
    this.paused = true;
    this.machine.stepInstruction();
    this.machine.audio.take();
    this.onState();
    this.onFrame();
  }

  /** debugger: un frame */
  stepFrame(): void {
    if (!this.powered) return;
    this.paused = true;
    // se siamo fermi su un breakpoint, prima superalo
    const bp = this.machine.breakpoint;
    this.machine.breakpoint = null;
    this.machine.stepInstruction();
    this.machine.breakpoint = bp;
    this.machine.runFrame();
    this.machine.audio.take();
    this.onState();
    this.onFrame();
  }

  resume(): void {
    if (!this.powered) return;
    if (this.machine.hitBreakpoint) {
      const bp = this.machine.breakpoint;
      this.machine.breakpoint = null;
      this.machine.stepInstruction();
      this.machine.breakpoint = bp;
      this.machine.hitBreakpoint = false;
    }
    this.setPaused(false);
  }

  // ---------------- audio ----------------
  applyAudioSettings(): void {
    const s = this.settings;
    this.machine.audio.outputRate = this.audio.sampleRate;
    this.machine.audio.volume = s.muted ? 0 : s.volume;
    this.machine.audio.mono = s.mono;
  }

  get audioBoard(): AudioBoard | undefined {
    return this.machine.board<AudioBoard>('audio');
  }

  // ---------------- tastiera e joystick ----------------
  get keyboard(): KeyboardBoard | undefined {
    return this.machine.board<KeyboardBoard>('keyboard');
  }

  get joystick(): JoystickBoard | undefined {
    return this.machine.board<JoystickBoard>('joystick');
  }

  /** tasto fisico premuto: true se l'emulatore lo ha usato */
  physicalKey(code: string, down: boolean, repeat: boolean): boolean {
    if (!this.powered) return false;
    if (this.settings.keyMode === 'joy') {
      const j = JOY_KEYS[code];
      if (!j) return false;
      if (down) this.joyKeys[j[0]] |= j[1];
      else this.joyKeys[j[0]] &= ~j[1];
      this.updateJoysticks();
      return true;
    }
    const kb = this.keyboard?.keyboard;
    if (!kb) return false;
    return down ? kb.keyDown(code, repeat) : kb.keyUp(code);
  }

  releaseKeys(): void {
    this.joyKeys = [0, 0];
    this.keyboard?.keyboard.releaseAll();
    this.updateJoysticks();
  }

  setKeyMode(mode: KeyMode): void {
    this.releaseKeys();
    this.settings.keyMode = mode;
    this.save();
    this.onState();
  }

  setVirtualJoystick(player: number, bits: number): void {
    this.joyVirtual[player] = bits;
    this.updateJoysticks();
  }

  /** stato combinato di un joystick (per l'interfaccia) */
  joystickState(player: number): number {
    return this.joyVirtual[player] | this.joyKeys[player] | this.joyPad[player];
  }

  private updateJoysticks(): void {
    const j = this.joystick;
    if (!j) return;
    for (let p = 0; p < 2; p++) j.setJoystick(p, this.joystickState(p));
  }

  private pollGamepads(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const next = [0, 0];
    let p = 0;
    for (const pad of pads) {
      if (!pad || p > 1) continue;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      let v = 0;
      if (b(12) || ay < -0.5) v |= JOY_UP;
      if (b(13) || ay > 0.5) v |= JOY_DOWN;
      if (b(14) || ax < -0.5) v |= JOY_LEFT;
      if (b(15) || ax > 0.5) v |= JOY_RIGHT;
      if (b(0) || b(2)) v |= JOY_FIRE1;
      if (b(1) || b(3)) v |= JOY_FIRE2;
      next[p++] = v;
    }
    if (next[0] !== this.joyPad[0] || next[1] !== this.joyPad[1]) {
      this.joyPad = next;
      this.updateJoysticks();
    }
  }

  // ---------------- seriale ----------------
  serialInput(byte: number): void {
    this.machine.board<SerialBoard>('serial')?.acia.receive(byte);
  }

  // ---------------- caricamenti ----------------
  setRom(data: Uint8Array, name: string): void {
    this.romData = data;
    this.romName = name;
    this.machine.loadRom(data);
    this.onState();
  }

  setSdImage(image: Uint8Array | null, name: string): void {
    this.sdImage = image;
    this.sdName = name;
    this.machine.board<SdCardBoard>('sdcard')?.card.insert(image);
    this.onState();
  }

  /**
   * carica un programma in RAM; con entry >= 0 lo avvia (stack azzerato, interrupt mascherati
   * come dopo il BIOS). Se la macchina e' spenta la accende e lascia partire il BIOS.
   */
  loadProgram(data: Uint8Array, load: number, entry: number): void {
    if (!this.powered) {
      this.powerOn();
      // il BIOS inizializza le schede: si aspetta il suo ciclo d'attesa del tasto (max 3 s)
      for (let i = 0; i < 180 && !(i > 20 && this.biosIdle()); i++) this.machine.runFrame();
      this.machine.audio.take();
    }
    this.machine.poke(load, data);
    if (entry >= 0) {
      const cpu = this.machine.cpu;
      cpu.pc = entry;
      cpu.sp = 0xFF;
      cpu.p |= 0x04;
      cpu.waiting = cpu.stopped = false;
      this.paused = false;
    }
    this.onState();
  }

  /** il BIOS e' nel menu, in attesa di un tasto (CHRIN a $A94E-$A973 o ciclo $E015-$E018) */
  private biosIdle(): boolean {
    const pc = this.machine.cpu.pc;
    return (pc >= 0xE015 && pc <= 0xE018) || (pc >= 0xA94E && pc <= 0xA973);
  }

  async runGame(file: string): Promise<void> {
    const r = await fetch(`./games/${file}`);
    if (!r.ok) throw new Error(`${file} non trovato`);
    if (this.machineId !== 'minivic') this.onMessage('I giochi sono scritti per il miniVIC (VDP su NMI, audio $D38x, joystick $D58x)');
    this.setKeyMode('joy');
    this.loadProgram(new Uint8Array(await r.arrayBuffer()), GAME_LOAD, GAME_ENTRY);
  }

  /** demo di una scheda del BO6502: inserisce la scheda nel rack (se serve) e avvia il programma a $1000 */
  async runDemo(file: string, board: BoardType): Promise<void> {
    const r = await fetch(`./demos/${file}`);
    if (!r.ok) throw new Error(`${file} non trovato`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (this.machineId !== 'bo6502') this.selectMachine('bo6502');
    const cfg = this.config.boards.find(b => b.type === board);
    // LCD legacy e LED decodificano entrambe tutta la pagina $Dxxx: ne resta inserita una sola
    const rival = this.config.boards.find(b => b.enabled && b.type !== board &&
      (b.type === 'lcd' || b.type === 'leds') && (board === 'lcd' || board === 'leds') && b.base === cfg?.base);
    if ((cfg && !cfg.enabled) || rival) {
      this.powerOff();
      this.updateConfig(c => {
        for (const b of c.boards) {
          if (b.type === board) b.enabled = true;
          if (rival && b.type === rival.type) b.enabled = false;
        }
      });
      this.onMessage(rival ? `Scheda ${board} inserita al posto di ${rival.type}` : `Scheda ${board} inserita nel rack`);
    }
    this.setKeyMode('ps2');
    this.loadProgram(data, 0x1000, 0x1000);
  }
}
