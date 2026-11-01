export async function notifyHub(bindings){
 if(!bindings.LIVE_HUB)return;
 const hub=bindings.LIVE_HUB.get(bindings.LIVE_HUB.idFromName('global'));
 await hub.fetch('https://live.internal/signal',{method:'POST'});
}
