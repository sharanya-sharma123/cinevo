async function api(url, method = "GET", body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: r.status });
  return data;
}
function authForm(formId, url, fields) {
  const f = document.getElementById(formId), err = document.getElementById("err");
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); err.classList.remove("show");
    const body = {}; fields.forEach((k) => (body[k] = document.getElementById(k).value));
    const btn = f.querySelector("button"); btn.disabled = true;
    try { await api(url, "POST", body); location.href = "/list.html"; }
    catch (x) { err.textContent = x.message; err.classList.add("show"); btn.disabled = false; }
  });
}
