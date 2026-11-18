const stockCollections = new Set([
  'coconut_purchases', 'coconut_husking', 'coconut_copra', 'coconut_oil', 'coconut_sales'
]);
const ledgerCollections = new Set([...stockCollections, 'coconut_worker_payments']);
const stockLabels = {
  rawLargeStock: 'raw large coconuts',
  rawSmallStock: 'raw small coconuts',
  peeledStock: 'peeled coconuts',
  husksStock: 'coconut husks',
  copraStock: 'copra',
  oilStock: 'coconut oil',
  poonacStock: 'poonac'
};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rows = value => Object.values(value || {}).filter(row => row && typeof row === 'object');
const recordDate = record => String(record.date || '').slice(0, 10);
const tolerance = 0.000001;

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'SYNC_CONFLICT';
  throw error;
}

function emptyBalance() {
  return {
    rawLargeStock: 0, rawSmallStock: 0, peeledStock: 0, husksStock: 0,
    copraStock: 0, oilStock: 0, poonacStock: 0,
    unknownCopraBatches: 0, copraConsumed: 0, workers: new Map()
  };
}

function addWorker(balance, workerId, amount) {
  if (!workerId) return;
  balance.workers.set(workerId, (balance.workers.get(workerId) || 0) + amount);
}

function ledgerEvents(snapshot) {
  const events = new Map();
  function eventFor(record) {
    const date = recordDate(record);
    if (!events.has(date)) events.set(date, emptyBalance());
    return events.get(date);
  }
  for (const record of rows(snapshot?.coconut_purchases)) {
    const event = eventFor(record);
    event.rawLargeStock += number(record.largeCount);
    event.rawSmallStock += number(record.smallCount);
  }
  for (const record of rows(snapshot?.coconut_husking)) {
    const event = eventFor(record);
    const recordedLarge = number(record.largeCount);
    const small = number(record.smallCount);
    const large = recordedLarge || small ? recordedLarge : number(record.count);
    event.rawLargeStock -= large;
    event.rawSmallStock -= small;
    event.peeledStock += large + small;
    event.husksStock += large + small;
    addWorker(event, record.workerId, number(record.total) - number(record.paidDrawer));
  }
  for (const record of rows(snapshot?.coconut_copra)) {
    const event = eventFor(record);
    event.peeledStock -= number(record.nutsUsed);
    const measuredOutput = number(record.copraKg);
    if (measuredOutput > 0) event.copraStock += measuredOutput;
    else event.unknownCopraBatches += 1;
  }
  for (const record of rows(snapshot?.coconut_oil)) {
    const event = eventFor(record);
    event.copraStock -= number(record.copraUsed);
    event.copraConsumed += number(record.copraUsed);
    event.oilStock += number(record.oilQty);
    event.poonacStock += number(record.poonacQty);
  }
  for (const record of rows(snapshot?.coconut_sales)) {
    const event = eventFor(record);
    if (record.type === 'unhusked' || record.type === 'husked') {
      const recordedLarge = number(record.largeCount);
      const small = number(record.smallCount);
      const large = recordedLarge || small ? recordedLarge : number(record.qty);
      if (record.type === 'unhusked') {
        event.rawLargeStock -= large;
        event.rawSmallStock -= small;
      } else event.peeledStock -= large + small;
      continue;
    }
    const stockField = {husks: 'husksStock', copra: 'copraStock', oil: 'oilStock', poonac: 'poonacStock'}[record.type];
    if (stockField) event[stockField] -= number(record.qty);
    if (record.type === 'copra') event.copraConsumed += number(record.qty);
    // Shell output is not measured in the source ledger, so no weight is inferred from nut counts.
  }
  for (const record of rows(snapshot?.coconut_worker_payments)) {
    addWorker(eventFor(record), record.workerId, -number(record.amount));
  }
  return events;
}

function addEvent(balance, event) {
  if (!event) return;
  for (const field of [...Object.keys(stockLabels), 'unknownCopraBatches', 'copraConsumed']) {
    balance[field] += event[field];
  }
  for (const [workerId, amount] of event.workers) addWorker(balance, workerId, amount);
}

export function getCoconutStockBalances(snapshot, asOfDate = '') {
  const balance = emptyBalance();
  for (const [date, event] of ledgerEvents(snapshot)) {
    if (!asOfDate || !date || date <= asOfDate) addEvent(balance, event);
  }
  return {
    ...Object.fromEntries(Object.keys(stockLabels).map(field => [field, balance[field]])),
    copraStockKnown: balance.unknownCopraBatches === 0,
    copraUnknownBatches: balance.unknownCopraBatches,
    workerOutstanding: Object.fromEntries(balance.workers)
  };
}

export function validateCoconutLedger(before, after, updates) {
  const changedCollections = new Set(Object.keys(updates || {}).map(path => path.split('/')[0]));
  if (![...changedCollections].some(name => ledgerCollections.has(name))) return;
  const oldEvents = ledgerEvents(before);
  const newEvents = ledgerEvents(after);
  const dates = [...new Set([...oldEvents.keys(), ...newEvents.keys()])].sort();
  const previous = emptyBalance();
  const next = emptyBalance();
  const stockChanged = [...changedCollections].some(name => stockCollections.has(name));
  for (const date of dates) {
    addEvent(previous, oldEvents.get(date));
    addEvent(next, newEvents.get(date));
    if (stockChanged) {
      if (next.unknownCopraBatches > 0 && next.copraConsumed > previous.copraConsumed + tolerance) {
        conflict('Record measured output for older copra batches before using or selling copra.');
      }
      for (const [field, label] of Object.entries(stockLabels)) {
        if (next[field] < Math.min(0, previous[field]) - tolerance) {
          conflict(`Available ${label} changed for ${date || 'the opening balance'}. Review the pending coconut transaction.`);
        }
      }
    }
    for (const [workerId, amount] of next.workers) {
      if (amount < Math.min(0, previous.workers.get(workerId) || 0) - tolerance) {
        conflict('The worker outstanding balance changed. Review the pending wage payment or husking record.');
      }
    }
  }
}
