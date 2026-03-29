import requests
import json

def test_scheduler():
    try:
        # We need to simulate a request or just check if the logic works.
        # Since the server might be running already on port 8000:
        res = requests.get("http://localhost:8000/scheduler/gantt")
        if res.status_code == 200:
            data = res.json()
            items = data.get("items", [])
            print(f"Scheduler items: {len(items)}")
            if len(items) > 0:
                print("SUCCESS: Scheduler is operational.")
            else:
                print("WARNING: Scheduler returned 0 items. Check ticket/technician matching.")
        else:
            print(f"FAILED: Status {res.status_code}")
    except Exception as e:
        print(f"Error testing scheduler: {e}")

if __name__ == "__main__":
    test_scheduler()
