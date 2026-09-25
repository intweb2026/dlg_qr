import random

from django.core.management.base import BaseCommand

from feedback.models import Attendee, FormSettings

FIRST = ["Aarav", "Priya", "James", "Olivia", "Mohammed", "Sofia", "Liam", "Ananya", "Noah", "Emma",
         "Rohan", "Isabella", "Lucas", "Meera", "Ethan", "Chloe", "Arjun", "Mia", "Daniel", "Zara"]
LAST = ["Sharma", "Patel", "Smith", "Johnson", "Khan", "Garcia", "Brown", "Iyer", "Wilson", "Taylor",
        "Mehta", "Martin", "Lee", "Nair", "Walker", "Clark", "Gupta", "Lopez", "Hall", "Young"]
COMPANIES = ["Shell", "BP", "Siemens Energy", "Aramco", "TotalEnergies", "Honeywell", "Schneider Electric",
             "ABB", "Wood PLC", "Baker Hughes", "Petrofac", "Equinor", "Worley", "SLB", "Halliburton"]


class Command(BaseCommand):
    help = "Create sample attendees for local testing (and the default form settings row)."

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=50)

    def handle(self, *args, **opts):
        FormSettings.load()
        created = 0
        for i in range(opts["count"]):
            first, last = random.choice(FIRST), random.choice(LAST)
            email = f"{first}.{last}.{i}@example.com".lower()
            _, new = Attendee.objects.get_or_create(
                email=email,
                defaults={"full_name": f"{first} {last}", "company_name": random.choice(COMPANIES)},
            )
            created += int(new)
        self.stdout.write(self.style.SUCCESS(f"Created {created} attendees."))
