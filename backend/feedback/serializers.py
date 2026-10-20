from rest_framework import serializers

from .models import Attendee, FeedbackSubmission, FormSettings, LuckyDrawWinner


class AttendeeSerializer(serializers.ModelSerializer):
    has_submitted = serializers.SerializerMethodField()

    class Meta:
        model = Attendee
        fields = ["attendee_id", "full_name", "email", "company_name", "is_walk_in", "has_submitted", "created_at"]
        read_only_fields = ["attendee_id", "is_walk_in", "has_submitted", "created_at"]

    def get_has_submitted(self, obj):
        return hasattr(obj, "feedback_submission")

    def validate_email(self, value):
        return value.strip().lower() or None if value else None


def mask_email(email):
    """p***a@example.com, so the public lookup never exposes full addresses."""
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked = local[0] + "*"
    else:
        masked = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked}@{domain}"


class AttendeeLookupSerializer(serializers.ModelSerializer):
    """Public, minimal shape loaded with the feedback form for the name lookup."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = Attendee
        fields = ["attendee_id", "full_name", "company_name", "email"]

    def get_email(self, obj):
        return mask_email(obj.email)


class NewAttendeeSerializer(serializers.Serializer):
    """A name typed on the form that is not on the attendee list. Company is required, it tells apart people with the same name."""

    full_name = serializers.CharField(max_length=255)
    company_name = serializers.CharField(
        max_length=255, error_messages={"required": "Enter your company name.", "blank": "Enter your company name."}
    )
    email = serializers.EmailField(max_length=255, required=False, allow_blank=True, allow_null=True, default=None)

    def validate_full_name(self, value):
        name = " ".join(value.split())
        if len(name) < 3:
            raise serializers.ValidationError("Enter your full name.")
        return name

    def validate_company_name(self, value):
        company = " ".join(value.split())
        if len(company) < 2:
            raise serializers.ValidationError("Enter your company name.")
        return company

    def validate_email(self, value):
        return value.strip().lower() or None if value else None


class FeedbackSubmitSerializer(serializers.Serializer):
    """Send attendee_id for a listed attendee, or new_attendee for a name that is not on the list."""

    attendee_id = serializers.IntegerField(required=False)
    new_attendee = NewAttendeeSerializer(required=False)
    feedback_data = serializers.DictField(allow_empty=False)

    def validate_attendee_id(self, value):
        try:
            return Attendee.objects.get(pk=value)
        except Attendee.DoesNotExist:
            raise serializers.ValidationError("Select your name from the attendee list.")

    def validate(self, attrs):
        if ("attendee_id" in attrs) == ("new_attendee" in attrs):
            raise serializers.ValidationError({"attendee_id": "Select your name from the list, or add it as a new attendee."})
        return attrs

    def validate_feedback_data(self, value):
        if len(str(value)) > 20000:
            raise serializers.ValidationError("Feedback is too long.")
        return value


class SubmissionAdminSerializer(serializers.ModelSerializer):
    attendee_id = serializers.IntegerField(source="attendee.attendee_id", read_only=True)
    attendee_name = serializers.CharField(source="attendee.full_name", read_only=True)
    email = serializers.CharField(source="attendee.email", read_only=True, allow_null=True)
    company_name = serializers.CharField(source="attendee.company_name", read_only=True)
    is_walk_in = serializers.BooleanField(source="attendee.is_walk_in", read_only=True)

    class Meta:
        model = FeedbackSubmission
        fields = [
            "id",
            "attendee_id",
            "attendee_name",
            "email",
            "company_name",
            "is_walk_in",
            "feedback_data",
            "is_suspended",
            "device_fingerprint",
            "created_at",
        ]


class FormSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = FormSettings
        fields = ["form_status", "max_spin_attempts", "spin_duration_seconds", "updated_at"]
        read_only_fields = ["updated_at"]


class WinnerSerializer(serializers.ModelSerializer):
    submission_id = serializers.IntegerField(source="submission.id", read_only=True)
    attendee_name = serializers.CharField(source="submission.attendee.full_name", read_only=True)
    company_name = serializers.CharField(source="submission.attendee.company_name", read_only=True)
    email = serializers.CharField(source="submission.attendee.email", read_only=True, allow_null=True)
    drawn_by = serializers.CharField(source="drawn_by.username", read_only=True, default=None)

    class Meta:
        model = LuckyDrawWinner
        fields = ["id", "submission_id", "attendee_name", "company_name", "email", "attempt_number", "drawn_by", "drawn_at"]
