import os, re

# Map hardcoded dark colors to their CSS variable equivalents
REPLACEMENTS = [
    # Backgrounds - dark shades that break light mode
    (r'"#020617"', '"var(--bg-base)"'),
    (r'"#0a0c0f"', '"var(--bg-base)"'),
    (r'"#0f172a"', '"var(--bg-surface)"'),
    (r'"#0d1117"', '"var(--bg-surface)"'),
    (r'"#1e293b"', '"var(--bg-elevated)"'),
    (r'"#161b22"', '"var(--bg-elevated)"'),
    (r'"#0c1525"', '"var(--bg-elevated)"'),
    (r'"#070e1a"', '"var(--bg-surface)"'),
    (r'"#334155"', '"var(--bg-overlay)"'),
    (r'"#1f2937"', '"var(--bg-overlay)"'),
    (r'"#21262d"', '"var(--bg-hover)"'),
    (r'"#101d30"', '"var(--bg-overlay)"'),
    (r'"#152236"', '"var(--bg-hover)"'),
    (r'"#0d2d5e"', '"var(--blue-dim)"'),
    (r'"#1e3a8a"', '"var(--blue-dim)"'),

    # Text - dark colors that are nearly invisible in dark mode 
    (r'"#f0f6ff"', '"var(--text-primary)"'),
    (r'"#f8fafc"', '"var(--text-primary)"'),
    (r'"#e2e8f0"', '"var(--text-secondary)"'),
    (r'"#cbd5e1"', '"var(--text-secondary)"'),
    (r'"#94a3b8"', '"var(--text-muted)"'),
    (r'"#7a9cc4"', '"var(--text-secondary)"'),
    (r'"#64748b"', '"var(--text-muted)"'),
    (r'"#4b5563"', '"var(--text-disabled)"'),
    (r'"#3d5a7a"', '"var(--text-muted)"'),
    (r'"#1e3451"', '"var(--text-disabled)"'),

    # Borders
    (r'"#374151"', '"var(--border)"'),
    (r'"#475569"', '"var(--border-strong)"'),
    (r'"#4b5563"', '"var(--border-strong)"'),
    (r'"#1f2937"', '"var(--border)"'),
]

def fix_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for old, new in REPLACEMENTS:
        content = re.sub(re.escape(old), new, content)
    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed: {path}")

app_dir = r'c:\Users\aless\Desktop\maintai_v3\frontend\app'
for root, _, files in os.walk(app_dir):
    for f in files:
        if f.endswith('.tsx') or f.endswith('.ts'):
            fix_file(os.path.join(root, f))

print("Done.")
