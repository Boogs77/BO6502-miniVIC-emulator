// W65C02 disassembler (for the debugger)

type Mode = 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy' | 'abs' | 'abx' | 'aby' | 'izx' | 'izy' | 'izp'
  | 'ind' | 'iax' | 'rel' | 'zpr';

const LEN: Record<Mode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, abs: 3, abx: 3, aby: 3,
  izx: 2, izy: 2, izp: 2, ind: 3, iax: 3, rel: 2, zpr: 3,
};

// "opcode mnemonic mode"
const TABLE = `
00 BRK imp|01 ORA izx|04 TSB zp|05 ORA zp|06 ASL zp|08 PHP imp|09 ORA imm|0A ASL acc|0C TSB abs|0D ORA abs|0E ASL abs
10 BPL rel|11 ORA izy|12 ORA izp|14 TRB zp|15 ORA zpx|16 ASL zpx|18 CLC imp|19 ORA aby|1A INC acc|1C TRB abs|1D ORA abx|1E ASL abx
20 JSR abs|21 AND izx|24 BIT zp|25 AND zp|26 ROL zp|28 PLP imp|29 AND imm|2A ROL acc|2C BIT abs|2D AND abs|2E ROL abs
30 BMI rel|31 AND izy|32 AND izp|34 BIT zpx|35 AND zpx|36 ROL zpx|38 SEC imp|39 AND aby|3A DEC acc|3C BIT abx|3D AND abx|3E ROL abx
40 RTI imp|41 EOR izx|45 EOR zp|46 LSR zp|48 PHA imp|49 EOR imm|4A LSR acc|4C JMP abs|4D EOR abs|4E LSR abs
50 BVC rel|51 EOR izy|52 EOR izp|55 EOR zpx|56 LSR zpx|58 CLI imp|59 EOR aby|5A PHY imp|5D EOR abx|5E LSR abx
60 RTS imp|61 ADC izx|64 STZ zp|65 ADC zp|66 ROR zp|68 PLA imp|69 ADC imm|6A ROR acc|6C JMP ind|6D ADC abs|6E ROR abs
70 BVS rel|71 ADC izy|72 ADC izp|74 STZ zpx|75 ADC zpx|76 ROR zpx|78 SEI imp|79 ADC aby|7A PLY imp|7C JMP iax|7D ADC abx|7E ROR abx
80 BRA rel|81 STA izx|84 STY zp|85 STA zp|86 STX zp|88 DEY imp|89 BIT imm|8A TXA imp|8C STY abs|8D STA abs|8E STX abs
90 BCC rel|91 STA izy|92 STA izp|94 STY zpx|95 STA zpx|96 STX zpy|98 TYA imp|99 STA aby|9A TXS imp|9C STZ abs|9D STA abx|9E STZ abx
A0 LDY imm|A1 LDA izx|A2 LDX imm|A4 LDY zp|A5 LDA zp|A6 LDX zp|A8 TAY imp|A9 LDA imm|AA TAX imp|AC LDY abs|AD LDA abs|AE LDX abs
B0 BCS rel|B1 LDA izy|B2 LDA izp|B4 LDY zpx|B5 LDA zpx|B6 LDX zpy|B8 CLV imp|B9 LDA aby|BA TSX imp|BC LDY abx|BD LDA abx|BE LDX aby
C0 CPY imm|C1 CMP izx|C4 CPY zp|C5 CMP zp|C6 DEC zp|C8 INY imp|C9 CMP imm|CA DEX imp|CB WAI imp|CC CPY abs|CD CMP abs|CE DEC abs
D0 BNE rel|D1 CMP izy|D2 CMP izp|D5 CMP zpx|D6 DEC zpx|D8 CLD imp|D9 CMP aby|DA PHX imp|DB STP imp|DD CMP abx|DE DEC abx
E0 CPX imm|E1 SBC izx|E4 CPX zp|E5 SBC zp|E6 INC zp|E8 INX imp|E9 SBC imm|EA NOP imp|EC CPX abs|ED SBC abs|EE INC abs
F0 BEQ rel|F1 SBC izy|F2 SBC izp|F5 SBC zpx|F6 INC zpx|F8 SED imp|F9 SBC aby|FA PLX imp|FD SBC abx|FE INC abx`;

const OPS: Array<[string, Mode]> = new Array(256);
for (const e of TABLE.split(/[|\n]/)) {
  const t = e.trim().split(/\s+/);
  if (t.length === 3) OPS[parseInt(t[0], 16)] = [t[1], t[2] as Mode];
}
for (let n = 0; n < 8; n++) {
  OPS[0x07 + n * 16] = ['RMB' + n, 'zp'];
  OPS[0x87 + n * 16] = ['SMB' + n, 'zp'];
  OPS[0x0F + n * 16] = ['BBR' + n, 'zpr'];
  OPS[0x8F + n * 16] = ['BBS' + n, 'zpr'];
}

const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
const h4 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');

export interface DisLine {
  addr: number;
  bytes: number[];
  text: string;
}

export function disassemble(read: (a: number) => number, addr: number): DisLine {
  const op = read(addr);
  const entry = OPS[op];
  if (!entry) return { addr, bytes: [op], text: `.byte $${h2(op)}` };
  const [mn, mode] = entry;
  const len = LEN[mode];
  const bytes = [op];
  for (let i = 1; i < len; i++) bytes.push(read((addr + i) & 0xFFFF));
  const b1 = bytes[1], w = bytes[1] | (bytes[2] << 8);
  let arg = '';
  switch (mode) {
    case 'acc': arg = 'A'; break;
    case 'imm': arg = `#$${h2(b1)}`; break;
    case 'zp': arg = `$${h2(b1)}`; break;
    case 'zpx': arg = `$${h2(b1)},X`; break;
    case 'zpy': arg = `$${h2(b1)},Y`; break;
    case 'abs': arg = `$${h4(w)}`; break;
    case 'abx': arg = `$${h4(w)},X`; break;
    case 'aby': arg = `$${h4(w)},Y`; break;
    case 'izx': arg = `($${h2(b1)},X)`; break;
    case 'izy': arg = `($${h2(b1)}),Y`; break;
    case 'izp': arg = `($${h2(b1)})`; break;
    case 'ind': arg = `($${h4(w)})`; break;
    case 'iax': arg = `($${h4(w)},X)`; break;
    case 'rel': arg = `$${h4((addr + 2 + (b1 < 128 ? b1 : b1 - 256)) & 0xFFFF)}`; break;
    case 'zpr': {
      const o = bytes[2];
      arg = `$${h2(b1)},$${h4((addr + 3 + (o < 128 ? o : o - 256)) & 0xFFFF)}`;
      break;
    }
  }
  return { addr, bytes, text: arg ? `${mn} ${arg}` : mn };
}

export function hex2(v: number): string { return h2(v & 0xFF); }
export function hex4(v: number): string { return h4(v & 0xFFFF); }
