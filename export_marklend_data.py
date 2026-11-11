import json
from supabase import create_client, Client

# Your Supabase project credentials
SUPABASE_URL = "https://mlgnbxqopqazykvoxpkh.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sZ25ieHFvcHFhenlrdm94cGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODc2MTcsImV4cCI6MjEwNjI2MzYxN30.vw7UeJ2mYt_tIOxINyAGPAn_prBozeHDTl-LR9MrCZA"

EMAIL = "marcuskavala@gmail.com"
PASSWORD = "marcuskavala"

# All base tables from your MarkLend 1.5 schema
TABLES_TO_EXPORT = [
    "profiles",
    "borrowers",
    "loans",
    "loan_schedules",
    "penalty_rules",
    "ledger_entries",
    "repayments",
    "capital_transactions",
    "audit_logs",
    "staff_permissions"
]

def export_supabase_data():
    # Initialize the Supabase Client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

    print(f"Authenticating as {EMAIL}...")
    try:
        supabase.auth.sign_in_with_password({
            "email": EMAIL,
            "password": PASSWORD
        })
        print("Successfully authenticated!\n")
    except Exception as e:
        print(f"Failed to sign in: {e}")
        return

    exported_data = {}

    # Loop through each table and fetch all rows using pagination
    for table_name in TABLES_TO_EXPORT:
        print(f"Fetching table: {table_name}...")
        all_rows = []
        page_size = 1000
        start = 0
        
        try:
            while True:
                # Paginate through rows to bypass the 1,000 row limit
                response = supabase.table(table_name).select("*").range(start, start + page_size - 1).execute()
                rows = response.data
                all_rows.extend(rows)
                
                if len(rows) < page_size:
                    break
                start += page_size
                
            exported_data[table_name] = all_rows
            print(f"  -> Successfully fetched {len(all_rows)} records from '{table_name}'")
        except Exception as e:
            print(f"  -> Error fetching '{table_name}': {e}")
            exported_data[table_name] = []

    # Save everything into a single JSON file
    output_filename = "marklend_export.json"
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(exported_data, f, ensure_ascii=False, indent=4, default=str)

    print(f"\nExport complete! Data saved to '{output_filename}'.")

if __name__ == "__main__":
    export_supabase_data()