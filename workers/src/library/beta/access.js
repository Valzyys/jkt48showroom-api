import { BetaDeviceModel } from '@/database/schema/config/BetaDevice';
import { BetaKeyModel } from '@/database/schema/config/BetaKey';
// All beta routes run in the single Coordinator object, including admin writes.
export function invalidateBetaDeviceAccess() {}
export async function getBetaDeviceAccess(fingerprint) {
  const device = await BetaDeviceModel.findOneAndUpdate({fingerprint,enabled:true},{$set:{lastSeenAt:new Date()}},{new:true});
  return Boolean(device);
}
export async function upsertBetaDevice({fingerprint,bypassKey,note}) {
  await BetaDeviceModel.updateOne({fingerprint},{$set:{enabled:true,lastSeenAt:new Date(),...(bypassKey?{bypassKey}:{}),...(note!==undefined?{note}:{})},$setOnInsert:{fingerprint}},{upsert:true});
}
export async function enrollBetaDevice({fingerprint,keyHash}) {
  const key = await BetaKeyModel.findOne({keyHash,expiresAt:{$gt:new Date()}}).lean();
  if (!key) return false;
  const existing = await BetaDeviceModel.findOne({fingerprint}).lean();
  if (existing?.enabled) { await BetaDeviceModel.updateOne({_id:existing._id},{$set:{lastSeenAt:new Date()}}); return true; }
  if (key.maxDevices != null && await BetaDeviceModel.countDocuments({bypassKey:key._id,enabled:true}) >= key.maxDevices) return false;
  await upsertBetaDevice({fingerprint,bypassKey:key._id});
  await BetaKeyModel.updateOne({_id:key._id},{$set:{lastUsedAt:new Date()},$inc:{enrollmentVersion:1}});
  return true;
}
export async function removeBetaDevice(fingerprint) { await BetaDeviceModel.deleteOne({fingerprint}); }
export async function listBetaDevices() {
  return BetaDeviceModel.find().select('fingerprint note lastSeenAt bypassKey createdAt').populate({path:'bypassKey',select:'note expiresAt'}).sort({lastSeenAt:-1}).lean();
}
