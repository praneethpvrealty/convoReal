# Scaling Architecture Blueprint: 10k Accounts, 40M Properties, 200M Contacts

This document outlines the architectural blueprint, scaling strategies, and step-by-step roadmap required to scale the WhatsApp CRM from its current Next.js/Supabase serverless structure to support **10k active tenant accounts, 40 Million properties (120M images), and 200 Million contacts**.

---

## 1. Executive Projections & Scale Metrics

| Component | Target Scale | Hardware / Storage Projection |
| :--- | :--- | :--- |
| **Active Accounts (Tenants)** | 10,000 | N/A |
| **Properties (Inventory)** | 40,000,000 (Avg 4k/account) | ~80 GB raw DB rows |
| **Images (Property Galleries)**| 120,000,000 (Avg 3/property) | **~180 Terabytes** (at 1.5MB avg/image) |
| **Contacts (Leads/Clients)** | 200,000,000 (Avg 20k/account) | ~300 GB raw DB rows |
| **Message & Ingestion Logs** | Highly variable | **1 TB+** (depending on retention policy) |
| **Minimum Database RAM** | N/A | **32 GB - 64 GB** (to keep query indices in-memory) |

---

## 2. Database Optimization Layer (PostgreSQL)

At 200 Million contact rows, standard table scans are fatal. The following database optimizations are required:

### A. Suffix Phone Lookup Optimization
* **The Problem**: WhatsApp webhook messages carry international phone numbers (e.g. `+917502598759`). Matching contacts by looking up the trailing suffix (e.g. `like '%598759'`) triggers a full table scan because standard B-Tree indexes do not support wildcard prefixes (`%`).
* **The Solution**: 
  1. Store the phone number in reverse (e.g. `957895205719+`) in a indexed column and search using a standard prefix index (`reversed_phone LIKE '957895205%'`).
  2. Alternatively, create a dedicated `phone_suffix` column containing only the last 8 digits of the normalized phone number, and index it using a composite B-Tree index:
     ```sql
     CREATE INDEX idx_contacts_account_suffix ON contacts (account_id, phone_suffix);
     ```

### B. Connection Pooling & Resource Isolation
* **The Problem**: 10,000 accounts receiving concurrent WhatsApp messages will generate huge transaction spikes. Serverless functions open new database connections on every invocation, which will instantly exceed Postgres max client connection limits.
* **The Solution**: 
  - Ensure all service connections route through Supabase's transaction pooler (PgBouncer/Supavisor).
  - Provision a dedicated cloud database instance (AWS RDS Aurora or Supabase Enterprise) with isolated read replicas to offload read-heavy dashboard queries from the write-heavy webhook database.

### C. Row-Level Security (RLS) Performance
* **The Problem**: RLS runs security checks on every row returned. If an RLS policy includes cross-table joins (e.g. joining `profiles` to confirm `account_id`), it multiplies query latency at scale.
* **The Solution**: Optimize policies to use security definer helper functions or cache user account claims directly in JWT tokens, avoiding subqueries inside RLS policies.

---

## 3. Webhook Ingestion & Concurrency Architecture

To handle high-frequency incoming message spikes from 10k WhatsApp phone numbers, processing must be **asynchronous** and **decoupled**.

```
                   ┌──────────────────────┐
                   │  Meta WhatsApp API   │
                   └──────────┬───────────┘
                              │ (Concurrent Webhooks)
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │        Go Webhook Ingress Service (Microservice)       │
  │  - Receives webhooks instantly, returns HTTP 200       │
  │  - Enqueues jobs to Redis Queue                        │
  └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
                ┌───────────────────────────┐
                │    Redis / Queue Store    │
                └────────────┬──────────────┘
                             │
             ┌───────────────┴───────────────┐
             ▼                               ▼
 ┌───────────────────────┐       ┌───────────────────────┐
 │ Node Worker Service 1 │  ...  │ Node Worker Service N │
 │ (Ingests / Gemini AI) │       │ (Ingests / Gemini AI) │
 └───────────┬───────────┘       └───────────┬───────────┘
             │                               │
             └───────────────┬───────────────┘
                             ▼
                  ┌──────────────────────┐
                  │  Supabase Database   │
                  └──────────────────────┘
```

### A. The Webhook Ingress Service (Go / Fiber)
* **Role**: A lightweight microservice written in **Go** (using the Fiber or Gin framework) deployed to a container cluster (Docker/AWS ECS).
* **Why Go?**: Go has a tiny memory footprint (uses ~20MB RAM per container compared to Node's 150MB+ in containerised envs) and leverages Goroutines (lightweight threads requiring only 2KB memory each). Go can accept thousands of concurrent webhooks, run SHA256 signature validation, push the payload to Redis, and respond with `HTTP 200` to Meta in under **20 milliseconds**.
* This prevents Meta from timing out and retrying webhooks, eliminating duplicate processing and race conditions.

### B. The Message Queue (Redis / BullMQ)
* **Role**: Buffers incoming payloads. This protects workers and Supabase from database connection exhaustion during peak traffic hours (e.g. when a user launches a massive broadcast campaign).

### C. Worker Nodes (Node.js / TypeScript)
* **Role**: Background workers that pull tasks from the queue, download media buffers from Meta, send media/text to the Gemini API for parsing/classification, and perform Supabase CRUD operations.
* **Why Node?**: Keeping workers in Node.js allows you to retain all the current JavaScript/TypeScript AI chatbot engine code, Supabase client logic, and Gemini parsing helper utilities without translating them to Go.

---

## 4. Media & File Storage Optimization (120M Images)

* **Egress Fees**: Storing 180 TB of images in standard cloud storage buckets and serving them to clients will result in massive egress bandwidth costs.
* **The Solution**: 
  - Migrate storage from Supabase Storage to **Cloudflare R2** (which features **$0 egress fees**).
  - Put Cloudflare CDN in front of R2 to cache image assets globally, reducing gallery load times to milliseconds for users while protecting the storage origin from load.

---

## 5. API Rate Limit Management (Gemini / Meta)

* **Gemini API**: Upgrade your API access to **Vertex AI Pay-As-You-Go** on Google Cloud to get high Requests-Per-Minute (RPM) and Tokens-Per-Minute (TPM) limits.
* **Retry Backoff**: Implement exponential backoff (e.g. 1s, 2s, 4s, 8s, 16s) inside the queue workers to gracefully handle temporary `429 Too Many Requests` responses from the Gemini API.

---

## 6. Migration Roadmap (Step-by-Step)

If you decide to scale the application to these levels, execute the migration in this logical order:

### Phase 1: Database Optimizations (Immediate)
1. Add the composite index on `(account_id, phone_suffix)` (or reversed phone column).
2. Set up PgBouncer / connection pooling connection strings.
3. Add pagination controls to all contact lists and property list query pages.

### Phase 2: Decoupling and Queueing
1. Set up a Redis instance.
2. Build an async queue processor using `BullMQ` in your current Node/NextJS project.
3. Modify your Next.js webhook route to simply push to the queue and instantly return `HTTP 200`. Move the heavy image-downloading, Gemini-parsing, and DB-updating logic into queue workers.

### Phase 3: Ingress Migration (Go)
1. Write the webhook signature verification and queue enqueue logic in Go.
2. Deploy the Go service on Docker/ECS as the webhook endpoint.
3. Configure your Meta developer console to route webhooks to this Go microservice.
4. Keep worker nodes running in Node.js to consume tasks from Redis.

### Phase 4: Storage Migration
1. Set up a Cloudflare R2 bucket.
2. Update the worker's `uploadPropertyImage` function to use the AWS S3 SDK pointed to Cloudflare R2.
