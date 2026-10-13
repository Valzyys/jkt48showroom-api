import jwt from 'jsonwebtoken';
import { env } from '@/runtime/env';
export class JWTError extends Error {
  constructor(message,code) { super(message); this.name='JWTError'; this.code=code; }
}
function secret(value) { const result = value || env.JWT_SECRET; if (!result) throw new JWTError('JWT secret missing','INVALID'); return result; }
export function createJWT(payload,expireMs,key) { return jwt.sign(payload,secret(key),{algorithm:'HS256',expiresIn:Math.floor(expireMs/1000)}); }
export function verifyJWT(token,key) {
  try { return jwt.verify(token,secret(key),{algorithms:['HS256']}); }
  catch(error) { throw new JWTError(error.name==='TokenExpiredError'?'Token expired':'Invalid token',error.name==='TokenExpiredError'?'EXPIRED':'INVALID'); }
}
export function isJWTValid(token,key) { try { verifyJWT(token,key); return true; } catch { return false; } }
