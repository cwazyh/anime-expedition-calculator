#!/usr/bin/env python3
"""
Estrazione immagini unità da animeexpeditions.com wiki
Salva in cartelle: units/, equipments/, elements/, cresttypes/
"""

import json
import os
import re
import time
import urllib.request
import urllib.parse
from urllib.error import HTTPError, URLError

# Create all directories
dirs = [
    "units", "equipments", "elements", "cresttypes",
    "units/evolved", "units/unevolved"
]
for d in dirs:
    os.makedirs(d, exist_ok=True)

base_url = "https://wiki.animeexpeditions.com"

# Known unit names from the wiki (from the Units page fetch)
# I'll build a comprehensive list based on what we know from the wiki structure
all_unit_names = [
    # Secret rarity
    "Impaler (Ultimate)", "Wolf (Revived)", "Reaper (Frenzied)", 
    "Emerald Fist", "First Blade (Strongest)", "Princess (Misery)",
    "Silver Falcon", "Black Heart (Revived)", "Dead Melody (Solo)",
    "5th God Hand", "Iron Wolf (Struggler)", "Devil (Hero)",
    "Crimson Captain", "Lightning God", "Sovereign", "Cubert", "Crow",
    # Exclusive
    "Atom (Totality)", "Emerald Fist", "Cubert", "Crimson (Brother)",
    # Mythic
    "Dead Melody", "First Blade", "Princess", "Black Heart", 
    "Alchemy Brothers (Truth)", "Rainman (Forecast)", "Ignition Commander (Betrayal)",
    "Traitor (Illusion)", "Noble Captain (Vibrant)", "Bioinsect (Final Form)",
    "Cursed Student (True Love)", "Elf Mage (Lunar)", "Elf Mage (Maid)",
    "Flame Emperor (Reincarnate)", "Hollow (Blaze)",
    # Legendary
    "Forbidden Teacher", "Greed", "Ice Queen", "Ramen Guy", "Scissor",
    "Reaper", "The Hero", "Water Princess",
    # Epic
    "Bounty Hunter", "Corps Captain", "Demon Cyborg", "Ice Mage",
    # Rare
    "Curly Brow", "Kid Assassin", "Reishi Archer", "Rubber Boy",
    "Little Carrot", "Thunder Shinobi"
]

print(f"Total units to process: {len(all_unit_names)}")

def get_page(url, retries=3):
    """Fetch a page with retry logic"""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.read().decode('utf-8')
        except (HTTPError, URLError) as e:
            print(f"  Attempt {attempt+1} failed for {url}: {e}")
            time.sleep(2)
    return None

def extract_image_url(html, pattern_type="unit"):
    """Extract image URL from wiki page HTML"""
    if not html:
        return None
    
    # Look for the main unit image
    # Wiki format: //static.wikitide.net/animeexpeditionswiki/thumb/.../UnitName.png/90px-UnitName.png
    
    # Pattern for unit images
    patterns = [
        r'//static\.wikitide\.net/animeexpeditionswiki/thumb/[^"]+?/([^"]+?)\.png[^"]*?>',
        r'.src="[^"]*?/thumb/[^"]+?/([^"]+?)\.png[^"]*"',
        r'/\/img/[^"]*?/([^"]+?)\.png[^"]*',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            img_name = match.group(1)
            # Return full URL
            return f"https://{base_url.split('/')[2]}/{img_name}.png"
    
    # Also look for any PNG in thumb directory
    thumb_pattern = r'//static\.wikitide\.net/animeexpeditionswiki/thumb/[^"]+/[^"]+\.png'
    matches = re.findall(thumb_pattern, html)
    if matches:
        # Get the last one (usually the highest resolution)
        last_match = matches[-1]
        img_name = re.search(r'/([^/]+)\.png', last_match)
        if img_name:
            return f"https://{base_url.split('/')[2]}/{img_name.group(1)}.png"
    
    return None

def sanitize_filename(name):
    """Sanitize unit name for filename"""
    # Replace problematic characters
    name = name.replace('(', '_').replace(')', '_')
    name = name.replace('/', '_').replace('\\', '_')
    name = name.replace(' ', '_')
    # Remove special chars but keep underscores
    name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
    return name.lower()

def download_image(url, save_path):
    """Download and save image"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read()
            # Determine extension
            if '.png' in url:
                ext = '.png'
            elif '.jpg' in url or '.jpeg' in url:
                ext = '.jpg'
            else:
                ext = '.png'  # default
            
            final_path = save_path + ext
            with open(final_path, 'wb') as f:
                f.write(data)
            return final_path
    except Exception as e:
        print(f"  Error downloading {url}: {e}")
        return None

processed = 0
skipped = 0
errors = 0

for i, unit_name in enumerate(all_unit_names):
    print(f"[{i+1}/{len(all_unit_names)}] Processing: {unit_name}")
    
    # Determine rarity and category
    # Simple categorization based on known names
    rarity = "Secret"  # default
    if "Atom" in unit_name or "Cubert" in unit_name or "Crimson" in unit_name:
        rarity = "Exclusive"
    elif any(x in unit_name for x in ["Alchemy", "Rainman", "Ignition", "Traitor", "Noble", "Bioinsect", "Cursed", "Elf", "Flame", "Hollow"]):
        rarity = "Mythic"
    elif any(x in unit_name for x in ["Forbidden", "Greed", "Ice Queen", "Ramen", "Scissor", "Reishi", "Demon", "Ice", "Water"]):
        rarity = "Legendary" if not any(x in unit_name for x in ["Rare", "Epic", "Common"]) else "Epic"
    elif any(x in unit_name for x in ["Curly", "Kid", "Reishi", "Rubber", "Little", "Thunder"]):
        rarity = "Rare"
    
    # Check if it's a skin/variant to skip
    skin_keywords = ["(Cyborg)", "(Drip)", "(White)", "(Beyond)", "(Badboy)", "(Abyssal)", "(Summer)", 
                     "(Released)", "(Awakened)", "(God King)", "(Djinn)", "(Hellblade)", "(Moon)", 
                     "(Hunt)", "(Grade 1)", "(Alligator)", "(True Love)"]
    if any(kw in unit_name for kw in skin_keywords):
        print(f"  Skipping skin/variant: {unit_name}")
        skipped += 1
        continue
    
    # Fetch the unit page
    # Convert unit name to wiki format: replace spaces with underscores, handle special chars
    wiki_name = unit_name.replace(' ', '_').replace('(', '').replace(')', '')
    unit_page_url = f"{base_url}/{wiki_name}"
    print(f"  Fetching page: {unit_page_url}")
    
    html = get_page(unit_page_url)
    if not html:
        print(f"  Could not fetch page")
        errors += 1
        processed += 1
        continue
    
    # Extract unit image
    img_url = extract_image_url(html)
    if img_url:
        # Sanitize name for file
        safe_name = sanitize_filename(unit_name)
        save_path = f"units/{safe_name}"
        
        # Skip if already exists
        if os.path.exists(save_path + ".png"):
            print(f"  Already exists: {save_path}.png")
            processed += 1
            continue
        
        result = download_image(img_url, save_path)
        if result:
            print(f"  Downloaded: {os.path.basename(result)}")
        else:
            print(f"  Failed to download image")
            errors += 1
    else:
        print(f"  No image found on page")
        errors += 1
    
    processed += 1
    
    # Rate limiting - wait between requests
    if (i + 1) % 5 == 0:
        print(f"  Pausing for rate limiting...")
        time.sleep(3)

print(f"\n{'='*50}")
print(f"PROCESS COMPLETE")
print(f"  Processed: {processed}")
print(f"  Skipped (skins/variants): {skipped}")
print(f"  Errors: {errors}")
print(f"  Total units in list: {len(all_unit_names)}")

# List saved files
print(f"\nSaved files in units/:")
for f in sorted(os.listdir("units"))[:20]:
    print(f"  - {f}")
