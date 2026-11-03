function charge(card, amount) {
  if (card.expired) {
    throw new Error('card expired');
  }
  return { ok: true, amount, last4: card.number.slice(-4) };
}

function formatInvoice(items) {
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { lines: items.map((i) => `${i.name} x${i.qty}`), total };
}

module.exports = { charge, formatInvoice };
