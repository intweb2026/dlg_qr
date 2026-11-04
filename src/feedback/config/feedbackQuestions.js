// Edit this list to change the form. Keys are stored in feedback_data (JSON) on the backend.
// Types: "radio" and "select" save the chosen option, "checkbox" saves a list of options, "textarea" saves text,
// "list" shows one text field per entry in "fields" and saves the filled ones as a list.
// A "radio" question with "other" set shows a text field when that option is picked, saved as "Other: <text>".
// "showOptional" shows an Optional label on a question that is not required.
// "aiSuggestion" on a textarea offers a polished testimonial written by Claude from the attendee's words, see
// components/TestimonialAssist.js; "consentLabel" is the publishing agreement shown with it.
// "optionsFrom" names a list the form loads from the API, each item { name, dates, location }, used as the options;
// the question is left out while that list is empty. "upcomingConferences" comes from the event's website,
// see backend/src/views/upcomingConferences.js.
const feedbackQuestions = [
  // Step 1 is the name, company and email; every question names the step it is shown on, 2 and up.
  {
    key: "conference_thoughts",
    step: 2,
    label: "What did you think of the conference?",
    hint: "A few words are enough.",
    type: "textarea",
    placeholder: "Type a few words about your experience...",
    aiSuggestion: true,
    consentLabel: "I agree that my comments may be published with my name and organization in future event marketing.",
  },
  {
    key: "industry_challenges",
    step: 2,
    label: "What are the three biggest challenges currently facing your industry?",
    hint: "Keywords or short phrases are fine.",
    type: "list",
    required: true,
    fields: [
      { placeholder: "1. Enter first challenge *", required: true },
      { placeholder: "2. Enter second challenge (optional)" },
      { placeholder: "3. Enter third challenge (optional)" },
    ],
  },
  {
    key: "heard_about",
    step: 3,
    label: "How did you first hear about this conference?",
    hint: "Select one answer.",
    type: "radio",
    required: true,
    options: [
      "Email invitation from the organizer",
      "Phone call from the organizer",
      "Google or Search engine",
      "Colleague or Word of mouth",
      "LinkedIn or Social media",
      "Industry publication or Association",
      "Attended a previous event",
      "Other (please specify)",
    ],
    other: "Other (please specify)",
    otherPlaceholder: "Please specify *",
  },
  {
    key: "suggested_companies",
    step: 4,
    label: "Which companies or industry groups would you like to see at our next conference?",
    hint: "You can suggest specific companies, organizations or types of industry professionals.",
    type: "list",
    fields: [
      { placeholder: "1. Enter suggestion (optional)" },
      { placeholder: "2. Enter suggestion (optional)" },
      { placeholder: "3. Enter suggestion (optional)" },
    ],
  },
  {
    key: "specialist_topics",
    step: 4,
    label: "Are there any specialist topics you feel deserve a dedicated conference?",
    hint: "Emerging technologies, industry challenges or subjects needing deeper discussion.",
    type: "textarea",
    placeholder: "Enter your suggestion(s)...",
    showOptional: true,
  },
  {
    key: "associations",
    step: 5,
    label: "Which industry associations are you a member of?",
    hint: "List up to three. Names or abbreviations are fine.",
    type: "list",
    fields: [
      { placeholder: "1. Association name (optional)" },
      { placeholder: "2. Association name (optional)" },
      { placeholder: "3. Association name (optional)" },
    ],
  },
  {
    key: "publications",
    step: 5,
    label: "Which industry publications or newsletters do you regularly read?",
    hint: "List up to three. Print or online publications are fine.",
    type: "list",
    fields: [
      { placeholder: "1. Publication or newsletter (optional)" },
      { placeholder: "2. Publication or newsletter (optional)" },
      { placeholder: "3. Publication or newsletter (optional)" },
    ],
  },
  {
    key: "upcoming_interest",
    step: 6,
    label: "Which of our upcoming conferences interest you?",
    hint: "Select any that catch your interest.",
    type: "checkbox",
    optionsFrom: "upcomingConferences",
    showOptional: true,
  },
];

export const ratingScale = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Good" },
  { value: 4, label: "Very good" },
  { value: 5, label: "Excellent" },
];

// Labels for keys from earlier versions of the form, so older submissions still read well in the admin.
const legacyLabels = {
  conference_thoughts_original: "Original words, before the suggested testimonial",
  conference_thoughts_version: "Testimonial version used",
  conference_thoughts_consent: "May be published with name and organization",
  overall_rating: "How would you rate the overall event?",
  session_format: "Which session format was most valuable to you?",
  valued_aspects: "Which aspects did you value most?",
  improvements: "What could we improve for next time?",
  overall_experience: "How would you rate the summit overall?",
  content_quality: "Quality of the sessions and content",
  speakers: "Speakers and panellists",
  networking: "Networking opportunities",
  venue_organisation: "Venue and organisation",
  attend_again: "Would you attend next year?",
  most_valuable: "What was the most valuable part of the summit?",
  suggestions: "What should we improve next time?",
};

export function questionLabel(key) {
  const q = feedbackQuestions.find((item) => item.key === key);
  if (q) return q.label;
  return legacyLabels[key] || key.replace(/_/g, " ");
}

export default feedbackQuestions;
