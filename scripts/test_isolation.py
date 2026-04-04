from sqlalchemy import text
from backend.core.database import SessionLocal
from backend.db.modelli import Asset, Ticket, Tenant, Utente

def test_isolation():
    print("Inizio test isolamento multi-tenancy...")
    with SessionLocal() as db:
        # 1. Verifica presenza dei tenant
        tenants = db.query(Tenant).all()
        print(f"Tenant trovati: {[t.slug for t in tenants]}")
        
        # 2. Crea un nuovo tenant di test se non esiste
        test_tenant = db.query(Tenant).filter(Tenant.slug == "test-isolation").first()
        if not test_tenant:
            test_tenant = Tenant(nome="Test Isolation", slug="test-isolation")
            db.add(test_tenant)
            db.commit()
            db.refresh(test_tenant)
            print("Creato tenant 'test-isolation'")

        # 3. Conta asset globali (modalità superadmin)
        total_assets = db.query(Asset).count()
        print(f"Asset totali (Superadmin view): {total_assets}")

        # 4. Simula query filtrata (modalità responsabile)
        demo_tenant = db.query(Tenant).filter(Tenant.slug == "demo").first()
        if demo_tenant:
            demo_assets = db.query(Asset).filter(Asset.tenant_id == demo_tenant.id).count()
            print(f"Asset tenant 'demo': {demo_assets}")
            
            test_assets = db.query(Asset).filter(Asset.tenant_id == test_tenant.id).count()
            print(f"Asset tenant 'test-isolation' (prima): {test_assets}")
            
            # Crea un asset nel tenant di test
            new_asset = Asset(nome="Asset Isolato", tenant_id=test_tenant.id)
            db.add(new_asset)
            db.commit()
            
            test_assets_after = db.query(Asset).filter(Asset.tenant_id == test_tenant.id).count()
            print(f"Asset tenant 'test-isolation' (dopo): {test_assets_after}")
            
            # Verifica che l'asset NON sia apparso nel tenant demo
            demo_assets_after = db.query(Asset).filter(Asset.tenant_id == demo_tenant.id).count()
            if demo_assets == demo_assets_after:
                print("✅ ISOLAMENTO CONFERMATO: L'asset creato nel tenant test non è visibile nel tenant demo.")
            else:
                print("❌ ERRORE ISOLAMENTO: L'asset è trapelato in altri tenant!")

if __name__ == "__main__":
    test_isolation()
