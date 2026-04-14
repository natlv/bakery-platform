# Bakery Marketplace

This repository contains a simple bakery marketplace prototype.

Customers can create baking requests, browse bakers, and accept bids. Bakers can sign up, manage menu items, and respond to customer requests. The backend also includes semantic baker matching and a lightweight chat endpoint.

## Project Structure

- `frontend/`: static HTML, CSS, and JavaScript pages
- `backend/`: FastAPI application, database access, and matching services
- `data/`: SQL schema, sample data assets, and import scripts

## Requirements

- Python 3.10+
- PostgreSQL
- `pip`

## Environment Variables

Create local env files from the examples:

- `backend/.env`
- `data/.env`

Minimum backend variables:

```env
DB_HOST=your_db_host
DB_PORT=5432
DB_NAME=your_db_name
DB_USER=your_db_user
DB_PASSWORD=your_db_password
SEALION_API_KEY=your_sealion_api_key
```

The backend also looks for Google Cloud credentials through `GOOGLE_APPLICATION_CREDENTIALS` or `KEY_PATH` if image uploads are enabled.
