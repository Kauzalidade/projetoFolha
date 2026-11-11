import { Router, Request, Response } from 'express';

const router = Router();

// Banco de dados simulado em memória para os feriados e parâmetros
let feriadosDB: any[] = [
  { id: '1', nome: 'Confraternização Universal', data: '2026-01-01', tipo: 'NACIONAL', impactaHorasExtras: true },
  { id: '2', nome: 'Tiradentes', data: '2026-04-21', tipo: 'NACIONAL', impactaHorasExtras: true }
];

let parametrosDB: any[] = [
  {
    id: '1',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    percentualFGTS: 0.08,
    responsavelAlteracao: 'RH System',
    atualizadoEm: new Date()
  }
];

// Listar feriados vigentes
router.get('/feriados', (req: Request, res: Response) => {
  return res.status(200).json(feriadosDB);
});

// Cadastrar novo feriado
router.post('/feriados', (req: Request, res: Response) => {
  const { nome, data, tipo, impactaHorasExtras } = req.body;
  const novoFeriado = { id: String(Date.now()), nome, data, tipo, impactaHorasExtras };
  feriadosDB.push(novoFeriado);
  return res.status(201).json(novoFeriado);
});

// Consultar parâmetros legais ativos na competência
router.get('/parametros/vigente', (req: Request, res: Response) => {
  const parametroAtual = parametrosDB.find(p => p.vigenciaFim === null);
  return res.status(200).json(parametroAtual || {});
});

export default router;
