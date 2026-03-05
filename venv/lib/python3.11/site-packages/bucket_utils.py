from google.cloud import storage
from pathlib import Path
import datetime, os
from dotenv import load_dotenv
load_dotenv()

BUCKET_NAME = os.getenv("BUCKET_NAME")
KEY_PATH = os.getenv("KEY_PATH")

class Bucket:
    def __init__(self):
        self.storage_client = storage.Client.from_service_account_json(KEY_PATH)
        self.bucket = self.storage_client.bucket(BUCKET_NAME)

    def upload_image(self, source_file_path):
        image_name = Path(source_file_path).name
        blob = self.bucket.blob(image_name)
        file_type = image_name.split('.')[-1]
        if blob.exists():
            print(f"Image {image_name} already exists in the bucket.")
            return False
        blob.upload_from_filename(source_file_path, content_type=f'image/{file_type}')
        return True
    
    def find_image(self, image_name):
        blob = self.bucket.blob(image_name)
        if blob.exists():
            return blob.generate_signed_url(
                version="v4",
                # This link will stop working after 30 minutes. Allows for non-public access to bucket.
                expiration=datetime.timedelta(minutes=30),
                method="GET"
            )
        else:
            return None

if __name__ == "__main__":
    image = "flow.png"
    bucket = Bucket()
    bucket.upload_image(image)
    link = bucket.find_image(image)
    print(f"Image uploaded to: {link}")