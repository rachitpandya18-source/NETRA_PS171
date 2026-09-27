$body = Get-Content .\examples\request_example.json -Raw
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/agent/run -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 10
