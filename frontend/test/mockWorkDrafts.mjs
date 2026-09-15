// Isolate legacy feature suites from autosave traffic. Recovery semantics are
// covered by workDrafts.browser.mjs against the real authenticated draft API.
export async function mockWorkDrafts(page, { resume = false } = {}) {
  const drafts = new Map();
  await page.route(url => url.pathname.startsWith("/api/work-drafts"), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split("/")[3];
    let body = { data: [] };
    if (request.method() === "PUT") {
      const value = request.postDataJSON();
      const row = { ...value, _id: id, revision: value.revision + 1, updatedAt: new Date().toISOString() };
      drafts.set(id, row); body = { data: row };
    } else if (request.method() === "DELETE") { drafts.delete(id); body = { success: true }; }
    else if (request.method() === "POST") body = { data: { __draftFile: "fixture-file", name: "fixture.pdf", type: "application/pdf" } };
    else if (id) body = { data: drafts.get(id) || null };
    else if (resume) body = { data: [...drafts.values()].filter(row => (!url.searchParams.has("scope") || row.scope === url.searchParams.get("scope")) && (!url.searchParams.has("recordId") || row.recordId === url.searchParams.get("recordId"))).reverse() };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return drafts;
}
