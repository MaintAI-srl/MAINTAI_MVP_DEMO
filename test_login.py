import urllib.request
import urllib.parse
import json

url = 'http://127.0.0.1:8000/auth/login'
data = urllib.parse.urlencode({'username': 'admin', 'password': 'admin'}).encode('ascii')
req = urllib.request.Request(url, data=data)

try:
    with urllib.request.urlopen(req) as response:
        result = response.read().decode('utf-8')
        print("Success:", response.getcode())
        print("Response:", result)
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code)
    print("Error Body:", e.read().decode('utf-8'))
except Exception as e:
    print("Connection Error:", str(e))
