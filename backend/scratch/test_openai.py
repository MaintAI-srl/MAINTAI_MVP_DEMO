import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

key = os.getenv('OPENAI_API_KEY') or os.getenv('openai_api_key', '')
model = os.getenv('OPENAI_MODEL') or os.getenv('openai_model', 'gpt-4.1-mini')
print(f"Key present: {bool(key)}")
print(f"Key prefix: {key[:12] if key else 'NONE'}")
print(f"Model: {model}")

if not key:
    print("ERROR: No OpenAI key found in .env")
    sys.exit(1)

try:
    from openai import OpenAI
    client = OpenAI(api_key=key)
    
    # Test 1: simple json_object
    print("\nTest 1: json_object mode...")
    resp = client.chat.completions.create(
        model=model,
        messages=[{'role': 'user', 'content': 'Reply with exactly: {"test":true}'}],
        response_format={'type': 'json_object'},
        max_tokens=50
    )
    print(f"OK: {resp.choices[0].message.content}")
    
    # Test 2: json_schema mode
    print("\nTest 2: json_schema mode...")
    schema = {
        "name": "test_schema",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"result": {"type": "string"}},
            "required": ["result"],
            "additionalProperties": False
        }
    }
    resp2 = client.chat.completions.create(
        model=model,
        messages=[{'role': 'user', 'content': 'Say hello'}],
        response_format={"type": "json_schema", "json_schema": schema},
        max_tokens=50
    )
    print(f"OK: {resp2.choices[0].message.content}")

except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {e}")
    traceback.print_exc()
