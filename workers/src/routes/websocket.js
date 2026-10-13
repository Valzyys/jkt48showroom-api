import { binding } from '@/runtime/env';
function hub() { const namespace = binding('LIVE_HUB'); return namespace.get(namespace.idFromName('global')); }
export async function combinedLives() { return (await hub().fetch('https://live.internal/lives')).json(); }
export async function webhookUpdateLive(lives, group) {
  const response = await hub().fetch('https://live.internal/update', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lives,group})});
  if (!response.ok) throw new Error('Live state update failed');
}
export async function initLiveData() { return hub().fetch('https://live.internal/refresh',{method:'POST'}); }
