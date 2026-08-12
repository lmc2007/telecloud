import secrets
import base64

key = secrets.token_bytes(64)
print(base64.b64encode(key).decode('utf-8'))
