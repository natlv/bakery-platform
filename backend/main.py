from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
import shutil
import os
from bucket_utils import Bucket
from db import cursor, conn, reset_connection
from pydantic import BaseModel
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from matching import match_bakers

load_dotenv()

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
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # upload to bucket
    success = bucket.upload_image(local_path)

    if not success:
        return {"error": "File already exists"}

    # generate signed URL
    signed_url = bucket.find_image(file.filename)
    
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
    image_url = None

    if file:
        local_path = f"{UPLOAD_DIR}/{file.filename}"

        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

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
            reset_connection()
            raise HTTPException(status_code=500, detail=str(e))

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

    conn.commit()
    return {"message": "bid submitted"}

@app.get("/bids/{request_id}")
def get_bids(request_id: int):
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

    conn.commit()
    
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
