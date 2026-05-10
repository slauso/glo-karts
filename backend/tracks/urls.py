from django.urls import path

from . import views

urlpatterns = [
    path("templates/", views.list_templates, name="track_templates"),
    path("community/", views.list_community, name="track_community"),
    path("mine/", views.list_mine, name="track_mine"),
    path("", views.create_track, name="track_create"),
    path("<uuid:track_id>/", views.get_track, name="track_detail"),
    path("<uuid:track_id>/update/", views.update_track, name="track_update"),
    path("<uuid:track_id>/delete/", views.delete_track, name="track_delete"),
    path("<uuid:track_id>/remix/", views.remix_track, name="track_remix"),
]
