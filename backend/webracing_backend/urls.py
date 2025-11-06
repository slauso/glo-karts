"""
URL configuration for webracing_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse

def api_root(request):
    """Root endpoint showing API information"""
    return JsonResponse({
        'message': 'Twisted Kart Racing Backend API',
        'version': '1.0',
        'endpoints': {
            'admin': '/admin/',
            'party_codes': {
                'create': '/api/party-codes/create/',
                'lookup': '/api/party-codes/lookup/<code>/'
            }
        },
        'status': 'running'
    })

urlpatterns = [
    path("", api_root, name="api_root"),
    path("admin/", admin.site.urls),
    path("api/party-codes/", include("party_codes.urls")),
]
