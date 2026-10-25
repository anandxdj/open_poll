// Landing copy that search results and AI answers reuse (FAQ JSON-LD and
// llms.txt read it from here), so the page and those summaries never disagree.

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQS: FaqItem[] = [
  {
    q: "Does my audience need an account?",
    a: "No. People join a live session with its code or QR code, choose a nickname and answer from their phone. Only the people who build and present decks need an account.",
  },
  {
    q: "What kinds of questions can I ask?",
    a: "Multiple choice (scored or not), typed answers, word clouds, open-ended responses, scales, rankings, number guesses, 100-point splits, 2 by 2 grids and pins on an image, plus Q&A with upvotes and emoji reactions.",
  },
  {
    q: "Can I use my existing slides or questions?",
    a: "Yes. Import a PowerPoint or PDF file, a Google Slides link, or a CSV or Excel list of questions. Some content, such as charts or videos, may need a quick check afterwards, and the import result lists what to review.",
  },
  {
    q: "How does the AI deck generator work?",
    a: "Describe your topic and audience. AI proposes an outline for you to review, then writes the slides with speaker notes. You can edit every slide, and monthly generation limits depend on your plan.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. Free lets you build decks and run live sessions with a smaller audience and fewer AI and import runs. The pricing section above always shows the current limits of every plan.",
  },
  {
    q: "Can my team work together?",
    a: "Yes. Invite people to a workspace and give each a role: owner, admin, editor, presenter or viewer. Decks can be shared with members, and workspace activity is recorded in an audit log.",
  },
  {
    q: "What can I do with the results?",
    a: "Every run of a deck is saved as a session with a report: results per slide, a leaderboard for quizzes and a participants table. Export it as CSV (Excel and PDF on paid plans), share a read-only results link, or delete the session when you no longer need it.",
  },
];
