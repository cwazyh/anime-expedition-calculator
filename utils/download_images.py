#!/usr/bin/env python3
"""Download unit images from wiki.animexpeditions.com"""

import re
import os
import urllib.request
import time

# Create dirs
for d in ["units", "evolved", "unevolved"]:
    os.makedirs(d, exist_ok=True)

key_units = [
    "Wolf (Revived)", "Atom (Totality)", "Reaper (Frenzied)", 
    "Emerald Fist", "First Blade (Strongest)", "Princess (Misery)",
    "Silver Falcon", "Black Heart (Revived)", "Dead Melody (Solo)",
    "5th God Hand", "Iron Wolf (Struggler)", "Devil (Hero)",
    "Impaler (Ultimate)", "Crimson Captain", "Lightning God", "Sovereign"
]

base_domain = "wiki.animexpeditions.com"

for unit_name in key_units:
    # Format name for wiki URL: replace spaces with underscores, remove parens
    wiki_name = unit_name.replace(' ', '_').replace('(', '').replace(')', '')
    url = f"https://{base_domain}/{wiki_name}"
    
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(url, timeout=10) as response:
            html = response.read().decode("utf-8")
        
        # Extract image URL - look for thumb pattern on wiki
        img_name = None
        # Wiki format: //static.wikitide.net/animeexpeditionswiki/thumb/xx/filename.png
        pattern = r"//static\.wikitide\.net/animeexpeditionswiki/thumb/[^\"]+/([^\"]+)\.png"
        match = re.search(pattern, html)
        if match:
            img_name = match.group(1)
        
        if img_name:
            # Build image URL
            img_url = f"https://{base_domain}/{img_name}.png"
            
            # Sanitize filename
            safe_name = unit_name.replace(' ', '_').replace('(', '_').replace(')', '_')
            save_path = f"units/{safe_name}.png"
            
            try:
                urllib.request.urlretrieve(img_url, save_path)
                print(f"OK: {unit_name} -> {save_path}")
            except Exception as e:
                print(f"FAIL: {unit_name}: {e}")
        else:
            print(f"WARN: No image found for {unit_name}")
    
    time.sleep(1)