from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
import shutil
import os
from pydantic import BaseModel, Field
from werkzeug.security import generate_password_hash, check_password_hash
from urllib.parse import urlparse, unquote
import uuid
from bucket_utils import Bucket
from infrastructure.db import get_db_cursor
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from semantic_matching.service import embed_baker_with_cursor, match_bakers
from infrastructure.logging import backend_logger as logger

load_dotenv()

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("KEY_PATH")
if credentials_path:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all for now
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bucket = Bucket()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def serialize_request_row(row):
    return {
        "request_id": row[0],
        "customer_id": row[1],
        "title": row[2],
        "description": row[3],
        "budget": float(row[4]) if row[4] is not None else None,
        "deadline": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
        "status": row[6],
        "image_url": bucket.find_image(row[7]) if row[7] else None,
        "accepted_bid_id": row[8],
        "created_at": row[9].isoformat() if hasattr(row[9], "isoformat") else row[9],
        "bid_count": row[10] or 0,
        "lowest_bid": float(row[11]) if row[11] is not None else None,
    }


def serialize_bid_row(row):
    return {
        "bid_id": row[0],
        "request_id": row[1],
        "baker_id": row[2],
        "price": float(row[3]) if row[3] is not None else None,
        "timeline": row[4],
        "notes": row[5],
        "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
    }


def serialize_baker_row(row):
    return {
        "baker_id": row[0],
        "name": row[1],
        "description": row[2] or "",
        "image_url": bucket.find_image(row[3]) if row[3] else None,
        "halal_certificate_url": bucket.find_image(row[4]) if row[4] else None,
        "fulfillment_method": row[5] or "",
        "halal_status": row[6] or "",
        "less_sweet": row[7] or "",
        "locations": row[8] or [],
        "specialties": row[9] or [],
        "contacts": row[10] or [],
        "created_at": row[11].isoformat() if hasattr(row[11], "isoformat") else row[11],
        "is_advertising": bool(row[12]) if len(row) > 12 else False,
    }


def serialize_menu_item_row(row):
    return {
        "item_id": row[0],
        "baker_id": row[1],
        "name": row[2] or "",
        "category": row[3] or "",
        "description": row[4] or "",
        "price": float(row[5]) if row[5] is not None else None,
        "lead_time": row[6] or "",
        "serves": row[7] or "",
        "dietary": row[8] or [],
        "custom_orders": bool(row[9]),
        "status": row[10] or "draft",
        "image_url": bucket.find_image(row[11]) if row[11] else None,
        "created_at": row[12].isoformat() if hasattr(row[12], "isoformat") else row[12],
        "updated_at": row[13].isoformat() if hasattr(row[13], "isoformat") else row[13],
    }


def fetch_or_create_lookup_id(cursor, table_name: str, id_column: str, name: str):
    cursor.execute(
        f"INSERT INTO {table_name} (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
        (name,),
    )
    cursor.execute(f"SELECT {id_column} FROM {table_name} WHERE name = %s", (name,))
    row = cursor.fetchone()
    return row[0] if row else None


def table_columns(cursor, table_name: str):
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row[0] for row in cursor.fetchall()}


def ensure_menu_item_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS menu_item (
            item_id BIGSERIAL PRIMARY KEY,
            baker_id BIGINT NOT NULL REFERENCES baker(baker_id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
            lead_time TEXT,
            serves TEXT,
            dietary TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
            custom_orders BOOLEAN NOT NULL DEFAULT FALSE,
            status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('live', 'draft')),
            image_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def menu_item_columns(cursor):
    ensure_menu_item_table(cursor)
    return table_columns(cursor, "menu_item")


class MenuItemPayload(BaseModel):
    baker_id: int
    name: str
    category: str
    description: str = ""
    price: float
    lead_time: str = ""
    serves: str = ""
    dietary: List[str] = Field(default_factory=list)
    custom_orders: bool = False
    status: str = "draft"
    image_url: str = ""


def insert_customer_profile(cursor, user_id: int, user):
    columns = table_columns(cursor, "customer")
    if not columns:
        return None

    values_by_column = {
        "user_id": user_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "name": f"{user.first_name} {user.last_name}".strip(),
        "email": user.email,
        "address": user.customer_address,
        "phone": user.customer_phone,
        "marketing_opt_in": user.marketing_opt_in,
        "interests": ", ".join(user.customer_interests or []),
    }
    insert_columns = [column for column in values_by_column if column in columns]
    if not insert_columns:
        return None

    placeholders = ", ".join(["%s"] * len(insert_columns))
    returning_column = "customer_id" if "customer_id" in columns else "id" if "id" in columns else None
    returning_sql = f" RETURNING {returning_column}" if returning_column else ""
    cursor.execute(
        f"""
        INSERT INTO customer ({", ".join(insert_columns)})
        VALUES ({placeholders})
        {returning_sql}
        """,
        tuple(values_by_column[column] for column in insert_columns),
    )
    row = cursor.fetchone() if returning_column else None
    return row[0] if row else user_id


def customer_identity_column(columns):
    if "customer_id" in columns:
        return "customer_id"
    if "id" in columns:
        return "id"
    return None


def insert_baker_profile(cursor, user):
    baker_columns = table_columns(cursor, "baker")
    fulfillment_method_id = fetch_or_create_lookup_id(
        cursor, "fulfillment_method", "fulfillment_method_id", user.fulfillment_method
    )
    halal_status_id = fetch_or_create_lookup_id(
        cursor, "halal_status", "halal_status_id", user.halal_status
    )
    less_sweet_id = fetch_or_create_lookup_id(
        cursor, "less_sweet", "less_sweet_id", user.less_sweet
    )

    values_by_column = {
        "name": user.bakery_name,
        "description": user.baker_bio,
        "image_url": user.image_url,
        "halal_certificate_url": user.halal_certificate_url,
        "fulfillment_method_id": fulfillment_method_id,
        "halal_status_id": halal_status_id,
        "less_sweet_id": less_sweet_id,
    }
    insert_columns = [column for column in values_by_column if column in baker_columns]
    placeholders = ", ".join(["%s"] * len(insert_columns))
    cursor.execute(
        f"""
        INSERT INTO baker ({", ".join(insert_columns)})
        VALUES ({placeholders})
        RETURNING baker_id
        """,
        tuple(values_by_column[column] for column in insert_columns),
    )
    baker_id = cursor.fetchone()[0]

    if user.baker_location:
        location_id = fetch_or_create_lookup_id(cursor, "location", "location_id", user.baker_location)
        cursor.execute(
            """
            INSERT INTO baker_location (baker_id, location_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
            """,
            (baker_id, location_id),
        )

    for specialty_name in user.specialties or []:
        specialty_id = fetch_or_create_lookup_id(cursor, "specialty", "specialty_id", specialty_name)
        cursor.execute(
            """
            INSERT INTO baker_specialty (baker_id, specialty_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
            """,
            (baker_id, specialty_id),
        )

    contact_rows = [
        ("email", user.email),
        ("instagram", user.instagram),
        ("website", user.website),
    ]
    for contact_type, contact_value in contact_rows:
        if not contact_value:
            continue
        cursor.execute(
            """
            INSERT INTO contact (baker_id, contact_type, contact_value)
            VALUES (%s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (baker_id, contact_type, contact_value),
        )

    return baker_id

def unique_image_upload(file: UploadFile):
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    local_path = os.path.join(UPLOAD_DIR, unique_filename)
    try:
        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        if bucket.upload_image(local_path):
            return unique_filename
    except Exception as e:
        logger.error(f"Error uploading image: {e}")
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

@app.get("/")
def root():
    return RedirectResponse(url="/customer_home.html", status_code=307)

@app.get("/health")
def health():
    logger.info("Health check requested")
    return {"status": "ok"}

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):

    filename =unique_image_upload(file)
    # upload to bucket
    if not filename:
        return {"error": "Error uploading image"}

    # generate signed URL
    signed_url = bucket.find_image(filename)
    
    return {
        "message": "uploaded",
        "filename": filename,
        "url": signed_url
    }

@app.post("/requests")
async def create_request(
    customer_id: int = Form(...),
    title: str = Form(...),
    description: str = Form(None),
    budget: float = Form(None),
    deadline: str = Form(None),
    file: UploadFile = File(None)
):
    image_url = None

    if file:
        image_url = unique_image_upload(file)

    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            INSERT INTO request
            (customer_id, title, description, budget, deadline, image_url)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING request_id
            """,
            (customer_id, title, description, budget, deadline, image_url)
        )
        request_id = cursor.fetchone()[0]

    return {"request_id": request_id}

@app.get("/requests")
def get_requests(
    customer_id: Optional[int] = None,
    status: Optional[str] = None,
    include_all_statuses: bool = False,
):
    try:
        clauses = []
        params = []

        if customer_id is not None:
            clauses.append("r.customer_id = %s")
            params.append(customer_id)

        if status:
            clauses.append("r.status = %s")
            params.append(status)
        elif customer_id is None and not include_all_statuses:
            clauses.append("r.status = 'open'")

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with get_db_cursor() as cursor:
            cursor.execute(
                f"""
            SELECT
                r.request_id,
                r.customer_id,
                r.title,
                r.description,
                r.budget,
                r.deadline,
                r.status,
                r.image_url,
                r.accepted_bid_id,
                r.created_at,
                COALESCE(b.bid_count, 0) AS bid_count,
                b.lowest_bid
            FROM request r
            LEFT JOIN (
                SELECT
                    request_id,
                    COUNT(*) AS bid_count,
                    MIN(price) AS lowest_bid
                FROM bid
                GROUP BY request_id
            ) b
                ON b.request_id = r.request_id
            {where_sql}
            ORDER BY r.created_at DESC
            """,
                params,
            )

            rows = cursor.fetchall()
            return [serialize_request_row(row) for row in rows]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/requests/{request_id}")
def get_request(request_id: int):
    logger.info(f"Fetching request with ID: {request_id}")
    with get_db_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                r.request_id,
                r.customer_id,
                r.title,
                r.description,
                r.budget,
                r.deadline,
                r.status,
                r.image_url,
                r.accepted_bid_id,
                r.created_at,
                COALESCE(b.bid_count, 0) AS bid_count,
                b.lowest_bid
            FROM request r
            LEFT JOIN (
                SELECT
                    request_id,
                    COUNT(*) AS bid_count,
                    MIN(price) AS lowest_bid
                FROM bid
                GROUP BY request_id
            ) b
                ON b.request_id = r.request_id
            WHERE r.request_id = %s
            """,
            (request_id,),
        )

        row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    return serialize_request_row(row)


@app.get("/advertising-bakers")
def get_advertising_bakers():
    try:
        with get_db_cursor() as cursor:
            baker_columns = table_columns(cursor, "baker")
            halal_certificate_sql = (
                "b.halal_certificate_url" if "halal_certificate_url" in baker_columns else "NULL::text"
            )
            is_advertising_sql = (
                "COALESCE(b.is_advertising, FALSE)" if "is_advertising" in baker_columns else "FALSE"
            )
            advertising_where_sql = "b.is_advertising = TRUE" if "is_advertising" in baker_columns else "TRUE"
            cursor.execute(
                f"""
                SELECT
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    {halal_certificate_sql} AS halal_certificate_url,
                    fm.name AS fulfillment_method,
                    hs.name AS halal_status,
                    ls.name AS less_sweet,
                    COALESCE(
                        ARRAY_AGG(DISTINCT l.name) FILTER (WHERE l.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS locations,
                    COALESCE(
                        ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS specialties,
                    COALESCE(
                        ARRAY_AGG(DISTINCT c.contact_type || ':' || c.contact_value)
                            FILTER (WHERE c.contact_value IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS contacts,
                    b.created_at,
                    {is_advertising_sql} AS is_advertising
                FROM baker b
                LEFT JOIN fulfillment_method fm
                    ON fm.fulfillment_method_id = b.fulfillment_method_id
                LEFT JOIN halal_status hs
                    ON hs.halal_status_id = b.halal_status_id
                LEFT JOIN less_sweet ls
                    ON ls.less_sweet_id = b.less_sweet_id
                LEFT JOIN baker_location bl
                    ON bl.baker_id = b.baker_id
                LEFT JOIN location l
                    ON l.location_id = bl.location_id
                LEFT JOIN baker_specialty bs
                    ON bs.baker_id = b.baker_id
                LEFT JOIN specialty s
                    ON s.specialty_id = bs.specialty_id
                LEFT JOIN contact c
                    ON c.baker_id = b.baker_id
                WHERE {advertising_where_sql}
                GROUP BY
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    fm.name,
                    hs.name,
                    ls.name,
                    b.created_at,
                    {is_advertising_sql}
                ORDER BY b.created_at DESC, b.baker_id DESC
                """
            )
            rows = cursor.fetchall()
        return [serialize_baker_row(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/bakers/{baker_id}")
def get_baker(baker_id: int):
    try:
        with get_db_cursor() as cursor:
            baker_columns = table_columns(cursor, "baker")
            halal_certificate_sql = (
                "b.halal_certificate_url" if "halal_certificate_url" in baker_columns else "NULL::text"
            )
            is_advertising_sql = (
                "COALESCE(b.is_advertising, FALSE)" if "is_advertising" in baker_columns else "FALSE"
            )
            cursor.execute(
                f"""
                SELECT
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    {halal_certificate_sql} AS halal_certificate_url,
                    fm.name AS fulfillment_method,
                    hs.name AS halal_status,
                    ls.name AS less_sweet,
                    COALESCE(
                        ARRAY_AGG(DISTINCT l.name) FILTER (WHERE l.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS locations,
                    COALESCE(
                        ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS specialties,
                    COALESCE(
                        ARRAY_AGG(DISTINCT c.contact_type || ':' || c.contact_value)
                            FILTER (WHERE c.contact_value IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS contacts,
                    b.created_at,
                    {is_advertising_sql} AS is_advertising
                FROM baker b
                LEFT JOIN fulfillment_method fm
                    ON fm.fulfillment_method_id = b.fulfillment_method_id
                LEFT JOIN halal_status hs
                    ON hs.halal_status_id = b.halal_status_id
                LEFT JOIN less_sweet ls
                    ON ls.less_sweet_id = b.less_sweet_id
                LEFT JOIN baker_location bl
                    ON bl.baker_id = b.baker_id
                LEFT JOIN location l
                    ON l.location_id = bl.location_id
                LEFT JOIN baker_specialty bs
                    ON bs.baker_id = b.baker_id
                LEFT JOIN specialty s
                    ON s.specialty_id = bs.specialty_id
                LEFT JOIN contact c
                    ON c.baker_id = b.baker_id
                WHERE b.baker_id = %s
                GROUP BY
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    fm.name,
                    hs.name,
                    ls.name,
                    b.created_at,
                    {is_advertising_sql}
                """,
                (baker_id,),
            )
            row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Baker not found")
        return serialize_baker_row(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/bakers")
def get_bakers(
    page: int = 1,
    page_size: int = 12,
    shuffle_seed: Optional[str] = None,
):
    page = max(1, page)
    page_size = max(1, min(page_size, 48))
    offset = (page - 1) * page_size
    try:
        with get_db_cursor() as cursor:
            baker_columns = table_columns(cursor, "baker")
            halal_certificate_sql = (
                "b.halal_certificate_url" if "halal_certificate_url" in baker_columns else "NULL::text"
            )
            is_advertising_sql = (
                "COALESCE(b.is_advertising, FALSE)" if "is_advertising" in baker_columns else "FALSE"
            )
            random_order_sql = (
                "md5(%s || ':' || b.baker_id::text)" if shuffle_seed else "b.created_at::text"
            )
            cursor.execute("SELECT COUNT(*) FROM baker")
            total = cursor.fetchone()[0]
            cursor.execute(
                f"""
                SELECT
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    {halal_certificate_sql} AS halal_certificate_url,
                    fm.name AS fulfillment_method,
                    hs.name AS halal_status,
                    ls.name AS less_sweet,
                    COALESCE(
                        ARRAY_AGG(DISTINCT l.name) FILTER (WHERE l.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS locations,
                    COALESCE(
                        ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS specialties,
                    COALESCE(
                        ARRAY_AGG(DISTINCT c.contact_type || ':' || c.contact_value)
                            FILTER (WHERE c.contact_value IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS contacts,
                    b.created_at,
                    {is_advertising_sql} AS is_advertising
                FROM baker b
                LEFT JOIN fulfillment_method fm
                    ON fm.fulfillment_method_id = b.fulfillment_method_id
                LEFT JOIN halal_status hs
                    ON hs.halal_status_id = b.halal_status_id
                LEFT JOIN less_sweet ls
                    ON ls.less_sweet_id = b.less_sweet_id
                LEFT JOIN baker_location bl
                    ON bl.baker_id = b.baker_id
                LEFT JOIN location l
                    ON l.location_id = bl.location_id
                LEFT JOIN baker_specialty bs
                    ON bs.baker_id = b.baker_id
                LEFT JOIN specialty s
                    ON s.specialty_id = bs.specialty_id
                LEFT JOIN contact c
                    ON c.baker_id = b.baker_id
                GROUP BY
                    b.baker_id,
                    b.name,
                    b.description,
                    b.image_url,
                    fm.name,
                    hs.name,
                    ls.name,
                    b.created_at,
                    {is_advertising_sql}
                ORDER BY
                    {is_advertising_sql} DESC,
                    CASE WHEN {is_advertising_sql} THEN {random_order_sql} ELSE NULL END ASC,
                    CASE WHEN NOT {is_advertising_sql} THEN b.created_at END DESC,
                    b.baker_id DESC
                LIMIT %s
                OFFSET %s
                """
                ,
                ((shuffle_seed,) if shuffle_seed else tuple()) + (page_size, offset),
            )
            rows = cursor.fetchall()
        return {
            "items": [serialize_baker_row(row) for row in rows],
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/bakers/{baker_id}/menu-items")
def get_baker_menu_items(baker_id: int, status: Optional[str] = None):
    if status and status not in {"live", "draft"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    try:
        with get_db_cursor() as cursor:
            ensure_menu_item_table(cursor)
            if status:
                cursor.execute(
                    """
                    SELECT
                        item_id,
                        baker_id,
                        name,
                        category,
                        description,
                        price,
                        lead_time,
                        serves,
                        dietary,
                        custom_orders,
                        status,
                        image_url,
                        created_at,
                        updated_at
                    FROM menu_item
                    WHERE baker_id = %s AND status = %s
                    ORDER BY created_at DESC, item_id DESC
                    """,
                    (baker_id, status),
                )
            else:
                cursor.execute(
                    """
                    SELECT
                        item_id,
                        baker_id,
                        name,
                        category,
                        description,
                        price,
                        lead_time,
                        serves,
                        dietary,
                        custom_orders,
                        status,
                        image_url,
                        created_at,
                        updated_at
                    FROM menu_item
                    WHERE baker_id = %s
                    ORDER BY created_at DESC, item_id DESC
                    """,
                    (baker_id,),
                )
            rows = cursor.fetchall()
        return [serialize_menu_item_row(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/menu-items")
def create_menu_item(item: MenuItemPayload):
    if item.status not in {"live", "draft"}:
        raise HTTPException(status_code=400, detail="Invalid item status")
    try:
        with get_db_cursor(commit=True) as cursor:
            ensure_menu_item_table(cursor)
            cursor.execute("SELECT 1 FROM baker WHERE baker_id = %s", (item.baker_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Baker not found")
            cursor.execute(
                """
                INSERT INTO menu_item (
                    baker_id,
                    name,
                    category,
                    description,
                    price,
                    lead_time,
                    serves,
                    dietary,
                    custom_orders,
                    status,
                    image_url
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                    item_id,
                    baker_id,
                    name,
                    category,
                    description,
                    price,
                    lead_time,
                    serves,
                    dietary,
                    custom_orders,
                    status,
                    image_url,
                    created_at,
                    updated_at
                """,
                (
                    item.baker_id,
                    item.name.strip(),
                    item.category.strip() or "occasion-cake",
                    item.description.strip(),
                    item.price,
                    item.lead_time.strip(),
                    item.serves.strip(),
                    [value.strip() for value in item.dietary if value and value.strip()],
                    item.custom_orders,
                    item.status,
                    item.image_url.strip() or None,
                ),
            )
            row = cursor.fetchone()
        return serialize_menu_item_row(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/menu-items/{item_id}")
def update_menu_item(item_id: int, item: MenuItemPayload):
    if item.status not in {"live", "draft"}:
        raise HTTPException(status_code=400, detail="Invalid item status")
    try:
        with get_db_cursor(commit=True) as cursor:
            ensure_menu_item_table(cursor)
            cursor.execute(
                """
                UPDATE menu_item
                SET
                    name = %s,
                    category = %s,
                    description = %s,
                    price = %s,
                    lead_time = %s,
                    serves = %s,
                    dietary = %s,
                    custom_orders = %s,
                    status = %s,
                    image_url = %s,
                    updated_at = now()
                WHERE item_id = %s AND baker_id = %s
                RETURNING
                    item_id,
                    baker_id,
                    name,
                    category,
                    description,
                    price,
                    lead_time,
                    serves,
                    dietary,
                    custom_orders,
                    status,
                    image_url,
                    created_at,
                    updated_at
                """,
                (
                    item.name.strip(),
                    item.category.strip() or "occasion-cake",
                    item.description.strip(),
                    item.price,
                    item.lead_time.strip(),
                    item.serves.strip(),
                    [value.strip() for value in item.dietary if value and value.strip()],
                    item.custom_orders,
                    item.status,
                    item.image_url.strip() or None,
                    item_id,
                    item.baker_id,
                ),
            )
            row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Menu item not found")
        return serialize_menu_item_row(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/menu-items/{item_id}")
def delete_menu_item(item_id: int, baker_id: int):
    try:
        with get_db_cursor(commit=True) as cursor:
            ensure_menu_item_table(cursor)
            cursor.execute(
                """
                DELETE FROM menu_item
                WHERE item_id = %s AND baker_id = %s
                RETURNING item_id
                """,
                (item_id, baker_id),
            )
            row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Menu item not found")
        return {"deleted": True, "item_id": row[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/bids")
def submit_bid(
    request_id: int = Form(...),
    baker_id: int = Form(...),
    price: float = Form(...),
    timeline: str = Form(...),
    notes: str = Form(None)
):
    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            SELECT status
            FROM request
            WHERE request_id = %s
            """,
            (request_id,),
        )

        request_row = cursor.fetchone()
        if not request_row:
            raise HTTPException(status_code=404, detail="Request not found")

        if request_row[0] != "open":
            raise HTTPException(status_code=400, detail="This request is no longer open for bids")

        cursor.execute(
            """
            INSERT INTO bid
            (request_id, baker_id, price, timeline, notes)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (request_id, baker_id, price, timeline, notes)
        )
    return {"message": "bid submitted"}

@app.get("/bids/{request_id}")
def get_bids(request_id: int):
    with get_db_cursor() as cursor:
        cursor.execute(
            """
            SELECT bid_id, request_id, baker_id, price, timeline, notes, created_at
            FROM bid
            WHERE request_id = %s
            ORDER BY created_at ASC
            """,
            (request_id,)
        )

        rows = cursor.fetchall()
        return [serialize_bid_row(row) for row in rows]

@app.post("/accept-bid")
def accept_bid(
    request_id: int = Form(...),
    bid_id: int = Form(...)
):
    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            SELECT bid_id
            FROM bid
            WHERE bid_id = %s AND request_id = %s
            """,
            (bid_id, request_id),
        )

        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bid not found for this request")

        cursor.execute(
            """
            UPDATE request
            SET status = 'accepted', accepted_bid_id = %s
            WHERE request_id = %s
            """,
            (bid_id, request_id)
        )
    
    return {
        "message": "bid accepted",
        "request_id": request_id,
        "accepted_bid_id": bid_id,
        "status": "accepted",
    }
    
class MatchRequest(BaseModel):
    query: str

@app.post("/baker-match")
async def match_bakers_endpoint(request: MatchRequest):
    results = match_bakers(request.query)
    return results

class ChatMessage(BaseModel):
    message: str

@app.post("/chat")
async def chat(body: ChatMessage):
    import requests as http_requests
    api_key = os.getenv("SEALION_API_KEY")
    response = http_requests.post(
        "https://api.sea-lion.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "aisingapore/Gemma-SEA-LION-v4-27B-IT",
            "messages": [
                {"role": "system", "content": "You are a helpful baking assistant for Smart Bakers, a marketplace connecting customers with local bakers. Help users with pricing, deadlines, writing baking requests, and bidding advice. Keep responses concise and practical."},
                {"role": "user", "content": body.message}
            ],
            "max_tokens": 300,
            "temperature": 0.7
        }
    )
    result = response.json()
    return {"reply": result["choices"][0]["message"]["content"]}

class UserSignup(BaseModel):
    email: str
    password: str
    role: str
    first_name: str
    last_name: str
    bakery_name: Optional[str] = None
    baker_location: Optional[str] = None
    baker_bio: Optional[str] = None
    specialties: List[str] = []
    fulfillment_method: str = "Self Pick-up"
    halal_status: str = "No"
    less_sweet: str = "No"
    instagram: Optional[str] = None
    website: Optional[str] = None
    image_url: Optional[str] = None
    halal_certificate_url: Optional[str] = None
    customer_address: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_interests: List[str] = []
    marketing_opt_in: bool = False

class UserLogin(BaseModel):
    email: str
    password: str
    role: str

class UserResetPassword(BaseModel):
    user_id: int
    password: str

class UserForgotPassword(BaseModel):
    email: str


@app.post("/signup")
async def signup(user: UserSignup):
    hashed_pw = generate_password_hash(user.password)
    try:
        with get_db_cursor(commit=True) as cursor:
            cursor.execute(
                "INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (user.email, hashed_pw, user.role, user.first_name, user.last_name)
            )
            user_id = cursor.fetchone()[0]

            profile_id = user_id
            if user.role == "Baker":
                if not user.bakery_name:
                    raise HTTPException(status_code=400, detail="Bakery name is required for baker accounts")
                profile_id = insert_baker_profile(cursor, user)
                embed_baker_with_cursor(cursor, profile_id)
            elif user.role == "Customer":
                profile_id = insert_customer_profile(cursor, user_id, user) or user_id

        return {"message": "User created successfully", "user_id": user_id, "profile_id": profile_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/login")
async def login(user: UserLogin):
    with get_db_cursor() as cursor:
        cursor.execute("SELECT id, password_hash, role, first_name FROM users WHERE email = %s", (user.email,))
        row = cursor.fetchone()

    if row and check_password_hash(row[1], user.password):
        profile_id = row[0]
        with get_db_cursor() as cursor:
            if row[2] == "Baker":
                cursor.execute(
                    """
                    SELECT b.baker_id
                    FROM baker b
                    LEFT JOIN contact c
                        ON c.baker_id = b.baker_id
                       AND c.contact_type = 'email'
                    WHERE c.contact_value = %s
                    ORDER BY b.baker_id DESC
                    LIMIT 1
                    """,
                    (user.email,),
                )
                baker_row = cursor.fetchone()
                if baker_row:
                    profile_id = baker_row[0]
            elif row[2] == "Customer":
                columns = table_columns(cursor, "customer")
                if columns:
                    identity_column = customer_identity_column(columns)
                    customer_row = None
                    if "user_id" in columns:
                        cursor.execute(
                            f"SELECT {identity_column} FROM customer WHERE user_id = %s LIMIT 1",
                            (row[0],),
                        )
                        customer_row = cursor.fetchone()
                    elif "email" in columns:
                        cursor.execute(
                            f"SELECT {identity_column} FROM customer WHERE email = %s LIMIT 1",
                            (user.email,),
                        )
                        customer_row = cursor.fetchone()
                    if customer_row and customer_row[0] is not None:
                        profile_id = customer_row[0]

        return {
            "message": "Login successful",
            "user_id": row[0],
            "profile_id": profile_id,
            "role" : row[2],
            "name" : row[3]
        }

    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/forgot-password")
async def forgot_password(user: UserForgotPassword):
    with get_db_cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE email = %s", (user.email,))
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="No account found with this email.")

    return {"message": "User verified", "user_id": row[0]}

@app.post("/reset_password")
async def reset_password(user: UserResetPassword):
    hashed_new_pw = generate_password_hash(user.password)
    try:
        with get_db_cursor(commit=True) as cursor:
            cursor.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (hashed_new_pw, user.user_id)
            )
        return {"message": "Password updated successfully"}
    except Exception as e:
        logger.error(f"Reset error: {e}")
        raise HTTPException(status_code=500, detail="Failed to update password.")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
