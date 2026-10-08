"""
ZKTeco ADMS push simulator — run on Hostinger to test /iclock/cdata parsing.
Usage: python3 test_zkteco.py
"""
import requests, json

SERVER = "http://127.0.0.1:3005"
SN     = "BYEL194660080"
# Two fake punch records: check-in and check-out
ATTLOG = "431\t2026-08-04 09:14:23\t0\t1\t0\t0\n431\t2026-08-04 18:00:00\t1\t1\t0\t0\n"

def test(label, **kwargs):
    url = f"{SERVER}/iclock/cdata?SN={SN}&table=ATTLOG&Stamp=0"
    try:
        r = requests.post(url, timeout=5, **kwargs)
        print(f"[{label}] status={r.status_code} response={r.text!r}")
    except Exception as e:
        print(f"[{label}] ERROR: {e}")

print("=== ZKTeco ADMS body format tests ===\n")

# Test 1: text/plain  (most common in newer ZKTeco firmware)
test("text/plain",
     data=ATTLOG,
     headers={"Content-Type": "text/plain"})

# Test 2: application/x-www-form-urlencoded with body as raw lines (some older firmware)
test("urlencoded-raw",
     data=ATTLOG,
     headers={"Content-Type": "application/x-www-form-urlencoded"})

# Test 3: urlencoded with ATTLOG as a named field (some firmware versions)
test("urlencoded-field",
     data={"ATTLOG": ATTLOG, "SN": SN, "table": "ATTLOG"},
     headers={"Content-Type": "application/x-www-form-urlencoded"})

# Test 4: no Content-Type header
test("no-content-type",
     data=ATTLOG)

# Test 5: empty body (confirm what the device is actually sending)
test("empty-body",
     data="",
     headers={"Content-Type": "text/plain"})

print("\n=== Also check server logs for [biometric-debug] lines ===")
print("Run: docker logs lumos_app --tail=30 | grep biometric-debug")
