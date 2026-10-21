from django.urls import path

from . import views

urlpatterns = [
    # Public
    path("form-status/", views.form_status, name="form-status"),
    path("attendees/", views.attendee_list, name="attendee-list"),
    path("feedback/submit/", views.feedback_submit, name="feedback-submit"),
    # Admin auth
    path("auth/login/", views.admin_login, name="admin-login"),
    path("auth/me/", views.admin_me, name="admin-me"),
    path("auth/logout/", views.admin_logout, name="admin-logout"),
    # Admin panel
    path("admin/settings/", views.SettingsView.as_view(), name="admin-settings"),
    path("admin/submissions/", views.submission_list, name="admin-submissions"),
    path("admin/submissions/<int:pk>/suspend/", views.submission_suspend, name="admin-submission-suspend"),
    path("admin/attendees/", views.AttendeeListCreate.as_view(), name="admin-attendees"),
    path("admin/attendees/import/", views.AttendeeImport.as_view(), name="admin-attendees-import"),
    path("admin/attendees/<int:pk>/", views.AttendeeDetail.as_view(), name="admin-attendee-detail"),
    # Lucky draw
    path("lucky-draw/pool/", views.lucky_draw_pool, name="lucky-draw-pool"),
    path("lucky-draw/spin/", views.lucky_draw_spin, name="lucky-draw-spin"),
    path("lucky-draw/reveal/", views.lucky_draw_reveal, name="lucky-draw-reveal"),
    path("lucky-draw/winners/", views.WinnerList.as_view(), name="lucky-draw-winners"),
]
