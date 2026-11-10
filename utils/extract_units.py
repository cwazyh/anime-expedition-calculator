import json
import os
import re
import urllib.request
import urllib.parse

# Create directories
dirs = [
    "units", "equipments", "elements", "cresttypes",
    "units/evolved", "units/unevolved"
]
for d in dirs:
    os.makedirs(d, exist_ok=True)

# Step 1: Get all unit pages from the Units listing
# The wiki Units page lists all units. Let's parse the data we have.
# From the earlier fetch, we have the unit categories. Let me create a comprehensive list
# based on what we know from the wiki structure.

# Known unit categories from wiki.animeexpeditions.com/Units
categories = {
    "Secret": [],
    "Exclusive": [],
    "Mythic": [],
    "Legendary": [],
    "Epic": [],
    "Rare": []
}

# We need to fetch each unit page to get the image
# Let me start with a few key units and then expand

# Actually, let me read the Units page we already fetched
# and extract all unit links

print("Starting unit image extraction...")
print(f"Working directory: {os.getcwd()}")
