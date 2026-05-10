"""
Idempotent template seeder. Reads `tracks/fixtures/starter_templates.json`
and upserts each entry by primary key. Safe to re-run on every deploy.

    python manage.py seed_templates
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand

from tracks.models import Track


class Command(BaseCommand):
    help = "Seed/refresh built-in starter Track templates from the JSON fixture."

    def handle(self, *args, **options):
        fixture = Path(__file__).resolve().parents[2] / "fixtures" / "starter_templates.json"
        if not fixture.exists():
            self.stderr.write(f"Fixture not found: {fixture}")
            return
        entries = json.loads(fixture.read_text(encoding="utf-8"))
        created, updated = 0, 0
        for entry in entries:
            pk = entry["pk"]
            fields = entry["fields"]
            obj, was_created = Track.objects.update_or_create(id=pk, defaults=fields)
            if was_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(self.style.SUCCESS(f"Templates seeded: {created} created, {updated} updated"))
