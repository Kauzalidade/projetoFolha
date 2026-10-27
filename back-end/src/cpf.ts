/**
 * cpf.ts - Validação e formatação oficial de CPF conforme RN-11 e RN-15.
 */

export function limparCPF(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

export function formatarCPF(cpf: string): string {
  const limpo = limparCPF(cpf);
  if (limpo.length !== 11) return cpf;
  return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9, 11)}`;
}

/**
 * Valida se um CPF possui 11 dígitos e dígitos verificadores (DV1 e DV2) corretos.
 * Rejeita sequências de dígitos repetidos (ex: 111.111.111-11).
 */
export function validarCPF(cpf: string): boolean {
  const limpo = limparCPF(cpf);

  if (limpo.length !== 11) {
    return false;
  }

  // Rejeita sequências com todos os dígitos iguais (ex: 00000000000, 11111111111, etc.)
  if (/^(\d)\1{10}$/.test(limpo)) {
    return false;
  }

  // Cálculo do primeiro dígito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (10 - i);
  }
  let resto = soma % 11;
  const dv1 = resto < 2 ? 0 : 11 - resto;
  if (dv1 !== parseInt(limpo.charAt(9), 10)) {
    return false;
  }

  // Cálculo do segundo dígito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (11 - i);
  }
  resto = soma % 11;
  const dv2 = resto < 2 ? 0 : 11 - resto;
  if (dv2 !== parseInt(limpo.charAt(10), 10)) {
    return false;
  }

  return true;
}
