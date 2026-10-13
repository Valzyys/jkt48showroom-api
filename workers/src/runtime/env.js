import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
export const env = new Proxy({}, { get: (_, key) => context.getStore()?.env?.[key] ?? process.env[key] });
export function runWithEnv(bindings, execution, action) {
  return context.run({ env: bindings, execution }, action);
}
export function background(promise) {
  const execution = context.getStore()?.execution;
  if (execution) execution.waitUntil(promise);
  else promise.catch(error => console.error(error.message));
}
export function binding(name) {
  const value = env[name];
  if (!value) throw Object.assign(new Error(`Missing binding: ${name}`), { status: 503 });
  return value;
}
