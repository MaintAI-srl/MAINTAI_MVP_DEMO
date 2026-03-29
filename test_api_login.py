import requests

def test_login():
    url = "http://localhost:8000/auth/login"
    payload = {
        "username": "admin",
        "password": "admin"
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    try:
        response = requests.post(url, data=payload, headers=headers)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        if response.status_code == 200:
            print("LOGIN API SUCCESS!")
        else:
            print("LOGIN API FAILED!")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    test_login()
