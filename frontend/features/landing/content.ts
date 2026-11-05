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
    q: "Can I use my existing slides or questions?",
    a: "Yes. Import a PowerPoint or PDF file, a Google Slides link, or a CSV or Excel list of questions. Some content, such as charts or videos, may need a quick check afterwards, and the import result lists what to review.",
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
