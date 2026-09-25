import secrets

from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class AdminUser(models.Model):
    """Admin panel account. Separate from Django's built-in auth User model."""

    id = models.AutoField(primary_key=True)
    username = models.CharField(max_length=150, unique=True)
    password = models.CharField(max_length=255)  # hashed, never plain text
    full_name = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True)
    last_login = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admin_users"
        ordering = ["username"]

    # DRF reads these on request.user
    is_authenticated = True
    is_anonymous = False

    def set_password(self, raw_password):
        self.password = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password)

    def __str__(self):
        return self.username


class AdminToken(models.Model):
    """API token issued on admin login, sent as 'Authorization: Token <key>'."""

    key = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(AdminUser, on_delete=models.CASCADE, related_name="tokens")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "admin_tokens"

    @classmethod
    def issue(cls, user):
        return cls.objects.create(key=secrets.token_hex(32), user=user)

    def __str__(self):
        return f"Token for {self.user.username}"


class Attendee(models.Model):
    """Registered summit attendees. Used by the search-as-you-type lookup."""

    attendee_id = models.AutoField(primary_key=True)
    full_name = models.CharField(max_length=255, db_index=True)
    email = models.EmailField(max_length=255, unique=True, null=True, blank=True)
    company_name = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "attendees"
        ordering = ["full_name"]

    def __str__(self):
        return f"{self.full_name} ({self.company_name})" if self.company_name else self.full_name


class FeedbackSubmission(models.Model):
    id = models.AutoField(primary_key=True)
    # OneToOne = one feedback per attendee, enforced at database level too.
    attendee = models.OneToOneField(
        Attendee,
        on_delete=models.PROTECT,
        db_column="attendee_id",
        related_name="feedback_submission",
    )
    device_fingerprint = models.CharField(max_length=255, db_index=True)
    feedback_data = models.JSONField(default=dict)
    is_suspended = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "feedback_submissions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.id} {self.attendee.full_name}"


class FormSettings(models.Model):
    """Singleton row holding the global form configuration."""

    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"
    STATUS_CHOICES = [(STATUS_ACTIVE, "Active"), (STATUS_INACTIVE, "Inactive")]

    form_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    # 0 means unlimited spins
    max_spin_attempts = models.PositiveIntegerField(default=0)
    # How long the lucky draw reels spin before stopping on the winning number
    spin_duration_seconds = models.PositiveIntegerField(
        default=5, validators=[MinValueValidator(1), MaxValueValidator(60)]
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "form_settings"
        verbose_name = "Form settings"
        verbose_name_plural = "Form settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def is_active(self):
        return self.form_status == self.STATUS_ACTIVE

    def __str__(self):
        return (f"Form {self.form_status}, max spins {self.max_spin_attempts or 'unlimited'}, "
                f"spin {self.spin_duration_seconds}s")


class LuckyDrawWinner(models.Model):
    """Log of revealed winners, so results survive a page refresh."""

    id = models.AutoField(primary_key=True)
    submission = models.ForeignKey(FeedbackSubmission, on_delete=models.CASCADE, related_name="wins")
    attempt_number = models.PositiveIntegerField(default=1)
    drawn_by = models.ForeignKey(AdminUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="draws")
    drawn_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "lucky_draw_winners"
        ordering = ["-drawn_at"]

    def __str__(self):
        return f"Winner #{self.submission_id} (attempt {self.attempt_number})"
