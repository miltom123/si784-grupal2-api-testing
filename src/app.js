import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DEPARTAMENTOS, LIMITES, cotizar, ErrorValidacion } from './tarifas.js';
import { openapi } from './openapi.js';

export const VERSION = '1.0.0';

const error = (c, status, code, message, campo = null) =>
  c.json({ error: { code, message, ...(campo ? { campo } : {}) } }, status);

export const app = new Hono();

app.use('*', cors());
app.use('*', async (c, next) => {
  const inicio = performance.now();
  await next();
  c.header('X-Response-Time', `${(performance.now() - inicio).toFixed(1)}ms`);
  c.header('X-API-Version', VERSION);
});

app.get('/', (c) =>
  c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>API de cotización de envíos</title></head>
<body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px">
<h1>API de cotización de envíos</h1>
<p>Actividad Grupal 2: API Testing · Calidad y Pruebas de Software (SI-784) · UPT</p>
<ul><li><a href="/v1/health">/v1/health</a></li><li><a href="/v1/departamentos">/v1/departamentos</a></li><li><a href="/v1/openapi.json">/v1/openapi.json</a></li></ul>
<p>Ejemplo: <code>POST /v1/cotizaciones</code> con <code>{"origen":"TAC","destino":"LIM","pesoKg":2.3}</code></p>
</body></html>`)
);

app.get('/v1/health', (c) => c.json({ estado: 'ok', version: VERSION }));

app.get('/v1/openapi.json', (c) => c.json(openapi));

app.get('/v1/departamentos', (c) => {
  const zona = c.req.query('zona');
  let lista = Object.entries(DEPARTAMENTOS).map(([codigo, d]) => ({ codigo, ...d }));
  if (zona !== undefined) {
    const z = zona.toUpperCase();
    if (!['LIMA', 'COSTA', 'SIERRA', 'SELVA'].includes(z)) {
      return error(c, 400, 'ZONA_INVALIDA', 'zona debe ser LIMA, COSTA, SIERRA o SELVA', 'zona');
    }
    lista = lista.filter((d) => d.zona === z);
  }
  return c.json({ total: lista.length, departamentos: lista });
});

app.get('/v1/departamentos/:codigo', (c) => {
  const codigo = c.req.param('codigo').toUpperCase();
  const d = DEPARTAMENTOS[codigo];
  if (!d) return error(c, 404, 'NO_ENCONTRADO', `No existe el departamento ${codigo}`);
  return c.json({ codigo, ...d });
});

app.get('/v1/limites', (c) => c.json(LIMITES));

app.post('/v1/cotizaciones', async (c) => {
  if (!(c.req.header('content-type') || '').includes('application/json')) {
    return error(c, 415, 'TIPO_NO_SOPORTADO', 'Envía el cuerpo como application/json');
  }
  let cuerpo;
  try {
    cuerpo = await c.req.json();
  } catch {
    return error(c, 400, 'JSON_INVALIDO', 'El cuerpo no es un JSON válido');
  }
  try {
    return c.json(cotizar(cuerpo), 200);
  } catch (e) {
    if (e instanceof ErrorValidacion) return error(c, 422, 'VALIDACION', e.message, e.campo);
    throw e;
  }
});

app.notFound((c) => error(c, 404, 'RUTA_NO_ENCONTRADA', `No existe ${c.req.method} ${c.req.path}`));

app.onError((e, c) => {
  console.error(e);
  return error(c, 500, 'ERROR_INTERNO', 'Error interno del servidor');
});
