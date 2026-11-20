import test from 'node:test';
import assert from 'node:assert/strict';
import { shareMeta, raffleIdFromPath } from './og.mjs';

const origin = 'https://sitio.example';
const brand = { name: 'Zona Norte Automotores', description: 'Comprá un curso y ganá un 0km.', image: '' };

test('portada: usa la marca y la imagen por defecto', () => {
  const m = shareMeta({ origin, pathname: '/', brand, raffle: null });
  assert.equal(m.title, 'Zona Norte Automotores');
  assert.equal(m.image, 'https://sitio.example/share-default.jpg');
  assert.equal(m.url, 'https://sitio.example/');
});

test('sorteo: título, premio y foto del sorteo', () => {
  const m = shareMeta({ origin, pathname: '/sorteo/2', brand, raffle: { title: 'Gran Sorteo', prize: 'Audi TT', imageUrl: 'https://cdn.example/audi.jpg' } });
  assert.equal(m.title, 'Gran Sorteo · Zona Norte Automotores');
  assert.match(m.description, /^Sorteamos Audi TT\./);
  assert.equal(m.image, 'https://cdn.example/audi.jpg');
});

test('sorteo sin foto: usa la imagen por defecto; foto relativa se vuelve absoluta', () => {
  assert.equal(shareMeta({ origin, pathname: '/sorteo/2', brand, raffle: { title: 'X' } }).image, 'https://sitio.example/share-default.jpg');
  assert.equal(shareMeta({ origin, pathname: '/sorteo/2', brand, raffle: { title: 'X', imageUrl: '/a.png' } }).image, 'https://sitio.example/a.png');
});

test('rechaza imágenes con protocolo raro y recorta textos largos', () => {
  const m = shareMeta({ origin, pathname: '/sorteo/2', brand, raffle: { title: 'T'.repeat(500), prize: 'P', imageUrl: 'javascript:alert(1)' } });
  assert.equal(m.image, 'https://sitio.example/share-default.jpg');
  assert.ok(m.title.length < 200);
});

test('solo /sorteo/<número> pide datos del sorteo', () => {
  assert.equal(raffleIdFromPath('/sorteo/12'), '12');
  assert.equal(raffleIdFromPath('/sorteo/12/bases'), null);
  assert.equal(raffleIdFromPath('/sorteo/abc'), null);
  assert.equal(raffleIdFromPath('/'), null);
});
