import requests
import json
import time

# --- CONFIGURATION ---
WIKI_SUBDOMAIN = "civilization"  # Zmień na właściwą wiki
MAIN_USERNAME = "Robal91"  # Twój główny nick
BOT_USERNAME = "RobalBot"  # Nick Twojego bota
# --------------------

url = f"https://{WIKI_SUBDOMAIN}.fandom.com/api.php"

headers = {
    "User-Agent": f"FandomContribsDownloader/1.0 (kontakt@{MAIN_USERNAME})"
}

def fetch_contribs(username):
    print(f"Rozpoczynam pobieranie edycji dla użytkownika '{username}'...")
    params = {
        "action": "query",
        "list": "usercontribs",
        "ucuser": username,
        "uclimit": "max",
        "ucprop": "timestamp|title",
        "format": "json"
    }
    
    session = requests.Session()
    session.headers.update(headers)
    contribs = []
    page_count = 0

    while True:
        response = session.get(url, params=params).json()
        
        if "query" in response and "usercontribs" in response["query"]:
            batch = response["query"]["usercontribs"]
            contribs.extend(batch)
            page_count += 1
            print(f"[{username}] Pobrano paczkę #{page_count} (łącznie: {len(contribs)} edycji)...")
            
        if "continue" in response:
            params["uccontinue"] = response["continue"]["uccontinue"]
            time.sleep(0.2)
        else:
            break
            
    return contribs

# 1. Pobieranie Twoich edycji
#main_contribs = fetch_contribs(MAIN_USERNAME)
#with open("fandom_edits.json", "w", encoding="utf-8") as f:
#    json.dump(main_contribs, f, ensure_ascii=False, indent=4)
#print(f"Zapisano Twoje edycje do pliku: fandom_edits.json (Razem: {len(main_contribs)})\n")

# 2. Pobieranie edycji bota
bot_contribs = fetch_contribs(BOT_USERNAME)
with open("fandom_edits_bot.json", "w", encoding="utf-8") as f:
    json.dump(bot_contribs, f, ensure_ascii=False, indent=4)
print(f"Zapisano edycje bota do pliku: fandom_edits_bot.json (Razem: {len(bot_contribs)})")

print("\nPobieranie zakończone pomyślnie!")