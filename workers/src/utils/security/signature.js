import { env } from '@/runtime/env';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
const encoder = new TextEncoder();
let signatureSecret = null;
let sourceSignatureSecrets = null;
function toHex(buffer) {
    return Buffer.from(buffer).toString('hex');
}
export function getSignatureSecret() {
    if (signatureSecret == null) {
        signatureSecret = crypto.createHmac('sha256', env.JWT_SECRET).update(env.SECRET).digest('hex');
    }
    return signatureSecret;
}
export function getSourceSignatureSecrets() {
    if (sourceSignatureSecrets == null) {
        sourceSignatureSecrets = new Map((env.SIGNATURE_SECRETS ?? '').split(',').map((item)=>{
            const separatorIndex = item.indexOf(':');
            if (separatorIndex === -1) return null;
            const source = item.slice(0, separatorIndex).trim();
            const secret = item.slice(separatorIndex + 1).trim();
            if (!source || !secret) return null;
            return [
                source,
                secret
            ];
        }).filter((item)=>item != null));
    }
    return sourceSignatureSecrets;
}
export function getSignatureSecretBySource(source) {
    if (!source) return getSignatureSecret();
    return getSourceSignatureSecrets().get(source) ?? null;
}
export async function sign(bodyRequest, secretKey = null) {
    secretKey = secretKey ?? getSignatureSecret();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secretKey), {
        name: 'HMAC',
        hash: 'SHA-256'
    }, false, [
        'sign'
    ]);
    const body = typeof bodyRequest === 'string' ? bodyRequest : JSON.stringify(bodyRequest);
    return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
}
export function isEqualSignature(value, expected) {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);
    return valueBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}
export async function verifySignature(bodyRequest, signature, source) {
    const secret = getSignatureSecretBySource(source);
    if (!secret) return false;
    const expectedSignature = await sign(bodyRequest, secret);
    return isEqualSignature(signature, expectedSignature);
}
