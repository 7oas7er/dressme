# alg=none JWT Bypass on /api/config Endpoint

**ID:** vuln-0001
**Severity:** HIGH
**Found:** 2026-11-12 00:14:15 UTC
**Target:** https://dressme-stg.7oas7er.com
**Endpoint:** /api/config
**Method:** GET
**CVSS:** 7.3
**Confidence:** High
**Fix Effort:** Low

## Description

The /api/config endpoint accepts JWTs with the alg=none algorithm, allowing unauthenticated access to Cognito configuration details. This enables information disclosure about the application's authentication infrastructure.

## Evidence

HTTP response from /api/config with alg=none JWT:
Status: 200
Content-Type: application/json; charset=utf-8
Body: {"cognito":{"userPoolId":"eu-north-1_arcGtCxVQ","clientId":"2st5t1c63bq0bnovqsuvhpdvd4","region":"eu-north-1","authDomain":"https://7oas7er-dressme-stg.auth.eu-north-1.amazoncognito.com","logoutUrl":"https://dressme-stg.7oas7er.com/","redirectUri":"https://dressme-stg.7oas7er.com/"}}

The server accepted the JWT with alg=none and no valid signature, returning sensitive Cognito configuration data.

## Impact

Unauthenticated access to Cognito configuration including userPoolId, clientId, authDomain, logoutUrl, and redirectUri. While not directly enabling data exfiltration or system compromise, this information could aid in crafting more targeted attacks against the authentication system.

## Counterevidence

Tested all other API endpoints (/api/items, /api/items/:id, /api/attribute-options, /api/suggest, /api/items/analyze) with alg=none tokens - all returned 401 Unauthorized, confirming that the alg=none bypass is specific to the /api/config endpoint and not a systemic issue across all endpoints.

## What Would Change This Severity

Confirmation that the /api/config endpoint's alg=none acceptance is an isolated configuration issue specific to that endpoint, or discovery that the disclosed Cognito configuration enables a more severe attack chain would change the severity assessment.

## Technical Analysis

The /api/config endpoint is intended to be a public configuration endpoint that returns Cognito user pool settings. However, the server does not validate the JWT algorithm field (alg) in the Authorization header. When a JWT with alg=none is provided, the server processes the token without signature verification and returns the Cognito configuration data. This is a classic algorithm confusion bypass where the server accepts tokens with no valid signature.

The Cognito configuration returned includes:
- userPoolId: eu-north-1_arcGtCxVQ
- clientId: 2st5t1c63bq0bnovqsuvhpdvd4
- region: eu-north-1
- authDomain: https://7oas7er-dressme-stg.auth.eu-north-1.amazoncognito.com
- logoutUrl: https://dressme-stg.7oas7er.com/
- redirectUri: https://dressme-stg.7oas7er.com/

All other API endpoints (/api/items, /api/items/:id, /api/attribute-options, /api/suggest, /api/items/analyze) properly reject alg=none tokens and require valid Cognito JWT authentication.

## Proof of Concept

1. Construct a JWT with alg=none and minimal payload
2. Send GET request to /api/config with the alg=none token in the Authorization header
3. Observe that the server returns 200 and Cognito configuration data without validating the token signature

```python
import jwt
token = jwt.encode({'test': 'payload'}, key='', algorithm='none')
import httpx
url = 'https://dressme-stg.7oas7er.com/api/config'
headers = {'Authorization': f'Bearer {token}'}
resp = httpx.get(url, headers=headers, timeout=10)
print(f'Status: {resp.status_code}')
print(f'Response: {resp.text}')
```

## Remediation

Implement JWT algorithm validation on the /api/config endpoint to reject tokens with alg=none. The server should explicitly verify the algorithm and only accept tokens with the expected algorithm (RS256 for Cognito). Additionally, implement proper token signature verification for all endpoints. Consider adding a middleware that validates JWT tokens before processing any requests, rejecting tokens with alg=none or any unrecognized algorithm.

## Assumptions

- The /api/config endpoint is intended to be publicly accessible for configuration
- The server's failure to validate JWT algorithms is a configuration/development oversight
- The disclosed Cognito configuration details are sufficient to aid further attacks, though direct data exfiltration is limited
