import httpx
from datetime import date
from backend.core.logging_config import get_logger

logger = get_logger(__name__)

async def get_forecast_for_scheduler(lat: float, lon: float, days: int = 14) -> dict[date, dict]:
    """
    Recupera le previsioni meteo per i prossimi N giorni.
    Ritorna un dizionario mappato per data con i parametri critici per i vincoli dell'asset.
    """
    if lat is None or lon is None:
        logger.warning("Coordinate mancanti per il fetch meteo scheduler. Salto.")
        return {}

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": ["weathercode", "temperature_2m_max", "windspeed_10m_max", "rain_sum"],
        "timezone": "auto",
        "forecast_days": days
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            if response.status_code != 200:
                logger.error(f"Errore API Meteo: {response.status_code}")
                return {}
            
            data = response.json()
            daily = data.get("daily", {})
            times = daily.get("time", [])
            codes = daily.get("weathercode", [])
            temp_max = daily.get("temperature_2m_max", [])
            wind_max = daily.get("windspeed_10m_max", [])
            rain_sum = daily.get("rain_sum", [])

            forecast_map = {}
            for i in range(len(times)):
                d = date.fromisoformat(times[i])
                forecast_map[d] = {
                    "code": codes[i],
                    "temp_max": temp_max[i],
                    "wind_max": wind_max[i],
                    "rain_sum": rain_sum[i],
                    "is_sunny": codes[i] in [0, 1, 2, 3], # Clear or mainly clear
                    "is_rainy": rain_sum[i] > 0.5 or codes[i] in [51, 53, 55, 61, 63, 65, 80, 81, 82]
                }
            return forecast_map

    except Exception as e:
        logger.error(f"Errore durante il fetch meteo: {str(e)}")
        return {}
