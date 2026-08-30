import urllib.request, json

url = 'http://127.0.0.1:8000/api/upload'
boundary = '----FormBoundary7MA4YWxkTrZu0gW'
pdf_path = r'd:\pdf-editor-prototype\backend\storage\08b9a2e5e94947cca587e8e9b68e9368.pdf'

with open(pdf_path, 'rb') as f:
    pdf_data = f.read()

header = (
    '--' + boundary + '\r\n'
    'Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n'
    'Content-Type: application/pdf\r\n\r\n'
).encode()
footer = ('\r\n--' + boundary + '--\r\n').encode()
body = header + pdf_data + footer

req = urllib.request.Request(url, data=body, method='POST')
req.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)

with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
    print(json.dumps(result, indent=2))
    print('\nDOC_ID:', result.get('doc_id'))
