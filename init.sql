-- Development-only bootstrap for reproducing the analysis tables locally.
-- Do not apply this file to the production RDS database.

CREATE TABLE IF NOT EXISTS business_category
(
    business_category_id integer NOT NULL,
    business_category_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT business_category_pkey PRIMARY KEY (business_category_id)
);

CREATE TABLE IF NOT EXISTS industry
(
    industry_id integer NOT NULL,
    industry_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT industry_pkey PRIMARY KEY (industry_id)
);

CREATE TABLE IF NOT EXISTS ipo_type
(
    ipo_type_id integer NOT NULL,
    ipo_type_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT ipo_type_pkey PRIMARY KEY (ipo_type_id)
);

CREATE TABLE IF NOT EXISTS keyword
(
    keyword_id integer NOT NULL,
    keyword_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT keyword_pkey PRIMARY KEY (keyword_id)
);

CREATE TABLE IF NOT EXISTS location_category
(
    location_category_id integer NOT NULL,
    location_category_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT location_category_pkey PRIMARY KEY (location_category_id)
);

CREATE TABLE IF NOT EXISTS prefecture
(
    prefecture_id integer NOT NULL,
    prefecture_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT prefecture_pkey PRIMARY KEY (prefecture_id)
);

CREATE TABLE IF NOT EXISTS release_type
(
    release_type_id integer NOT NULL,
    release_type_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT release_type_pkey PRIMARY KEY (release_type_id)
);

CREATE TABLE IF NOT EXISTS city
(
    city_id integer NOT NULL,
    city_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    prefecture_id integer NOT NULL,
    CONSTRAINT city_pkey PRIMARY KEY (city_id),
    CONSTRAINT city_prefecture_id_fkey FOREIGN KEY (prefecture_id)
        REFERENCES prefecture (prefecture_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS company
(
    company_id integer NOT NULL,
    company_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    president_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    address character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    phone character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    description text COLLATE pg_catalog."default" NOT NULL DEFAULT ''::text,
    industry_id integer NOT NULL,
    ipo_type_id integer NOT NULL,
    capital integer NOT NULL DEFAULT 0,
    foundation_date character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    url character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    twitter_screen_name character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    CONSTRAINT company_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_industry_id_fkey FOREIGN KEY (industry_id)
        REFERENCES industry (industry_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT company_ipo_type_id_fkey FOREIGN KEY (ipo_type_id)
        REFERENCES ipo_type (ipo_type_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS release
(
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    subtitle text COLLATE pg_catalog."default" NOT NULL DEFAULT ''::text,
    lead_paragraph text COLLATE pg_catalog."default" NOT NULL DEFAULT ''::text,
    body text COLLATE pg_catalog."default" NOT NULL,
    main_image character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    main_image_fastly character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    youtube_url character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    release_type_id integer,
    created_at timestamp without time zone,
    CONSTRAINT release_pkey PRIMARY KEY (company_id, release_id),
    CONSTRAINT release_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES company (company_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_release_type_id_fkey FOREIGN KEY (release_type_id)
        REFERENCES release_type (release_type_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS release_business_category
(
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    business_category_id integer NOT NULL,
    main_flg smallint NOT NULL,
    CONSTRAINT release_business_category_pkey PRIMARY KEY (company_id, release_id, business_category_id, main_flg),
    CONSTRAINT release_business_category_business_category_id_fkey FOREIGN KEY (business_category_id)
        REFERENCES business_category (business_category_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_business_category_company_id_release_id_fkey FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS release_keyword
(
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    keyword_id integer NOT NULL,
    sort_priority integer NOT NULL DEFAULT 0,
    CONSTRAINT release_keyword_pkey PRIMARY KEY (company_id, release_id, keyword_id),
    CONSTRAINT release_keyword_company_id_release_id_fkey FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_keyword_keyword_id_fkey FOREIGN KEY (keyword_id)
        REFERENCES keyword (keyword_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS release_location
(
    id integer NOT NULL,
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    prefecture_id integer,
    city_id integer,
    location_category_id integer,
    CONSTRAINT release_location_pkey PRIMARY KEY (id),
    CONSTRAINT release_location_city_id_fkey FOREIGN KEY (city_id)
        REFERENCES city (city_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_location_company_id_release_id_fkey FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_location_location_category_id_fkey FOREIGN KEY (location_category_id)
        REFERENCES location_category (location_category_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT release_location_prefecture_id_fkey FOREIGN KEY (prefecture_id)
        REFERENCES prefecture (prefecture_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS release_statistic
(
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    page_view integer NOT NULL,
    unique_user integer NOT NULL,
    like_count integer NOT NULL,
    CONSTRAINT release_statistic_pkey PRIMARY KEY (company_id, release_id),
    CONSTRAINT release_statistic_company_id_release_id_fkey FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS webclipping_list
(
    id integer NOT NULL,
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    release_url character varying(240) COLLATE pg_catalog."default",
    clipping_url text COLLATE pg_catalog."default",
    new_site_name character varying(240) COLLATE pg_catalog."default",
    site_name character varying(240) COLLATE pg_catalog."default",
    insert_date timestamp without time zone NOT NULL,
    CONSTRAINT webclipping_list_pkey PRIMARY KEY (id),
    CONSTRAINT webclipping_list_company_id_release_id_fkey FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS recommendation_generation
(
    id uuid NOT NULL,
    cache_key text NOT NULL,
    company_id text NOT NULL,
    dashboard jsonb NOT NULL,
    conditions jsonb NOT NULL,
    saved boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT recommendation_generation_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS recommendation_generation_cache_idx
    ON recommendation_generation (cache_key, expires_at DESC);

CREATE INDEX IF NOT EXISTS recommendation_generation_cache_latest_idx
    ON recommendation_generation (cache_key, created_at DESC);

CREATE INDEX IF NOT EXISTS recommendation_generation_company_idx
    ON recommendation_generation (company_id, created_at DESC);
