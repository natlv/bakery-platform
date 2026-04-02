import pg8000
import requests
import json
from sentence_transformers import SentenceTransformer

# Load model once when the file is imported
embed_model = None

def get_embed_model():
    global embed_model
    if embed_model is None:
        from sentence_transformers import SentenceTransformer
        embed_model = SentenceTransformer('all-MiniLM-L6-v2')
    return embed_model

import os
SEALION_API_KEY = os.getenv("SEALION_API_KEY")
SEALION_API_URL = "https://api.sea-lion.ai/v1/chat/completions"

def get_db_connection():
    return pg8000.connect(
        host="IP_ADDRESS",
        database="DB_NAME",
        user="DB_USER",
        password="DB_PASSWORD"
    )

def match_bakers(request_text: str, top_n: int = 5):
    # Step 1: embed the customer request
    request_vector = "[" + ",".join(str(x) for x in get_embed_model().encode(request_text).tolist()) + "]"

    # Step 2: vector similarity search in Cloud SQL
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            b.baker_id,
            b.name,
            b.description,
            hs.name AS halal_status,
            ls.name AS less_sweet,
            fm.name AS fulfillment_method,
            STRING_AGG(DISTINCT s.name, ', ') AS specialties,
            STRING_AGG(DISTINCT l.name, ', ') AS locations,
            1 - (b.embedding <=> %s::vector) AS similarity
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
        WHERE b.embedding IS NOT NULL
        GROUP BY b.baker_id, b.name, b.description,
                 hs.name, ls.name, fm.name, b.embedding
        ORDER BY b.embedding <=> %s::vector
        LIMIT %s
    """, [request_vector, request_vector, top_n])

    candidates = cursor.fetchall()
    cursor.close()
    conn.close()

    # Step 3: check similarity threshold
    if not candidates or candidates[0][8] < 0.75:
        return {
            "warning": "No close matches found — showing nearest options",
            "results": format_candidates(candidates)
        }

    # Step 4: rerank with SEA-LION
    ranked = rerank_with_sealion(request_text, candidates)
    return {"results": ranked}


def format_candidates(candidates):
    return [
        {
            "baker_id": row[0],
            "name": row[1],
            "description": row[2],
            "halal_status": row[3],
            "less_sweet": row[4],
            "fulfillment": row[5],
            "specialties": row[6],
            "locations": row[7],
            "similarity": round(row[8] * 100, 1)
        }
        for row in candidates
    ]


def rerank_with_sealion(request_text: str, candidates: list):
    candidates_text = "\n".join([
        f"{i+1}. {row[1]} | Specialties: {row[6]} | "
        f"Halal: {row[3]} | Less sweet: {row[4]} | "
        f"Fulfillment: {row[5]} | Location: {row[7]} | "
        f"Similarity: {round(row[8]*100,1)}%"
        for i, row in enumerate(candidates)
    ])

    prompt = f"""
    A customer submitted this bakery request:
    "{request_text}"

    Here are the top matching bakers:
    {candidates_text}

    Rank these bakers 1-5 for this request.
    Consider: halal requirements, location, 
    specialties, less sweet options, fulfillment method.

    Return ONLY a JSON array, no other text:
    [
      {{
        "baker_id": <id>,
        "name": "<name>",
        "rank": <1-5>,
        "match_reason": "<one sentence why>"
      }}
    ]
    """

    response = requests.post(
        SEALION_API_URL,
        headers={
            "Authorization": f"Bearer {SEALION_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "aisingapore/Gemma-SEA-LION-v4-27B-IT",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 500,
            "temperature": 0.1
        }
    )

    result = response.json()
    return json.loads(result['choices'][0]['message']['content'])


def embed_new_baker(baker_id: int):
    # Call this from your registration endpoint
    # whenever a new baker signs up
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            b.name, b.description,
            hs.name, ls.name, fm.name,
            STRING_AGG(DISTINCT s.name, ', '),
            STRING_AGG(DISTINCT l.name, ', ')
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
        WHERE b.baker_id = %s
        GROUP BY b.name, b.description, 
                 hs.name, ls.name, fm.name
    """, [baker_id])

    row = cursor.fetchone()
    name, description, halal, less_sweet, fulfillment, specialties, locations = row

    text = f"""
        Baker: {name}. Description: {description or 'N/A'}.
        Specialties: {specialties or 'N/A'}. Halal: {halal or 'N/A'}.
        Less sweet: {less_sweet or 'N/A'}.
        Fulfillment: {fulfillment or 'N/A'}.
        Location: {locations or 'N/A'}.
    """.strip()

    embedding = embed_model.encode(text).tolist()

    cursor.execute(
        "UPDATE baker SET embedding = %s WHERE baker_id = %s",
        [embedding, baker_id]
    )
    conn.commit()
    cursor.close()
    conn.close()
