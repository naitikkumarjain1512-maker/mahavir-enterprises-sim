# Mahavir Enterprises - SimCompany API

This repository contains the server for the Mahavir Enterprises SimCompany selling system.

Features
- Node/Express API
- Postgres persistence
- Transactional sell endpoint with SELECT ... FOR UPDATE locking
- Price preview endpoint
- Dockerfile and docker-compose for local development

Deploy flow
1. Add GitHub Secrets: DOCKERHUB_USER, DOCKERHUB_TOKEN, (optional) RENDER_SERVICE_ID, RENDER_API_KEY
2. Push to main — GitHub Actions will build and push the Docker image.
3. Deploy the Docker image to Render (or follow the local docker-compose steps).

---

CI trigger: small update pushed to start the Actions workflow.

If you added the repository secrets as instructed, the workflow will now build and push the Docker image and (if Render secrets provided) trigger a Render deploy. Monitor the run here:

https://github.com/naitikkumarjain1512-maker/mahavir-enterprises-sim/actions

I will watch for the workflow result; when it finishes successfully I will provide the Docker Hub image name and the public API URL (Render) if deployed.
