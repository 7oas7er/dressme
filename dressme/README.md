# DressMe (site)

SPA placeholder for the DressMe wardrobe app. Deployed as static assets to S3/CloudFront.

## Planned (Option A)

- Cognito sign-in (single user in v1)
- Catalog CRUD + photo capture (UC-01–03)
- Suggest session → three looks (UC-04); flat-lay collage from item photos (UC-05–06)
- Bedrock: attributes + item IDs only (no photos to the model in v1)

Small bundler OK when catalog/camera UX needs it; keep tests under `../tests/` gating deploy.
