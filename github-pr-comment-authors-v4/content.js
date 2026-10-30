(() => {
  "use strict";

  let tooltip = null;
  let activeAnchor = null;
  let hoverToken = 0;

  function isPullsPage() {
    return /^\/[^/]+\/[^/]+\/pulls(?:\/|$)?/.test(window.location.pathname);
  }

  function normalizePrUrl(url) {
    const parsed = new URL(url, window.location.origin);
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return {
      owner: decodeURIComponent(match[1]),
      repo: decodeURIComponent(match[2]),
      number: match[3],
      url: `${window.location.origin}/${match[1]}/${match[2]}/pull/${match[3]}`
    };
  }

  function getPrFromCommentAnchor(anchor) {
    const href = anchor.getAttribute("href");
    if (!href) return null;
    return normalizePrUrl(href);
  }

  function findCommentAnchors(root = document) {
    const anchors = Array.from(root.querySelectorAll("a[href*='/pull/']"));
    return anchors.filter((anchor) => {
      const pr = getPrFromCommentAnchor(anchor);
      if (!pr) return false;

      const label = `${anchor.getAttribute("aria-label") || ""} ${anchor.textContent || ""}`.toLowerCase();
      const hasCommentIcon = Boolean(anchor.querySelector("svg.octicon-comment, .octicon-comment-discussion, .octicon-comment"));
      const looksLikeCommentCount = /\bcomment/.test(label) || hasCommentIcon;
      const isPullTitle = anchor.classList.contains("js-navigation-open") || anchor.closest(".markdown-title");

      return looksLikeCommentCount && !isPullTitle;
    });
  }

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "gh-pr-author-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    tooltip.addEventListener("mouseenter", () => {
      if (activeAnchor) tooltip.hidden = false;
    });
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function positionTooltip(anchor) {
    const box = anchor.getBoundingClientRect();
    const tip = ensureTooltip();
    const top = Math.max(8, window.scrollY + box.bottom + 8);
    let left = window.scrollX + box.left + box.width / 2 - tip.offsetWidth / 2;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - tip.offsetWidth - 8));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function showTooltip(anchor, html) {
    const tip = ensureTooltip();
    tip.innerHTML = html;
    tip.hidden = false;
    requestAnimationFrame(() => positionTooltip(anchor));
  }

  function hideTooltip(anchor) {
    if (anchor && activeAnchor !== anchor) return;
    activeAnchor = null;
    if (tooltip) tooltip.hidden = true;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response || !response.ok) {
          reject(response && response.error ? response.error : new Error("No response from background worker."));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function renderLoading(pr) {
    return `
      <div class="gh-pr-author-tooltip__title">PR #${escapeHtml(pr.number)}</div>
      <div class="gh-pr-author-tooltip__muted">Loading review activity from GitHub API...</div>
    `;
  }

  function renderStatusBadge(user) {
    const status = user.status || "UNKNOWN";
    const className = `gh-pr-author-tooltip__status gh-pr-author-tooltip__status--${status.toLowerCase().replaceAll("_", "-")}`;
    return `<span class="${className}">${escapeHtml(user.statusLabel || status)}</span>`;
  }

  function renderPeople(pr, payload) {
    const people = Array.isArray(payload.people) ? payload.people : [];
    if (!people.length) {
      return `
        <div class="gh-pr-author-tooltip__title">PR #${escapeHtml(pr.number)}</div>
        <div class="gh-pr-author-tooltip__muted">No reviewers or comment authors found by the GitHub API.</div>
      `;
    }

    const rows = people.map((user) => {
      const reviewer = user.reviewer ? "Reviewer" : "Commenter only";
      const comments = user.commentCount === 1 ? "1 comment" : `${user.commentCount} comments`;
      const noComment = user.commentCount === 0 ? " gh-pr-author-tooltip__row--no-comment" : "";
      const detailParts = [];
      if (user.issueComments) detailParts.push(`${user.issueComments} conversation`);
      if (user.reviewComments) detailParts.push(`${user.reviewComments} inline`);
      if (user.reviewBodyComments) detailParts.push(`${user.reviewBodyComments} review-body`);
      const detail = detailParts.length ? `<div class="gh-pr-author-tooltip__detail">${escapeHtml(detailParts.join(" · "))}</div>` : "";
      return `
        <li class="gh-pr-author-tooltip__row${noComment}">
          <div class="gh-pr-author-tooltip__user">@${escapeHtml(user.login)}</div>
          <div class="gh-pr-author-tooltip__meta">
            <span>${escapeHtml(reviewer)}</span>
            <span>${escapeHtml(comments)}</span>
          </div>
          ${renderStatusBadge(user)}
          ${detail}
        </li>
      `;
    }).join("");

    const reviewersWithoutComments = payload.reviewersWithoutComments || 0;
    const summary = reviewersWithoutComments > 0
      ? `${reviewersWithoutComments} reviewer${reviewersWithoutComments === 1 ? "" : "s"} with no comments`
      : "No parsed reviewer is missing comments";
    const auth = payload.authenticated ? "token" : "public/unauthenticated";
    const teams = Array.isArray(payload.requestedTeams) && payload.requestedTeams.length
      ? `<div class="gh-pr-author-tooltip__muted">Pending team review: ${escapeHtml(payload.requestedTeams.join(", "))}</div>`
      : "";

    return `
      <div class="gh-pr-author-tooltip__title">PR #${escapeHtml(pr.number)} review activity</div>
      <div class="gh-pr-author-tooltip__muted gh-pr-author-tooltip__summary">${escapeHtml(summary)} · source: GitHub REST API (${escapeHtml(auth)})</div>
      ${teams}
      <ul class="gh-pr-author-tooltip__authors">${rows}</ul>
    `;
  }

  function renderError(pr, error) {
    const status = error && error.status ? `HTTP ${error.status}` : "Error";
    const endpoint = error && error.endpoint ? `<div class="gh-pr-author-tooltip__muted">${escapeHtml(error.endpoint)}</div>` : "";
    return `
      <div class="gh-pr-author-tooltip__title">PR #${escapeHtml(pr.number)}</div>
      <div class="gh-pr-author-tooltip__error">${escapeHtml(status)}: Could not load authoritative review state.</div>
      <div class="gh-pr-author-tooltip__muted">${escapeHtml(error.message || String(error))}</div>
      ${endpoint}
    `;
  }

  async function onEnter(event) {
    const anchor = event.currentTarget;
    const pr = getPrFromCommentAnchor(anchor);
    if (!pr) return;

    activeAnchor = anchor;
    const token = ++hoverToken;
    showTooltip(anchor, renderLoading(pr));

    try {
      const payload = await sendMessage({ type: "GET_PR_ACTIVITY", pr });
      if (activeAnchor !== anchor || token !== hoverToken) return;
      showTooltip(anchor, renderPeople(pr, payload));
    } catch (error) {
      if (activeAnchor !== anchor || token !== hoverToken) return;
      showTooltip(anchor, renderError(pr, error));
    }
  }

  function attach(anchor) {
    if (anchor.dataset.ghPrReviewHoverAttached === "true") return;
    anchor.dataset.ghPrReviewHoverAttached = "true";
    anchor.addEventListener("mouseenter", onEnter);
    anchor.addEventListener("focus", onEnter);
    anchor.addEventListener("mouseleave", () => hideTooltip(anchor));
    anchor.addEventListener("blur", () => hideTooltip(anchor));
  }

  function scan() {
    if (!isPullsPage()) return;
    findCommentAnchors().forEach(attach);
  }

  scan();

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("scroll", () => {
    if (activeAnchor && tooltip && !tooltip.hidden) positionTooltip(activeAnchor);
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (activeAnchor && tooltip && !tooltip.hidden) positionTooltip(activeAnchor);
  });
})();
