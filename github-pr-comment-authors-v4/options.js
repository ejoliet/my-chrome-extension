"use strict";

const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");
const saveButton = document.getElementById("save");
const clearButton = document.getElementById("clear");
const toggleButton = document.getElementById("toggle");

chrome.storage.local.get({ githubToken: "" }, (result) => {
  tokenInput.value = result.githubToken || "";
  statusEl.textContent = result.githubToken ? "A token is saved locally in this browser profile." : "No token saved.";
});

saveButton.addEventListener("click", () => {
  const githubToken = tokenInput.value.trim();
  chrome.storage.local.set({ githubToken }, () => {
    statusEl.textContent = githubToken ? "Saved." : "Token cleared.";
  });
});

clearButton.addEventListener("click", () => {
  tokenInput.value = "";
  chrome.storage.local.remove("githubToken", () => {
    statusEl.textContent = "Token cleared.";
  });
});

toggleButton.addEventListener("click", () => {
  const showing = tokenInput.type === "text";
  tokenInput.type = showing ? "password" : "text";
  toggleButton.textContent = showing ? "Show" : "Hide";
});
