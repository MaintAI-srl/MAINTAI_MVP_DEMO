import sqlite3
import os

db_path = "backend/maintai.db" # Adjusted path based on dir structure

def migrate():
    if not os.path.exists(db_path):
        # Proviamo anche root
        db_path_root = "maintai.db"
        if os.path.exists(db_path_root):
            path = db_path_root
        else:
            print(f"Database {db_path} non trovato.")
            return
    else:
        path = db_path

    print(f"Migrating {path}...")
    conn = sqlite3.connect(path)
    cursor = conn.cursor()

    # Asset table
    cols_asset = [
        ("weather_sunny_required", "BOOLEAN DEFAULT 0"),
        ("weather_max_wind_kmh", "FLOAT"),
        ("weather_max_rain_mm", "FLOAT")
    ]
    
    for col_name, col_type in cols_asset:
        try:
            cursor.execute(f"ALTER TABLE asset ADD COLUMN {col_name} {col_type}")
            print(f"Added column {col_name} to asset table.")
        except sqlite3.OperationalError:
            print(f"Column {col_name} già esistente in asset.")

    # Impianti table (controlliamo se la tabella si chiama 'impianti')
    cols_impianti = [
        ("latitude", "FLOAT"),
        ("longitude", "FLOAT")
    ]
    
    for col_name, col_type in cols_impianti:
        try:
            cursor.execute(f"ALTER TABLE impianti ADD COLUMN {col_name} {col_type}")
            print(f"Added column {col_name} to impianti table.")
        except sqlite3.OperationalError:
            print(f"Column {col_name} già esistente in impianti.")

    conn.commit()
    conn.close()
    print("Migration completed.")

if __name__ == "__main__":
    migrate()
