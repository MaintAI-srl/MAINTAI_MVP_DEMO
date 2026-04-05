"""
WeatherService — usa Open-Meteo (nessuna API key richiesta)
"""
from __future__ import annotations
import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional
import httpx
from backend.core.logging_config import get_logger

logger = get_logger(__name__)
_logger = logging.getLogger(__name__)


@dataclass
class WeatherData:
    temperature_c: float
    wind_speed_kmh: float
    precipitation_mm: float
    weather_code: int
    is_stormy: bool
    is_freezing: bool   # temp < 2°C
    is_high_wind: bool  # vento > 40 km/h


async def get_weather_forecast(
    lat: float, lon: float, target_date: date
) -> Optional[WeatherData]:
    """Ritorna previsione meteo per una data specifica. Ritorna None se fallisce."""
    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
            "timezone": "auto",
            "start_date": str(target_date),
            "end_date": str(target_date),
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        daily = data.get("daily", {})
        temps_max = daily.get("temperature_2m_max", [None])
        temps_min = daily.get("temperature_2m_min", [None])
        precip = daily.get("precipitation_sum", [0.0])
        wind = daily.get("wind_speed_10m_max", [0.0])
        wcode = daily.get("weather_code", [0])

        temp_max = temps_max[0] if temps_max else 0.0
        temp_min = temps_min[0] if temps_min else 0.0
        temp_avg = ((temp_max or 0) + (temp_min or 0)) / 2
        precip_val = precip[0] if precip else 0.0
        wind_val = wind[0] if wind else 0.0
        code = wcode[0] if wcode else 0

        return WeatherData(
            temperature_c=round(temp_avg, 1),
            wind_speed_kmh=round(wind_val or 0.0, 1),
            precipitation_mm=round(precip_val or 0.0, 1),
            weather_code=code or 0,
            is_stormy=(code or 0) >= 80,
            is_freezing=temp_avg < 2.0,
            is_high_wind=(wind_val or 0.0) > 40.0,
        )
    except Exception as exc:
        _logger.warning(
            "WeatherService: impossibile recuperare meteo per (%s, %s, %s): %s",
            lat, lon, target_date, exc
        )
        return None

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
