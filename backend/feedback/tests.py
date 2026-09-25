from django.contrib.auth.models import User
from rest_framework.test import APIClient, APITestCase

from .models import AdminToken, AdminUser, Attendee, FeedbackSubmission, FormSettings, LuckyDrawWinner


class FeedbackFlowTests(APITestCase):
    def setUp(self):
        self.a1 = Attendee.objects.create(full_name="Priya Sharma", email="priya@example.com", company_name="Shell")
        self.a2 = Attendee.objects.create(full_name="James Smith", email="james@example.com", company_name="BP")

    def test_attendee_list_loads_all_and_masks_email(self):
        data = self.client.get("/api/attendees/").json()
        self.assertEqual({a["full_name"] for a in data}, {"Priya Sharma", "James Smith"})
        self.assertEqual(next(a for a in data if a["full_name"] == "Priya Sharma")["email"], "p***a@example.com")

    def test_attendee_list_hides_submitted(self):
        FeedbackSubmission.objects.create(attendee=self.a1, device_fingerprint="a", feedback_data={"x": 1})
        names = [a["full_name"] for a in self.client.get("/api/attendees/").json()]
        self.assertEqual(names, ["James Smith"])

    def test_attendee_list_closed_form(self):
        cfg = FormSettings.load()
        cfg.form_status = "inactive"
        cfg.save()
        self.assertEqual(self.client.get("/api/attendees/").status_code, 403)

    def test_submit_and_duplicate(self):
        r = self.client.post("/api/feedback/submit/", {"attendee_id": self.a1.pk, "feedback_data": {"overall": 5}}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.cookies["submission_status"].value, "true")
        fresh = APIClient()
        r2 = fresh.post("/api/feedback/submit/", {"attendee_id": self.a1.pk, "feedback_data": {"overall": 4}}, format="json")
        self.assertEqual(r2.status_code, 400)
        self.assertEqual(r2.json()["code"], "already_submitted")

    def test_same_device_blocked(self):
        self.client.post("/api/feedback/submit/", {"attendee_id": self.a1.pk, "feedback_data": {"x": 1}}, format="json")
        r = self.client.post("/api/feedback/submit/", {"attendee_id": self.a2.pk, "feedback_data": {"x": 1}}, format="json")
        self.assertEqual(r.json()["code"], "device_submitted")

    def test_inactive_form(self):
        cfg = FormSettings.load()
        cfg.form_status = "inactive"
        cfg.save()
        r = self.client.post("/api/feedback/submit/", {"attendee_id": self.a1.pk, "feedback_data": {"x": 1}}, format="json")
        self.assertEqual(r.status_code, 403)


class AdminAuthTests(APITestCase):
    def test_default_admins_exist_and_can_sign_in(self):
        for username in ("benny", "maxwell", "nolan", "ramon"):
            r = self.client.post("/api/auth/login/", {"username": username, "password": f"{username}123"}, format="json")
            self.assertEqual(r.status_code, 200, username)
            self.assertTrue(AdminToken.objects.filter(key=r.json()["token"], user__username=username).exists())

    def test_passwords_are_hashed(self):
        self.assertNotEqual(AdminUser.objects.get(username="benny").password, "benny123")

    def test_wrong_password_and_unknown_user(self):
        r = self.client.post("/api/auth/login/", {"username": "benny", "password": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/auth/login/", {"username": "ghost", "password": "ghost123"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_django_auth_user_cannot_sign_in(self):
        User.objects.create_user("staffer", password="staffer123", is_staff=True, is_superuser=True)
        r = self.client.post("/api/auth/login/", {"username": "staffer", "password": "staffer123"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_inactive_admin_rejected(self):
        AdminUser.objects.filter(username="nolan").update(is_active=False)
        r = self.client.post("/api/auth/login/", {"username": "nolan", "password": "nolan123"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_admin_endpoints_need_token(self):
        self.assertIn(self.client.get("/api/admin/settings/").status_code, (401, 403))
        self.client.credentials(HTTP_AUTHORIZATION="Token not-a-real-token")
        self.assertEqual(self.client.get("/api/admin/settings/").status_code, 401)

    def test_me_and_logout(self):
        token = self.client.post("/api/auth/login/", {"username": "maxwell", "password": "maxwell123"}, format="json").json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(self.client.get("/api/auth/me/").json()["username"], "maxwell")
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)


class LuckyDrawTests(APITestCase):
    def setUp(self):
        self.a1 = Attendee.objects.create(full_name="Priya Sharma", email="priya@example.com", company_name="Shell")
        self.a2 = Attendee.objects.create(full_name="James Smith", email="james@example.com", company_name="BP")
        token = self.client.post("/api/auth/login/", {"username": "benny", "password": "benny123"}, format="json").json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")

    def test_spin_duration_setting(self):
        self.assertEqual(self.client.get("/api/admin/settings/").json()["spin_duration_seconds"], 5)
        r = self.client.patch("/api/admin/settings/", {"spin_duration_seconds": 8}, format="json")
        self.assertEqual(r.json()["spin_duration_seconds"], 8)
        self.assertEqual(self.client.get("/api/lucky-draw/pool/").json()["spin_duration_seconds"], 8)
        for bad in (0, 61):
            self.assertEqual(self.client.patch("/api/admin/settings/", {"spin_duration_seconds": bad}, format="json").status_code, 400)

    def test_spin_hides_name_until_reveal(self):
        s1 = FeedbackSubmission.objects.create(attendee=self.a1, device_fingerprint="a", feedback_data={"x": 1})
        FeedbackSubmission.objects.create(attendee=self.a2, device_fingerprint="b", feedback_data={"x": 1})
        self.client.patch(f"/api/admin/submissions/{s1.id}/suspend/", {}, format="json")
        pool = self.client.get("/api/lucky-draw/pool/").json()
        self.assertEqual(pool["count"], 1)
        self.assertNotIn(s1.id, pool["ids"])

        spin = self.client.post("/api/lucky-draw/spin/").json()
        self.assertEqual(set(spin), {"submission_id", "pad_length"})  # no name before reveal
        self.assertNotEqual(spin["submission_id"], s1.id)

        reveal = self.client.post("/api/lucky-draw/reveal/", {"submission_id": spin["submission_id"], "attempt_number": 1}, format="json")
        self.assertEqual(reveal.status_code, 201)
        self.assertEqual(reveal.json()["attendee_name"], "James Smith")
        self.assertEqual(reveal.json()["drawn_by"], "benny")
        self.assertEqual(LuckyDrawWinner.objects.count(), 1)

    def test_reveal_rejects_suspended(self):
        s1 = FeedbackSubmission.objects.create(attendee=self.a1, device_fingerprint="a", feedback_data={"x": 1}, is_suspended=True)
        r = self.client.post("/api/lucky-draw/reveal/", {"submission_id": s1.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_past_winners_leave_the_pool(self):
        s1 = FeedbackSubmission.objects.create(attendee=self.a1, device_fingerprint="a", feedback_data={"x": 1})
        s2 = FeedbackSubmission.objects.create(attendee=self.a2, device_fingerprint="b", feedback_data={"x": 1})
        self.assertEqual(self.client.post("/api/lucky-draw/reveal/", {"submission_id": s1.id}, format="json").status_code, 201)
        pool = self.client.get("/api/lucky-draw/pool/").json()
        self.assertEqual((pool["ids"], pool["past_winners"]), ([s2.id], 1))
        for _ in range(5):
            self.assertEqual(self.client.post("/api/lucky-draw/spin/").json()["submission_id"], s2.id)
        # the same entry cannot be revealed twice
        self.assertEqual(self.client.post("/api/lucky-draw/reveal/", {"submission_id": s1.id}, format="json").status_code, 400)
        # clearing the history puts winners back in the pool
        self.client.delete("/api/lucky-draw/winners/")
        self.assertEqual(self.client.get("/api/lucky-draw/pool/").json()["count"], 2)
