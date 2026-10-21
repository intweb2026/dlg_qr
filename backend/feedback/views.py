import csv
import io
import secrets

from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.db.models import Max, ProtectedError, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import IsAdmin
from .models import AdminToken, AdminUser, Attendee, FeedbackSubmission, FormSettings, LuckyDrawWinner
from .serializers import (
    AttendeeLookupSerializer,
    AttendeeSerializer,
    FeedbackSubmitSerializer,
    FormSettingsSerializer,
    SubmissionAdminSerializer,
    WinnerSerializer,
)
from .utils import device_fingerprint, normalize_name, pad_length_for

# =====================================================================
# Public endpoints
# =====================================================================
@api_view(["GET"])
@permission_classes([AllowAny])
def form_status(request):
    cfg = FormSettings.load()
    return Response({"form_status": cfg.form_status, "is_active": cfg.is_active})


@api_view(["GET"])
@permission_classes([AllowAny])
def attendee_list(request):
    """Full lookup list, loaded once with the feedback form. The browser filters it after 3 typed characters."""
    if not FormSettings.load().is_active:
        return Response({"detail": "Event feedback is closed."}, status=status.HTTP_403_FORBIDDEN)
    qs = Attendee.objects.filter(feedback_submission__isnull=True).order_by("full_name")  # hide people who already submitted
    return Response(AttendeeLookupSerializer(qs, many=True).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def feedback_submit(request):
    # 1. Status check
    if not FormSettings.load().is_active:
        return Response({"detail": "Event feedback is closed."}, status=status.HTTP_403_FORBIDDEN)

    # 2. The one entry per device check is done by the form, with a cookie and localStorage on its own site.
    # A cookie set here would live on the API domain, which clearing the form site's cookies does not remove.

    serializer = FeedbackSubmitSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    attendee = serializer.validated_data.get("attendee_id")
    new_attendee = serializer.validated_data.get("new_attendee")

    # 3. A new name and company pair must not already be on the list, compared without case, accents or extra
    #    spaces. The same name from another company is a different person and is allowed.
    if new_attendee:
        wanted = (normalize_name(new_attendee["full_name"]), normalize_name(new_attendee["company_name"]))
        existing = next(
            (a for a in Attendee.objects.select_related("feedback_submission")
             if (normalize_name(a.full_name), normalize_name(a.company_name)) == wanted),
            None,
        )
        if existing and hasattr(existing, "feedback_submission"):
            return Response(
                {"detail": "Feedback has already been submitted for this name and company. "
                           "If that was not you, ask the registration desk.",
                 "code": "already_submitted"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if existing:
            return Response(
                {"detail": "This name and company are already on the attendee list, select your name from the list.",
                 "code": "attendee_exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Email is optional, but unique on the attendee list.
        if new_attendee["email"] and Attendee.objects.filter(email=new_attendee["email"]).exists():
            return Response(
                {"detail": "This email is already on the attendee list. Select your name from the list, "
                           "or use another email.",
                 "code": "email_exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # 4. Duplicate check + save
    if attendee and FeedbackSubmission.objects.filter(attendee=attendee).exists():
        return Response(
            {"detail": "Feedback has already been submitted for this attendee.", "code": "already_submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        with transaction.atomic():
            # A name not on the list is added as an attendee, rolled back if the submission fails.
            if new_attendee:
                attendee = Attendee.objects.create(**new_attendee, is_walk_in=True)
            submission = FeedbackSubmission.objects.create(
                attendee=attendee,
                device_fingerprint=device_fingerprint(request),
                feedback_data=serializer.validated_data["feedback_data"],
            )
    except IntegrityError:
        return Response(
            {"detail": "Feedback has already been submitted for this attendee.", "code": "already_submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(
        {"id": submission.id, "submission_status": True, "detail": "Thank you, your feedback has been submitted."},
        status=status.HTTP_201_CREATED,
    )


# =====================================================================
# Admin auth
# =====================================================================
# Hash used when the username does not exist, so the response time does not reveal valid usernames.
_DUMMY_HASH = make_password("not-a-real-password")


@api_view(["POST"])
@permission_classes([AllowAny])
def admin_login(request):
    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    user = AdminUser.objects.filter(username__iexact=username).first() if username else None
    if user is None:
        AdminUser(password=_DUMMY_HASH).check_password(password)
        valid = False
    else:
        valid = user.check_password(password) and user.is_active
    if not valid:
        return Response({"detail": "Incorrect username or password."}, status=status.HTTP_400_BAD_REQUEST)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    token = AdminToken.issue(user)
    return Response({"token": token.key, "username": user.username, "full_name": user.full_name})


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_me(request):
    return Response({"username": request.user.username, "full_name": request.user.full_name})


@api_view(["POST"])
@permission_classes([IsAdmin])
def admin_logout(request):
    request.auth.delete()  # only this session, other devices stay signed in
    return Response(status=status.HTTP_204_NO_CONTENT)


# =====================================================================
# Admin: settings and submissions
# =====================================================================
class SettingsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(FormSettingsSerializer(FormSettings.load()).data)

    def patch(self, request):
        cfg = FormSettings.load()
        serializer = FormSettingsSerializer(cfg, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAdmin])
def submission_list(request):
    qs = FeedbackSubmission.objects.select_related("attendee").order_by("id")
    q = request.query_params.get("q", "").strip()
    if q:
        filt = Q(attendee__full_name__icontains=q) | Q(attendee__email__icontains=q) | Q(attendee__company_name__icontains=q)
        if q.isdigit():
            filt |= Q(id=int(q))
        qs = qs.filter(filt)
    state = request.query_params.get("status")
    if state == "active":
        qs = qs.filter(is_suspended=False)
    elif state == "suspended":
        qs = qs.filter(is_suspended=True)
    walk_in = request.query_params.get("walk_in")
    if walk_in in ("true", "false"):
        qs = qs.filter(attendee__is_walk_in=walk_in == "true")
    all_qs = FeedbackSubmission.objects.all()
    return Response({
        "results": SubmissionAdminSerializer(qs, many=True).data,
        "stats": {
            "total": all_qs.count(),
            "active": all_qs.filter(is_suspended=False).count(),
            "suspended": all_qs.filter(is_suspended=True).count(),
        },
        "pad_length": pad_length_for(all_qs.aggregate(m=Max("id"))["m"]),
    })


@api_view(["PATCH"])
@permission_classes([IsAdmin])
def submission_suspend(request, pk):
    try:
        sub = FeedbackSubmission.objects.select_related("attendee").get(pk=pk)
    except FeedbackSubmission.DoesNotExist:
        return Response({"detail": "Submission not found."}, status=status.HTTP_404_NOT_FOUND)
    if "is_suspended" in request.data:
        sub.is_suspended = bool(request.data["is_suspended"])
    else:
        sub.is_suspended = not sub.is_suspended
    sub.save(update_fields=["is_suspended"])
    return Response(SubmissionAdminSerializer(sub).data)


# =====================================================================
# Admin: attendees
# =====================================================================
class AttendeeListCreate(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = Attendee.objects.select_related("feedback_submission").all()
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(Q(full_name__icontains=q) | Q(email__icontains=q) | Q(company_name__icontains=q))
        walk_in = request.query_params.get("walk_in")  # true = added on the feedback form, false = from the list
        if walk_in in ("true", "false"):
            qs = qs.filter(is_walk_in=walk_in == "true")
        return Response(AttendeeSerializer(qs, many=True).data)

    def post(self, request):
        serializer = AttendeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AttendeeDetail(APIView):
    permission_classes = [IsAdmin]

    def get_object(self, pk):
        try:
            return Attendee.objects.get(pk=pk)
        except Attendee.DoesNotExist:
            return None

    def patch(self, request, pk):
        obj = self.get_object(pk)
        if not obj:
            return Response({"detail": "Attendee not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = AttendeeSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        obj = self.get_object(pk)
        if not obj:
            return Response({"detail": "Attendee not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            obj.delete()
        except ProtectedError:
            return Response({"detail": "This attendee has a feedback submission, suspend it instead of deleting."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttendeeImport(APIView):
    """CSV upload. Header row: full_name, company_name, email (email optional)."""

    permission_classes = [IsAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Choose a CSV file to import."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            text = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"detail": "The file must be UTF-8 encoded CSV."}, status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(text))
        headers = {h.strip().lower() for h in (reader.fieldnames or [])}
        name_key = next((k for k in ("full_name", "attendee_name", "name") if k in headers), None)
        if not name_key:
            return Response({"detail": "CSV needs a full_name column (also accepted, attendee_name or name)."},
                            status=status.HTTP_400_BAD_REQUEST)

        created, skipped, errors = 0, 0, []
        for line, row in enumerate(reader, start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            name = row.get(name_key, "")
            if not name:
                skipped += 1
                continue
            email = row.get("email", "").lower() or None
            company = row.get("company_name") or row.get("company") or ""
            if email and Attendee.objects.filter(email=email).exists():
                skipped += 1
                continue
            try:
                Attendee.objects.create(full_name=name, email=email, company_name=company)
                created += 1
            except Exception as exc:  # noqa: BLE001
                errors.append(f"Line {line}, {exc}")
        return Response({"created": created, "skipped": skipped, "errors": errors[:20]})


# =====================================================================
# Lucky draw, public so the /lucky-draw page works without signing in
# =====================================================================
def eligible_pool():
    """Active entries that have not already won a finished draw. Clearing the winner history puts winners back."""
    return (
        FeedbackSubmission.objects.select_related("attendee")
        .filter(is_suspended=False, wins__isnull=True)
        .order_by("id")
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def lucky_draw_pool(request):
    pool = eligible_pool()
    ids = list(pool.values_list("id", flat=True))
    max_id = FeedbackSubmission.objects.aggregate(m=Max("id"))["m"] or 0
    cfg = FormSettings.load()
    return Response({
        "ids": ids,
        "count": len(ids),
        "past_winners": FeedbackSubmission.objects.filter(is_suspended=False, wins__isnull=False).distinct().count(),
        "max_id": max_id,
        "pad_length": pad_length_for(max_id),
        "max_spin_attempts": cfg.max_spin_attempts,
        "spin_duration_seconds": cfg.spin_duration_seconds,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def lucky_draw_spin(request):
    """Winner is chosen on the server with a cryptographically secure RNG.

    Only the entry number is returned here, the name stays on the server until Reveal is pressed.
    """
    ids = list(eligible_pool().values_list("id", flat=True))
    if not ids:
        return Response({"detail": "No eligible submissions in the pool."}, status=status.HTTP_400_BAD_REQUEST)
    max_id = FeedbackSubmission.objects.aggregate(m=Max("id"))["m"] or 0
    return Response({"submission_id": secrets.choice(ids), "pad_length": pad_length_for(max_id)})


@api_view(["POST"])
@permission_classes([AllowAny])
def lucky_draw_reveal(request):
    try:
        sub = eligible_pool().get(id=int(request.data.get("submission_id")))
    except (FeedbackSubmission.DoesNotExist, TypeError, ValueError):
        return Response({"detail": "That submission is not in the eligible pool."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        attempt = max(1, int(request.data.get("attempt_number") or 1))
    except (TypeError, ValueError):
        attempt = 1
    # drawn_by is only known when a signed-in admin runs the draw.
    drawn_by = request.user if isinstance(request.user, AdminUser) else None
    win = LuckyDrawWinner.objects.create(submission=sub, attempt_number=attempt, drawn_by=drawn_by)
    return Response(WinnerSerializer(win).data, status=status.HTTP_201_CREATED)


class WinnerList(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        qs = LuckyDrawWinner.objects.select_related("submission__attendee", "drawn_by")
        return Response(WinnerSerializer(qs, many=True).data)

    def delete(self, request):
        LuckyDrawWinner.objects.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
