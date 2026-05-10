"""
Track persistence model for the GLO KARTS Studio.

Anonymous-owner identity (Phase 1 design): every browser generates a UUID
once, persists it in localStorage as `gloKartsStudio.ownerToken`, and sends
it as the `X-Owner-Token` header on every authenticated mutation. We store
that token on the Track row as `owner_token` and use it to gate edits and
deletes. This is intentionally lightweight — it can be upgraded later to a
real Django User by adding a `claimed_by` FK and a one-time "claim" flow.
"""

import uuid
from django.db import models


class Track(models.Model):
    """A user-authored track design."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=80, default="Untitled Track")
    author_name = models.CharField(max_length=40, blank=True, default="")
    description = models.TextField(blank=True, default="")

    # The full editor3 save blob: { track: {...}, decor: {...} }.
    # Stored opaquely so the schema can evolve without backend migrations.
    track_data = models.JSONField()

    # Optional small base64 PNG snapshot for gallery cards (≤ ~50 KB).
    thumbnail = models.TextField(blank=True, default="")

    tags = models.CharField(max_length=200, blank=True, default="")

    # Discovery flags.
    is_template = models.BooleanField(default=False, db_index=True)
    is_public = models.BooleanField(default=False, db_index=True)

    # Lightweight provenance for remixes.
    remix_of = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="remixes",
    )

    # Anonymous owner identity (UUID string from browser localStorage).
    # Templates may have an empty owner_token (system-owned).
    owner_token = models.CharField(max_length=64, blank=True, default="", db_index=True)

    play_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [
            models.Index(fields=("is_public", "-updated_at")),
            models.Index(fields=("is_template", "-updated_at")),
            models.Index(fields=("owner_token", "-updated_at")),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.id})"
