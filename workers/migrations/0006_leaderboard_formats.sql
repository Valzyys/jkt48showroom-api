ALTER TABLE collector_leaderboards RENAME TO collector_leaderboards_legacy;
CREATE TABLE collector_leaderboards (
 data_id TEXT NOT NULL,
 layout TEXT NOT NULL DEFAULT 'portrait' CHECK(layout IN ('portrait','banner')),
 source_version INTEGER NOT NULL,
 design_version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL,
 render_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 object_key TEXT,
 width INTEGER,
 height INTEGER,
 updated_at INTEGER NOT NULL,
 last_error TEXT,
 PRIMARY KEY(data_id,layout)
);
INSERT INTO collector_leaderboards(data_id,source_version,design_version,state,render_token,lease_until,object_key,width,height,updated_at,last_error)
 SELECT data_id,source_version,design_version,state,render_token,lease_until,object_key,width,height,updated_at,last_error FROM collector_leaderboards_legacy;
DROP TABLE collector_leaderboards_legacy;
CREATE INDEX collector_leaderboards_state ON collector_leaderboards(state,lease_until);
