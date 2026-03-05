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
    description: str = Form(...),
    budget: float = Form(...),
    deadline: str = Form(...),
    file: UploadFile = File(...)
):

    local_path = f"{UPLOAD_DIR}/{file.filename}"

    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    bucket.upload_image(local_path)

    image_url = file.filename

    cursor.execute(
        """
        INSERT INTO requests (description, budget, deadline, image_url)
        VALUES (%s, %s, %s, %s)
        """,
        (description, budget, deadline, image_url),
    )

    conn.commit()

    return {"message": "request created"}
