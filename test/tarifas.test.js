import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cotizar, ErrorValidacion } from '../src/tarifas.js';

test('misma zona, estándar: base 8 + 2.5 kg facturables', () => {
  const r = cotizar({ origen: 'TAC', destino: 'ARE', pesoKg: 2.3 });
  assert.equal(r.pesoFacturableKg, 2.5);
  assert.equal(r.desglose.flete, 14.25);
  assert.equal(r.total, 16.82);
});

test('express aplica factor 1.6 y entrega más rápida', () => {
  const r = cotizar({ origen: 'TAC', destino: 'LIM', pesoKg: 1, servicio: 'express' });
  assert.equal(r.desglose.flete, 23.2);
  assert.deepEqual(r.diasHabiles, { min: 2, max: 3 });
});

test('selva suma recargo y el seguro es 1 % del valor declarado', () => {
  const r = cotizar({ origen: 'LIM', destino: 'LOR', pesoKg: 0.1, valorDeclarado: 500 });
  assert.equal(r.desglose.recargoSelva, 5);
  assert.equal(r.desglose.seguro, 5);
});

test('valores límite de peso', () => {
  assert.doesNotThrow(() => cotizar({ origen: 'TAC', destino: 'TAC', pesoKg: 0.1 }));
  assert.doesNotThrow(() => cotizar({ origen: 'TAC', destino: 'TAC', pesoKg: 50 }));
  assert.throws(() => cotizar({ origen: 'TAC', destino: 'TAC', pesoKg: 0.09 }), ErrorValidacion);
  assert.throws(() => cotizar({ origen: 'TAC', destino: 'TAC', pesoKg: 50.01 }), ErrorValidacion);
});

test('códigos en minúscula se aceptan y desconocidos se rechazan', () => {
  assert.equal(cotizar({ origen: 'tac', destino: 'lim', pesoKg: 1 }).origen.codigo, 'TAC');
  assert.throws(() => cotizar({ origen: 'XXX', destino: 'LIM', pesoKg: 1 }), /origen/);
});
