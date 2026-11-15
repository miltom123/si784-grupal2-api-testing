// Prueba de carga con k6 sobre la API de cotización de envíos.
// Uso: k6 run -e BASE_URL=https://tu-api.vercel.app tests/k6/carga.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const erroresNegocio = new Rate('errores_de_negocio');
const tiempoCotizacion = new Trend('tiempo_cotizacion', true);

export const options = {
  scenarios: {
    rampa: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 }, // calentamiento
        { duration: '30s', target: 20 }, // carga sostenida
        { duration: '10s', target: 0 } // bajada
      ],
      gracefulRampDown: '5s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // menos de 1 % de errores HTTP
    http_req_duration: ['p(95)<800'], // el 95 % responde en menos de 800 ms
    tiempo_cotizacion: ['p(95)<800', 'avg<400'],
    errores_de_negocio: ['rate<0.01'],
    checks: ['rate>0.99']
  }
};

const DEPARTAMENTOS = ['TAC', 'LIM', 'ARE', 'CUS', 'LOR', 'PIU', 'PUN', 'UCA'];
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

export function setup() {
  const r = http.get(`${BASE_URL}/v1/health`);
  if (r.status !== 200) throw new Error(`La API no está disponible en ${BASE_URL} (status ${r.status})`);
}

export default function () {
  group('catálogo', () => {
    const r = http.get(`${BASE_URL}/v1/departamentos`, { tags: { endpoint: 'departamentos' } });
    check(r, {
      'catálogo 200': (res) => res.status === 200,
      'catálogo con 25 departamentos': (res) => res.json('total') === 25
    });
  });

  group('cotización', () => {
    const cuerpo = {
      origen: azar(DEPARTAMENTOS),
      destino: azar(DEPARTAMENTOS),
      pesoKg: Math.round((0.1 + Math.random() * 49.9) * 10) / 10,
      servicio: Math.random() < 0.3 ? 'express' : 'estandar',
      valorDeclarado: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 2000)
    };
    const r = http.post(`${BASE_URL}/v1/cotizaciones`, JSON.stringify(cuerpo), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'cotizaciones' }
    });
    tiempoCotizacion.add(r.timings.duration);
    const ok = check(r, {
      'cotización 200': (res) => res.status === 200,
      'total = subtotal + IGV': (res) => {
        const b = res.json();
        return Math.abs(b.total - (b.desglose.subtotal + b.desglose.igv)) < 0.011;
      }
    });
    erroresNegocio.add(!ok);
  });

  group('validación', () => {
    const r = http.post(`${BASE_URL}/v1/cotizaciones`, JSON.stringify({ origen: 'TAC', destino: 'LIM', pesoKg: 999 }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'cotizaciones-invalidas' },
      responseCallback: http.expectedStatuses(422)
    });
    check(r, { 'peso inválido → 422': (res) => res.status === 422 });
  });

  sleep(0.5);
}

export function handleSummary(data) {
  const m = data.metrics;
  const fila = (nombre, v) => `| ${nombre} | ${v} |`;
  const resumen = [
    '# Resultado de k6',
    '',
    '| Métrica | Valor |',
    '|---|---|',
    fila('Peticiones', m.http_reqs.values.count),
    fila('Peticiones por segundo', m.http_reqs.values.rate.toFixed(1)),
    fila('Errores HTTP', `${(m.http_req_failed.values.rate * 100).toFixed(2)} %`),
    fila('Duración p(95)', `${m.http_req_duration.values['p(95)'].toFixed(0)} ms`),
    fila('Cotización promedio', `${m.tiempo_cotizacion.values.avg.toFixed(0)} ms`),
    fila('Checks aprobados', `${(m.checks.values.rate * 100).toFixed(2)} %`),
    '',
    '## Umbrales',
    '',
    ...Object.entries(data.metrics)
      .filter(([, v]) => v.thresholds)
      .flatMap(([k, v]) => Object.entries(v.thresholds).map(([t, r]) => `- ${r.ok ? '✅' : '❌'} \`${k}\`: ${t}`))
  ].join('\n');
  return {
    stdout: resumen + '\n',
    'reports/k6-resumen.md': resumen + '\n',
    'reports/k6-resumen.json': JSON.stringify(data, null, 2)
  };
}
