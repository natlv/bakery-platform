from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import shutil
import os
from urllib.parse import urlparse, unquote
from bucket_utils import Bucket
from db import cursor, conn
from log_setup import backend_logger as logger

load_dotenv()

credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("KEY_PATH")
if credentials_path:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

app = FastAPI()
logger.info("FastAPI application initialized")

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
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


def resolve_image_url(image_ref):
    if not image_ref:
        return None

    object_name = image_ref

    if str(image_ref).startswith(("http://", "https://")):
        parsed = urlparse(image_ref)
        path = unquote(parsed.path.rstrip("/"))
        if not path:
            return image_ref
        object_name = path.split("/")[-1]

    try:
        refreshed_url = bucket.find_image(object_name)
        return refreshed_url or image_ref
    except Exception:
        return image_ref


def serialize_request_row(row):
    return {
        "request_id": row[0],
        "customer_id": row[1],
        "title": row[2],
        "description": row[3],
        "budget": float(row[4]) if row[4] is not None else None,
        "deadline": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
        "status": row[6],
        "image_url": resolve_image_url(row[7]),
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

@app.get("/")
def root():
    return RedirectResponse(url="/login.html", status_code=307)


@app.get("/api")
def api_root():
    return {"message": "Backend running"}


@app.get("/health")
def health():
    logger.info("Health check requested")
    return {"status": "ok"}

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):

    # save locally
    local_path = os.path.join(UPLOAD_DIR, file.filename)
    logger.info(f"Received file upload: {file.filename}")
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # upload to bucket
    success = bucket.upload_image(local_path)

    if not success:
        logger.info(f"File {file.filename} already exists in bucket. Returning error.")
        return {"error": "File already exists"}

    # generate signed URL
    signed_url = bucket.find_image(file.filename)
    logger.info(f"File {file.filename} uploaded successfully.")
    return {
        "message": "uploaded",
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
    logger.info(f"Received request for customer {customer_id}: {title}")
    image_url = None

    if file:
        local_path = f"{UPLOAD_DIR}/{file.filename}"

        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        logger.info(f"File saved locally: {local_path}")

        bucket.upload_image(local_path)
        image_url = file.filename

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
    conn.commit()
    logger.info(f"Request for customer {customer_id} created: {title} (ID: {request_id})")
    return {"request_id": request_id}

@app.get("/requests")
def get_requests(
    customer_id: Optional[int] = None,
    status: Optional[str] = None,
    include_all_statuses: bool = False,
):
    clauses = []
    params = []
    logger.info(f"Fetching requests with filters - customer_id: {customer_id}, status: {status}, include_all_statuses: {include_all_statuses}")
    if customer_id is not None:
        clauses.append("r.customer_id = %s")
        params.append(customer_id)

    if status:
        clauses.append("r.status = %s")
        params.append(status)
    elif customer_id is None and not include_all_statuses:
        clauses.append("r.status = 'open'")

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

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
    logger.info(f"Retrieved {len(rows)} requests")
    return [serialize_request_row(row) for row in rows]


@app.get("/requests/{request_id}")
def get_request(request_id: int):
    logger.info(f"Fetching request with ID: {request_id}")
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
        logger.info(f"Request with ID {request_id} not found")
        raise HTTPException(status_code=404, detail="Request not found")

    return serialize_request_row(row)

@app.post("/bids")
def submit_bid(
    request_id: int = Form(...),
    baker_id: int = Form(...),
    price: float = Form(...),
    timeline: str = Form(...),
    notes: str = Form(None)
):
    logger.info(f"Receiving bid for request {request_id} by baker {baker_id}")
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
        logger.info(f"Request with ID {request_id} not found")
        raise HTTPException(status_code=404, detail="Request not found")

    if request_row[0] != "open":
        logger.info(f"Request with ID {request_id} is not open for bids")
        raise HTTPException(status_code=400, detail="This request is no longer open for bids")

    cursor.execute(
        """
        INSERT INTO bid
        (request_id, baker_id, price, timeline, notes)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (request_id, baker_id, price, timeline, notes)
    )

    conn.commit()
    logger.info(f"Bid submitted for request {request_id}")
    return {"message": "bid submitted"}

@app.get("/bids/{request_id}")
def get_bids(request_id: int):
    logger.info(f"Fetching bids for request ID: {request_id}")
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
    logger.info(f"Retrieved {len(rows)} bids for request ID: {request_id}")
    return [serialize_bid_row(row) for row in rows]

@app.post("/accept-bid")
def accept_bid(
    request_id: int = Form(...),
    bid_id: int = Form(...)
):
    logger.info(f"Received accept bid {bid_id} for request {request_id}")
    cursor.execute(
        """
        SELECT bid_id
        FROM bid
        WHERE bid_id = %s AND request_id = %s
        """,
        (bid_id, request_id),
    )

    if not cursor.fetchone():
        logger.info(f"Bid with ID {bid_id} not found for request {request_id}")
        raise HTTPException(status_code=404, detail="Bid not found for this request")

    cursor.execute(
        """
        UPDATE request
        SET status = 'accepted', accepted_bid_id = %s
        WHERE request_id = %s
        """,
        (bid_id, request_id)
    )

    conn.commit()
    logger.info(f"Bid accepted for request {request_id}")
    return {
        "message": "bid accepted",
        "request_id": request_id,
        "accepted_bid_id": bid_id,
        "status": "accepted",
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
