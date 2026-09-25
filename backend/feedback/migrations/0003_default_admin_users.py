from django.contrib.auth.hashers import make_password
from django.db import migrations

DEFAULT_ADMINS = [
    ("benny", "benny123", "Benny"),
    ("maxwell", "maxwell123", "Maxwell"),
    ("nolan", "nolan123", "Nolan"),
    ("ramon", "ramon123", "Ramon"),
]


def create_admins(apps, schema_editor):
    AdminUser = apps.get_model("feedback", "AdminUser")
    for username, password, full_name in DEFAULT_ADMINS:
        if not AdminUser.objects.filter(username=username).exists():
            AdminUser.objects.create(username=username, password=make_password(password), full_name=full_name)


def remove_admins(apps, schema_editor):
    apps.get_model("feedback", "AdminUser").objects.filter(username__in=[u for u, _, _ in DEFAULT_ADMINS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("feedback", "0002_admin_users_spin_duration"),
    ]

    operations = [
        migrations.RunPython(create_admins, remove_admins),
    ]
