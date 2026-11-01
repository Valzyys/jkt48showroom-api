ALTER TABLE api_payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'mypg';
ALTER TABLE api_payments ADD COLUMN qris_payload TEXT;
ALTER TABLE api_payments ADD COLUMN fulfilment_token TEXT;
