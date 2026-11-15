// Genera la colección de Postman a partir de una lista legible de casos.
// Uso: node tests/postman/generar-coleccion.mjs
import fs from 'node:fs';

const esquemaError = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'object', required: ['code', 'message'] } }
};
const esquemaCotizacion = {
  type: 'object',
  required: ['origen', 'destino', 'servicio', 'pesoFacturableKg', 'desglose', 'total', 'moneda', 'diasHabiles'],
  properties: {
    total: { type: 'number', minimum: 0 },
    moneda: { const: 'PEN' },
    desglose: { type: 'object', required: ['base', 'porPeso', 'recargoSelva', 'flete', 'seguro', 'subtotal', 'igv'] }
  }
};

const s = JSON.stringify;
const status = (n) => `pm.test('responde ${n}', () => pm.response.to.have.status(${n}));`;
const errorCon = (code, campo) => [
  `pm.test('el error sigue el contrato', () => pm.response.to.have.jsonSchema(${s(esquemaError)}));`,
  `pm.test('código de error ${code}', () => pm.expect(pm.response.json().error.code).to.eql('${code}'));`,
  ...(campo ? [`pm.test('señala el campo ${campo}', () => pm.expect(pm.response.json().error.campo).to.eql('${campo}'));`] : [])
];
const cotizacionValida = [
  status(200),
  `pm.test('cumple el esquema de cotización', () => pm.response.to.have.jsonSchema(${s(esquemaCotizacion)}));`,
  `pm.test('IGV es el 18 % del subtotal', () => { const d = pm.response.json().desglose; pm.expect(d.igv).to.be.closeTo(d.subtotal * 0.18, 0.011); });`,
  `pm.test('total = subtotal + IGV', () => { const r = pm.response.json(); pm.expect(r.total).to.be.closeTo(r.desglose.subtotal + r.desglose.igv, 0.011); });`
];

const cotizar = (nombre, cuerpo, tests) => ({ nombre, metodo: 'POST', ruta: '/v1/cotizaciones', cuerpo, tests });

const carpetas = [
  {
    nombre: '1. Salud y catálogo',
    casos: [
      { nombre: 'Health check', metodo: 'GET', ruta: '/v1/health', tests: [
        status(200),
        `pm.test('estado ok', () => pm.expect(pm.response.json().estado).to.eql('ok'));`,
        `pm.test('expone la versión en la cabecera', () => pm.response.to.have.header('X-API-Version'));`
      ] },
      { nombre: 'Listar departamentos', metodo: 'GET', ruta: '/v1/departamentos', tests: [
        status(200),
        `pm.test('hay 25 departamentos', () => pm.expect(pm.response.json().total).to.eql(25));`,
        `pm.test('cada departamento tiene código, nombre y zona', () => pm.response.json().departamentos.forEach((d) => pm.expect(d).to.have.all.keys('codigo', 'nombre', 'zona')));`
      ] },
      { nombre: 'Filtrar por zona (minúsculas)', metodo: 'GET', ruta: '/v1/departamentos?zona=selva', tests: [
        status(200),
        `pm.test('solo devuelve la zona SELVA', () => pm.response.json().departamentos.forEach((d) => pm.expect(d.zona).to.eql('SELVA')));`,
        `pm.test('son 5 departamentos de selva', () => pm.expect(pm.response.json().total).to.eql(5));`
      ] },
      { nombre: 'Zona inexistente', metodo: 'GET', ruta: '/v1/departamentos?zona=marte', tests: [status(400), ...errorCon('ZONA_INVALIDA', 'zona')] },
      { nombre: 'Obtener Tacna', metodo: 'GET', ruta: '/v1/departamentos/tac', tests: [
        status(200),
        `pm.test('es Tacna en la costa', () => { const r = pm.response.json(); pm.expect(r.nombre).to.eql('Tacna'); pm.expect(r.zona).to.eql('COSTA'); });`,
        `pm.collectionVariables.set('zonaTacna', pm.response.json().zona);`
      ] },
      { nombre: 'Departamento inexistente', metodo: 'GET', ruta: '/v1/departamentos/XYZ', tests: [status(404), ...errorCon('NO_ENCONTRADO')] }
    ]
  },
  {
    nombre: '2. Cotizaciones válidas',
    casos: [
      cotizar('Misma zona, estándar (Tacna → Arequipa)', { origen: 'TAC', destino: 'ARE', pesoKg: 2.3 }, [
        ...cotizacionValida,
        `pm.test('cobra 2.5 kg por bloques de 0.5 kg', () => pm.expect(pm.response.json().pesoFacturableKg).to.eql(2.5));`,
        `pm.test('total esperado S/ 16.82', () => pm.expect(pm.response.json().total).to.eql(16.82));`
      ]),
      cotizar('Distinta zona, express (Tacna → Lima)', { origen: 'TAC', destino: 'LIM', pesoKg: 1, servicio: 'express' }, [
        ...cotizacionValida,
        `pm.test('flete con factor express 1.6', () => pm.expect(pm.response.json().desglose.flete).to.eql(23.2));`,
        `pm.test('entrega en 2 a 3 días', () => pm.expect(pm.response.json().diasHabiles).to.eql({ min: 2, max: 3 }));`
      ]),
      cotizar('Selva con valor declarado (Lima → Loreto)', { origen: 'LIM', destino: 'LOR', pesoKg: 0.1, valorDeclarado: 500 }, [
        ...cotizacionValida,
        `pm.test('aplica recargo de selva', () => pm.expect(pm.response.json().desglose.recargoSelva).to.eql(5));`,
        `pm.test('seguro = 1 % del valor declarado', () => pm.expect(pm.response.json().desglose.seguro).to.eql(5));`
      ]),
      cotizar('Express siempre cuesta más que estándar', { origen: 'TAC', destino: 'CUS', pesoKg: 4 }, [
        status(200),
        `pm.collectionVariables.set('totalEstandar', pm.response.json().total);`,
        `pm.sendRequest({ url: pm.environment.get('baseUrl') + '/v1/cotizaciones', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: JSON.stringify({ origen: 'TAC', destino: 'CUS', pesoKg: 4, servicio: 'express' }) } }, (err, res) => { pm.test('express > estándar', () => { pm.expect(err).to.be.null; pm.expect(res.json().total).to.be.above(pm.response.json().total); }); });`
      ])
    ]
  },
  {
    nombre: '3. Valores límite',
    casos: [
      cotizar('Peso mínimo 0.1 kg', { origen: 'TAC', destino: 'TAC', pesoKg: 0.1 }, [status(200)]),
      cotizar('Peso máximo 50 kg', { origen: 'TAC', destino: 'TAC', pesoKg: 50 }, [status(200)]),
      cotizar('Peso bajo el mínimo (0.09 kg)', { origen: 'TAC', destino: 'TAC', pesoKg: 0.09 }, [status(422), ...errorCon('VALIDACION', 'pesoKg')]),
      cotizar('Peso sobre el máximo (50.01 kg)', { origen: 'TAC', destino: 'TAC', pesoKg: 50.01 }, [status(422), ...errorCon('VALIDACION', 'pesoKg')]),
      cotizar('Valor declarado sobre el máximo', { origen: 'TAC', destino: 'LIM', pesoKg: 1, valorDeclarado: 10001 }, [status(422), ...errorCon('VALIDACION', 'valorDeclarado')])
    ]
  },
  {
    nombre: '4. Errores y robustez',
    casos: [
      cotizar('Origen inexistente', { origen: 'XXX', destino: 'LIM', pesoKg: 1 }, [status(422), ...errorCon('VALIDACION', 'origen')]),
      cotizar('Falta el peso', { origen: 'TAC', destino: 'LIM' }, [status(422), ...errorCon('VALIDACION', 'pesoKg')]),
      cotizar('Peso como texto', { origen: 'TAC', destino: 'LIM', pesoKg: '2' }, [status(422), ...errorCon('VALIDACION', 'pesoKg')]),
      cotizar('Servicio desconocido', { origen: 'TAC', destino: 'LIM', pesoKg: 1, servicio: 'aereo' }, [status(422), ...errorCon('VALIDACION', 'servicio')]),
      { nombre: 'JSON mal formado', metodo: 'POST', ruta: '/v1/cotizaciones', crudo: '{"origen": "TAC",', tests: [status(400), ...errorCon('JSON_INVALIDO')] },
      { nombre: 'Content-Type incorrecto', metodo: 'POST', ruta: '/v1/cotizaciones', crudo: 'origen=TAC', tipo: 'text/plain', tests: [status(415), ...errorCon('TIPO_NO_SOPORTADO')] },
      { nombre: 'Ruta inexistente', metodo: 'GET', ruta: '/v1/no-existe', tests: [status(404), ...errorCon('RUTA_NO_ENCONTRADA')] }
    ]
  }
];

const item = (c) => ({
  name: c.nombre,
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: c.tests } }],
  request: {
    method: c.metodo,
    header: c.cuerpo || c.crudo ? [{ key: 'Content-Type', value: c.tipo || 'application/json' }] : [],
    ...(c.cuerpo || c.crudo ? { body: { mode: 'raw', raw: c.crudo ?? JSON.stringify(c.cuerpo, null, 2) } } : {}),
    url: { raw: `{{baseUrl}}${c.ruta}`, host: ['{{baseUrl}}'], path: c.ruta.split('?')[0].split('/').filter(Boolean), ...(c.ruta.includes('?') ? { query: c.ruta.split('?')[1].split('&').map((q) => { const [key, value] = q.split('='); return { key, value }; }) } : {}) }
  }
});

const coleccion = {
  info: {
    name: 'API de cotización de envíos - pruebas funcionales',
    description: 'Actividad Grupal 2: API Testing · SI-784 · UPT. Generada por tests/postman/generar-coleccion.mjs',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  event: [{
    listen: 'test',
    script: { type: 'text/javascript', exec: [
      `pm.test('responde en menos de 3 s', () => pm.expect(pm.response.responseTime).to.be.below(3000));`,
      `pm.test('responde JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json'));`
    ] }
  }],
  item: carpetas.map((f) => ({ name: f.nombre, item: f.casos.map(item) })),
  variable: [{ key: 'zonaTacna', value: '' }, { key: 'totalEstandar', value: '' }]
};

const dir = new URL('.', import.meta.url);
fs.writeFileSync(new URL('envios.postman_collection.json', dir), JSON.stringify(coleccion, null, 2) + '\n');
const casos = carpetas.reduce((n, f) => n + f.casos.length, 0);
console.log(`Colección generada: ${casos} peticiones en ${carpetas.length} carpetas`);
