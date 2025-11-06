# Deployment Guide - Koyeb

## Quick Start

This Django backend is configured for Koyeb buildpack deployment.

### Repository Setup
- **Work Directory**: `backend`
- **Build Command**: Leave empty (buildpack handles pip install + collectstatic automatically)
- **Run Command**: Leave empty (uses `Procfile`)

### Environment Variables

Required for production:

```bash
# Security
SECRET_KEY=your-long-random-secret-key-here
DEBUG=False

# Allowed Hosts (optional - defaults to .koyeb.app)
ALLOWED_HOSTS=twistedkart.koyeb.app,www.twistedkart.koyeb.app

# CORS (if frontend is on different domain)
CORS_ALLOWED_ORIGINS=https://your-frontend.com
# Or allow all origins for development (not recommended for production)
CORS_ALLOW_ALL_ORIGINS=True
```

### Default Configuration

If environment variables are not set:
- `DEBUG` defaults to `False`
- `ALLOWED_HOSTS` defaults to `[".koyeb.app", "localhost", "127.0.0.1"]`
- Database defaults to SQLite (will be ephemeral on Koyeb)

### Production Database

For persistent data, add a PostgreSQL database:

1. Add PostgreSQL service in Koyeb
2. Set `DATABASE_URL` environment variable (dj-database-url will parse it automatically)

Example:
```bash
DATABASE_URL=postgres://user:password@host:5432/dbname
```

### Static Files

Static files are served via WhiteNoise middleware. Collectstatic runs automatically during build.

### Post-Deploy

After deployment, your app will be available at:
- `https://[your-app-name].koyeb.app/`

Test endpoints:
- Admin: `https://[your-app-name].koyeb.app/admin/`
- API: `https://[your-app-name].koyeb.app/api/` (check your `urls.py`)

### Troubleshooting

**400 Bad Request**: Check `ALLOWED_HOSTS` environment variable includes your domain
**500 Server Error**: Check Koyeb logs and ensure `SECRET_KEY` is set
**Static files not loading**: Verify WhiteNoise is in `MIDDLEWARE` and `collectstatic` ran during build

### Local Development

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```
