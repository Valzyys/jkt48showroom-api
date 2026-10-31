/**
 * Stub kompatibilitas untuk Durable Object lama.
 *
 * Class IdnComments pernah diekspor worker ini (era migrasi v3-idn-comments) dan
 * masih memiliki instance Durable Object yang hidup di Cloudflare. Menghapus
 * export-nya membuat deploy gagal dengan error 10064, jadi class ini dipertahankan
 * sebagai stub. Kode baru tidak memakai class ini lagi.
 */
export class IdnComments {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
