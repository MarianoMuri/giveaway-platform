const { QueryTypes } = require('sequelize');
const { sequelize, Raffle, Chance } = require('../db');

/**
 * Asignación de números consecutivos.
 *
 * Cada sorteo tiene un contador (Raffle.nextNumber, arranca en 100000). Para tomar
 * un bloque de N números se hace UN solo UPDATE atómico que suma N y devuelve el
 * valor nuevo (RETURNING). La base serializa los UPDATE sobre la misma fila: si
 * llegan dos pagos a la vez, el segundo espera al primero y recibe el bloque
 * siguiente. No hay "leer y después escribir", que es donde aparecen los duplicados.
 *
 * El contador solo avanza: un número anulado (reintegro, contracargo) nunca se
 * vuelve a asignar. Además, la restricción única (RaffleId, number) de Chance
 * hace que la base rechace un duplicado aunque hubiera un bug acá.
 */
async function reserveBlock(raffleId, count, transaction) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Cantidad de números inválida: ${count}`);
  const qi = sequelize.getQueryInterface();
  const table = qi.queryGenerator.quoteTable(Raffle.getTableName());
  const col = qi.quoteIdentifier('nextNumber');
  const rows = await sequelize.query(
    `UPDATE ${table} SET ${col} = ${col} + :count WHERE ${qi.quoteIdentifier('id')} = :raffleId RETURNING ${col}`,
    { replacements: { count, raffleId }, type: QueryTypes.SELECT, transaction }
  );
  if (!rows.length) throw new Error(`Sorteo ${raffleId} inexistente`);
  const next = Number(rows[0].nextNumber);
  return { first: next - count, last: next - 1 };
}

// Asigna los números de una orden. Se llama dentro de la transacción que confirma el pago.
async function assignNumbers(order, transaction) {
  const { first, last } = await reserveBlock(order.RaffleId, order.chances, transaction);
  const rows = [];
  for (let n = first; n <= last; n++) rows.push({ number: n, RaffleId: order.RaffleId, OrderId: order.id });
  for (let i = 0; i < rows.length; i += 1000) {
    await Chance.bulkCreate(rows.slice(i, i + 1000), { transaction });
  }
  await order.update({ firstNumber: first, lastNumber: last }, { transaction });
  return { first, last };
}

// Anula los números de una orden (se usa ante reintegros y contracargos)
async function voidNumbers(orderId, transaction) {
  const [count] = await Chance.update({ status: 'void' }, { where: { OrderId: orderId, status: 'valid' }, transaction });
  return count;
}

module.exports = { reserveBlock, assignNumbers, voidNumbers };
