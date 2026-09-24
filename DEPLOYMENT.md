# Deployment Guide

## Recommended production topology
Browser -> HTTPS reverse proxy -> FastAPI application -> PostgreSQL database

## IT checklist
1. Provision Linux VM/container environment.
2. Provision PostgreSQL with restricted network access.
3. Create production `.env` outside source control.
4. Use a strong random database password. This app has no login of its own — it
   must sit behind a proxy/parent app that authenticates users and forwards
   their identity via the `X-Auth-User` / `X-Auth-Role` headers (see README);
   never expose this service's port directly.
5. Run application behind HTTPS (Nginx/Apache/load balancer).
6. Restrict access using organization network/VPN/SSO where appropriate.
7. Configure automated encrypted database backups and test restoration.
8. Centralize application/audit logs and define retention.
9. Configure least-privilege user roles and per-lab access.
10. Complete security, privacy, validation and UAT before real patient data is entered.

## Never commit
- `.env`
- database dumps containing patient data
- TLS private keys
- passwords/API keys
