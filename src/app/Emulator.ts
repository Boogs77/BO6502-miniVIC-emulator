// Emulator - controller: current machine, settings, run loop, input
//
// The loop runs on requestAnimationFrame. With audio on, the pace is set by the worklet
// queue (frames are run while there is less than ~70 ms of audio queued), so sound and
// video stay locked without stutter; without audio the browser clock is followed.

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

/** physical keys -> joystick: P1 arrows + Z/X, P2 WASD + F/G */
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
  /** speed (1 = real time) */
  speed = 1;
  romData: Uint8Array | null = null;
  romName = '';
  sdImage: Uint8Array | null = null;
  sdName = '';

  /** called on every emulated and displayed frame */
  onFrame: () => void = () => {};
  /** state change (power, pause, machine...) */
  onState: () => void = () => {};
  /** byte transmitted by the serial port */
  onSerial: (byte: number) => void = () => {};
  /** message for the user */
  onMessage: (text: string, kind?: 'info' | 'error') => void = () => {};

  // joystick sources: virtual (mouse), physical keyboard, gamepad
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

  // ---------------- machine and configuration ----------------
  get machineId(): MachineId {
    return this.config.id;
  }

  /** loads the default ROM and SD card (at startup) */
  async init(): Promise<void> {
    await this.loadDefaultRom();
    await this.loadGamesSd().catch(() => this.onMessage('Default games not found', 'error'));
    this.rebuild();
  }

  async loadDefaultRom(): Promise<void> {
    const r = await fetch('./roms/minivic.bin');
    if (!r.ok) throw new Error('Default ROM not found');
    this.romData = new Uint8Array(await r.arrayBuffer());
    this.romName = 'BIOS miniVIC 30.09.26 (WozMon + MS BASIC + SD)';
  }

  async loadGamesSd(): Promise<void> {
    // public/sd.img (copied by bo6502-SDbuilder/update_sd.py) wins: it is the same SD as the real card.
    // The "BOGS" check also covers the Vite dev server, which answers index.html for missing files.
    const img = await fetch('./sd.img').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    if (img && img.byteLength >= 512 && img.byteLength % 512 === 0) {
      const data = new Uint8Array(img);
      if (String.fromCharCode(...data.subarray(0, 4)) === 'BOGS') {
        this.sdImage = data;
        this.sdName = `BO6502-SDbuilder SD (${data[15]} programs)`;
        return;
      }
    }
    const programs: SdProgram[] = [];
    for (const g of GAMES) {
      const r = await fetch(`./games/${g.file}`);
      if (!r.ok) continue;
      programs.push({ name: g.title, data: new Uint8Array(await r.arrayBuffer()), load: GAME_LOAD, entry: GAME_ENTRY, run: true });
    }
    if (!programs.length) throw new Error('no games');
    this.sdImage = buildSdImage(programs);
    this.sdName = `miniVIC games (${programs.length} programs)`;
  }

  /** rebuilds the machine from the configuration (only with the machine off) */
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

  /** changes the configuration (rack) and rebuilds the machine */
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

  // ---------------- power ----------------
  powerOn(): void {
    if (this.powered) return;
    void this.audio.start()
      .then(() => { this.machine.audio.outputRate = this.audio.sampleRate; })
      .catch(() => this.onMessage('Audio not available in this browser', 'error'));
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

  // ---------------- loop ----------------
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
      // locked to audio: fill the queue up to ~70 ms
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
        this.onMessage(`Breakpoint at $${this.machine.cpu.pc.toString(16).toUpperCase().padStart(4, '0')}`);
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

  /** debugger: one instruction */
  step(): void {
    if (!this.powered) return;
    this.paused = true;
    this.machine.stepInstruction();
    this.machine.audio.take();
    this.onState();
    this.onFrame();
  }

  /** debugger: one frame */
  stepFrame(): void {
    if (!this.powered) return;
    this.paused = true;
    // if stopped on a breakpoint, step past it first
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

  // ---------------- keyboard and joysticks ----------------
  get keyboard(): KeyboardBoard | undefined {
    return this.machine.board<KeyboardBoard>('keyboard');
  }

  get joystick(): JoystickBoard | undefined {
    return this.machine.board<JoystickBoard>('joystick');
  }

  /** physical key event: true if the emulator used it */
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

  /** combined state of a joystick (for the UI) */
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

  // ---------------- serial ----------------
  serialInput(byte: number): void {
    this.machine.board<SerialBoard>('serial')?.acia.receive(byte);
  }

  // ---------------- loading ----------------
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
   * loads a program into RAM; with entry >= 0 it starts it (stack reset, interrupts masked
   * as after the BIOS). If the machine is off it powers it on and lets the BIOS start.
   */
  loadProgram(data: Uint8Array, load: number, entry: number): void {
    if (!this.powered) {
      this.powerOn();
      // the BIOS initialises the boards: wait for its key-wait loop (max 3 s)
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

  /** the BIOS is in its menu, waiting for a key (CHRIN at $A94E-$A973 or loop $E015-$E018) */
  private biosIdle(): boolean {
    const pc = this.machine.cpu.pc;
    return (pc >= 0xE015 && pc <= 0xE018) || (pc >= 0xA94E && pc <= 0xA973);
  }

  async runGame(file: string): Promise<void> {
    const r = await fetch(`./games/${file}`);
    if (!r.ok) throw new Error(`${file} not found`);
    if (this.machineId !== 'minivic') this.onMessage('The games are written for the miniVIC (VDP on NMI, audio $D38x, joystick $D58x)');
    this.setKeyMode('joy');
    this.loadProgram(new Uint8Array(await r.arrayBuffer()), GAME_LOAD, GAME_ENTRY);
  }

  /** demo of a BO6502 board: plugs the board into the rack (if needed) and starts the program at $1000 */
  async runDemo(file: string, board: BoardType): Promise<void> {
    const r = await fetch(`./demos/${file}`);
    if (!r.ok) throw new Error(`${file} not found`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (this.machineId !== 'bo6502') this.selectMachine('bo6502');
    const cfg = this.config.boards.find(b => b.type === board);
    // legacy LCD and LEDs both decode the whole $Dxxx page: only one stays plugged in
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
      this.onMessage(rival ? `Board ${board} plugged in instead of ${rival.type}` : `Board ${board} plugged into the rack`);
    }
    this.setKeyMode('ps2');
    this.loadProgram(data, 0x1000, 0x1000);
  }
}
