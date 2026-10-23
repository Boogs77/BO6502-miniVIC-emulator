// App - layout e collegamenti dell'interfaccia

import { Emulator } from '../app/Emulator';
import { MACHINE_NAMES, MachineId } from '../machines/profiles';
import { h, hex } from './dom';
import { Screen } from './Screen';
import { Terminal } from './Terminal';
import { VirtualKeyboard } from './VirtualKeyboard';
import { Joypad } from './Joypad';
import { Displays } from './Displays';
import { gamesPanel } from './panels/GamesPanel';
import { MediaPanel } from './panels/MediaPanel';
import { RackPanel } from './panels/RackPanel';
import { AudioPanel } from './panels/AudioPanel';
import { DebugPanel } from './panels/DebugPanel';

type TabId = 'games' | 'media' | 'rack' | 'audio' | 'terminal' | 'debug';

const TABS: Array<[TabId, string]> = [
  ['games', 'Giochi'], ['media', 'Media'], ['rack', 'Rack'], ['audio', 'Audio'], ['terminal', 'Seriale'], ['debug', 'Debug'],
];

export class App {
  private emu = new Emulator();
  private screen = new Screen();
  private terminal = new Terminal();
  private vkb = new VirtualKeyboard();
  private displays = new Displays();
  private pads: Joypad[];
  private media: MediaPanel;
  private rack: RackPanel;
  private audioPanel: AudioPanel;
  private debug: DebugPanel;
  private tab: TabId = 'games';
  private panels = new Map<TabId, HTMLElement>();
  private tabButtons = new Map<TabId, HTMLElement>();
  private toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  private toastTimer = 0;
  private lastSlowUpdate = 0;

  // elementi della barra
  private powerBtn = h('button', { type: 'button', class: 'power', 'aria-pressed': 'false' }, h('span', { class: 'led' }), 'POWER');
  private resetBtn = h('button', { type: 'button' }, 'RESET');
  private pauseBtn = h('button', { type: 'button' }, 'Pausa');
  private machineBtns = new Map<MachineId, HTMLElement>();
  private keyModeBtn = h('button', { type: 'button', class: 'keymode' });
  private muteBtn = h('button', { type: 'button', class: 'icon', 'aria-label': 'Audio' });
  private speedSel = h('select', { 'aria-label': 'Velocità' },
    ...[0.25, 0.5, 1, 2, 4].map(s => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  private status = h('div', { class: 'statusbar' });
  private keyboardDeck: HTMLElement;
  private joyDeck: HTMLElement;

  constructor(root: HTMLElement) {
    const emu = this.emu;
    this.pads = [0, 1].map(p => new Joypad(p, bits => emu.setVirtualJoystick(p, bits)));
    this.media = new MediaPanel(emu);
    this.rack = new RackPanel(emu);
    this.audioPanel = new AudioPanel(emu);
    this.debug = new DebugPanel(emu);

    this.panels.set('games', gamesPanel(emu));
    this.panels.set('media', this.media.el);
    this.panels.set('rack', this.rack.el);
    this.panels.set('audio', this.audioPanel.el);
    this.panels.set('terminal', h('div', { class: 'panel-body' },
      h('p', { class: 'hint' }, 'Porta seriale W65C51 (19200 8N1). Clicca sul terminale per scrivere: i tasti arrivano alla ricezione dell’ACIA.'),
      this.terminal.el,
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => this.terminal.clear() }, 'Pulisci'))));
    this.panels.set('debug', this.debug.el);

    // ---------- barra superiore ----------
    const machineSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Macchina' });
    for (const id of ['bo6502', 'minivic'] as MachineId[]) {
      const b = h('button', { type: 'button', role: 'radio', onclick: () => emu.selectMachine(id) }, MACHINE_NAMES[id]);
      this.machineBtns.set(id, b);
      machineSeg.append(b);
    }
    this.powerBtn.addEventListener('click', () => (emu.powered ? emu.powerOff() : emu.powerOn()));
    this.resetBtn.addEventListener('click', () => emu.reset());
    this.pauseBtn.addEventListener('click', () => (emu.paused ? emu.resume() : emu.setPaused(true)));
    this.speedSel.addEventListener('change', () => { emu.speed = Number(this.speedSel.value); });
    this.keyModeBtn.addEventListener('click', () => emu.setKeyMode(emu.settings.keyMode === 'ps2' ? 'joy' : 'ps2'));
    this.muteBtn.addEventListener('click', () => {
      emu.settings.muted = !emu.settings.muted;
      emu.applyAudioSettings();
      emu.save();
      this.refreshState();
    });

    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '65C02'), h('span', {}, 'BO6502 · miniVIC ', h('small', {}, 'emulator'))),
      machineSeg,
      h('div', { class: 'controls' }, this.powerBtn, this.resetBtn, this.pauseBtn, this.speedSel),
      h('div', { class: 'controls right' }, this.keyModeBtn, this.muteBtn,
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Schermo intero', title: 'Schermo intero', onclick: () => this.screen.el.requestFullscreen?.() }, '⛶')));

    // ---------- tastiera e joystick ----------
    const showKb = h('input', { type: 'checkbox', checked: emu.settings.showKeyboard });
    const showJoy = h('input', { type: 'checkbox', checked: emu.settings.showJoysticks });
    this.keyboardDeck = h('div', { class: 'deck-item' }, this.vkb.el);
    this.joyDeck = h('div', { class: 'deck-item joys' }, this.pads[0].el, this.pads[1].el);
    showKb.addEventListener('change', () => { emu.settings.showKeyboard = showKb.checked; emu.save(); this.refreshState(); });
    showJoy.addEventListener('change', () => { emu.settings.showJoysticks = showJoy.checked; emu.save(); this.refreshState(); });
    const smooth = h('input', { type: 'checkbox', checked: emu.settings.smooth });
    smooth.addEventListener('change', () => { emu.settings.smooth = smooth.checked; emu.save(); this.screen.setSmooth(smooth.checked); });
    const scan = h('input', { type: 'checkbox', checked: emu.settings.scanlines });
    scan.addEventListener('change', () => { emu.settings.scanlines = scan.checked; emu.save(); this.screen.setScanlines(scan.checked); });
    this.screen.setSmooth(emu.settings.smooth);
    this.screen.setScanlines(emu.settings.scanlines);

    const stage = h('section', { class: 'stage' },
      h('div', { class: 'monitor' }, this.screen.el, this.status),
      this.displays.el,
      h('div', { class: 'deck-toggles' },
        h('label', {}, showKb, ' Tastiera'),
        h('label', {}, showJoy, ' Joystick'),
        h('label', {}, smooth, ' Filtro'),
        h('label', {}, scan, ' Scanline')),
      this.joyDeck,
      this.keyboardDeck);

    // ---------- pannelli ----------
    const tabs = h('nav', { class: 'tabs', role: 'tablist' });
    for (const [id, label] of TABS) {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => this.showTab(id) }, label);
      this.tabButtons.set(id, b);
      tabs.append(b);
    }
    const panelHost = h('div', { class: 'panel' }, ...this.panels.values());
    const side = h('aside', { class: 'side' }, tabs, panelHost);

    root.replaceChildren(topbar, h('main', { class: 'layout' }, stage, side), this.toastEl);

    // ---------- eventi dell'emulatore ----------
    emu.onFrame = () => this.frame();
    emu.onState = () => this.refreshState();
    emu.onSerial = b => this.terminal.write(b);
    emu.onMessage = (t, k) => this.toast(t, k);
    this.terminal.onInput = b => emu.serialInput(b);

    this.bindKeyboard();
    this.showTab('games');
    this.refreshState();
    this.frame();

    emu.init().then(() => this.refreshState()).catch(e => this.toast(String(e), 'error'));
  }

  private bindKeyboard(): void {
    const ignore = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
      (t instanceof HTMLElement && t.classList.contains('terminal-screen'));
    window.addEventListener('keydown', e => {
      if (ignore(e.target) || e.metaKey) return;
      if (this.emu.physicalKey(e.code, true, e.repeat)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      if (ignore(e.target)) return;
      if (this.emu.physicalKey(e.code, false, false)) e.preventDefault();
    });
    window.addEventListener('blur', () => this.emu.releaseKeys());
  }

  private showTab(id: TabId): void {
    this.tab = id;
    for (const [t, el] of this.panels) el.hidden = t !== id;
    for (const [t, b] of this.tabButtons) b.setAttribute('aria-selected', String(t === id));
    if (id === 'terminal') this.terminal.render();
    this.slowUpdate();
  }

  private toast(text: string, kind: 'info' | 'error' = 'info'): void {
    this.toastEl.textContent = text;
    this.toastEl.className = 'toast show ' + kind;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toastEl.className = 'toast'; }, 3500);
  }

  private refreshState(): void {
    const emu = this.emu;
    this.powerBtn.classList.toggle('on', emu.powered);
    this.powerBtn.setAttribute('aria-pressed', String(emu.powered));
    this.resetBtn.toggleAttribute('disabled', !emu.powered);
    this.pauseBtn.toggleAttribute('disabled', !emu.powered);
    this.pauseBtn.textContent = emu.paused ? 'Continua' : 'Pausa';
    for (const [id, b] of this.machineBtns) b.setAttribute('aria-checked', String(id === emu.machineId));
    const joy = emu.settings.keyMode === 'joy';
    this.keyModeBtn.textContent = joy ? 'Tasti → Joystick' : 'Tasti → Tastiera';
    this.keyModeBtn.title = 'Dove vanno i tasti della tastiera fisica';
    this.keyModeBtn.classList.toggle('joy', joy);
    this.muteBtn.textContent = emu.settings.muted ? '\u{1F507}' : '\u{1F50A}';
    this.keyboardDeck.hidden = !emu.settings.showKeyboard;
    this.joyDeck.hidden = !emu.settings.showJoysticks;
    this.vkb.attach(emu.keyboard ? {
      keyDown: c => { if (emu.powered) emu.keyboard?.keyboard.keyDown(c); },
      keyUp: c => { emu.keyboard?.keyboard.keyUp(c); },
      isDown: c => emu.keyboard?.keyboard.isDown(c) ?? false,
    } : null);
    this.keyboardDeck.classList.toggle('absent', !emu.keyboard);
    this.joyDeck.classList.toggle('absent', !emu.joystick);
    this.media.update();
    this.rack.update();
    this.debug.rebind();
    this.displays.bind(emu.machine);
    document.title = `${MACHINE_NAMES[emu.machineId]} · BO6502 Emulator`;
    this.frame();
  }

  private frame(): void {
    const emu = this.emu;
    this.screen.draw(emu.machine, emu.powered);
    this.displays.draw(emu.machine, emu.powered);
    if (this.tab === 'terminal') this.terminal.render();
    this.vkb.update();
    this.pads.forEach((p, i) => p.update(emu.joystickState(i)));
    const now = performance.now();
    if (now - this.lastSlowUpdate > 100 || emu.paused) this.slowUpdate();
  }

  private slowUpdate(): void {
    this.lastSlowUpdate = performance.now();
    const emu = this.emu;
    const m = emu.machine;
    const state = !emu.powered ? 'spento' : emu.paused ? 'in pausa' : `${emu.fps.toFixed(0)} fps`;
    this.status.textContent =
      `${MACHINE_NAMES[emu.machineId]} · W65C02S ${m.cpuHz / 1e6} MHz · ${state}` +
      (emu.powered ? ` · PC $${hex(m.cpu.pc, 4)}` : '') +
      (m.vdu ? ` · VDP ${m.vdu.irqLine.toUpperCase()}` : '');
    if (this.tab === 'audio') this.audioPanel.update();
    if (this.tab === 'debug') this.debug.update();
  }
}
