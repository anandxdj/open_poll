# Anonymity

What a host can and cannot learn about the people who answer. Use it to answer "is this
anonymous?" honestly.

## Live sessions

- Participants never need an account. They join with a nickname they type themselves, and the
  host sees it in the leaderboard, the report and the exports. Anonymity is only as good as that
  choice: "Ada" is anonymous, a full name is not.
- Answers are stored per participant (`presentationanswers.participantId`), so the report and the
  exports can show who answered what, under the nickname.
- Audience Q&A can allow anonymous questions (`anonymousAllowed`); those store no author name.
  Upvotes are stored per participant to prevent double votes, and are never shown with names.
- A participant can remove their name and answers from an ended session on their results page.
  Their row in the final leaderboard keeps its place as "Removed participant". The session totals
  (counts, averages, word clouds) keep their contribution without a name.

## Polls

- Anonymous polls (`isAnonymous`, the default) store a random ballot id per response, not who
  answered. A signed-in respondent is still recorded by user id, to stop double voting.
- Non-anonymous polls record the signed-in user, or the guest's email and name.

## What is never shown to hosts

Device ids, participant tokens and anything from another workspace. The live engine does not store
participants' IP addresses with their answers (rate limits key short-lived Redis counters by IP).
