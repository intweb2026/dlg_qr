// Edit this list to change the form. Keys are stored in feedback_data (JSON) on the backend.
// Types: "radio" and "select" save the chosen option, "checkbox" saves a list of options, "textarea" saves text,
// "list" shows one text field per entry in "fields" and saves the filled ones as a list.
// A "radio" question with "other" set shows a text field when that option is picked, saved as "Other: <text>".
// "aiSuggestion" on a textarea offers a polished testimonial written by Gemini from the attendee's words, see
// components/TestimonialAssist.js; "consentLabel" is the Yes or No marketing question shown under it.
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
    consentLabel: "May we use your comments to market future events?",
  },
  {
    key: "industry_challenges",
    step: 2,
    label: "What are the three biggest challenges currently facing your industry?",
    hint: "Keywords or short phrases are fine.",
    type: "list",
    required: true,
    fields: [
      { placeholder: "1. Enter first challenge", required: true },
      { placeholder: "2. Enter second challenge" },
      { placeholder: "3. Enter third challenge" },
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
    hint: "You can suggest specific companies, organizations or types of industry professionals",
    type: "list",
    fields: [
      { placeholder: "1. Enter suggestion" },
      { placeholder: "2. Enter suggestion" },
      { placeholder: "3. Enter suggestion" },
    ],
  },
  {
    key: "specialist_topics",
    step: 4,
    label: "Are there any specialist topics you feel deserve a dedicated conference?",
    hint: "Emerging technologies, industry challenges or subjects needing deeper discussion.",
    type: "textarea",
    placeholder: "Enter your suggestion(s)...",
  },
  {
    key: "associations",
    step: 5,
    label: "Which industry associations are you a member of?",
    hint: "List up to three. Names or abbreviations are fine.",
    type: "list",
    fields: [
      { placeholder: "1. Association name" },
      { placeholder: "2. Association name" },
      { placeholder: "3. Association name" },
    ],
  },
  {
    key: "publications",
    step: 5,
    label: "Which industry publications or newsletters do you regularly read?",
    hint: "List up to three. Print or online publications are fine.",
    type: "list",
    fields: [
      { placeholder: "1. Publication or newsletter" },
      { placeholder: "2. Publication or newsletter" },
      { placeholder: "3. Publication or newsletter" },
    ],
  },
  {
    key: "upcoming_interest",
    step: 6,
    label: "Which of our upcoming conferences interest you?",
    hint: "Select all the conferences that interest you.",
    type: "checkbox",
    optionsFrom: "upcomingConferences",
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
  conference_thoughts_original: "Original words, before Polish",
  conference_thoughts_version: "Polished with AI or own words",
  conference_thoughts_consent: "May we use your comments to market future events?",
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

// The extra answers saved beside a question, shown straight after it in this order.
const EXTRA_SUFFIXES = ["_original", "_version", "_consent"];

/**
 * The saved answers as [key, value] pairs in the order of the form. MySQL keeps JSON keys sorted by length and then
 * by name, so the order they come back in is not the order of the questions. Each question's extra answers, such as
 * conference_thoughts_original, follow it, and keys from earlier versions of the form go last in their saved order.
 */
export function orderedAnswers(data) {
  const entries = Object.entries(data || {});
  const rank = (key) => {
    const index = feedbackQuestions.findIndex((q) => q.key === key);
    if (index !== -1) return index * 10;
    for (const [i, suffix] of EXTRA_SUFFIXES.entries()) {
      const base = feedbackQuestions.findIndex((q) => key === `${q.key}${suffix}`);
      if (base !== -1) return base * 10 + i + 1;
    }
    return feedbackQuestions.length * 10;
  };
  // sort is stable, so keys of the same rank stay in the order they were saved.
  return entries.sort(([a], [b]) => rank(a) - rank(b));
}

export function questionLabel(key) {
  const q = feedbackQuestions.find((item) => item.key === key);
  if (q) return q.label;
  return legacyLabels[key] || key.replace(/_/g, " ");
}

export default feedbackQuestions;
