CREATE TABLE stops (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    demand INT DEFAULT 1 CHECK (demand >= 0),
    priority INT DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    is_depot BOOLEAN DEFAULT FALSE
);

CREATE TABLE road_segments (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(50) REFERENCES stops(id) ON DELETE CASCADE,
    target_id VARCHAR(50) REFERENCES stops(id) ON DELETE CASCADE,
    distance_km DOUBLE PRECISION NOT NULL CHECK (distance_km >= 0),
    travel_time_min DOUBLE PRECISION NOT NULL CHECK (travel_time_min >= 0),
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT unique_road UNIQUE (source_id, target_id)
);

CREATE TABLE buses (
    id SERIAL PRIMARY KEY,
    bus_number VARCHAR(20) UNIQUE NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0)
);

CREATE INDEX idx_road_source ON road_segments(source_id);
CREATE INDEX idx_road_target ON road_segments(target_id);