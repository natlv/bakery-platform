from fastapi import FastAPI, UploadFile, File, Form
from dotenv import load_dotenv
import shutil
import os
from bucket_utils import Bucket
from db import cursor, conn

load_dotenv()
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

app = FastAPI()

bucket = Bucket()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/")
def root():
    return {"message": "Backend running"}

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
        image_url = bucket.find_image(file.filename)

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
def get_requests():

    cursor.execute(
        """
        SELECT request_id, title, description, budget, deadline, status, image_url
        FROM request
        WHERE status = 'open'
        ORDER BY created_at DESC
        """
    )

    rows = cursor.fetchall()
    return rows

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
        SELECT bid_id, baker_id, price, timeline, notes
        FROM bid
        WHERE request_id = %s
        ORDER BY created_at ASC
        """,
        (request_id,)
    )

    rows = cursor.fetchall()
    return rows

@app.post("/accept-bid")
def accept_bid(
    request_id: int = Form(...),
    bid_id: int = Form(...)
):

    cursor.execute(
        """
        UPDATE request
        SET status = 'accepted', accepted_bid_id = %s
        WHERE request_id = %s
        """,
        (bid_id, request_id)
    )

    conn.commit()

    return {"message": "bid accepted"}

