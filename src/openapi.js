const Error = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, campo: { type: 'string' } }
    }
  }
};

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'API de cotización de envíos',
    version: '1.0.0',
    description: 'Actividad Grupal 2: API Testing · Calidad y Pruebas de Software (SI-784) · Universidad Privada de Tacna'
  },
  paths: {
    '/v1/health': { get: { summary: 'Estado del servicio', responses: { 200: { description: 'OK' } } } },
    '/v1/departamentos': {
      get: {
        summary: 'Lista los departamentos del Perú con su zona',
        parameters: [{ name: 'zona', in: 'query', schema: { type: 'string', enum: ['LIMA', 'COSTA', 'SIERRA', 'SELVA'] } }],
        responses: { 200: { description: 'Lista' }, 400: { description: 'Zona inválida', content: { 'application/json': { schema: Error } } } }
      }
    },
    '/v1/departamentos/{codigo}': {
      get: {
        summary: 'Obtiene un departamento',
        parameters: [{ name: 'codigo', in: 'path', required: true, schema: { type: 'string', example: 'TAC' } }],
        responses: { 200: { description: 'Departamento' }, 404: { description: 'No existe', content: { 'application/json': { schema: Error } } } }
      }
    },
    '/v1/limites': { get: { summary: 'Límites de peso y valor declarado', responses: { 200: { description: 'Límites' } } } },
    '/v1/cotizaciones': {
      post: {
        summary: 'Cotiza un envío',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['origen', 'destino', 'pesoKg'],
                properties: {
                  origen: { type: 'string', example: 'TAC' },
                  destino: { type: 'string', example: 'LIM' },
                  pesoKg: { type: 'number', minimum: 0.1, maximum: 50, example: 2.3 },
                  servicio: { type: 'string', enum: ['estandar', 'express'], default: 'estandar' },
                  valorDeclarado: { type: 'number', minimum: 0, maximum: 10000, default: 0 }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Cotización con desglose, total en PEN y días hábiles' },
          400: { description: 'JSON inválido', content: { 'application/json': { schema: Error } } },
          415: { description: 'Content-Type no soportado', content: { 'application/json': { schema: Error } } },
          422: { description: 'Error de validación', content: { 'application/json': { schema: Error } } }
        }
      }
    }
  }
};
