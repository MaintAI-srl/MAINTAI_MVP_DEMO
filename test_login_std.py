import urllib.request
import urllib.parse
import json

def test_login():
    url = "http://localhost:8000/auth/login"
    data = urllib.parse.urlencode({
        "username": "demo",
        "password": "demo123"
    }).encode()
    
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = response.read().decode()
            print("Response Status:", response.getcode())
            print("Response Data:", json.dumps(json.loads(res_data), indent=2))
    except Exception as e:
        print("Error during login:", e)

if __name__ == "__main__":
    test_login()
