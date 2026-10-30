"use strict";

const API_BASE = "https://api.github.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const STATUS_LABELS = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  COMMENTED: "Commented",
  DISMISSED: "Review dismissed",
  PENDING_REQUEST: "Review requested",
  UNKNOWN: "Unknown"
};

const STATUS_SORT = {
  CHANGES_REQUESTED: 5,
  APPROVED: 4,
  COMMENTED: 3,
  DISMISSED: 2,
  PENDING_REQUEST: 1,
  UNKNOWN: 0
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "GET_PR_ACTIVITY") return false;

  getPrActivity(message.pr)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: toPublicError(error) }));

  return true;
});

function toPublicError(error) {
  return {
    message: error && error.message ? error.message : String(error),
    status: error && error.status ? error.status : undefined,
    endpoint: error && error.endpoint ? error.endpoint : undefined
  };
}

async function getStoredToken() {
  const result = await chrome.storage.local.get({ githubToken: "" });
  return String(result.githubToken || "").trim();
}

function cacheKey(pr) {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

async function getPrActivity(pr) {
  validatePr(pr);
  const key = cacheKey(pr);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.payload;

  const token = await getStoredToken();
  const [reviews, requested, reviewComments, issueComments] = await Promise.all([
    fetchAllPages(`/repos/${enc(pr.owner)}/${enc(pr.repo)}/pulls/${enc(pr.number)}/reviews`, token),
    fetchJson(`/repos/${enc(pr.owner)}/${enc(pr.repo)}/pulls/${enc(pr.number)}/requested_reviewers`, token),
    fetchAllPages(`/repos/${enc(pr.owner)}/${enc(pr.repo)}/pulls/${enc(pr.number)}/comments`, token),
    fetchAllPages(`/repos/${enc(pr.owner)}/${enc(pr.repo)}/issues/${enc(pr.number)}/comments`, token)
  ]);

  const payload = buildActivity(pr, {
    reviews,
    requestedReviewers: Array.isArray(requested.users) ? requested.users : [],
    requestedTeams: Array.isArray(requested.teams) ? requested.teams : [],
    reviewComments,
    issueComments,
    authenticated: Boolean(token)
  });

  cache.set(key, { payload, fetchedAt: Date.now() });
  return payload;
}

function validatePr(pr) {
  if (!pr || !pr.owner || !pr.repo || !pr.number) {
    throw new Error("Missing PR owner, repo, or number.");
  }
}

function enc(value) {
  return encodeURIComponent(String(value));
}

async function fetchAllPages(path, token) {
  const output = [];
  let url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}per_page=100`;

  for (let page = 0; page < 20 && url; page += 1) {
    const { data, nextUrl } = await fetchGitHub(url, token);
    if (!Array.isArray(data)) {
      throw new Error(`Expected an array from ${path}.`);
    }
    output.push(...data);
    url = nextUrl;
  }

  return output;
}

async function fetchJson(path, token) {
  const { data } = await fetchGitHub(`${API_BASE}${path}`, token);
  return data;
}

async function fetchGitHub(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { message: text || response.statusText };
  }

  if (!response.ok) {
    const apiMessage = data && data.message ? data.message : response.statusText;
    const error = new Error(
      response.status === 401 || response.status === 403 || response.status === 404
        ? `${apiMessage}. For private repositories, add a fine-grained GitHub token with read-only Pull requests and Issues access in the extension options.`
        : apiMessage
    );
    error.status = response.status;
    error.endpoint = stripQuery(url);
    throw error;
  }

  return {
    data,
    nextUrl: parseNextLink(response.headers.get("Link"))
  };
}

function stripQuery(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return url;
  }
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1];
  }
  return null;
}

function buildActivity(pr, data) {
  const users = new Map();

  for (const comment of data.issueComments) {
    const login = loginOf(comment.user);
    if (!login) continue;
    const user = ensureUser(users, login);
    user.issueComments += 1;
    user.commentCount += 1;
  }

  for (const comment of data.reviewComments) {
    const login = loginOf(comment.user);
    if (!login) continue;
    const user = ensureUser(users, login);
    user.reviewComments += 1;
    user.commentCount += 1;
  }

  const reviewSequence = [...data.reviews]
    .filter((review) => loginOf(review.user))
    .sort((a, b) => reviewTime(a) - reviewTime(b));

  reviewSequence.forEach((review, index) => {
    const login = loginOf(review.user);
    const user = ensureUser(users, login);
    user.reviewer = true;
    user.reviewCount += 1;

    const state = normalizeReviewState(review.state);
    if (state) {
      user.status = state;
      user.statusAt = review.submitted_at || review.updated_at || review.submittedAt || null;
      user.statusOrder = index;
    }

    if (hasBody(review.body)) {
      user.reviewBodyComments += 1;
      user.commentCount += 1;
    }
  });

  for (const reviewer of data.requestedReviewers) {
    const login = loginOf(reviewer);
    if (!login) continue;
    const user = ensureUser(users, login);
    user.reviewer = true;
    if (!user.status || user.status === "UNKNOWN") {
      user.status = "PENDING_REQUEST";
      user.statusAt = null;
    }
  }

  const people = Array.from(users.values()).map((user) => ({
    login: user.login,
    reviewer: user.reviewer,
    status: user.status || "UNKNOWN",
    statusLabel: STATUS_LABELS[user.status || "UNKNOWN"],
    statusAt: user.statusAt,
    commentCount: user.commentCount,
    issueComments: user.issueComments,
    reviewComments: user.reviewComments,
    reviewBodyComments: user.reviewBodyComments,
    reviewCount: user.reviewCount
  })).sort(sortPeople);

  return {
    owner: pr.owner,
    repo: pr.repo,
    number: pr.number,
    source: "github-rest-api",
    authenticated: data.authenticated,
    fetchedAt: new Date().toISOString(),
    reviewersWithoutComments: people.filter((p) => p.reviewer && p.commentCount === 0).length,
    requestedTeams: data.requestedTeams.map((team) => team.slug || team.name).filter(Boolean),
    people
  };
}

function ensureUser(users, login) {
  if (!users.has(login)) {
    users.set(login, {
      login,
      reviewer: false,
      status: "UNKNOWN",
      statusAt: null,
      statusOrder: -1,
      commentCount: 0,
      issueComments: 0,
      reviewComments: 0,
      reviewBodyComments: 0,
      reviewCount: 0
    });
  }
  return users.get(login);
}

function loginOf(user) {
  const login = user && typeof user.login === "string" ? user.login.trim() : "";
  return /^[A-Za-z0-9-]+$/.test(login) ? login : null;
}

function normalizeReviewState(state) {
  const normalized = String(state || "").toUpperCase();
  if (["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function reviewTime(review) {
  const value = review.submitted_at || review.updated_at || review.created_at || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasBody(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sortPeople(a, b) {
  if (a.reviewer !== b.reviewer) return a.reviewer ? -1 : 1;
  const statusDelta = (STATUS_SORT[b.status] || 0) - (STATUS_SORT[a.status] || 0);
  if (statusDelta) return statusDelta;
  if (b.commentCount !== a.commentCount) return b.commentCount - a.commentCount;
  return a.login.localeCompare(b.login);
}
