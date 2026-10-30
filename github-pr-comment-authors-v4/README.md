# GitHub PR Review Hover

Chrome Manifest V3 extension for GitHub pull request list pages.

On `https://github.com/<org>/<repo>/pulls`, hover the comment-count icon for a PR to see:

- Reviewers, including reviewers who did not leave comments.
- Latest review state per reviewer: Approved, Changes requested, Commented, Review requested, Review dismissed, or Unknown.
- Comment counts per user.
- Breakdown of conversation comments, inline review comments, and review-body comments.

## Why v4 changed

Earlier versions inferred reviewer state from GitHub's rendered PR HTML. That is unreliable. GitHub often renders requested-review state, sidebar state, timeline state, and lazy-loaded fragments differently. v4 uses GitHub's REST API as the source of truth:

- `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`

## Install locally

1. Unzip this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped `github-pr-comment-authors-v4` folder.
6. Open a GitHub PR list page and hover a PR comment icon.

## Private repositories

Public repositories can work without a token. Private repositories usually need a GitHub token because the official REST API will not authorize private repository access from your normal GitHub web session.

To configure a token:

1. Create a fine-grained personal access token in GitHub.
2. Restrict it to the repository or organization you need.
3. Grant read-only `Pull requests` and read-only `Issues` permissions.
4. Open the extension options page.
5. Paste and save the token.

The token is stored in `chrome.storage.local` in your local browser profile. It is sent only to `https://api.github.com/*`.

## Important behavior

- The latest review state per reviewer is computed from chronological PR review records.
- A user who approved without a body or inline comments appears as `Reviewer · 0 comments · Approved`.
- A currently requested reviewer without a submitted review appears as `Reviewer · 0 comments · Review requested`.
- Commenter-only users appear as `Commenter only` and have status `Unknown`.
- If the API cannot answer, the tooltip shows an error instead of guessing.

## Limitations

- Team review requests are shown as pending teams, but they are not expanded to individual members. Expanding teams requires additional organization/team API access and is ambiguous because GitHub does not assign the request to every team member.
- Large PRs are paginated up to 2,000 records per endpoint in this build.
- The extension does not mutate GitHub data.
