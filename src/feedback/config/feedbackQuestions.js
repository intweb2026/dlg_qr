// Edit this list to change the form. Keys are stored in feedback_data (JSON) on the backend.
// Types: "radio" and "select" save the chosen option, "checkbox" saves a list of options, "textarea" saves text.
const feedbackQuestions = [
  {
    key: "overall_rating",
    label: "How would you rate the overall event?",
    type: "radio",
    options: ["Excellent", "Good", "Average", "Poor"],
    required: true,
  },
  {
    key: "session_format",
    label: "Which session format was most valuable to you?",
    type: "select",
    options: ["Keynote presentations", "Technical sessions", "Panel discussions", "Case studies", "Networking breaks"],
    required: true,
  },
  {
    key: "valued_aspects",
    label: "Which aspects did you value most?",
    type: "checkbox",
    options: ["Speakers", "Networking", "Content", "Venue"],
    required: true,
  },
  { key: "improvements", label: "What could we improve for next time?", type: "textarea" },
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
