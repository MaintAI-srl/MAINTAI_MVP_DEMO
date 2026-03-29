
from fastapi import APIRouter
from backend.services.ai.openai_service import get_openai_client

router = APIRouter()

@router.get("/")
def root():
    return {"message": "MaintAI backend attivo"}

@router.get("/test-openai")
def test_openai():
    ai_client = get_openai_client()

    print(">>> TEST OPENAI CHIAMATO")

    response = ai_client.responses.create(
        model="gpt-4.1-mini",
        input="Rispondi solo con: ok openai"
    )

    print(">>> RESPONSE ID:", response.id)
    print(">>> OUTPUT:", response.output_text)

    return {
        "status": "ok",
        "output": response.output_text,
        "response_id": response.id
    }

