from rest_framework import serializers

from .models import Track


class TrackSummarySerializer(serializers.ModelSerializer):
    """Lightweight payload for list endpoints (no track_data blob)."""

    remix_of = serializers.PrimaryKeyRelatedField(read_only=True)
    preview_placements = serializers.SerializerMethodField()

    class Meta:
        model = Track
        fields = (
            "id",
            "name",
            "author_name",
            "description",
            "thumbnail",
            "tags",
            "is_template",
            "is_public",
            "remix_of",
            "play_count",
            "created_at",
            "updated_at",
            "preview_placements",
        )

    def get_preview_placements(self, obj):
        """Compact placement list (just k/x/z/r) for the landing thumbnail.

        We intentionally drop decor and metadata to keep list responses small —
        the landing tiles only need the track skeleton to render an isometric
        snapshot. Returns [] on malformed/empty payloads.
        """
        try:
            return obj.track_data.get("track", {}).get("placements", []) or []
        except Exception:
            return []


class TrackDetailSerializer(serializers.ModelSerializer):
    """Full payload including the editor save blob."""

    remix_of = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Track
        fields = (
            "id",
            "name",
            "author_name",
            "description",
            "track_data",
            "thumbnail",
            "tags",
            "is_template",
            "is_public",
            "remix_of",
            "play_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "play_count", "created_at", "updated_at", "is_template")


class TrackCreateSerializer(serializers.ModelSerializer):
    """Body for POST /api/tracks/ — owner_token comes from header."""

    class Meta:
        model = Track
        fields = (
            "name",
            "author_name",
            "description",
            "track_data",
            "thumbnail",
            "tags",
            "is_public",
        )
