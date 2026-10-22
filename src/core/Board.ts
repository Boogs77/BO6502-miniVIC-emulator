// Interfaccia comune delle schede sul bus a 39 pin

import { StereoSink } from '../audio/StereoSink';

export type BoardType = 'vdu' | 'serial' | 'keyboard' | 'joystick' | 'sdcard' | 'audio';

export type IrqLine = 'irq' | 'nmi' | 'none';

/** cio' che la macchina mette a disposizione delle schede */
export interface BoardContext {
  /** ciclo CPU corrente */
  cycles(): number;
  /** clock della CPU in Hz */
  readonly cpuHz: number;
  /** imposta la linea di interrupt della scheda */
  setInterrupt(board: Board, active: boolean): void;
  readonly audio: StereoSink;
}

export interface Board {
  readonly type: BoardType;
  /** nome della scheda e dei chip */
  readonly label: string;
  /** primo indirizzo decodificato */
  base: number;
  /** ampiezza dello spazio decodificato (multiplo di 16) */
  readonly size: number;
  /** linea di interrupt della scheda ('none' se non ne ha) */
  irqLine: IrqLine;

  attach(ctx: BoardContext): void;
  reset(): void;
  read(offset: number): number;
  write(offset: number, value: number): void;
  /** lettura senza effetti collaterali (debugger) */
  peek(offset: number): number;
  /** avanza di n cicli CPU (opzionale) */
  tick?(cycles: number): void;
  /** fine del frame video (opzionale) */
  endFrame?(): void;
}
