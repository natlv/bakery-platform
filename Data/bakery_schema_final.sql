--- Lookup Tables ---
CREATE TABLE fulfillment_method (
  fulfillment_method_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE halal_status (
  halal_status_id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE less_sweet (
  less_sweet_id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);


--- Core Tables ---
CREATE TABLE baker (
  baker_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url TEXT,
  fulfillment_method_id BIGINT REFERENCES fulfillment_method(fulfillment_method_id),
  halal_status_id BIGINT REFERENCES halal_status(halal_status_id),
  less_sweet_id BIGINT REFERENCES less_sweet(less_sweet_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE location (
  location_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE baker_location (
  baker_id BIGINT NOT NULL REFERENCES baker(baker_id) ON DELETE CASCADE, --- this will help automatically delete related rows if the parent row is deleted 
  location_id BIGINT NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT, --- this helps prevent deletion if relation rows exist to protect shared reference data
  PRIMARY KEY (baker_id, location_id)
);

CREATE TABLE specialty (
  specialty_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE baker_specialty (
  baker_id BIGINT NOT NULL REFERENCES baker(baker_id) ON DELETE CASCADE,
  specialty_id BIGINT NOT NULL REFERENCES specialty(specialty_id) ON DELETE RESTRICT,
  PRIMARY KEY (baker_id, specialty_id)
);

CREATE TABLE contact (
  contact_id BIGSERIAL PRIMARY KEY,
  baker_id BIGINT NOT NULL REFERENCES baker(baker_id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('instagram','email','website')),
  contact_value TEXT NOT NULL,
  UNIQUE (baker_id, contact_type, contact_value)
);

CREATE TABLE source_listing (
  baker_id BIGINT PRIMARY KEY REFERENCES baker(baker_id) ON DELETE CASCADE,
  csv_row_number INT,
  source_index INT,
  raw_title TEXT
);