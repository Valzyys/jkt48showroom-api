# Pip AI API

Pip menggunakan API key yang sama dengan API data: key developer `jkc_…` dari dashboard atau key server `API_KEY`. Kirim lewat `Authorization: Bearer …` atau `X-API-Key`. Key wajib dikirim lewat header; sesi website dan query key tidak digunakan untuk Pip. Request developer memakai kuota bulanan yang sama dengan API data. Simpan key di server atau environment klien CLI.

## Endpoint dan model

| Method | Endpoint | Format |
| --- | --- | --- |
| GET | `/v1/models` | Katalog profil |
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/responses` | OpenAI Responses untuk Codex |
| POST | `/v1/messages` | Adapter Anthropic Messages |

Profil `pip` untuk umum, `pip-code` untuk pekerjaan kode, dan `pip-docs` untuk jawaban yang menggunakan dokumentasi publik JKT48Connect. Ketiganya menggunakan backend Mistral yang sama. Pip bukan model OpenAI atau Claude. Instruksi, knowledge retrieval, dan skill menyiapkan konteks; ini bukan fine-tuning bobot model.

## Request pertama

Simpan key developer yang sudah dimiliki dalam environment variable `API_KEY` pada mesin yang menjalankan klien. Pemilik Worker juga dapat memakai key server yang sudah dikonfigurasi; tidak perlu membuat key khusus Pip.

```bash
curl https://api.jkt48connect.app/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"pip","messages":[{"role":"user","content":"Halo Pip"}],"stream":false}'
```

Respons memuat `id`, `object: "chat.completion"`, `model`, `choices[].message.content`, `choices[].finish_reason`, dan `usage`. Request `stream: true` mengembalikan SSE. Chat Completions diakhiri `[DONE]`; Responses diakhiri event `response.completed` atau `response.incomplete`. Kegagalan menghasilkan error, bukan completion palsu.

```python
import os
from openai import OpenAI
client = OpenAI(base_url="https://api.jkt48connect.app/v1",
                api_key=os.environ["API_KEY"])
response = client.responses.create(model="pip-code", input="Jelaskan fungsi async di Python.")
print(response.output_text)
```

## Codex

Gabungkan konfigurasi ini dengan konfigurasi yang sudah ada, tanpa mengganti pengaturan proyek atau permission lainnya:

```toml
model_provider = "pip"
model = "pip-code"
model_context_window = 120000
model_auto_compact_token_limit = 90000
web_search = "disabled"

[model_providers.pip]
name = "Pip by JKT48Connect (Mistral)"
base_url = "https://api.jkt48connect.app/v1"
env_key = "API_KEY"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 1
stream_max_retries = 1
stream_idle_timeout_ms = 130000

[features]
apps = false
```

Profil Pip membatasi katalog ke maksimal 128 tool. Nonaktifkan Apps yang tidak diperlukan pada profil ini; jika menambahkan MCP, jaga total tool tetap di bawah batas tersebut. Gunakan konfigurasi khusus Pip atau override CLI `-c features.apps=false` saat menjalankannya, agar konfigurasi provider lainnya tetap sesuai kebutuhan. Bagian `[features]` dalam config global berlaku untuk semua provider.

Export key sebelum membuka sesi baru. Gateway menerima function tools dan custom text tools; eksekusi tool tetap dilakukan oleh Codex pada perangkat Anda sesuai izin klien. Gateway tidak menjalankan shell di VPS. Gunakan riwayat lengkap termasuk output tool; `previous_response_id` dan WebSocket tidak tersedia.

## Claude Code

Claude Code memakai Messages, sehingga base URL-nya tidak ditambah `/v1`:

```bash
export ANTHROPIC_BASE_URL="https://api.jkt48connect.app"
export ANTHROPIC_AUTH_TOKEN="$API_KEY"
export ANTHROPIC_MODEL="pip-code"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=120000
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000
export ANTHROPIC_DEFAULT_OPUS_MODEL="pip-code"
export ANTHROPIC_DEFAULT_SONNET_MODEL="pip-code"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="pip"
claude --model pip-code
```

Buka sesi baru setelah menambahkan batas konteks dan auto-compaction di atas. Claude Code dapat mengasumsikan 200K token untuk model yang tidak dikenal; profil ini disetel konservatif ke 120K dan compaction 100K agar riwayat panjang tidak melewati kapasitas backend.

Ini adapter backend Mistral pihak ketiga, bukan Claude dan bukan jaminan dukungan resmi Anthropic. Jangan menonaktifkan permission checks klien. Penghitungan token persis melalui `/v1/messages/count_tokens` belum tersedia dan mengembalikan 501.

## Batas, data, dan error

Gateway mendukung teks, function call, hasil tool, streaming, dan respons JSON. Gambar, audio, file, embeddings, pelatihan model, server tools, dan structured output belum didukung; request tersebut ditolak dengan error yang jelas.

Batas awal per key: 20 request inferensi per menit dan 500 per hari UTC, body 1 MiB, output maksimal 16384 token, deadline upstream 300 detik. Satu tugas agent bisa memakai beberapa request. Model yang tercantum tidak menjamin kemampuan penalaran setara model lain.

Gateway menyimpan statistik penggunaan dan metadata request yang disamarkan untuk key developer, tanpa isi prompt atau kode. Isi request dikirim ke Mistral; aturan retensi provider tetap berlaku. Jangan sertakan secret proyek. Sesi upstream dapat kedaluwarsa dan membutuhkan pembaruan oleh pemilik.

| Status | Arti |
| --- | --- |
| 400 | Input atau fitur tidak didukung |
| 401 | API key tidak valid atau sudah dicabut |
| 413 | Body terlalu besar, ringkas konteks |
| 429 | Batas gateway atau upstream tercapai |
| 501 | Penghitungan token persis tidak tersedia |
| 502 | Upstream gagal atau sesi kedaluwarsa |
| 503 | Gateway nonaktif atau belum dikonfigurasi |

Uji integrasi dengan tool call, kirim kembali hasilnya, lalu pastikan jawaban akhir diterima. Respons teks atau `/v1/models` yang berhasil saja belum membuktikan seluruh alur coding agent berjalan.
