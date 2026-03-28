import pg8000
import csv
import os
from dotenv import load_dotenv

load_dotenv()

conn = pg8000.connect(
    host=os.getenv("DB_HOST"),
    database=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
)
cursor = conn.cursor()

with open('baker_final.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:

        # Skip rows with no title
        if not row['title'] or row['title'].strip() == '':
            continue

        # --- Lookup tables first ---

        # Fulfillment method
        fulfillment = row['Delivery / Pick-up'].strip() if row['Delivery / Pick-up'] else 'Unknown'
        cursor.execute("""
            INSERT INTO fulfillment_method (name)
            VALUES (%s)
            ON CONFLICT (name) DO NOTHING
        """, [fulfillment])
        cursor.execute("SELECT fulfillment_method_id FROM fulfillment_method WHERE name = %s", [fulfillment])
        fulfillment_id = cursor.fetchone()[0]

        # Halal status
        halal = row['Halal Status'].strip() if row['Halal Status'] else 'No'
        cursor.execute("""
            INSERT INTO halal_status (name)
            VALUES (%s)
            ON CONFLICT (name) DO NOTHING
        """, [halal])
        cursor.execute("SELECT halal_status_id FROM halal_status WHERE name = %s", [halal])
        halal_id = cursor.fetchone()[0]

        # Less sweet
        less_sweet = row['Less Sweet'].strip() if row['Less Sweet'] else 'No'
        cursor.execute("""
            INSERT INTO less_sweet (name)
            VALUES (%s)
            ON CONFLICT (name) DO NOTHING
        """, [less_sweet])
        cursor.execute("SELECT less_sweet_id FROM less_sweet WHERE name = %s", [less_sweet])
        less_sweet_id = cursor.fetchone()[0]

        # --- Insert baker ---
        name = row['title'].strip()
        description = row['description'].strip() if row['description'] else None
        image_url = row['img'].strip() if row['img'] else None

        cursor.execute("""
            INSERT INTO baker (name, description, image_url,
                fulfillment_method_id, halal_status_id, less_sweet_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (name) DO NOTHING
        """, [name, description, image_url, fulfillment_id, halal_id, less_sweet_id])

        # Get baker_id
        cursor.execute("SELECT baker_id FROM baker WHERE name = %s", [name])
        result = cursor.fetchone()
        if not result:
            continue
        baker_id = result[0]

        # --- Location ---
        if row['location'] and row['location'].strip():
            location = row['location'].strip()
            cursor.execute("""
                INSERT INTO location (name)
                VALUES (%s)
                ON CONFLICT (name) DO NOTHING
            """, [location])
            cursor.execute("SELECT location_id FROM location WHERE name = %s", [location])
            location_id = cursor.fetchone()[0]
            cursor.execute("""
                INSERT INTO baker_location (baker_id, location_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
            """, [baker_id, location_id])

        # --- Specialties ---
        if row['Specialties'] and row['Specialties'].strip():
            for specialty in row['Specialties'].split(','):
                specialty = specialty.strip()
                if specialty:
                    cursor.execute("""
                        INSERT INTO specialty (name)
                        VALUES (%s)
                        ON CONFLICT (name) DO NOTHING
                    """, [specialty])
                    cursor.execute("SELECT specialty_id FROM specialty WHERE name = %s", [specialty])
                    specialty_id = cursor.fetchone()[0]
                    cursor.execute("""
                        INSERT INTO baker_specialty (baker_id, specialty_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING
                    """, [baker_id, specialty_id])

        # --- Contacts ---
        if row.get('IG') and row['IG'].strip():
            cursor.execute("""
                INSERT INTO contact (baker_id, contact_type, contact_value)
                VALUES (%s, 'instagram', %s)
                ON CONFLICT DO NOTHING
            """, [baker_id, row['IG'].strip()])

        if row.get('Email') and row['Email'].strip():
            cursor.execute("""
                INSERT INTO contact (baker_id, contact_type, contact_value)
                VALUES (%s, 'email', %s)
                ON CONFLICT DO NOTHING
            """, [baker_id, row['Email'].strip()])

        if row.get('Website') and row['Website'].strip() and row['Website'].strip() != 'nan':
            cursor.execute("""
                INSERT INTO contact (baker_id, contact_type, contact_value)
                VALUES (%s, 'website', %s)
                ON CONFLICT DO NOTHING
            """, [baker_id, row['Website'].strip()])

        # --- Source listing ---
        cursor.execute("""
            INSERT INTO source_listing (baker_id, csv_row_number, source_index, raw_title)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, [
            baker_id,
            row.get('Unnamed: 0'),
            row.get('index'),
            row.get('title')
        ])

        print(f"Imported: {name}")

conn.commit()
cursor.close()
conn.close()
print("Done — all bakers imported.")
