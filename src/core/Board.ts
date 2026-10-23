// Common interface of the boards on the 39-pin bus

import { StereoSink } from '../audio/StereoSink';

export type BoardType = 'vdu' | 'serial' | 'keyboard' | 'joystick' | 'sdcard' | 'audio' | 'biglcd' | 'lcd' | 'leds';

export type IrqLine = 'irq' | 'nmi' | 'none';

/** what the machine provides to the boards */
export interface BoardContext {
  /** current CPU cycle */
  cycles(): number;
  /** CPU clock in Hz */
  readonly cpuHz: number;
  /** sets the board interrupt line */
  setInterrupt(board: Board, active: boolean): void;
  readonly audio: StereoSink;
}

export interface Board {
  readonly type: BoardType;
  /** board and chip name */
  readonly label: string;
  /** first decoded address */
  base: number;
  /** size of the decoded space (multiple of 16) */
  readonly size: number;
  /** board interrupt line ('none' if it has none) */
  irqLine: IrqLine;

  attach(ctx: BoardContext): void;
  reset(): void;
  read(offset: number): number;
  write(offset: number, value: number): void;
  /** read without side effects (debugger) */
  peek(offset: number): number;
  /** advances by n CPU cycles (optional) */
  tick?(cycles: number): void;
  /** power-on: random memory content, like the real chips (optional) */
  powerOn?(): void;
  /** end of the video frame (optional) */
  endFrame?(): void;
}
