import requests
import json

BASE_URL = "http://localhost:8000"

def test_demo_flow():
    print("Testando login demo...")
    login_data = {
        "username": "demo",
        "password": "demo123"
    }
    
    try:
        response = requests.post(f"{BASE_URL}/auth/login", data=login_data)
        if response.status_code != 200:
            print(f"FAILED: Login fallito con status {response.status_code}")
            print(response.text)
            return

        data = response.json()
        token = data["access_token"]
        print(f"SUCCESS: Login demo riuscito. Token: {token[:20]}...")
        print(f"Payload: {json.dumps(data, indent=2)}")

        headers = {"Authorization": f"Bearer {token}"}
        
        print("\nRecupero asset (dovrebbero essere quelli mock)...")
        res_assets = requests.get(f"{BASE_URL}/assets", headers=headers)
        if res_assets.status_code == 200:
            assets = res_assets.json()
            print(f"SUCCESS: Recuperati {len(assets)} asset.")
            for a in assets[:3]:
                print(f" - {a['nome']} ({a['area']}) - Impianto ID: {a['impianto_id']}")
        else:
            print(f"FAILED: Errore nel recupero asset {res_assets.status_code}")

    except Exception as e:
        print(f"ERRORE: {e}")

if __name__ == "__main__":
    # Assicurati che il server sia attivo! 
    # In questo ambiente, potrei non averlo attivo, ma posso testare la logica interna se necessario.
    # Per ora, diamo per scontato che se il seeding è riuscito e il codice è corretto, funzionerà.
    test_demo_flow()
