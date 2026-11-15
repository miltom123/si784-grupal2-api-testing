// Reglas de negocio de la cotización. Funciones puras: no dependen de HTTP.

export const DEPARTAMENTOS = {
  AMA: { nombre: 'Amazonas', zona: 'SELVA' },
  ANC: { nombre: 'Áncash', zona: 'COSTA' },
  APU: { nombre: 'Apurímac', zona: 'SIERRA' },
  ARE: { nombre: 'Arequipa', zona: 'COSTA' },
  AYA: { nombre: 'Ayacucho', zona: 'SIERRA' },
  CAJ: { nombre: 'Cajamarca', zona: 'SIERRA' },
  CAL: { nombre: 'Callao', zona: 'LIMA' },
  CUS: { nombre: 'Cusco', zona: 'SIERRA' },
  HUV: { nombre: 'Huancavelica', zona: 'SIERRA' },
  HUC: { nombre: 'Huánuco', zona: 'SIERRA' },
  ICA: { nombre: 'Ica', zona: 'COSTA' },
  JUN: { nombre: 'Junín', zona: 'SIERRA' },
  LAL: { nombre: 'La Libertad', zona: 'COSTA' },
  LAM: { nombre: 'Lambayeque', zona: 'COSTA' },
  LIM: { nombre: 'Lima', zona: 'LIMA' },
  LOR: { nombre: 'Loreto', zona: 'SELVA' },
  MDD: { nombre: 'Madre de Dios', zona: 'SELVA' },
  MOQ: { nombre: 'Moquegua', zona: 'COSTA' },
  PAS: { nombre: 'Pasco', zona: 'SIERRA' },
  PIU: { nombre: 'Piura', zona: 'COSTA' },
  PUN: { nombre: 'Puno', zona: 'SIERRA' },
  SAM: { nombre: 'San Martín', zona: 'SELVA' },
  TAC: { nombre: 'Tacna', zona: 'COSTA' },
  TUM: { nombre: 'Tumbes', zona: 'COSTA' },
  UCA: { nombre: 'Ucayali', zona: 'SELVA' }
};

export const LIMITES = {
  pesoMinKg: 0.1,
  pesoMaxKg: 50,
  valorDeclaradoMax: 10000
};

const SERVICIOS = {
  estandar: { factor: 1, dias: [3, 5] },
  express: { factor: 1.6, dias: [1, 2] }
};

const TARIFA_POR_KG = 2.5;
const RECARGO_SELVA = 5;
const TASA_SEGURO = 0.01;
const IGV = 0.18;

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export class ErrorValidacion extends Error {
  constructor(campo, mensaje) {
    super(mensaje);
    this.campo = campo;
  }
}

export function validar(entrada) {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new ErrorValidacion(null, 'El cuerpo debe ser un objeto JSON');
  }
  const { origen, destino, pesoKg, servicio = 'estandar', valorDeclarado = 0 } = entrada;

  for (const [campo, valor] of [['origen', origen], ['destino', destino]]) {
    if (typeof valor !== 'string' || !DEPARTAMENTOS[valor.toUpperCase()]) {
      throw new ErrorValidacion(campo, `${campo} debe ser un código de departamento válido (por ejemplo, TAC o LIM)`);
    }
  }
  if (typeof pesoKg !== 'number' || !Number.isFinite(pesoKg)) {
    throw new ErrorValidacion('pesoKg', 'pesoKg debe ser un número');
  }
  if (pesoKg < LIMITES.pesoMinKg || pesoKg > LIMITES.pesoMaxKg) {
    throw new ErrorValidacion('pesoKg', `pesoKg debe estar entre ${LIMITES.pesoMinKg} y ${LIMITES.pesoMaxKg}`);
  }
  if (!SERVICIOS[servicio]) {
    throw new ErrorValidacion('servicio', 'servicio debe ser "estandar" o "express"');
  }
  if (typeof valorDeclarado !== 'number' || !Number.isFinite(valorDeclarado) || valorDeclarado < 0 || valorDeclarado > LIMITES.valorDeclaradoMax) {
    throw new ErrorValidacion('valorDeclarado', `valorDeclarado debe ser un número entre 0 y ${LIMITES.valorDeclaradoMax}`);
  }
  return { origen: origen.toUpperCase(), destino: destino.toUpperCase(), pesoKg, servicio, valorDeclarado };
}

export function cotizar(entrada) {
  const e = validar(entrada);
  const zOrigen = DEPARTAMENTOS[e.origen].zona;
  const zDestino = DEPARTAMENTOS[e.destino].zona;

  const base = zOrigen === zDestino ? 8 : 12;
  const pesoFacturable = Math.ceil(e.pesoKg * 2) / 2; // se cobra por cada 0.5 kg iniciado
  const porPeso = pesoFacturable * TARIFA_POR_KG;
  const recargoSelva = zOrigen === 'SELVA' || zDestino === 'SELVA' ? RECARGO_SELVA : 0;
  const flete = redondear((base + porPeso + recargoSelva) * SERVICIOS[e.servicio].factor);
  const seguro = redondear(e.valorDeclarado * TASA_SEGURO);
  const subtotal = redondear(flete + seguro);
  const igv = redondear(subtotal * IGV);
  const total = redondear(subtotal + igv);
  const [min, max] = SERVICIOS[e.servicio].dias;
  const extra = zOrigen === zDestino ? 0 : 1;

  return {
    origen: { codigo: e.origen, ...DEPARTAMENTOS[e.origen] },
    destino: { codigo: e.destino, ...DEPARTAMENTOS[e.destino] },
    servicio: e.servicio,
    pesoKg: e.pesoKg,
    pesoFacturableKg: pesoFacturable,
    desglose: { base, porPeso: redondear(porPeso), recargoSelva, flete, seguro, subtotal, igv },
    total,
    moneda: 'PEN',
    diasHabiles: { min: min + extra, max: max + extra }
  };
}
