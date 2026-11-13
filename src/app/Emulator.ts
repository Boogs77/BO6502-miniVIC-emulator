// Emulator - controller: current machine, settings, run loop, input
//
// Every machine has its default BIOS and SD card: the Arcade6502 starts with the Arcade BIOS and the cabinet SD
// (public/sd_arcade.img.gz), the others with the BIOS chosen in the Media panel and the full SD.
//
// The loop runs on requestAnimationFrame. With audio on, the pace is set by the worklet
// queue (frames are run while there is less than ~70 ms of audio queued), so sound and
// video stay locked without stutter; without audio the browser clock is followed.

import { Machine, NTSC_FPS } from '../core/Machine';
import { MachineConfig, MachineId, buildMachine, defaultConfig } from '../machines/profiles';
import { AudioOutput } from '../audio/AudioOutput';
import {
  AudioBoard, JoystickBoard, KeyboardBoard, SdCardBoard, SerialBoard,
  JOY_DOWN, JOY_FIRE1, JOY_FIRE2, JOY_FIRE3, JOY_LEFT, JOY_RIGHT, JOY_START, JOY_UP,
  SW_COIN1, SW_COIN2, SW_SERVICE, SW_TEST,
} from '../boards/Boards';
import { buildSdImage, extendSdImage, SdProgram } from '../machines/sdimage';
import { GAMES, GAME_ENTRY, GAME_LOAD } from '../machines/games';
import { BiosId, ROMS } from '../machines/roms';
import { SdKind } from '../devices/SDCard';
import { SaveArea } from '../devices/SaveArea';
import { attachSaveStore } from './saveStore';
import { loadSettings, saveSettings, Settings } from './settings';
import { BoardType } from '../core/Board';

export type KeyMode = 'ps2' | 'joy';

/** COIN of a control panel: not a joystick bit, it goes to the SD VIA of the Arcade6502 (SW_COIN1/2) */
export const JOY_COIN = 0x100;

/** default SD images: full SD (games + apps), games SD, Arcade6502 cabinet SD; null = an image of the user */
export type SdDefault = 'full' | 'games' | 'arcade' | null;

/** physical keys -> joystick: P1 arrows + Z/X, P2 WASD + F/G */
const JOY_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, JOY_UP], ArrowDown: [0, JOY_DOWN], ArrowLeft: [0, JOY_LEFT], ArrowRight: [0, JOY_RIGHT],
  KeyZ: [0, JOY_FIRE1], KeyX: [0, JOY_FIRE2], Space: [0, JOY_FIRE1], ControlLeft: [0, JOY_FIRE1],
  KeyW: [1, JOY_UP], KeyS: [1, JOY_DOWN], KeyA: [1, JOY_LEFT], KeyD: [1, JOY_RIGHT],
  KeyF: [1, JOY_FIRE1], KeyG: [1, JOY_FIRE2],
};

/** Arcade6502 only: button 3 (C / H), START (1 or Enter / 2), COIN (5 / 6), like the MAME keys */
const ARCADE_KEYS: Record<string, [number, number]> = {
  KeyC: [0, JOY_FIRE3], Digit1: [0, JOY_START], Enter: [0, JOY_START], Digit5: [0, JOY_COIN],
  KeyH: [1, JOY_FIRE3], Digit2: [1, JOY_START], Digit6: [1, JOY_COIN],
};

/** Arcade6502 cabinet switches on the keyboard: 9 = SERVICE (system test), 0 = TEST (joystick test) */
const SWITCH_KEYS: Record<string, number> = { Digit9: SW_SERVICE, Digit0: SW_TEST };

/** BIOS jump table: JT_INIT_CRT (text mode with the BIOS font), called by the Arcade front-end before a game */
const JT_INIT_CRT = 0xFD09;

/** miniVIC applications played with the joystick, not the PS/2 keyboard (the keys go to the joystick) */
const JOYSTICK_APPS = new Set(['jukebox.bin']);

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
  /** BIOS in use: one of ROMS, or 'custom' for a file loaded by the user */
  bios: BiosId | 'custom' = 'std';
  /** SD image (extended in memory to 16 MB; the card writes into it) */
  sdImage: Uint8Array | null = null;
  sdName = '';
  /** the card was written since it was inserted or downloaded */
  sdModified = false;
  /** which bundled image is in the slot (switching to or from the Arcade6502 changes it) */
  sdDefault: SdDefault = null;
  /** SD save area (records, saved games): apart from the image, kept in the browser */
  readonly saves = new SaveArea();
  /** the save area is kept in the browser (false: lost on reload) */
  savesKept = false;

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
  // Arcade6502 cabinet switches (TEST, SERVICE): on screen and on the keyboard
  private switchVirtual = 0;
  private switchKeys = 0;

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

  get isArcade(): boolean {
    return this.config.id === 'arcade';
  }

  /** BIOS saved in the settings for the current machine */
  get biosSetting(): BiosId {
    return this.isArcade ? this.settings.arcadeBios : this.settings.bios;
  }

  /** loads the chosen BIOS and the default SD card (at startup) */
  async init(): Promise<void> {
    await this.loadRom(this.biosSetting).catch(() => this.loadRom(this.isArcade ? 'arcade' : 'std'));
    this.savesKept = await attachSaveStore(this.saves).catch(() => false);
    const keep = this.saves.onWrite;
    this.saves.onWrite = sector => { keep(sector); this.onState(); };
    await this.loadDefaultSd().catch(() => this.onMessage('Default games not found', 'error'));
    this.rebuild();
  }

  /** the default SD of the current machine: the cabinet SD for the Arcade6502, the full SD for the others */
  private async loadDefaultSd(): Promise<void> {
    if (this.isArcade) await this.loadArcadeSd().catch(() => this.loadFullSd());
    else await this.loadFullSd().catch(() => this.loadGamesSd());
  }

  /** fetches a gzipped SD image of public/ ("BOGS" directory checked) */
  private async fetchSdGz(file: string, what: string): Promise<Uint8Array> {
    const r = await fetch(`./${file}`);
    if (!r.ok || !r.body) throw new Error(`${what} not found`);
    let data = new Uint8Array(await r.arrayBuffer());
    // a server may already have removed the gzip layer (Content-Encoding): unpack only a real .gz
    if (data[0] === 0x1F && data[1] === 0x8B) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (data.length < 512 || data.length % 512 || String.fromCharCode(...data.subarray(0, 4)) !== 'BOGS') {
      throw new Error(`${what}: not an SD image`);
    }
    return data;
  }

  /**
   * default SD: public/sd_full.img.gz, the full SD of bo6502-SDbuilder (games, MiniVIC Apps, songs,
   * sample documents; the apps need the BIOS KEYB/SD), gzipped by scripts/pack-sd-full.mjs
   */
  async loadFullSd(): Promise<void> {
    const data = await this.fetchSdGz('sd_full.img.gz', 'full SD');
    this.sdImage = extendSdImage(data);
    this.sdModified = false;
    this.sdDefault = 'full';
    this.sdName = `Full SD: games + MiniVIC Apps (${data[15]} programs)`;
  }

  /**
   * default SD of the Arcade6502: public/sd_arcade.img.gz, the cabinet SD of bo6502-SDbuilder
   * (update_sd.py --mode arcade): the games, the MiniVIC Jukebox and its songs, and the arcade catalog
   * (list, pictures, descriptions) read by the Arcade BIOS front-end
   */
  async loadArcadeSd(): Promise<void> {
    const data = await this.fetchSdGz('sd_arcade.img.gz', 'Arcade6502 SD');
    this.sdImage = extendSdImage(data);
    this.sdModified = false;
    this.sdDefault = 'arcade';
    this.sdName = `Arcade6502 cabinet SD (${data[15]} programs + catalog)`;
  }

  /** fetches a BIOS image of the ROMS list (public/roms) */
  async loadRom(id: BiosId): Promise<void> {
    const rom = ROMS.find(r => r.id === id) ?? ROMS[0];
    const r = await fetch(`./roms/${rom.file}`);
    if (!r.ok) throw new Error(`${rom.title}: ${rom.file} not found`);
    this.romData = new Uint8Array(await r.arrayBuffer());
    this.romName = rom.title;
    this.bios = rom.id;
  }

  /** changes the BIOS: rebuilds the machine with the same SD image and, if it was on, powers it on again */
  async selectBios(id: BiosId): Promise<void> {
    await this.loadRom(id);
    if (this.isArcade) this.settings.arcadeBios = id;
    else this.settings.bios = id;
    this.save();
    const wasOn = this.powered;
    this.powerOff();
    this.rebuild();
    if (wasOn) this.powerOn();
  }

  /** short name of the BIOS for the status line */
  get biosLabel(): string {
    return this.bios === 'custom' ? 'custom ROM' : `BIOS ${ROMS.find(r => r.id === this.bios)?.version ?? ''}`;
  }

  /** changes the SD card type: the card is re-inserted, so the BIOS has to initialise it again */
  setSdKind(kind: SdKind): void {
    this.settings.sdKind = kind;
    this.save();
    const sd = this.machine.board<SdCardBoard>('sdcard');
    if (sd) {
      sd.card.kind = kind;
      sd.card.insert(this.sdImage);
    }
    this.onState();
  }

  async loadGamesSd(): Promise<void> {
    // public/sd.img (copied by bo6502-SDbuilder/update_sd.py) wins: it is the same SD as the real card.
    // The "BOGS" check also covers the Vite dev server, which answers index.html for missing files.
    const img = await fetch('./sd.img').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    if (img && img.byteLength >= 512 && img.byteLength % 512 === 0) {
      const data = new Uint8Array(img);
      if (String.fromCharCode(...data.subarray(0, 4)) === 'BOGS') {
        this.sdImage = extendSdImage(data);
        this.sdModified = false;
        this.sdName = `BO6502-SDbuilder SD (${data[15]} programs)`;
        this.sdDefault = 'games';
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
    this.sdImage = extendSdImage(buildSdImage(programs));
    this.sdModified = false;
    this.sdName = `miniVIC games (${programs.length} programs)`;
    this.sdDefault = 'games';
  }

  /** rebuilds the machine from the configuration (only with the machine off) */
  rebuild(): void {
    this.machine = buildMachine(this.config);
    if (this.romData) this.machine.loadRom(this.romData);
    const sd = this.machine.board<SdCardBoard>('sdcard');
    if (sd) {
      sd.card.kind = this.settings.sdKind;
      sd.card.onWrite = () => this.sdWritten();
      sd.card.saveArea = this.saves;
      sd.card.insert(this.sdImage);
    }
    const serial = this.machine.board<SerialBoard>('serial');
    if (serial) serial.acia.onTransmit = b => this.onSerial(b);
    this.updateJoysticks();
    this.applyAudioSettings();
    this.onState();
  }

  /**
   * changes the machine. Going to or from the Arcade6502 also changes the BIOS (the one saved for that machine)
   * and, if a bundled SD is in the slot, the SD (cabinet SD / full SD); an image of the user stays in.
   */
  async selectMachine(id: MachineId): Promise<void> {
    if (id === this.machineId) return;
    const wasOn = this.powered;
    if (wasOn) this.powerOff();
    const arcadeChanged = (id === 'arcade') !== this.isArcade;
    this.settings.machine = id;
    this.config = this.settings.configs[id];
    this.save();
    if (arcadeChanged) {
      this.releaseKeys();
      await this.loadRom(this.biosSetting).catch(e => this.onMessage(String((e as Error).message), 'error'));
      if (this.sdDefault !== null && (this.sdDefault === 'arcade') !== this.isArcade) {
        await this.loadDefaultSd().catch(e => this.onMessage(String((e as Error).message), 'error'));
      }
    }
    if (id !== this.machineId) return;   // another machine was chosen meanwhile
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

  /** the physical keys drive the joysticks (always on the Arcade6502: it has no keyboard) */
  get keysToJoystick(): boolean {
    return this.settings.keyMode === 'joy' || this.isArcade;
  }

  /** physical key event: true if the emulator used it */
  physicalKey(code: string, down: boolean, repeat: boolean): boolean {
    if (!this.powered) return false;
    if (this.keysToJoystick) {
      const sw = this.isArcade ? SWITCH_KEYS[code] : undefined;
      if (sw) {
        if (down) this.switchKeys |= sw;
        else this.switchKeys &= ~sw;
        this.updateJoysticks();
        return true;
      }
      const j = JOY_KEYS[code] ?? (this.isArcade ? ARCADE_KEYS[code] : undefined);
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
    this.switchKeys = 0;
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

  /** combined state of a joystick (for the UI): JOY_* bits, JOY_COIN for the coin of that player */
  joystickState(player: number): number {
    return this.joyVirtual[player] | this.joyKeys[player] | this.joyPad[player];
  }

  /** Arcade6502 cabinet switches pressed on screen */
  setVirtualSwitches(bits: number): void {
    this.switchVirtual = bits;
    this.updateJoysticks();
  }

  /** TEST / SERVICE switches pressed now (SW_* bits, for the UI) */
  get switchState(): number {
    return this.switchVirtual | this.switchKeys;
  }

  private updateJoysticks(): void {
    const j = this.joystick;
    if (j) for (let p = 0; p < 2; p++) j.setJoystick(p, this.joystickState(p) & 0xFF);
    // the coins and the TEST / SERVICE switches go to the SD board (wired only on the Arcade6502)
    const coins = (this.joystickState(0) & JOY_COIN ? SW_COIN1 : 0) | (this.joystickState(1) & JOY_COIN ? SW_COIN2 : 0);
    this.machine.board<SdCardBoard>('sdcard')?.setSwitches(coins | this.switchState);
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
      if (this.isArcade) {
        // Arcade6502: A, B, X = buttons 1-3, Start = START, Back/Select = COIN
        if (b(0)) v |= JOY_FIRE1;
        if (b(1)) v |= JOY_FIRE2;
        if (b(2)) v |= JOY_FIRE3;
        if (b(9)) v |= JOY_START;
        if (b(8)) v |= JOY_COIN;
      } else {
        if (b(0) || b(2)) v |= JOY_FIRE1;
        if (b(1) || b(3)) v |= JOY_FIRE2;
      }
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
  /** loads a ROM file chosen by the user (not saved in the settings) */
  setRom(data: Uint8Array, name: string): void {
    this.romData = data;
    this.romName = name;
    this.bios = 'custom';
    this.machine.loadRom(data);
    this.onState();
  }

  /** inserts an SD image, extended in memory to 16 MB for the documents area (the file is not changed) */
  setSdImage(image: Uint8Array | null, name: string, kind: SdDefault = null): void {
    this.sdImage = image && extendSdImage(image);
    this.sdName = name;
    this.sdModified = false;
    this.sdDefault = image ? kind : null;
    this.machine.board<SdCardBoard>('sdcard')?.card.insert(this.sdImage);
    this.onState();
  }

  private sdWritten(): void {
    if (this.sdModified) return;
    this.sdModified = true;
    this.onState();
  }

  /**
   * loads a program into RAM; with entry >= 0 it starts it (stack reset, interrupts masked
   * as after the BIOS). If the machine is off it powers it on and lets the BIOS start.
   * With the Arcade BIOS the program starts as from its front-end: through JT_INIT_CRT (text mode with the
   * BIOS font), which returns to the entry point.
   */
  loadProgram(data: Uint8Array, load: number, entry: number): void {
    const arcadeBios = this.bios === 'arcade';
    if (!this.powered) {
      this.powerOn();
      if (arcadeBios) {
        // the front-end initialises the boards and reads the SD catalog: wait until the card has been
        // idle for half a second (max 10 s)
        for (let i = 0, quiet = 0; i < 600 && quiet < 30; i++) {
          this.machine.runFrame();
          quiet = this.machine.board<SdCardBoard>('sdcard')?.card.selected ? 0 : quiet + 1;
        }
      } else {
        // the BIOS initialises the boards: wait for its key-wait loop (max 3 s)
        for (let i = 0; i < 180 && !(i > 20 && this.biosIdle()); i++) this.machine.runFrame();
      }
      this.machine.audio.take();
    }
    this.machine.poke(load, data);
    if (entry >= 0) {
      const cpu = this.machine.cpu;
      cpu.pc = entry;
      cpu.sp = 0xFF;
      cpu.p |= 0x04;
      cpu.waiting = cpu.stopped = false;
      if (arcadeBios) {
        // JSR JT_INIT_CRT with the entry point as return address
        this.machine.poke(0x01FE, Uint8Array.of((entry - 1) & 0xFF, (entry - 1) >> 8));
        cpu.sp = 0xFD;
        cpu.pc = JT_INIT_CRT;
      }
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
    if (this.machineId === 'bo6502') this.onMessage('The games are written for the miniVIC (VDP on NMI, audio $D38x, joystick $D58x)');
    this.setKeyMode('joy');
    this.loadProgram(new Uint8Array(await r.arrayBuffer()), GAME_LOAD, GAME_ENTRY);
  }

  /**
   * miniVIC application: needs the KEYB/SD BIOS (sector routines, extended keyboard); keys on the PS/2 keyboard.
   * A joystick application (the Jukebox) also runs on the Arcade6502 with the Arcade BIOS, like a game.
   */
  async runApp(file: string): Promise<void> {
    const r = await fetch(`./apps/${file}`);
    if (!r.ok) throw new Error(`${file} not found`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (this.isArcade && JOYSTICK_APPS.has(file) && this.bios === 'arcade') {
      this.loadProgram(data, GAME_LOAD, GAME_ENTRY);
      return;
    }
    if (this.machineId !== 'minivic') await this.selectMachine('minivic');
    if (this.bios !== 'keybsd') {
      await this.selectBios('keybsd');
      this.powerOff();   // loadProgram powers on and waits for the new BIOS to initialise the boards
      this.onMessage('The applications need the KEYB/SD BIOS: BIOS changed');
    }
    this.setKeyMode(JOYSTICK_APPS.has(file) ? 'joy' : 'ps2');
    this.loadProgram(data, GAME_LOAD, GAME_ENTRY);
  }

  /** demo of a BO6502 board: plugs the board into the rack (if needed) and starts the program at $1000 */
  async runDemo(file: string, board: BoardType): Promise<void> {
    const r = await fetch(`./demos/${file}`);
    if (!r.ok) throw new Error(`${file} not found`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (this.machineId !== 'bo6502') await this.selectMachine('bo6502');
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
