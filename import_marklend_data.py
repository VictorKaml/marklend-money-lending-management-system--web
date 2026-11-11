import json
from supabase import create_client, Client

# Configuration for your NEW Supabase project
SUPABASE = "https://omlcrgyiepnpcojjcjgm.supabase.co"
SUPABASE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tbGNyZ3lpZXBucGNvampjamdtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTk2MzY4MiwiZXhwIjoyMTA3NTM5NjgyfQ.6RHdCA8sVAzFcYP-iDpDJJ5kbmmRYPymVrYOpv1M8A8"

# Precise table insertion order to respect foreign key constraints
IMPORT_ORDER = [
    "profiles",
    "borrowers",
    "loans",
    "loan_schedules",
    "penalty_rules",
    "repayments",
    "ledger_entries",
    "capital_transactions",
    "audit_logs",
    "staff_permissions"
]

def import_supabase_data():
    # Initialize Supabase client using the Service Role key
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    print("Loading 'marklend_export.json'...")
    try:
        with open("marklend_export.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: 'marklend_export.json' not found in this directory.")
        return

    # Process each table in the correct sequence
    for table_name in IMPORT_ORDER:
        if table_name not in data:
            print(f"Skipping '{table_name}': Not found in JSON file.")
            continue
            
        rows = data[table_name]
        if not rows:
            print(f"Table '{table_name}' is empty. Skipping.")
            continue

        print(f"Importing {len(rows)} records into '{table_name}'...")
        
        # Insert/Upsert in chunks of 100 to easily trace any issues
        chunk_size = 100
        success_count = 0
        
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i + chunk_size]
            try:
                supabase.table(table_name).upsert(chunk).execute()
                success_count += len(chunk)
            except Exception as e:
                print(f"  -> Error in '{table_name}' at chunk {i}-{i+len(chunk)}: {e}")
                
        print(f"  -> Completed '{table_name}': {success_count}/{len(rows)} records imported.")

    print("\nData import process finished!")

if __name__ == "__main__":
    import_supabase_data()