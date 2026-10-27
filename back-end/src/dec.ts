/**
 * dec.ts - Representação decimal de precisão exata para valores monetários (R$).
 * 
 * Regra de Ouro: JavaScript erra contas com ponto flutuante binário (ex: 0.1 + 0.2 != 0.3).
 * Este módulo armazena valores internamente como inteiros de centavos (BigInt) ou escala fixa,
 * garantindo precisão absoluta e arredondamento "metade para cima" (half-up, RN-03).
 */

export class Dec {
  /** Valor armazenado em centavos (ex: R$ 10,50 = 1050n) */
  readonly centavos: bigint;

  constructor(centavos: bigint | number | string) {
    if (typeof centavos === 'bigint') {
      this.centavos = centavos;
    } else if (typeof centavos === 'number') {
      if (!Number.isFinite(centavos)) {
        throw new Error('Valor numérico inválido para Dec');
      }
      this.centavos = BigInt(Math.round(centavos));
    } else if (typeof centavos === 'string') {
      const clean = centavos.trim().replace(/\s/g, '');
      if (/^-?\d+$/.test(clean)) {
        this.centavos = BigInt(clean);
      } else {
        throw new Error(`String inválida para centavos: "${centavos}"`);
      }
    } else {
      throw new Error('Tipo inválido para inicializar Dec');
    }
  }

  /**
   * Cria Dec a partir de string ou número no formato decimal (ex: "1621.00" ou 1621.00 ou "1.621,00").
   */
  static fromMoeda(valor: string | number): Dec {
    if (typeof valor === 'number') {
      if (!Number.isFinite(valor)) throw new Error('Valor inválido para moeda');
      return new Dec(BigInt(Math.round(valor * 100)));
    }

    let limpo = valor.trim().replace(/^R\$\s?/, '').replace(/\s/g, '');
    if (limpo.includes(',') && limpo.includes('.')) {
      // Exemplo: 1.621,00 -> remove ponto, troca vírgula por ponto
      limpo = limpo.replace(/\./g, '').replace(',', '.');
    } else if (limpo.includes(',')) {
      // Exemplo: 1621,00 -> 1621.00
      limpo = limpo.replace(',', '.');
    }

    const partes = limpo.split('.');
    if (partes.length > 2) {
      throw new Error(`Formato monetário inválido: "${valor}"`);
    }

    const inteiros = partes[0] || '0';
    let decimais = partes[1] || '00';
    if (decimais.length === 1) decimais += '0';
    if (decimais.length > 2) {
      // Arredondamento half-up no 3º dígito
      const d3 = parseInt(decimais[2], 10);
      let cent = parseInt(decimais.substring(0, 2), 10);
      if (d3 >= 5) cent += 1;
      decimais = cent.toString().padStart(2, '0');
    }

    const sinal = inteiros.startsWith('-') ? -1n : 1n;
    const absInt = inteiros.replace('-', '');
    const centavos = sinal * (BigInt(absInt) * 100n + BigInt(decimais));
    return new Dec(centavos);
  }

  static zero(): Dec {
    return new Dec(0n);
  }

  add(outro: Dec): Dec {
    return new Dec(this.centavos + outro.centavos);
  }

  sub(outro: Dec): Dec {
    return new Dec(this.centavos - outro.centavos);
  }

  mul(fator: number): Dec {
    // Multiplicação com arredondamento half-up
    // fator pode ser 1.5, 0.075, etc.
    const centavosNum = Number(this.centavos);
    const resultado = centavosNum * fator;
    return new Dec(Math.round(resultado));
  }

  isZero(): boolean {
    return this.centavos === 0n;
  }

  isPositive(): boolean {
    return this.centavos > 0n;
  }

  isNegative(): boolean {
    return this.centavos < 0n;
  }

  toNumber(): number {
    return Number(this.centavos) / 100;
  }

  toString(): string {
    const sinal = this.centavos < 0n ? '-' : '';
    const abs = this.centavos < 0n ? -this.centavos : this.centavos;
    const inteiros = (abs / 100n).toString();
    const cent = (abs % 100n).toString().padStart(2, '0');
    return `${sinal}${inteiros}.${cent}`;
  }

  toFormatado(): string {
    const sinal = this.centavos < 0n ? '-' : '';
    const abs = this.centavos < 0n ? -this.centavos : this.centavos;
    const inteiros = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const cent = (abs % 100n).toString().padStart(2, '0');
    return `R$ ${sinal}${inteiros},${cent}`;
  }
}
