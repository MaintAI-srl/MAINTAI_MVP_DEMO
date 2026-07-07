from datetime import date, timedelta, datetime


def generate_plan(
    tickets: list[dict],
    tecnici: list[dict],
    assets: dict[int, dict],
    start_date: date | None = None,
    forecast_data: dict[date, dict] | None = None,
    assenze_tecnici: list[dict] | None = None,
) -> dict:
    """
    Multi-day scheduler.
    - Solo tecnici con stato='in servizio'
    - Ticket con durata > 8h vengono spezzati in sub-task da max 8h
    - Rispetta tecnico_id pinnato
    - Fallback a qualunque tecnico se skill matching fallisce
    """
    if start_date is None:
        start_date = date.today()

    MAX_DAYS = 14
    MAX_ORE_GIORNO = 8.0

    # Solo tecnici disponibili (in servizio)
    tecnici_attivi = [t for t in tecnici if (t.get("stato") or "in servizio") == "in servizio"]

    if not tecnici_attivi:
        return {
            "items": [],
            "non_allocati": [_build_non_allocato(task, assets) for task in tickets],
            "ore_residue": [],
            "ore_settimana": [],
            "start_date": start_date.isoformat(),
        }

    # Ore disponibili per (tecnico_id, day) 
    ore_disponibili: dict[int, dict[date, float]] = {
        t["id"]: {
            start_date + timedelta(days=d): float(t.get("ore_giornaliere") or 8)
            for d in range(MAX_DAYS)
        }
        for t in tecnici_attivi
    }

    if assenze_tecnici:
        for assenza in assenze_tecnici:
            tid = assenza.get("tecnico_id")
            if tid in ore_disponibili:
                di = assenza["data_inizio"]
                df = assenza["data_fine"]
                d_inizio = di.date() if hasattr(di, "date") else datetime.fromisoformat(str(di)).date()
                d_fine = df.date() if hasattr(df, "date") else datetime.fromisoformat(str(df)).date()
                
                curr = d_inizio
                while curr <= d_fine:
                    if curr in ore_disponibili[tid]:
                        ore_disponibili[tid][curr] = 0.0
                    curr += timedelta(days=1)

    slot_tracker: dict[tuple, float] = {}
    tecnico_by_id: dict[int, dict] = {t["id"]: t for t in tecnici_attivi if t.get("id")}

    allocati: list[dict] = []
    non_allocati: list[dict] = []

    # 1. Ticket bloccati
    locked_tickets = [t for t in tickets if t.get("planned_start") and t.get("planned_finish")]
    unplanned_tickets = [t for t in tickets if not t.get("planned_start") or not t.get("planned_finish")]

    for task in locked_tickets:
        ps_dt = datetime.fromisoformat(task["planned_start"])
        pf_dt = datetime.fromisoformat(task["planned_finish"])
        day = ps_dt.date()
        durata = (pf_dt - ps_dt).total_seconds() / 3600
        start_h = ps_dt.hour + ps_dt.minute / 60
        end_h = pf_dt.hour + pf_dt.minute / 60
        fascia = task.get("fascia_oraria") or "diurna"

        tecnico_id = task.get("tecnico_id")
        tecnico = tecnico_by_id.get(tecnico_id) if tecnico_id else None
        tecnico_nome = tecnico["nome"] if tecnico else "Sconosciuto"

        if tecnico_id in ore_disponibili and day in ore_disponibili[tecnico_id]:
            ore_disponibili[tecnico_id][day] = max(0.0, ore_disponibili[tecnico_id][day] - durata)
            slot_key = (tecnico_id, day.isoformat(), fascia)
            slot_tracker[slot_key] = max(slot_tracker.get(slot_key, end_h), end_h)

        asset_id = task.get("asset_id")
        asset = assets.get(asset_id) if asset_id else None
        asset_name = asset["name"] if asset else f"Asset {asset_id or '?'}"

        allocati.append({
            "id": task["id"], "titolo": task["titolo"], "asset_name": asset_name, "asset_id": asset_id,
            "priorita": task.get("priorita") or "Bassa", "tipo": task.get("tipo") or "CM",
            "fascia": fascia, "durata_ore": durata, "tecnico": tecnico_nome, "tecnico_id": tecnico_id,
            "date": day.isoformat(), "start_hour": start_h, "end_hour": end_h,
            "planned_start": task["planned_start"], "planned_finish": task["planned_finish"],
            "locked": True,
        })

    # 2. Ticket da pianificare
    ordered = sorted(
        unplanned_tickets,
        key=lambda x: (
            0 if x.get("priorita") == "Alta" else 1 if x.get("priorita") == "Media" else 2,
            0 if str(x.get("fascia_oraria")).lower() in ["diurna", "mattina"] else 1,
        ),
    )

    def _get_base_hour(fascia: str) -> float:
        f = str(fascia).lower()
        if f == "notte": return 22.0
        if f == "pomeriggio": return 14.0
        return 8.0

    def _try_assign(task: dict, candidate_tecnici: list[dict]) -> bool:
        durata = float(task.get("durata_stimata_ore") or 1)
        fascia = task.get("fascia_oraria") or "diurna"
        asset_id = task.get("asset_id")
        asset = assets.get(asset_id) if asset_id else None
        asset_name = asset["name"] if asset else f"Asset {asset_id or '?'}"
        
        # Vincoli Meteo Asset
        w_sunny = asset.get("weather_sunny_required", False) if asset else False
        w_wind_max = asset.get("weather_max_wind_kmh") if asset else None
        w_rain_max = asset.get("weather_max_rain_mm") if asset else None
        priorita = task.get("priorita") or "Bassa"

        for tecnico in candidate_tecnici:
            tid = tecnico["id"]
            for d in range(MAX_DAYS):
                day = start_date + timedelta(days=d)
                
                # CHECK METEO (Skip se NON è priorità Alta)
                if forecast_data and day in forecast_data and priorita != "Alta":
                    f = forecast_data[day]
                    if w_sunny and not f.get("is_sunny", True): continue
                    if w_wind_max is not None and f.get("wind_max", 0) > w_wind_max: continue
                    if w_rain_max is not None and f.get("rain_sum", 0) > w_rain_max: continue

                if ore_disponibili[tid].get(day, 0) >= durata:
                    slot_key = (tid, day.isoformat(), fascia)
                    start_hour = slot_tracker.get(slot_key, _get_base_hour(fascia))
                    end_hour = start_hour + durata
                    
                    # Update tracker and residue
                    slot_tracker[slot_key] = end_hour
                    ore_disponibili[tid][day] -= durata

                    def _safe_dt(d: date, h: float) -> datetime:
                        extra_days = int(h // 24)
                        real_hour = int(h % 24)
                        minute = int((h % 1) * 60)
                        return datetime.combine(d + timedelta(days=extra_days), datetime.min.time()).replace(
                            hour=real_hour, minute=minute
                        )

                    allocati.append({
                        "id": task["id"], "titolo": task["titolo"], "asset_name": asset_name,
                        "asset_id": asset_id, "priorita": priorita, "tipo": task.get("tipo") or "CM",
                        "fascia": fascia, "durata_ore": durata, "tecnico": tecnico["nome"], "tecnico_id": tid,
                        "date": day.isoformat(), "start_hour": start_hour, "end_hour": end_hour,
                        "planned_start": _safe_dt(day, start_hour).isoformat(),
                        "planned_finish": _safe_dt(day, end_hour).isoformat(),
                        "locked": False,
                    })
                    return True
        return False

    for task in ordered:
        assigned = False
        # 1. Pin
        pinned_id = task.get("tecnico_id")
        if pinned_id and pinned_id in tecnico_by_id:
            assigned = _try_assign(task, [tecnico_by_id[pinned_id]])
        # 2. Skill
        if not assigned:
            skill_matched = [t for t in tecnici_attivi if "verifiche" in (t.get("skill") or "").lower()]
            assigned = _try_assign(task, skill_matched)
        # 3. Fallback
        if not assigned:
            assigned = _try_assign(task, tecnici_attivi)
        
        if not assigned:
            non_allocati.append(_build_non_allocato(task, assets))

    return {
        "items": allocati,
        "non_allocati": non_allocati,
        "ore_residue": [
            {"tecnico": tecnico_by_id[tid]["nome"], "ore_residue": ore_disponibili[tid].get(start_date, 0.0)}
            for tid in ore_disponibili
        ],
        "ore_settimana": [
            {
                "tecnico": tecnico_by_id[tid]["nome"],
                "ore_per_giorno": [
                    {"date": (start_date + timedelta(days=d)).isoformat(), "ore_residue": ore_disponibili[tid].get(start_date + timedelta(days=d), 0.0)}
                    for d in range(7)
                ]
            }
            for tid in ore_disponibili
        ],
        "start_date": start_date.isoformat(),
    }


def _build_non_allocato(task: dict, assets: dict) -> dict:
    asset_id = task.get("asset_id")
    asset = assets.get(asset_id) if asset_id else None
    return {
        "id": task["id"], "titolo": task["titolo"], "asset_name": asset["name"] if asset else f"Asset {asset_id or '?'}",
        "asset_id": asset_id, "priorita": task.get("priorita") or "Bassa", "tipo": task.get("tipo") or "CM",
        "fascia": task.get("fascia_oraria") or "diurna", "durata_ore": float(task.get("durata_stimata_ore") or 1),
        "tecnico": "Non assegnato", "tecnico_id": None, "date": None, "start_hour": None, "end_hour": None,
        "planned_start": None, "planned_finish": None, "locked": False,
    }
