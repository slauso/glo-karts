from django.contrib import admin

from .models import Track


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ("name", "author_name", "is_template", "is_public", "play_count", "updated_at")
    list_filter = ("is_template", "is_public")
    search_fields = ("name", "author_name", "tags", "owner_token")
    readonly_fields = ("id", "created_at", "updated_at", "play_count")
    fieldsets = (
        (None, {"fields": ("id", "name", "author_name", "description", "tags")}),
        ("Visibility", {"fields": ("is_template", "is_public", "remix_of")}),
        ("Owner", {"fields": ("owner_token",)}),
        ("Payload", {"fields": ("track_data", "thumbnail")}),
        ("Stats", {"fields": ("play_count", "created_at", "updated_at")}),
    )
