import {applyCloudCommit, readPath, writePath, CommitConflict} from './cloud-commit.mjs';

export const ledgerCollections = [
  'coconut_purchases', 'coconut_husking', 'coconut_gradings', 'coconut_copra',
  'coconut_oil', 'coconut_sales', 'coconut_workers', 'coconut_worker_payments',
  'cash_movements', 'day_ends',
];

export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id)
  && !['__proto__', 'constructor', 'prototype'].includes(id);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const coconutOnly = (collection, record) => collection === 'cash_movements' ? /^coconut_/.test(record?.source ?? '')
  : collection === 'day_ends' ? record?.type === 'coconut' : Boolean(record);

export function coconutSnapshot(source, settings) {
  const snapshot = {settings: {main: {...settings,
    coconutOpeningFloats: source.settings?.main?.coconutOpeningFloats ?? {}}}};
  for (const collection of ledgerCollections) {
    snapshot[collection] = Object.fromEntries(Object.entries(source[collection] ?? {})
      .filter(([id, record]) => validId(id) && coconutOnly(collection, record)));
  }
  return snapshot;
}

export function publicSnapshot(snapshot) {
  const {_pos_commits, ...records} = snapshot;
  return records;
}

function validPath(path) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  return parts.length === 2 && ledgerCollections.includes(parts[0]) && validId(parts[1])
    || /^settings\/main\/coconutOpeningFloats\/\d{4}-\d{2}-\d{2}$/.test(path);
}
function safeValue(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 16000;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (Array.isArray(value)) return value.length < 500 && value.every(child => safeValue(child, depth + 1));
  return object(value) && Object.keys(value).length < 200
    && Object.entries(value).every(([key, child]) => validId(key) && safeValue(child, depth + 1));
}

export function validateCommand(command) {
  if (!object(command) || !/^[a-zA-Z0-9_-]{8,100}$/.test(command.id)
      || !object(command.updates) || !object(command.expected)) throw new Error('Invalid coconut transaction.');
  const paths = Object.keys(command.updates);
  if (!paths.length || paths.length > 100 || paths.length !== Object.keys(command.expected).length) {
    throw new Error('Invalid coconut transaction size.');
  }
  for (const path of paths) {
    const value = command.updates[path];
    if (!validPath(path) || !Object.hasOwn(command.expected, path) || !safeValue(command.expected[path]) || !safeValue(value)) {
      throw new Error('Invalid coconut record path or value.');
    }
    if (path.startsWith('settings/')) {
      if (typeof value !== 'number' || value < 0) throw new Error('Invalid opening float.');
    } else if (value !== null && (!object(value) || !coconutOnly(path.split('/')[0], value))) {
      throw new Error('Choose a record in the coconut workspace.');
    }
  }
}
function equal(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right,key) && equal(left[key], right[key]));
}

export function applyCoconutCommand(snapshot, command) {
  validateCommand(command);
  if (!Object.hasOwn(snapshot._pos_commits ?? {}, command.id)) {
    for (const [path, before] of Object.entries(command.expected)) {
      if (!equal(readPath(snapshot, path), before)) throw new CommitConflict('A coconut record changed on another device. The pending entry is still saved here.');
    }
  }
  return applyCloudCommit(snapshot, {id: command.id, updates: command.updates});
}

export function buildCoconutCommand(snapshot, operations, id) {
  const draft = structuredClone(snapshot), updates = {}, expected = {};
  for (const operation of operations) {
    const {path, type, data} = operation;
    if (!validPath(path)) throw new Error('Invalid coconut record.');
    const prior = readPath(draft, path);
    if (!Object.hasOwn(expected, path)) expected[path] = readPath(snapshot, path);
    const value = type === 'del' ? null : type === 'patch' ? {...prior, ...data} : data;
    updates[path] = value;
    writePath(draft, path, value);
  }
  return {id, updates, expected};
}
