// Render beacon — confirms a REAL human landed from a /r/ short link.
// Only fires when the page carries utm_medium=social (i.e. came through our
// redirect), and only after a ~1.1s dwell + a visible paint — so URL scanners
// and proxies that hit the redirect and vanish never count. Cookieless, no PII;
// just source / campaign / path so Insights can build clicks → renders → sign-ups.
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("utm_medium") !== "social") return;
    var source = q.get("utm_source") || "";
    var campaign = q.get("utm_campaign") || "";
    if (!source || !campaign) return;

    var sent = false;
    function fire() {
      if (sent || document.visibilityState === "hidden") return;
      sent = true;
      var body = JSON.stringify({ source: source, campaign: campaign, path: location.pathname });
      try {
        var blob = new Blob([body], { type: "application/json" });
        if (!(navigator.sendBeacon && navigator.sendBeacon("/e", blob))) {
          fetch("/e", { method: "POST", body: body, headers: { "content-type": "application/json" }, keepalive: true });
        }
      } catch (e) {
        try {
          fetch("/e", { method: "POST", body: body, headers: { "content-type": "application/json" }, keepalive: true });
        } catch (e2) {}
      }
    }
    // dwell gate: a real visitor is still here ~1.1s after paint; bots have left
    setTimeout(fire, 1100);
  } catch (e) {}
})();
