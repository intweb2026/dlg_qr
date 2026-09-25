from django import forms
from django.contrib import admin

from .models import AdminToken, AdminUser, Attendee, FeedbackSubmission, FormSettings, LuckyDrawWinner


class AdminUserForm(forms.ModelForm):
    new_password = forms.CharField(
        label="Password",
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text="Required for a new account. Leave blank to keep the current password.",
    )

    class Meta:
        model = AdminUser
        fields = ("username", "full_name", "is_active")

    def clean(self):
        data = super().clean()
        if not self.instance.pk and not data.get("new_password"):
            self.add_error("new_password", "Set a password for the new account.")
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get("new_password"):
            user.set_password(self.cleaned_data["new_password"])
        if commit:
            user.save()
        return user


@admin.register(AdminUser)
class AdminUserAdmin(admin.ModelAdmin):
    form = AdminUserForm
    list_display = ("username", "full_name", "is_active", "last_login", "created_at")
    search_fields = ("username", "full_name")


@admin.register(AdminToken)
class AdminTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "created_at")
    readonly_fields = ("key", "user", "created_at")

    def has_add_permission(self, request):
        return False


@admin.register(Attendee)
class AttendeeAdmin(admin.ModelAdmin):
    list_display = ("attendee_id", "full_name", "email", "company_name", "created_at")
    search_fields = ("full_name", "email", "company_name")


@admin.register(FeedbackSubmission)
class FeedbackSubmissionAdmin(admin.ModelAdmin):
    list_display = ("id", "attendee", "is_suspended", "created_at")
    list_filter = ("is_suspended",)
    search_fields = ("attendee__full_name", "attendee__email", "attendee__company_name")
    list_editable = ("is_suspended",)
    readonly_fields = ("device_fingerprint", "created_at")


@admin.register(FormSettings)
class FormSettingsAdmin(admin.ModelAdmin):
    list_display = ("form_status", "max_spin_attempts", "spin_duration_seconds", "updated_at")

    def has_add_permission(self, request):
        return not FormSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LuckyDrawWinner)
class LuckyDrawWinnerAdmin(admin.ModelAdmin):
    list_display = ("submission", "attempt_number", "drawn_by", "drawn_at")
