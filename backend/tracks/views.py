"""
DRF views for the Track persistence API.

Authentication is anonymous: callers send `X-Owner-Token: <uuid>` and we
match that against `Track.owner_token` for any mutating action. Read
endpoints are open.
"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Track
from .serializers import (
    TrackCreateSerializer,
    TrackDetailSerializer,
    TrackSummarySerializer,
)


def _owner(request) -> str:
    return (request.headers.get("X-Owner-Token") or "").strip()


def _paginate(qs, request, page_size_default=24, page_size_max=60):
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = min(page_size_max, max(1, int(request.GET.get("page_size", page_size_default))))
    except (TypeError, ValueError):
        size = page_size_default
    total = qs.count()
    start = (page - 1) * size
    return qs[start : start + size], {
        "page": page,
        "page_size": size,
        "total": total,
        "has_more": start + size < total,
    }


def _sort(qs, request):
    sort = (request.GET.get("sort") or "newest").lower()
    if sort == "popular":
        return qs.order_by("-play_count", "-updated_at")
    if sort == "oldest":
        return qs.order_by("created_at")
    # newest / default
    return qs.order_by("-updated_at")


def _search(qs, request):
    q = (request.GET.get("q") or "").strip()
    if not q:
        return qs
    return qs.filter(name__icontains=q) | qs.filter(author_name__icontains=q) | qs.filter(tags__icontains=q)


@api_view(["GET"])
@permission_classes([AllowAny])
def list_templates(request):
    qs = _search(Track.objects.filter(is_template=True), request)
    qs = _sort(qs, request)
    page_qs, meta = _paginate(qs, request)
    return Response({"results": TrackSummarySerializer(page_qs, many=True).data, **meta})


@api_view(["GET"])
@permission_classes([AllowAny])
def list_community(request):
    qs = _search(Track.objects.filter(is_public=True, is_template=False), request)
    qs = _sort(qs, request)
    page_qs, meta = _paginate(qs, request)
    return Response({"results": TrackSummarySerializer(page_qs, many=True).data, **meta})


@api_view(["GET"])
@permission_classes([AllowAny])
def list_mine(request):
    owner = _owner(request)
    if not owner:
        return Response({"results": [], "page": 1, "page_size": 0, "total": 0, "has_more": False})
    qs = Track.objects.filter(owner_token=owner)
    qs = _sort(qs, request)
    page_qs, meta = _paginate(qs, request)
    return Response({"results": TrackSummarySerializer(page_qs, many=True).data, **meta})


@api_view(["GET"])
@permission_classes([AllowAny])
def get_track(request, track_id):
    track = get_object_or_404(Track, id=track_id)
    if request.GET.get("play") == "1":
        Track.objects.filter(pk=track.pk).update(play_count=track.play_count + 1)
        track.play_count += 1
    return Response(TrackDetailSerializer(track).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def create_track(request):
    owner = _owner(request)
    if not owner:
        return Response({"error": "Missing X-Owner-Token header"}, status=status.HTTP_400_BAD_REQUEST)
    serializer = TrackCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    track = serializer.save(owner_token=owner)
    return Response(TrackDetailSerializer(track).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([AllowAny])
def update_track(request, track_id):
    owner = _owner(request)
    track = get_object_or_404(Track, id=track_id)
    if not owner or track.owner_token != owner:
        return Response({"error": "Not the owner"}, status=status.HTTP_403_FORBIDDEN)
    # Whitelist editable fields; never let clients flip is_template.
    editable = {"name", "author_name", "description", "track_data", "thumbnail", "tags", "is_public"}
    for field in editable:
        if field in request.data:
            setattr(track, field, request.data[field])
    track.save()
    return Response(TrackDetailSerializer(track).data)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def delete_track(request, track_id):
    owner = _owner(request)
    track = get_object_or_404(Track, id=track_id)
    if not owner or track.owner_token != owner:
        return Response({"error": "Not the owner"}, status=status.HTTP_403_FORBIDDEN)
    track.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([AllowAny])
def remix_track(request, track_id):
    owner = _owner(request)
    if not owner:
        return Response({"error": "Missing X-Owner-Token header"}, status=status.HTTP_400_BAD_REQUEST)
    src = get_object_or_404(Track, id=track_id)
    # Source must be discoverable (template or public) OR owned by the requester.
    if not (src.is_template or src.is_public or src.owner_token == owner):
        return Response({"error": "Track is not remixable"}, status=status.HTTP_403_FORBIDDEN)
    new_name = request.data.get("name") or f"{src.name} (remix)"
    new_author = request.data.get("author_name", "")
    clone = Track.objects.create(
        name=new_name[:80],
        author_name=new_author[:40],
        description="",
        track_data=src.track_data,
        thumbnail=src.thumbnail,
        tags=src.tags,
        is_template=False,
        is_public=False,
        remix_of=src,
        owner_token=owner,
    )
    return Response(TrackDetailSerializer(clone).data, status=status.HTTP_201_CREATED)
