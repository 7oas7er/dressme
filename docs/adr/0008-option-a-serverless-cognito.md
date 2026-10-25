# ADR 0008 — Option A: serverless + Cognito

- **Status:** Accepted (2026-10-25)
- **Context:** DressMe v1 needs durable wardrobe CRUD, photo storage, LLM suggest (attrs+IDs only), Cognito for a single user, and a SPA — beyond Block Drop’s static game + high-scores Lambda.
- **Decision:** Template-native Option A: S3/CloudFront SPA, Lambda APIs, DynamoDB items, S3 media + presigns, Cognito, Bedrock in `eu-north-1`, client-side flat-lay collage. Reject Access-only (B), container/Postgres (C), and local-first (D) for v1.
- **Consequences:** More AWS surface than Block Drop; stays aligned with app-* platform habits. Scaffold may land `/api/health` + SPA placeholder before full UC-01–06.
