import { binding, env } from './env.js';
export async function security(operation) {
  if (env.LOCAL_COORDINATOR) return env.LOCAL_COORDINATOR.security(operation);
  const namespace = binding('COORDINATOR');
  const response = await namespace.get(namespace.idFromName('global')).fetch('https://coordinator.internal/security',{method:'POST',body:JSON.stringify(operation)});
  if (!response.ok) throw Object.assign(new Error('Security service unavailable'),{status:503});
  return response.json();
}
