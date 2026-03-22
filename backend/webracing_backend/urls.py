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
from django.urls import path
from django.http import JsonResponse
import os

def api_root(request):
    """Root endpoint showing API information"""
    return JsonResponse({
        'message': 'GLO KARTS Racing Backend API',
        'version': '1.0',
        'endpoints': {
            'admin': '/admin/',
            'realtime_health': os.environ.get('REALTIME_HEALTH_URL', 'http://localhost:2567/health')
        },
        'status': 'running'
    })

urlpatterns = [
    path("", api_root, name="api_root"),
    path("admin/", admin.site.urls),
]
