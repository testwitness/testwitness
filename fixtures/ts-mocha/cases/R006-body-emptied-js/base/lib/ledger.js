'use strict';

function post(entries, entry) {
  if (entry.amount === 0) throw new Error('empty entry');
  return entries.concat([entry]);
}

function balance(entries) {
  return entries.reduce((sum, e) => sum + (e.side === 'debit' ? e.amount : -e.amount), 0);
}

module.exports = { post, balance };
