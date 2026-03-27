import pg8000
from sentence_transformers import SentenceTransformer

# Connect to Cloud SQL
conn = pg8000.connect(
    host="10.52.68.3",
    database="bakery_db",
    user="postgres",
    password="CS5224Database!"
)
cursor = conn.cursor()

# Load embedding model (downloads automatically first time)
model = SentenceTransformer('all-MiniLM-L6-v2')

# Fetch all bakers without embeddings
cursor.execute("""
    SELECT 
        b.baker_id,
        b.name,
        b.description,
        hs.name AS halal_status,
        ls.name AS less_sweet,
        fm.name AS fulfillment_method,
        STRING_AGG(DISTINCT s.name, ', ') AS specialties,
        STRING_AGG(DISTINCT l.name, ', ') AS locations
    FROM baker b
    LEFT JOIN halal_status hs 
        ON b.halal_status_id = hs.halal_status_id
    LEFT JOIN less_sweet ls 
        ON b.less_sweet_id = ls.less_sweet_id
    LEFT JOIN fulfillment_method fm 
        ON b.fulfillment_method_id = fm.fulfillment_method_id
    LEFT JOIN baker_specialty bs 
        ON b.baker_id = bs.baker_id
    LEFT JOIN specialty s 
        ON bs.specialty_id = s.specialty_id
    LEFT JOIN baker_location bl 
        ON b.baker_id = bl.baker_id
    LEFT JOIN location l 
        ON bl.location_id = l.location_id
    WHERE b.embedding IS NULL
    GROUP BY b.baker_id, b.name, b.description,
             hs.name, ls.name, fm.name
""")

bakers = cursor.fetchall()
print(f"Embedding {len(bakers)} bakers...")

for row in bakers:
    baker_id, name, description, halal, less_sweet, fulfillment, specialties, locations = row

    # Build specialty keywords string
    specialty_keywords = ""
    if specialties:
       specialty_list = specialties.split(", ")
       specialty_keywords = " ".join(specialty_list)

    # Build dietary keywords string
    dietary_keywords = ""
    if halal == "Yes":
       dietary_keywords += "halal halal-certified muslim-friendy "
    if less_sweet == "Yes":
       dietary_keywords += "less sweet less-sweet reduced sugar "

    # Expand specialty synonyms for better matching
    synonym_map = {
	"Cakes": "cakes custom cakes celebration cakes",
    	"Birthday Cakes": "birthday cake birthday celebration",
    	"Wedding Cakes": "wedding cake wedding",
    	"Cookies & Biscuits": "cookies biscuits baked cookies",
    	"Bread": "bread loaf sourdough artisan bread",
    	"Cupcakes": "cupcakes mini cakes",
    	"Brownies": "brownies chocolate brownies",
    	"Pastries": "pastries croissants baked pastries",
    	"Pies & Tarts": "pies tarts fruit tart",
    	"Chocolate Confections": "chocolate truffles chocolate sweets",
    	"Traditional Desserts": "traditional local desserts kueh",
    	"Festive Baked Goods": "festive chinese new year christmas hari raya"
}

    expanded_specialties = ""
    if specialties:
       for specialty in specialties.split(", "):
           expanded_specialties += synonym_map.get(specialty, specialty) + " "

    # Build descriptive string from all fields
    text = f"""
        Baker: {name}.
    	Description: {description or 'N/A'}.
    	Specialties: {specialties or 'N/A'}.
    	{expanded_specialties}.
    	{dietary_keywords}.
    	Halal: {halal or 'N/A'}.
    	Less sweet: {less_sweet or 'N/A'}.
    	Fulfillment: {fulfillment or 'N/A'}.
    	Location: {locations or 'N/A'}.
    """.strip()

    # Generate embedding locally — no API call needed
    embedding = "[" + ",".join(str(x) for x in model.encode(text).tolist()) + "]"

    # Store vector in Cloud SQL
    cursor.execute(
    "UPDATE baker SET embedding = %s::vector WHERE baker_id = %s",
    [embedding, baker_id]
)
    print(f"  Embedded: {name}")

conn.commit()
cursor.close()
conn.close()
print("Done — all bakers embedded.")
