const availability = document.querySelector("#availability");
const availabilityText = document.querySelector("#availabilityText");
const linkField = document.querySelector("#linkField");
const currentLink = document.querySelector("#currentLink");
const openLink = document.querySelector("#openLink");
const copyLink = document.querySelector("#copyLink");
const refreshLink = document.querySelector("#refreshLink");
const updatedAt = document.querySelector("#updatedAt");
const feedback = document.querySelector("#feedback");

let activeUrl = "";
const gatewayUrl = new URL("/login", window.location.origin).toString();
const shareUrl = new URL("/", window.location.origin).toString();

function setUnavailable(message) {
  activeUrl = "";
  availability.dataset.state = "error";
  availabilityText.textContent = "Link unavailable";
  linkField.dataset.state = "error";
  currentLink.textContent = message;
  openLink.href = "#";
  openLink.classList.add("is-disabled");
  openLink.setAttribute("aria-disabled", "true");
  copyLink.disabled = true;
  updatedAt.textContent = "Not available";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

async function loadLink() {
  availability.dataset.state = "loading";
  availabilityText.textContent = "Checking access link";
  feedback.textContent = "";
  feedback.classList.remove("is-error");

  try {
    const response = await fetch(`/link.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("The link configuration could not be loaded.");

    const config = await response.json();
    const parsedUrl = new URL(config.url);
    if (config.active === false || parsedUrl.protocol !== "https:") {
      throw new Error("No active HTTPS tunnel is published.");
    }

    activeUrl = gatewayUrl;
    availability.dataset.state = "ready";
    availabilityText.textContent = "Access link available";
    delete linkField.dataset.state;
    currentLink.textContent = shareUrl;
    openLink.href = activeUrl;
    openLink.classList.remove("is-disabled");
    openLink.setAttribute("aria-disabled", "false");
    copyLink.disabled = false;
    updatedAt.textContent = formatTimestamp(config.updatedAt);
  } catch (error) {
    setUnavailable(error.message || "No active link has been published.");
  }
}

copyLink.addEventListener("click", async () => {
  if (!activeUrl) return;
  try {
    await navigator.clipboard.writeText(shareUrl);
    feedback.textContent = "Link copied to clipboard.";
    feedback.classList.remove("is-error");
  } catch {
    feedback.textContent = "Copy was blocked by the browser. Select the link above instead.";
    feedback.classList.add("is-error");
  }
});

refreshLink.addEventListener("click", loadLink);
loadLink();
