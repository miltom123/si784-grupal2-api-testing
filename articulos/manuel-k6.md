---
title: "Pruebas de carga con k6 en CI/CD: umbrales que deciden si tu API está lista para producción"
published: false
tags: testing, k6, performance, githubactions
---

> **Actividad Grupal 2: API Testing**: Calidad y Pruebas de Software (SI-784), Universidad Privada de Tacna.
> Autores: Manuel Andre Dongo Palza y Milton H. Flores Chino.

**Repositorio:** https://github.com/miltom123/si784-grupal2-api-testing
**API en producción:** https://si784-api-envios.vercel.app
**Video (≤ 5 min):** _ENLACE_DEL_VIDEO_

---

## Que funcione no basta: tiene que aguantar

Una API puede pasar todas sus pruebas funcionales y aun así caerse con veinte usuarios a la vez. En nuestro proyecto, una API de **cotización de envíos entre departamentos del Perú** (Node.js 20 + Hono, desplegada en Vercel), dividimos el trabajo de pruebas en dos partes:

- **Newman** comprueba que cada respuesta sea correcta. Milton lo explica en su artículo: https://dev.to/milton_hfloreschino_123/pruebas-de-api-con-newman-de-0-a-121-aserciones-en-un-pipeline-que-despliega-en-vercel-2ke2.
- **k6** comprueba que la API siga siendo correcta y rápida **bajo carga**. Ese es el tema de este artículo.

## ¿Qué es k6?

[k6](https://k6.io) es una herramienta de pruebas de carga de Grafana Labs:

- Los escenarios se escriben en **JavaScript**.
- El motor está escrito en Go: un solo binario genera miles de peticiones con poco consumo de recursos.
- Lo más útil para CI son los **umbrales (thresholds)**. Si una métrica no los cumple, k6 termina con código de salida distinto de cero y **el pipeline falla**.

## El script: [`tests/k6/carga.js`](https://github.com/miltom123/si784-grupal2-api-testing/blob/main/tests/k6/carga.js)

### 1. Escenario de rampa

```js
export const options = {
  scenarios: {
    rampa: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 }, // calentamiento
        { duration: '30s', target: 20 }, // carga sostenida
        { duration: '10s', target: 0 }   // bajada
      ]
    }
  },
```

La carga sube de 0 a 20 usuarios virtuales (VUs), se mantiene y baja. Así se ven tanto el arranque en frío de la función serverless como el comportamiento sostenido.

### 2. Umbrales: la definición de "aprobado"

```js
  thresholds: {
    http_req_failed:    ['rate<0.01'],           // < 1 % de errores HTTP
    http_req_duration:  ['p(95)<800'],           // el 95 % responde en < 800 ms
    tiempo_cotizacion:  ['p(95)<800', 'avg<400'],
    errores_de_negocio: ['rate<0.01'],
    checks:             ['rate>0.99']
  }
};
```

Usamos el **percentil 95** y no el promedio, porque el promedio esconde las respuestas lentas que sufren los usuarios reales.

### 3. Tráfico realista con grupos

Cada iteración de un VU mezcla tres tipos de tráfico:

```js
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
```

- **Catálogo:** `GET /v1/departamentos`, que debe devolver 25 departamentos.
- **Cotización:** datos aleatorios en cada iteración, para no medir siempre el mismo caso.
- **Validación:** un peso inválido que **debe** responder `422`.

### 4. Métricas personalizadas

k6 trae métricas HTTP de serie. Agregamos dos propias:

```js
const erroresNegocio   = new Rate('errores_de_negocio');
const tiempoCotizacion = new Trend('tiempo_cotizacion', true);
```

- `tiempo_cotizacion` mide **solo** el endpoint que importa al negocio.
- `errores_de_negocio` cuenta las respuestas que llegan con 200 **pero con montos incoherentes**. Un error así no aparece en `http_req_failed`.

### 5. Errores esperados que no cuentan como fallos

Por defecto, k6 cuenta un `422` como petición fallida. Como en la validación ese código es lo **esperado**, se lo indicamos:

```js
http.post(url, cuerpoInvalido, { responseCallback: http.expectedStatuses(422) });
```

Sin esto, `http_req_failed` subiría al 33 % y el umbral fallaría aunque la API funcione bien.

### 6. Verificar antes de cargar, y reportar al final

- `setup()` verifica `/v1/health` antes de empezar. Si la API no responde, la prueba aborta con un mensaje claro en vez de generar miles de errores.
- `handleSummary()` escribe `reports/k6-resumen.md`, que GitHub Actions muestra en el resumen de la ejecución.

## k6 dentro del pipeline

En [`ci-cd.yml`](https://github.com/miltom123/si784-grupal2-api-testing/blob/main/.github/workflows/ci-cd.yml), k6 corre dos veces:

```yaml
- uses: grafana/setup-k6-action@v1

# Antes de desplegar: humo rápido contra la API levantada en el runner
- run: k6 run --vus 5 --duration 10s -e BASE_URL=http://localhost:3000 tests/k6/carga.js

# Después de desplegar en Vercel: el escenario completo contra la URL pública
- run: k6 run -e BASE_URL="$BASE_URL" tests/k6/carga.js
```

El flujo completo es: `push` → pruebas unitarias + Newman + k6 smoke → `vercel deploy --prod` → Newman + k6 contra producción. Si algún umbral falla, el job queda en rojo.

## Resultados contra producción (Vercel)

| Métrica | Valor |
|---|---|
| Peticiones | 3148 |
| Peticiones por segundo | 56.9 |
| Errores HTTP | 0.00 % |
| Duración p(95) | 45 ms |
| Cotización promedio | 26 ms |
| Checks aprobados | 100 % |

Todos los umbrales se cumplieron:

- ✅ `http_req_failed` < 1 %
- ✅ `http_req_duration` p(95) < 800 ms
- ✅ `tiempo_cotizacion` p(95) < 800 ms y promedio < 400 ms
- ✅ `errores_de_negocio` < 1 %
- ✅ `checks` > 99 %

En local, la misma prueba dio un p(95) de unos 2 ms. La diferencia con los 45 ms de producción es la red y la plataforma serverless. Por eso **hay que medir en el entorno real** y no solo en la máquina del desarrollador.

## Lecciones

- **Los umbrales convierten una prueba de carga en una compuerta de calidad.** Sin ellos, k6 solo imprime números que nadie mira.
- **Verifica también el contenido bajo carga.** Un 200 con un total mal calculado es un error, aunque el servidor no lo sepa.
- **Declara los códigos de error esperados** con `responseCallback`, o tus métricas de fallo mentirán.
- **Un smoke corto antes de desplegar y la prueba completa después** equilibran el tiempo del pipeline con la confianza en el resultado.

Para probarlo tú mismo:

```bash
k6 run -e BASE_URL=https://si784-api-envios.vercel.app tests/k6/carga.js
```
