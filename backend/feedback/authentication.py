from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.permissions import BasePermission

from .models import AdminToken, AdminUser


class AdminTokenAuthentication(BaseAuthentication):
    """Reads 'Authorization: Token <key>' and resolves it to an AdminUser."""

    keyword = "Token"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != self.keyword.lower().encode():
            return None
        if len(parts) != 2:
            raise exceptions.AuthenticationFailed("Invalid token header.")
        try:
            key = parts[1].decode()
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Invalid token header.")

        try:
            token = AdminToken.objects.select_related("user").get(key=key)
        except AdminToken.DoesNotExist:
            raise exceptions.AuthenticationFailed("Your session has expired, sign in again.")
        if not token.user.is_active:
            raise exceptions.AuthenticationFailed("This admin account is disabled.")
        return token.user, token

    def authenticate_header(self, request):
        return self.keyword


class IsAdmin(BasePermission):
    message = "Sign in as an admin to continue."

    def has_permission(self, request, view):
        return isinstance(request.user, AdminUser) and request.user.is_active
