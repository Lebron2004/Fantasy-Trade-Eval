#!/usr/bin/env python3
"""
One-time Yahoo login, run on your own computer. Prints the refresh token to save
as the YAHOO_REFRESH_TOKEN GitHub secret. You only do this once.

  1. Create an app at https://developer.yahoo.com/apps/create/
       - Application Type: Installed Application (or Web Application)
       - Redirect URI: https://localhost:8080
       - API Permissions: Fantasy Sports, Read
  2. Run:  python scripts/yahoo_auth.py
  3. Paste the Client ID and Client Secret when asked, open the link it prints,
     approve, then copy the "code=" value from the address bar of the page that
     fails to load (that's expected, nothing is running on localhost).
"""
import base64, json, urllib.parse, urllib.request

REDIRECT = "https://localhost:8080"

cid = input("Yahoo Client ID: ").strip()
secret = input("Yahoo Client Secret: ").strip()
print("\nOpen this link, sign in, and approve:\n")
print("https://api.login.yahoo.com/oauth2/request_auth?" + urllib.parse.urlencode(
    {"client_id": cid, "redirect_uri": REDIRECT, "response_type": "code"}))
print("\nYour browser then lands on a localhost page that won't load. Copy the value after code= in its address bar.")
code = input("\nPaste the code here: ").strip()
if "code=" in code:
    code = urllib.parse.parse_qs(urllib.parse.urlparse(code).query).get("code", [code])[0]

body = urllib.parse.urlencode({"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT}).encode()
req = urllib.request.Request("https://api.login.yahoo.com/oauth2/get_token", data=body, headers={
    "Authorization": "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode(),
    "Content-Type": "application/x-www-form-urlencoded"})
with urllib.request.urlopen(req, timeout=30) as r:
    tok = json.loads(r.read().decode())

print("\nSuccess. Add these three repository secrets on GitHub (Settings > Secrets and variables > Actions):\n")
print(f"  YAHOO_CLIENT_ID      = {cid}")
print(f"  YAHOO_CLIENT_SECRET  = {secret}")
print(f"  YAHOO_REFRESH_TOKEN  = {tok['refresh_token']}")
print("\nKeep these private. Don't paste them into any file in the repo.")
