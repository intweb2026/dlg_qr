import hashlib
import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from feedback.models import Attendee, FeedbackSubmission, FormSettings

FIRST = [
    "Aisha", "Benjamin", "Carlos", "Deepika", "Elena", "Farhan", "Grace", "Hiroshi", "Ingrid", "Jamal",
    "Kavya", "Lorenzo", "Mariam", "Nikolai", "Oluwaseun", "Pooja", "Quentin", "Rania", "Samuel", "Tanvi",
    "Umar", "Valentina", "William", "Ximena", "Yusuf", "Zoe", "Adrian", "Bianca", "Cyrus", "Divya",
    "Elias", "Fatima", "Gabriel", "Hannah", "Ishaan", "Julia", "Kenji", "Leila", "Mateo", "Nadia",
]
LAST = [
    "Al Mansoori", "Bennett", "Castillo", "Desai", "Eriksen", "Fernandes", "Gonzalez", "Haddad", "Ibrahim", "Jensen",
    "Kapoor", "Lindqvist", "Menon", "Novak", "Okafor", "Pereira", "Qureshi", "Rossi", "Sato", "Thompson",
    "Usman", "Varga", "Williams", "Xu", "Yamamoto", "Zimmermann", "Anand", "Bose", "Chowdhury", "Dubois",
]
COMPANIES = [
    "ADNOC", "Shell", "BP", "Siemens Energy", "Aramco", "TotalEnergies", "Honeywell", "Schneider Electric", "ABB",
    "Wood PLC", "Baker Hughes", "Petrofac", "Equinor", "Worley", "SLB", "Halliburton", "Emerson", "Yokogawa",
    "KBR", "McDermott", "Technip Energies", "Fluor", "QatarEnergy", "ENOC", "Masdar",
]
MOST_VALUABLE = [
    "The keynote on energy transition was excellent.",
    "Networking with peers from other operators.",
    "The panel on digital twins gave us ideas we can use right away.",
    "Hands-on workshops, especially the AI in maintenance session.",
    "Meeting suppliers in the exhibition hall.",
    "Case studies from real projects, very practical.",
    "The hydrogen roundtable.",
    "Clear, well prepared speakers.",
    "Learning how other teams approach decarbonisation.",
    "The closing fireside chat.",
    "",
]
SUGGESTIONS = [
    "Longer breaks between sessions for networking.",
    "More seating in the main hall.",
    "Share the slides after each session.",
    "Better Wi-Fi in the breakout rooms.",
    "More vegetarian options at lunch.",
    "Start the second day a little later.",
    "Add a mobile app with the agenda.",
    "More time for audience questions.",
    "Clearer signage to the workshop rooms.",
    "Nothing, it was very well organised.",
    "",
]


def weighted_rating():
    return random.choices([1, 2, 3, 4, 5], weights=[3, 6, 20, 38, 33])[0]


class Command(BaseCommand):
    help = "Add demo attendees and feedback submissions for testing the form, admin panel and lucky draw."

    def add_arguments(self, parser):
        parser.add_argument("--attendees", type=int, default=100, help="New attendees to create (default 100).")
        parser.add_argument("--feedback", type=int, default=50, help="New feedback submissions to create (default 50).")

    @transaction.atomic
    def handle(self, *args, **opts):
        FormSettings.load()
        created_attendees = self.create_attendees(opts["attendees"])
        created_feedback = self.create_feedback(opts["feedback"])
        self.stdout.write(self.style.SUCCESS(
            f"Created {created_attendees} attendees and {created_feedback} feedback submissions. "
            f"Totals now {Attendee.objects.count()} attendees, {FeedbackSubmission.objects.count()} submissions."
        ))

    def create_attendees(self, count):
        taken = set(Attendee.objects.values_list("full_name", flat=True))
        combos = [f"{f} {l}" for f in FIRST for l in LAST if f"{f} {l}" not in taken]
        random.shuffle(combos)
        if len(combos) < count:
            self.stdout.write(self.style.WARNING(f"Only {len(combos)} unused names left, creating that many."))
        created = 0
        for name in combos[:count]:
            base = name.lower().replace(" ", ".")
            email, n = f"{base}@example.com", 2
            while Attendee.objects.filter(email=email).exists():
                email, n = f"{base}{n}@example.com", n + 1
            Attendee.objects.create(full_name=name, email=email, company_name=random.choice(COMPANIES))
            created += 1
        return created

    def create_feedback(self, count):
        pending = list(Attendee.objects.filter(feedback_submission__isnull=True))
        random.shuffle(pending)
        if len(pending) < count:
            self.stdout.write(self.style.WARNING(f"Only {len(pending)} attendees without feedback, creating that many."))
        now = timezone.now()
        created = 0
        for attendee in pending[:count]:
            data = {
                "overall_experience": weighted_rating(),
                "content_quality": weighted_rating(),
                "speakers": weighted_rating(),
                "networking": weighted_rating(),
                "venue_organisation": weighted_rating(),
                "attend_again": random.choices(["Yes", "Maybe", "No"], weights=[70, 22, 8])[0],
            }
            for key, pool in (("most_valuable", MOST_VALUABLE), ("suggestions", SUGGESTIONS)):
                text = random.choice(pool)
                if text:
                    data[key] = text
            fingerprint = hashlib.sha256(f"demo-{attendee.pk}-{random.random()}".encode()).hexdigest()
            sub = FeedbackSubmission.objects.create(attendee=attendee, device_fingerprint=fingerprint, feedback_data=data)
            # Spread submission times over the last few hours so the admin table looks realistic
            FeedbackSubmission.objects.filter(pk=sub.pk).update(
                created_at=now - timedelta(minutes=random.randint(5, 360))
            )
            created += 1
        return created
