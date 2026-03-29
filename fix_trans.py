import os
for root, _, files in os.walk('c:/Users/aless/Desktop/maintai_v3/frontend/app'):
    for f in files:
        if f.endswith('.tsx') or f.endswith('.ts'):
            p = os.path.join(root, f)
            with open(p, 'r', encoding='utf-8') as file:
                c = file.read()
            if '""transparent""' in c:
                c = c.replace('""transparent""', '"transparent"')
                with open(p, 'w', encoding='utf-8') as file:
                    file.write(c)
                print("Fixed", p)
