import os

def replace_text(file_path, old_text, new_text):
    if not os.path.exists(file_path):
        print(f"File non trovato: {file_path}")
        return
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    if old_text in content:
        content = content.replace(old_text, new_text)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated {file_path}')

base = r'c:\Users\aless\Desktop\maintai_v3\backend'

replace_text(os.path.join(base, 'tests', 'test_scheduler.py'), '"categoria": "meccanica", ', '')
replace_text(os.path.join(base, 'services', 'scheduler_service.py'), 'categoria = asset["categoria"] if asset else ""', 'categoria = ""')
replace_text(os.path.join(base, 'services', 'scheduler_service.py'), 'not categoria\n                    or ', '')
replace_text(os.path.join(base, 'services', 'ai', 'problem_analysis_service.py'), 'categoria = asset["categoria"] if asset and asset.get("categoria") else "Non specificata"', 'categoria = "Non specificata"')
replace_text(os.path.join(base, 'services', 'ai', 'problem_analysis_service.py'), '- Categoria dichiarata: {categoria}\n', '')
replace_text(os.path.join(base, 'services', 'ai', 'problem_analysis_service.py'), '- La categoria asset potrebbe essere incompleta, generica o non affidabile.\n', '')
replace_text(os.path.join(base, 'services', 'ai', 'problem_analysis_service.py'), '- Non basare la diagnosi solo sulla categoria.\n', '')
replace_text(os.path.join(base, 'services', 'ai', 'problem_analysis_service.py'), '- Non usare la categoria come unica guida.\n', '')
replace_text(os.path.join(base, 'services', 'ai', 'diagnostic_service.py'), "Categoria: {asset.get('categoria') if asset else 'sconosciuta'}\\n", '')
replace_text(os.path.join(base, 'data', 'mock_data.py'), '"categoria": "cabina_mt", ', '')
replace_text(os.path.join(base, 'data', 'mock_data.py'), '"categoria": "trasformatore", ', '')
replace_text(os.path.join(base, 'data', 'mock_data.py'), '"categoria": "carriponte", ', '')
replace_text(os.path.join(base, 'data', 'mock_data.py'), '"categoria": "fotovoltaico", ', '')
replace_text(os.path.join(base, 'api', 'routes', 'problem_analysis.py'), '"categoria": asset.categoria,', '')
replace_text(os.path.join(base, 'api', 'routes', 'manuali.py'), 'new_asset_categoria: str | None = Form(None),', '')
replace_text(os.path.join(base, 'api', 'routes', 'manuali.py'), 'categoria=new_asset_categoria or "altro",', '')
replace_text(os.path.join(base, 'api', 'routes', 'manuali.py'), 'categoria_ai = parsed.get("categoria", "")', 'categoria_ai = ""')
replace_text(os.path.join(base, 'api', 'routes', 'manuali.py'), 'if categoria_ai:\n            asset = db.query(Asset).filter(Asset.categoria == categoria_ai).first()', '')
replace_text(os.path.join(base, 'api', 'routes', 'diagnostic.py'), '"categoria": asset.categoria', '"categoria": ""')
replace_text(os.path.join(base, 'api', 'routes', 'db_routes.py'), 'categoria: str, ', '')
replace_text(os.path.join(base, 'api', 'routes', 'db_routes.py'), 'categoria=categoria,', '')
replace_text(os.path.join(base, 'api', 'routes', 'assets.py'), '    if not asset.categoria or not asset.categoria.strip():\n        raise HTTPException(status_code=422, detail="Il campo \'categoria\' è obbligatorio")\n', '')
replace_text(os.path.join(base, 'api', 'routes', 'scheduler.py'), '"categoria": a.categoria or "",', '')
