// Question text for the saved feedback_data keys, in the order of the form. Keep in step with
// src/feedback/config/feedbackQuestions.js on the frontend.
const QUESTIONS = [
  ["conference_thoughts", "Could you share a brief testimonial?"],
  ["industry_challenges", "What are the biggest challenges facing your industry?"],
  ["heard_about", "How did you first hear about this conference?"],
  ["suggested_companies", "Who would you like to see at our next conference?"],
  ["specialist_topics", "What specialist topics deserve a dedicated conference?"],
  // Question 6 on the form, between the fifth and sixth questions.
  ["speaker_reviews", "Which presentations did you find most valuable?"],
  ["associations", "Which industry associations are you a member of?"],
  ["publications", "Which industry publications or newsletters do you read?"],
  ["upcoming_interest", "Which of our upcoming conferences interest you?"],
];

// Keys from earlier versions of the form.
const LEGACY_LABELS = {
  conference_thoughts_original: "Original words, before Polish",
  conference_thoughts_version: "Polished with AI or own words",
  conference_thoughts_consent: "May we use your testimonial to market future events?",
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

const EXTRA_SUFFIXES = ["_original", "_version", "_consent"];

function questionLabel(key) {
  const q = QUESTIONS.find(([k]) => k === key);
  return q ? q[1] : LEGACY_LABELS[key] || key.replace(/_/g, " ");
}

/** Saved answers as [{ sr_no, question, response }] in the order of the form, MySQL returns JSON keys sorted instead. */
function feedbackList(data) {
  const rank = (key) => {
    const index = QUESTIONS.findIndex(([k]) => k === key);
    if (index !== -1) return index * 10;
    for (const [i, suffix] of EXTRA_SUFFIXES.entries()) {
      const base = QUESTIONS.findIndex(([k]) => key === `${k}${suffix}`);
      if (base !== -1) return base * 10 + i + 1;
    }
    return QUESTIONS.length * 10;
  };
  const entries = Object.entries(data && typeof data === "object" ? data : {}).sort(([a], [b]) => rank(a) - rank(b));
  const pad = Math.max(2, String(entries.length).length);
  return entries.map(([key, response], i) => ({
    sr_no: String(i + 1).padStart(pad, "0"),
    question: questionLabel(key),
    response,
  }));
}

module.exports = { feedbackList, questionLabel };
