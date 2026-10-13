import { env } from '@/runtime/env';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { createMiddleware } from 'hono/factory';
function generateIV() {
    return crypto.randomBytes(16);
}
const algorithm = 'aes-256-cbc';
export function encrypt(text) {
    const iv = generateIV();
    const key = new Uint8Array(Buffer.from(env.SECRET));
    const cipher = crypto.createCipheriv(algorithm, key, new Uint8Array(iv));
    let encrypted = new Uint8Array(cipher.update(text));
    encrypted = new Uint8Array(Buffer.concat([
        encrypted,
        new Uint8Array(cipher.final())
    ]));
    return `${iv.toString('hex')}:${Buffer.from(encrypted).toString('hex')}`;
}
export function decrypt(encrypted) {
    try {
        const textParts = encrypted.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(algorithm, new Uint8Array(Buffer.from(env.SECRET)), new Uint8Array(iv));
        let decrypted = decipher.update(new Uint8Array(encryptedText));
        decrypted = Buffer.concat([
            new Uint8Array(decrypted),
            new Uint8Array(decipher.final())
        ]);
        return decrypted.toString();
    } catch  {
        return null;
    }
}
export function hashWithSecret(data, secretKey) {
    return crypto.createHmac('md5', secretKey).update(data).digest('hex');
}
export function generateUUID() {
    return crypto.randomUUID();
}
export function isAdmin(userId) {
    const ids = (env.ADMIN_IDS || '').split(',');
    return ids.includes(String(userId));
}
export function checkAdmin() {
    return createMiddleware(async (c, next)=>{
        const user = c.get('user');
        if (!user) return await c.notFound();
        if (!isAdmin(user.id)) return await c.notFound();
        return next();
    });
}
export function getIp(context) {
    return context.req.header('CF-Connecting-IP');
}
